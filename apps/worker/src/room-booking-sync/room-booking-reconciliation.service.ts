import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RoomBookingEncryptionService } from './room-booking-encryption.service';
import { MicrosoftGraphClient, MicrosoftGraphError, type Microsoft365Credentials } from './microsoft-graph.client';

// docs/modules/room_booking_module_plan.md §13.3/§13.4 — the actual sync work behind the
// Microsoft 365 webhook (apps/api's Microsoft365WebhookController only enqueues 'reconcile-room'
// jobs; this is the consumer). Also reused by the periodic fallback cron in
// room-booking-renewal.service.ts, since a webhook notification can be missed (a dropped
// delivery, a subscription that lapsed) and Graph gives no reliable "catch me up" delta feed for
// event collections without a stored delta token, which this milestone doesn't implement.
interface GraphEvent {
  id: string;
  iCalUId: string;
  subject?: string;
  isCancelled?: boolean;
  organizer?: { emailAddress?: { name?: string } };
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}
interface GraphEventListResponse { value: GraphEvent[] }

// Graph's dateTime+timeZone pair is *not* an ISO instant on its own (the string has no offset) —
// this must be interpreted in the given IANA zone. new Date() would otherwise silently treat it
// as UTC or local-to-the-server, both wrong. Uses Intl to compute the zone's offset at that
// instant (handles DST correctly) rather than a static offset table.
function graphDateTimeToInstant(dateTime: string, timeZone: string): Date {
  const naive = new Date(`${dateTime}Z`); // parse the wall-clock fields as if they were UTC
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(naive);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = asUtc - naive.getTime();
  return new Date(naive.getTime() - offsetMs);
}

const SYNC_WINDOW_PAST_DAYS = 1;
const SYNC_WINDOW_FUTURE_DAYS = 35;

@Injectable()
export class RoomBookingReconciliationService {
  private readonly logger = new Logger(RoomBookingReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: RoomBookingEncryptionService,
  ) {}

  async reconcileRoom(roomId: string): Promise<void> {
    const room = await this.prisma.bookableRoom.findUnique({ where: { id: roomId } });
    if (room?.providerKey !== 'MICROSOFT_365' || !room.calendarConnectionId || !room.externalResourceEmail) {
      this.logger.warn(`Skipping reconciliation for room ${roomId} — not a mapped Microsoft 365 room`);
      return;
    }
    const connection = await this.prisma.roomCalendarConnection.findUnique({ where: { id: room.calendarConnectionId } });
    if (!connection?.encryptedCredential) {
      this.logger.warn(`Skipping reconciliation for room ${roomId} — connection ${room.calendarConnectionId} has no stored credentials`);
      return;
    }

    const from = new Date(Date.now() - SYNC_WINDOW_PAST_DAYS * 86_400_000);
    const to = new Date(Date.now() + SYNC_WINDOW_FUTURE_DAYS * 86_400_000);

    try {
      const credentials = JSON.parse(this.encryption.decrypt(connection.encryptedCredential)) as Microsoft365Credentials;
      const client = new MicrosoftGraphClient(credentials);
      const response = await client.request<GraphEventListResponse>(
        `/users/${encodeURIComponent(room.externalResourceEmail)}/calendarView?startDateTime=${from.toISOString()}&endDateTime=${to.toISOString()}&$top=250`,
        { headers: { Prefer: 'outlook.timezone="UTC"' } },
      );
      const events = response.value.filter((e) => !e.isCancelled);
      const seenICalUIds = new Set<string>();

      for (const event of events) {
        seenICalUIds.add(event.iCalUId);
        const startsAt = graphDateTimeToInstant(event.start.dateTime, event.start.timeZone);
        const endsAt = graphDateTimeToInstant(event.end.dateTime, event.end.timeZone);
        const providerExternalKey = `${connection.id}:${event.id}`;

        // §3.8 — reconciliation keys on externalICalUid first (survives a reconnect), falling
        // back to providerExternalKey only when no row with that iCalUId exists yet.
        const existing = await this.prisma.roomReservation.findFirst({
          where: { roomId: room.id, OR: [{ externalICalUid: event.iCalUId }, { providerExternalKey }] },
        });

        const data = {
          title: event.subject ?? null,
          organizerDisplayName: event.organizer?.emailAddress?.name ?? null,
          startsAt, endsAt,
          status: 'CONFIRMED' as const,
          providerKey: 'MICROSOFT_365' as const,
          origin: 'EXTERNAL_SYNC' as const,
          externalEventId: event.id,
          providerExternalKey,
          externalICalUid: event.iCalUId,
          providerUpdatedAt: new Date(),
        };

        if (existing) {
          await this.prisma.roomReservation.update({ where: { id: existing.id }, data });
        } else {
          await this.prisma.roomReservation.create({ data: { ...data, roomId: room.id } });
        }
      }

      // A stored MICROSOFT_365 reservation inside the queried window that Graph no longer
      // reports (deleted, or moved outside the window) is stale — cancel it rather than deleting
      // the row, matching how native cancellation works (§3.8: CANCELLED, not removed).
      const staleReservations = await this.prisma.roomReservation.findMany({
        where: {
          roomId: room.id, providerKey: 'MICROSOFT_365', status: 'CONFIRMED',
          startsAt: { lt: to }, endsAt: { gt: from },
        },
        select: { id: true, externalICalUid: true },
      });
      const staleIds = staleReservations.filter((r) => !r.externalICalUid || !seenICalUIds.has(r.externalICalUid)).map((r) => r.id);
      if (staleIds.length > 0) {
        await this.prisma.roomReservation.updateMany({ where: { id: { in: staleIds } }, data: { status: 'CANCELLED' } });
      }

      await this.prisma.roomCalendarConnection.update({
        where: { id: connection.id },
        data: { lastSuccessfulSyncAt: new Date(), lastErrorCode: null },
      });
    } catch (err) {
      const code = err instanceof MicrosoftGraphError ? `graph_${err.status}` : 'unknown_error';
      this.logger.warn(`Reconciliation failed for room ${roomId} (connection ${room.calendarConnectionId}): ${err instanceof Error ? err.message : String(err)}`);
      await this.prisma.roomCalendarConnection.update({ where: { id: connection.id }, data: { lastErrorCode: code } })
        .catch((updateErr: unknown) => this.logger.warn(`Failed to persist lastErrorCode for connection ${connection.id}: ${String(updateErr)}`));
    }
  }
}
