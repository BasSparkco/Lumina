import { Injectable } from '@nestjs/common';
import type { RoomBookingPlayerPayload } from '@lumina/types';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomBookingService } from './room-booking.service';

const DEFAULT_LEASE_GRACE_HOURS = 168;
const MAX_PLAYER_RESERVATIONS = 20;

// docs/modules/room_booking_module_plan.md §5.2/§9.3 — the bounded, privacy-redacted read model
// the player actually receives. Never sends the complete historical reservation table; privacy
// redaction happens here, server-side, before the payload is ever serialized to the player.
@Injectable()
export class RoomPlayerStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomBooking: RoomBookingService,
  ) {}

  async buildPayload(binding: {
    roomId: string;
    quickBookingEnabled: boolean;
    quickBookingDurationsMinutes: number[];
    startingSoonMinutes: number;
  }): Promise<RoomBookingPlayerPayload | null> {
    const room = await this.prisma.bookableRoom.findUnique({ where: { id: binding.roomId } });
    if (!room) return null;

    const now = new Date();
    // §9.3 — any reservation already in progress, through the end of the room's local day, plus
    // enough of the next day to show the first upcoming reservation once today has ended.
    const endOfLocalDay = this.endOfLocalDay(now, room.timezone);
    const lookahead = new Date(endOfLocalDay.getTime() + 24 * 60 * 60 * 1000);

    const reservations = await this.prisma.roomReservation.findMany({
      where: { roomId: room.id, status: 'CONFIRMED', startsAt: { lt: lookahead }, endsAt: { gt: now } },
      orderBy: { startsAt: 'asc' },
      take: MAX_PLAYER_RESERVATIONS,
    });

    const generatedAt = now.toISOString();
    const graceHours = Number(process.env.PLAYER_ENTITLEMENT_OFFLINE_GRACE_HOURS) || DEFAULT_LEASE_GRACE_HOURS;
    const validUntil = new Date(now.getTime() + graceHours * 60 * 60 * 1000).toISOString();

    return {
      room: {
        id: room.id,
        name: room.name,
        locationLabel: room.locationLabel,
        timezone: room.timezone,
        capacity: room.capacity,
        amenities: room.amenities,
        status: room.status,
      },
      display: {
        privacyMode: room.privacyMode,
        quickBookingEnabled: binding.quickBookingEnabled,
        quickBookingDurationsMinutes: binding.quickBookingDurationsMinutes,
        startingSoonMinutes: binding.startingSoonMinutes,
      },
      serverNow: generatedAt,
      reservations: reservations.map((r) =>
        this.roomBooking.redactPrivacy(
          {
            id: r.id,
            startsAt: r.startsAt.toISOString(),
            endsAt: r.endsAt.toISOString(),
            title: r.title,
            organizerDisplayName: r.organizerDisplayName,
            status: 'CONFIRMED' as const,
          },
          room.privacyMode,
        ),
      ),
      generatedAt,
      validUntil,
    };
  }

  private endOfLocalDay(now: Date, timezone: string): Date {
    // en-CA gives YYYY-MM-DD directly, sortable/parseable without locale ambiguity.
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const midnightUtcGuess = new Date(`${parts}T23:59:59.999Z`);
    // The room's local midnight isn't literally UTC midnight; this offsets by the zone's current
    // UTC offset so "end of local day" lands close enough for a display-window boundary (a few
    // minutes of slack around a DST transition is acceptable here — the exact cutoff only affects
    // how much of the *next* day's reservations show up early, not correctness of what's shown).
    const offsetMinutes = this.utcOffsetMinutes(now, timezone);
    return new Date(midnightUtcGuess.getTime() - offsetMinutes * 60_000);
  }

  private utcOffsetMinutes(date: Date, timeZone: string): number {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second),
    );
    return (asUtc - date.getTime()) / 60_000;
  }
}
