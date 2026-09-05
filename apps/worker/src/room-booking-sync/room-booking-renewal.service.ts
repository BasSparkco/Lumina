import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { RoomBookingEncryptionService } from './room-booking-encryption.service';
import { RoomBookingReconciliationService } from './room-booking-reconciliation.service';
import { MicrosoftGraphClient, MicrosoftGraphError, type Microsoft365Credentials } from './microsoft-graph.client';

// Graph caps calendar-event subscriptions at ~4230 minutes; renew well before expiry so a missed
// cron tick (deploy window, transient failure) still leaves margin before Graph actually drops
// the subscription. Mirrors SUBSCRIPTION_LIFETIME_MINUTES in
// apps/api's microsoft365-connections.service.ts.
const SUBSCRIPTION_LIFETIME_MINUTES = 60 * 24 * 2.9;
const RENEW_WHEN_EXPIRING_WITHIN_MS = 6 * 60 * 60_000; // 6 hours

// docs/modules/room_booking_module_plan.md §13.3 — "renew subscriptions before they expire" and
// a periodic fallback so a missed/dropped webhook notification doesn't silently desync a room
// forever (Graph's change-notification delivery is best-effort, not guaranteed).
@Injectable()
export class RoomBookingRenewalService implements OnModuleInit {
  private readonly logger = new Logger(RoomBookingRenewalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: RoomBookingEncryptionService,
    private readonly reconciliation: RoomBookingReconciliationService,
  ) {}

  async onModuleInit() {
    await Promise.allSettled([this.renewExpiringSubscriptions(), this.fallbackReconcileAllRooms()]);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async renewExpiringSubscriptions() {
    const expiring = await this.prisma.roomCalendarConnection.findMany({
      where: {
        providerKey: 'MICROSOFT_365',
        status: 'CONNECTED',
        webhookSubscriptionId: { not: null },
        webhookExpiresAt: { lt: new Date(Date.now() + RENEW_WHEN_EXPIRING_WITHIN_MS) },
      },
    });

    for (const connection of expiring) {
      try {
        if (!connection.encryptedCredential || !connection.webhookSubscriptionId) continue;
        const credentials = JSON.parse(this.encryption.decrypt(connection.encryptedCredential)) as Microsoft365Credentials;
        const client = new MicrosoftGraphClient(credentials);
        const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_LIFETIME_MINUTES * 60_000).toISOString();
        const subscription = await client.request<{ expirationDateTime: string }>(`/subscriptions/${connection.webhookSubscriptionId}`, {
          method: 'PATCH',
          body: JSON.stringify({ expirationDateTime }),
        });
        await this.prisma.roomCalendarConnection.update({
          where: { id: connection.id },
          data: { webhookExpiresAt: new Date(subscription.expirationDateTime), lastErrorCode: null },
        });
      } catch (err) {
        const code = err instanceof MicrosoftGraphError ? `graph_${err.status}` : 'unknown_error';
        this.logger.warn(`Subscription renewal failed for connection ${connection.id}: ${err instanceof Error ? err.message : String(err)}`);
        await this.prisma.roomCalendarConnection.update({ where: { id: connection.id }, data: { lastErrorCode: code } })
          .catch((updateErr: unknown) => this.logger.warn(`Failed to persist lastErrorCode for connection ${connection.id}: ${String(updateErr)}`));
      }
    }
  }

  // Catches whatever a dropped/missed webhook notification would otherwise leave desynced
  // forever — Graph's delivery is best-effort. Runs less often than the renewal check since a
  // full reconciliation per room is more expensive than a single subscription PATCH.
  @Cron(CronExpression.EVERY_30_MINUTES)
  async fallbackReconcileAllRooms() {
    const rooms = await this.prisma.bookableRoom.findMany({
      where: { providerKey: 'MICROSOFT_365', calendarConnectionId: { not: null } },
      select: { id: true },
    });
    for (const room of rooms) {
      await this.reconciliation.reconcileRoom(room.id).catch((err) =>
        this.logger.warn(`Fallback reconciliation failed for room ${room.id}: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
  }
}
