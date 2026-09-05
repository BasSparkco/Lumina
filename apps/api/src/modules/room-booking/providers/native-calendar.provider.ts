import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  RoomBookingConflictError,
  type NormalizedReservation,
  type ProviderCancelInput,
  type ProviderCreateInput,
  type ProviderHealth,
  type ProviderListInput,
  type RoomCalendarProvider,
} from './room-calendar-provider';

// docs/modules/room_booking_module_plan.md §5.1/§7.3 — the native provider implements the same
// behavioral contract as an external one, backed directly by PostgreSQL. Atomic conflict
// protection is the database exclusion constraint added in the
// 20260905134345_add_room_booking migration, not application-level locking — this provider only
// needs to translate the resulting Postgres error into RoomBookingConflictError.
@Injectable()
export class NativeCalendarProvider implements RoomCalendarProvider {
  readonly key = 'LUMINA' as const;

  constructor(private readonly prisma: PrismaService) {}

  async listReservations(input: ProviderListInput): Promise<NormalizedReservation[]> {
    const rows = await this.prisma.roomReservation.findMany({
      where: {
        roomId: input.room.id,
        providerKey: 'LUMINA',
        status: 'CONFIRMED',
        startsAt: { lt: input.to },
        endsAt: { gt: input.from },
      },
      orderBy: { startsAt: 'asc' },
    });
    return rows.map((r) => this.toNormalized(r));
  }

  async createReservation(input: ProviderCreateInput): Promise<NormalizedReservation> {
    try {
      const row = await this.prisma.roomReservation.create({
        data: {
          roomId: input.room.id,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          title: input.title ?? null,
          organizerDisplayName: input.organizerDisplayName ?? null,
          providerKey: 'LUMINA',
          origin: 'DASHBOARD',
        },
      });
      return this.toNormalized(row);
    } catch (err) {
      if (this.isExclusionViolation(err)) throw new RoomBookingConflictError();
      throw err;
    }
  }

  async cancelReservation(input: ProviderCancelInput): Promise<void> {
    await this.prisma.roomReservation.updateMany({
      where: { roomId: input.room.id, id: input.externalEventId, providerKey: 'LUMINA' },
      data: { status: 'CANCELLED' },
    });
  }

  healthCheck(): Promise<ProviderHealth> {
    return Promise.resolve({ status: 'HEALTHY', lastSuccessfulSyncAt: new Date(), lastErrorCode: null });
  }

  // Postgres surfaces an exclusion-constraint violation as SQLSTATE 23P01. Prisma's driver-adapter
  // error wrapping exposes the original code under `err.meta`/`err.cause` depending on version;
  // checking the constraint name in the message is the stable signal across those variations.
  private isExclusionViolation(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return message.includes('RoomReservation_no_overlap_native_confirmed') || message.includes('23P01');
  }

  private toNormalized(row: {
    id: string; startsAt: Date; endsAt: Date; title: string | null; organizerDisplayName: string | null;
    status: string; updatedAt: Date;
  }): NormalizedReservation {
    return {
      externalEventId: row.id,
      externalICalUid: null,
      externalEtag: null,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      title: row.title,
      organizerDisplayName: row.organizerDisplayName,
      status: row.status === 'CANCELLED' ? 'CANCELLED' : 'CONFIRMED',
      providerUpdatedAt: row.updatedAt,
    };
  }
}
