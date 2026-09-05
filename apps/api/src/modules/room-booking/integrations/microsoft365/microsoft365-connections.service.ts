import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { OrgScopedService } from '../../../../common/org-scoped.service';
import { AuditService } from '../../../audit/audit.service';
import { RoomBookingEncryptionService } from '../../encryption.service';
import { Microsoft365CalendarProvider } from './microsoft365-calendar.provider';
import { MicrosoftGraphClient, MicrosoftGraphError, type Microsoft365Credentials } from './microsoft-graph.client';
import type { ConnectMicrosoft365Dto } from './dto/connect-microsoft365.dto';

interface GraphRoom { id: string; displayName?: string; emailAddress: string; capacity?: number }
interface GraphRoomListResponse { value: GraphRoom[] }

const SUBSCRIPTION_LIFETIME_MINUTES = 60 * 24 * 2.9; // Graph caps calendar-event subscriptions at ~4230 minutes

// docs/modules/room_booking_module_plan.md §13.4 — connect/disconnect/room-discovery/mapping for
// the Microsoft 365 connector. Credentials are encrypted at rest (RoomBookingEncryptionService)
// and never returned from any method here.
@Injectable()
export class Microsoft365ConnectionsService {
  private readonly logger = new Logger(Microsoft365ConnectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScoped: OrgScopedService,
    private readonly audit: AuditService,
    private readonly encryption: RoomBookingEncryptionService,
    private readonly provider: Microsoft365CalendarProvider,
  ) {}

  async connect(orgId: string, dto: ConnectMicrosoft365Dto, actorUserId: string) {
    const credentials: Microsoft365Credentials = { tenantId: dto.tenantId, clientId: dto.clientId, clientSecret: dto.clientSecret };
    const client = new MicrosoftGraphClient(credentials);
    try {
      await client.testConnection();
    } catch (err) {
      if (err instanceof MicrosoftGraphError) throw new BadRequestException(`Could not connect to Microsoft 365: ${err.message}`);
      throw err;
    }

    const connection = await this.prisma.roomCalendarConnection.create({
      data: {
        organizationId: orgId,
        providerKey: 'MICROSOFT_365',
        displayName: dto.displayName,
        status: 'CONNECTED',
        encryptedCredential: this.encryption.encrypt(JSON.stringify(credentials)),
        externalTenantId: dto.tenantId,
        lastSuccessfulSyncAt: new Date(),
      },
    });
    await this.audit.log({ organizationId: orgId, userId: actorUserId, action: 'room.integration.connect', resourceType: 'RoomCalendarConnection', resourceId: connection.id, metadata: { providerKey: 'MICROSOFT_365', displayName: dto.displayName } });
    return this.toHealthDto(connection);
  }

  // §7.4/§14 — credentials are deleted immediately; the connection row itself is kept (status
  // DISCONNECTED) for its health/history metadata, and every room that referenced it is
  // explicitly unmapped rather than left silently pointing at a dead connection.
  async disconnect(orgId: string, connectionId: string, actorUserId: string) {
    const connection = await this.assertOwnsConnection(orgId, connectionId);
    await this.prisma.$transaction([
      this.prisma.roomCalendarConnection.update({
        where: { id: connectionId },
        data: { status: 'DISCONNECTED', encryptedCredential: null, webhookSubscriptionId: null, webhookExpiresAt: null },
      }),
      this.prisma.bookableRoom.updateMany({ where: { calendarConnectionId: connectionId }, data: { calendarConnectionId: null } }),
    ]);
    await this.audit.log({ organizationId: orgId, userId: actorUserId, action: 'room.integration.disconnect', resourceType: 'RoomCalendarConnection', resourceId: connection.id, metadata: {} });
  }

  async listConnections(orgId: string) {
    const connections = await this.prisma.roomCalendarConnection.findMany({ where: { organizationId: orgId, providerKey: 'MICROSOFT_365' } });
    return Promise.all(connections.map((c) => this.toHealthDto(c)));
  }

  // Room resources not yet mapped to a BookableRoom in this org.
  async listMappableRooms(orgId: string, connectionId: string) {
    await this.assertOwnsConnection(orgId, connectionId);
    const client = await this.buildClient(connectionId);
    const response = await client.request<GraphRoomListResponse>('/places/microsoft.graph.room?$top=200');
    const alreadyMapped = new Set(
      (await this.prisma.bookableRoom.findMany({ where: { calendarConnectionId: connectionId }, select: { externalResourceEmail: true } }))
        .map((r) => r.externalResourceEmail),
    );
    return response.value
      .filter((r) => !alreadyMapped.has(r.emailAddress))
      .map((r) => ({ externalResourceId: r.id, email: r.emailAddress, displayName: r.displayName ?? r.emailAddress, capacity: r.capacity ?? null }));
  }

