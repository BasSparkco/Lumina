import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RoomBookingEncryptionService } from '../../encryption.service';
import { RoomBookingConflictError, type NormalizedReservation, type ProviderCancelInput, type ProviderCreateInput, type ProviderHealth, type ProviderListInput, type RoomCalendarProvider } from '../../providers/room-calendar-provider';
import { MicrosoftGraphClient, MicrosoftGraphError, type Microsoft365Credentials } from './microsoft-graph.client';

interface GraphEvent {
  id: string;
  subject?: string;
  organizer?: { emailAddress?: { name?: string } };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  iCalUId?: string;
  '@odata.etag'?: string;
  lastModifiedDateTime?: string;
  isCancelled?: boolean;
}
interface GraphEventListResponse { value: GraphEvent[] }

// docs/modules/room_booking_module_plan.md §5.1/§13.1 — implements the same RoomCalendarProvider
// contract as NativeCalendarProvider, translating provider IDs/recurrence/timezone/errors into
// Lumina-owned NormalizedReservation shapes. Never called directly by a controller or player-state
// assembly — only through RoomCalendarProviderRegistry.
@Injectable()
export class Microsoft365CalendarProvider implements RoomCalendarProvider {
  readonly key = 'MICROSOFT_365' as const;
  private readonly logger = new Logger(Microsoft365CalendarProvider.name);
  private readonly clientCache = new Map<string, MicrosoftGraphClient>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: RoomBookingEncryptionService,
  ) {}

  async listReservations(input: ProviderListInput): Promise<NormalizedReservation[]> {
    const client = await this.getClient(input.room.calendarConnectionId);
    const email = this.requireEmail(input.room.externalResourceEmail);
    // calendarView (not /events) expands recurring series into concrete instances within the
    // window server-side — the "recurrence expansion" requirement (§15.4) without Lumina having
    // to implement RRULE expansion itself.
    const params = new URLSearchParams({
      startDateTime: input.from.toISOString(),
      endDateTime: input.to.toISOString(),
      $top: '250',
    });
    const response = await client.request<GraphEventListResponse>(
      `/users/${encodeURIComponent(email)}/calendarView?${params.toString()}`,
      { headers: { Prefer: 'outlook.timezone="UTC"' } },
    );
    return response.value.filter((e) => !e.isCancelled).map((e) => this.toNormalized(e));
  }

  async createReservation(input: ProviderCreateInput): Promise<NormalizedReservation> {
    const client = await this.getClient(input.room.calendarConnectionId);
    const email = this.requireEmail(input.room.externalResourceEmail);
    try {
      const event = await client.request<GraphEvent>(`/users/${encodeURIComponent(email)}/events`, {
        method: 'POST',
        headers: { 'Idempotency-Key': input.idempotencyKey },
        body: JSON.stringify({
          subject: input.title ?? 'Reserved via Lumina',
          start: { dateTime: input.startsAt.toISOString(), timeZone: 'UTC' },
          end: { dateTime: input.endsAt.toISOString(), timeZone: 'UTC' },
        }),
      });
      return this.toNormalized(event);
    } catch (err) {
      // Graph returns 409/423-style conflicts as an ErrorCalendarCannotUpdateDeletedEvent or a
      // generic 400 for overlapping resource bookings depending on tenant policy — surfaced
      // uniformly as a booking conflict rather than leaking Graph-specific error shapes.
      if (err instanceof MicrosoftGraphError && (err.status === 409 || err.status === 423)) {
        throw new RoomBookingConflictError();
      }
      throw err;
    }
  }

  async cancelReservation(input: ProviderCancelInput): Promise<void> {
    const client = await this.getClient(input.room.calendarConnectionId);
    const email = this.requireEmail(input.room.externalResourceEmail);
    await client.request(`/users/${encodeURIComponent(email)}/events/${input.externalEventId}/cancel`, { method: 'POST' });
  }

  async healthCheck(connectionId: string | null): Promise<ProviderHealth> {
    if (!connectionId) return { status: 'NOT_CONNECTED', lastSuccessfulSyncAt: null, lastErrorCode: null };
    const connection = await this.prisma.roomCalendarConnection.findUnique({ where: { id: connectionId } });
    if (!connection) return { status: 'NOT_CONNECTED', lastSuccessfulSyncAt: null, lastErrorCode: null };
    try {
      const client = await this.getClient(connectionId);
      await client.testConnection();
      return { status: 'HEALTHY', lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt, lastErrorCode: null };
    } catch (err) {
      this.logger.warn(`Microsoft 365 health check failed for connection ${connectionId}: ${err instanceof Error ? err.message : String(err)}`);
      return { status: 'ERROR', lastSuccessfulSyncAt: connection.lastSuccessfulSyncAt, lastErrorCode: connection.lastErrorCode };
    }
  }

  private async getClient(connectionId: string | null): Promise<MicrosoftGraphClient> {
    if (!connectionId) throw new Error('Room has no Microsoft 365 calendar connection configured');
    const cached = this.clientCache.get(connectionId);
    if (cached) return cached;

    const connection = await this.prisma.roomCalendarConnection.findUnique({ where: { id: connectionId } });
    if (!connection?.encryptedCredential) throw new Error('Microsoft 365 connection has no stored credentials');
    const credentials = JSON.parse(this.encryption.decrypt(connection.encryptedCredential)) as Microsoft365Credentials;
    const client = new MicrosoftGraphClient(credentials);
    this.clientCache.set(connectionId, client);
    return client;
  }

  private requireEmail(email: string | null): string {
    if (!email) throw new Error('Room has no Microsoft 365 resource mailbox mapped');
    return email;
  }

  private toNormalized(event: GraphEvent): NormalizedReservation {
    return {
      externalEventId: event.id,
      externalICalUid: event.iCalUId ?? null,
      externalEtag: event['@odata.etag'] ?? null,
      startsAt: new Date(`${event.start.dateTime}Z`),
      endsAt: new Date(`${event.end.dateTime}Z`),
      title: event.subject ?? null,
      organizerDisplayName: event.organizer?.emailAddress?.name ?? null,
      status: event.isCancelled ? 'CANCELLED' : 'CONFIRMED',
      providerUpdatedAt: event.lastModifiedDateTime ? new Date(event.lastModifiedDateTime) : null,
    };
  }
}
