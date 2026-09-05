import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RoomCalendarProviderRegistry } from './providers/room-calendar-provider.registry';
import type { NormalizedReservation } from './providers/room-calendar-provider';

// §8.1/§8.2 — "cap query ranges and result counts" / "do not trust a client-provided
// availability result." Every availability read goes through the room's own provider, never a
// cached client value — the dashboard calendar and the Book Now flow both call this.
const MAX_QUERY_RANGE_DAYS = 62;
const MAX_RESULTS = 500;

@Injectable()
export class RoomAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: RoomCalendarProviderRegistry,
  ) {}

  async getAvailability(room: {
    id: string; providerKey: 'LUMINA' | 'MICROSOFT_365' | 'GOOGLE_WORKSPACE';
    externalResourceId: string | null; externalResourceEmail: string | null; calendarConnectionId: string | null;
  }, from: Date, to: Date): Promise<NormalizedReservation[]> {
    if (!(from < to)) throw new BadRequestException('from must be before to');
    const rangeDays = (to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000);
    if (rangeDays > MAX_QUERY_RANGE_DAYS) {
      throw new BadRequestException(`Availability queries are capped at ${MAX_QUERY_RANGE_DAYS} days`);
    }

    const provider = this.providers.get(room.providerKey);
    const results = await provider.listReservations({ room, from, to });
    return results.slice(0, MAX_RESULTS);
  }

  // Reservations already normalized+stored locally (native or the external projection) — used by
  // the dashboard calendar and the player-state builder, which both read local data rather than
  // calling out to a provider on every request.
  async listStoredReservations(roomId: string, from: Date, to: Date) {
    if (!(from < to)) throw new BadRequestException('from must be before to');
    return this.prisma.roomReservation.findMany({
      where: {
        roomId,
        status: 'CONFIRMED',
        startsAt: { lt: to },
        endsAt: { gt: from },
      },
      orderBy: { startsAt: 'asc' },
      take: MAX_RESULTS,
    });
  }
}