  async mapRoom(orgId: string, roomId: string, connectionId: string, externalResourceId: string, externalResourceEmail: string, actorUserId: string) {
    await this.assertOwnsConnection(orgId, connectionId);
    const room = await this.orgScoped.assertOwns(
      () => this.prisma.bookableRoom.findFirst({ where: { id: roomId, organizationId: orgId } }),
      'Room not found',
    );
    const updated = await this.prisma.bookableRoom.update({
      where: { id: room.id },
      data: { providerKey: 'MICROSOFT_365', calendarConnectionId: connectionId, externalResourceId, externalResourceEmail },
    });
    await this.audit.log({ organizationId: orgId, userId: actorUserId, action: 'room.integration.map', resourceType: 'BookableRoom', resourceId: room.id, metadata: { connectionId, externalResourceEmail } });
    return updated;
  }

  // Deliberately not exposed through the encryption service — only the connection id and a
  // shared deployment secret ever combine to produce this, so it's verifiable without a second
  // stored column and unpredictable without ROOM_BOOKING_ENCRYPTION_KEY.
  computeClientState(connectionId: string): string {
    const secret = process.env.ROOM_BOOKING_ENCRYPTION_KEY ?? '';
    return createHmac('sha256', secret).update(connectionId).digest('hex');
  }

  async buildClient(connectionId: string): Promise<MicrosoftGraphClient> {
    const connection = await this.prisma.roomCalendarConnection.findUnique({ where: { id: connectionId } });
    if (!connection?.encryptedCredential) throw new ConflictException('This connection has no stored credentials — reconnect it');
    const credentials = JSON.parse(this.encryption.decrypt(connection.encryptedCredential)) as Microsoft365Credentials;
    return new MicrosoftGraphClient(credentials);
  }

  // §13.3 — public HTTPS callback URL; used both when first subscribing a room's calendar and on
  // renewal. `resource` targets the room mailbox's events collection specifically.
  async subscribe(connectionId: string, roomEmail: string): Promise<{ subscriptionId: string; expiresAt: Date }> {
    const webhookBase = process.env.ROOM_BOOKING_WEBHOOK_BASE_URL;
    if (!webhookBase) throw new ConflictException('ROOM_BOOKING_WEBHOOK_BASE_URL is not configured on this deployment');
    const client = await this.buildClient(connectionId);
    const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60_000).toISOString();
    const subscription = await client.request<{ id: string; expirationDateTime: string }>('/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        changeType: 'created,updated,deleted',
        notificationUrl: `${webhookBase}/v1/room-booking/integrations/microsoft365/webhook`,
        resource: `/users/${encodeURIComponent(roomEmail)}/events`,
        expirationDateTime,
        clientState: this.computeClientState(connectionId),
      }),
    });
    return { subscriptionId: subscription.id, expiresAt: new Date(subscription.expirationDateTime) };
  }

  // Org-scoped wrapper used by the dashboard controller — resolves the room's own connection and
  // resource email, then persists the resulting subscription onto the connection row so the
  // worker's renewal cron (which reads webhookExpiresAt directly) can find it later.
  async subscribeRoomWebhook(orgId: string, roomId: string) {
    const room = await this.orgScoped.assertOwns(
      () => this.prisma.bookableRoom.findFirst({ where: { id: roomId, organizationId: orgId, providerKey: 'MICROSOFT_365' } }),
      'Mapped Microsoft 365 room not found',
    );
    if (!room.calendarConnectionId || !room.externalResourceEmail) {
      throw new BadRequestException('Room is not mapped to a Microsoft 365 resource mailbox yet');
    }
    const { subscriptionId, expiresAt } = await this.subscribe(room.calendarConnectionId, room.externalResourceEmail);
    await this.prisma.roomCalendarConnection.update({
      where: { id: room.calendarConnectionId },
      data: { webhookSubscriptionId: subscriptionId, webhookExpiresAt: expiresAt },
    });
    return { subscriptionId, expiresAt: expiresAt.toISOString() };
  }

  async renewSubscription(connectionId: string, subscriptionId: string): Promise<Date> {
    const client = await this.buildClient(connectionId);
    const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60_000).toISOString();
    const subscription = await client.request<{ expirationDateTime: string }>(`/subscriptions/${subscriptionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ expirationDateTime }),
    });
    return new Date(subscription.expirationDateTime);
  }

  private async assertOwnsConnection(orgId: string, connectionId: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.roomCalendarConnection.findFirst({ where: { id: connectionId, organizationId: orgId, providerKey: 'MICROSOFT_365' } }),
      'Connection not found',
    );
  }

  private async toHealthDto(connection: { id: string; providerKey: 'MICROSOFT_365' | 'LUMINA' | 'GOOGLE_WORKSPACE'; displayName: string; status: string; lastSuccessfulSyncAt: Date | null; lastErrorCode: string | null; webhookExpiresAt: Date | null }) {
    const roomCount = await this.prisma.bookableRoom.count({ where: { calendarConnectionId: connection.id } });
    return {
      id: connection.id,
      providerKey: connection.providerKey,
      displayName: connection.displayName,
      status: connection.status,
      lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt?.toISOString() ?? null,
      lastErrorCode: connection.lastErrorCode,
      webhookExpiresAt: connection.webhookExpiresAt?.toISOString() ?? null,
      roomCount,
    };
  }
}
