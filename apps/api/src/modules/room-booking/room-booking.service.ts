import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { RoomPrivacyMode } from '@lumina/types';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import { ScreenGateway } from '../ws/screen.gateway';
import { AuditService } from '../audit/audit.service';
import { RoomAvailabilityService } from './room-availability.service';
import { RoomCalendarProviderRegistry } from './providers/room-calendar-provider.registry';
import { RoomBookingConflictError } from './providers/room-calendar-provider';
import type { CreateRoomDto } from './dto/create-room.dto';
import type { CreateReservationDto, UpdateReservationDto } from './dto/reservation.dto';
import type { UpdateDisplayBindingDto } from './dto/update-display-binding.dto';

const MIN_BOOK_NOW_MINUTES = 5;

function normalizeRoomName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

const IANA_TZ_CHECK = new Set<string>();
function assertValidTimezone(timezone: string): void {
  if (IANA_TZ_CHECK.has(timezone)) return;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    IANA_TZ_CHECK.add(timezone);
  } catch {
    throw new BadRequestException(`"${timezone}" is not a supported IANA timezone`);
  }
}

@Injectable()
export class RoomBookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScoped: OrgScopedService,
    private readonly gateway: ScreenGateway,
    private readonly audit: AuditService,
    private readonly availability: RoomAvailabilityService,
    private readonly providers: RoomCalendarProviderRegistry,
  ) {}

  // ── Rooms ────────────────────────────────────────────────────────────────

  async listRooms(orgId: string) {
    return this.prisma.bookableRoom.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } });
  }

  async getRoom(orgId: string, roomId: string) {
    return this.assertOwnsRoom(orgId, roomId);
  }

  async createRoom(orgId: string, dto: CreateRoomDto, actorUserId: string) {
    assertValidTimezone(dto.timezone);
    if (dto.wayfindingPoiId) await this.assertOwnsPoi(orgId, dto.wayfindingPoiId);

    const room = await this.prisma.bookableRoom.create({
      data: {
        organizationId: orgId,
        name: dto.name,
        normalizedName: normalizeRoomName(dto.name),
        locationLabel: dto.locationLabel ?? null,
        timezone: dto.timezone,
        capacity: dto.capacity ?? null,
        amenities: dto.amenities ?? [],
        privacyMode: dto.privacyMode ?? 'BUSY_ONLY',
        status: dto.status ?? 'ACTIVE',
        wayfindingPoiId: dto.wayfindingPoiId ?? null,
      },
    });
    await this.audit.log({ organizationId: orgId, userId: actorUserId, action: 'room.create', resourceType: 'BookableRoom', resourceId: room.id, metadata: { name: room.name } });
    return room;
  }

  async updateRoom(orgId: string, roomId: string, dto: CreateRoomDto, actorUserId: string) {
    const existing = await this.assertOwnsRoom(orgId, roomId);
    assertValidTimezone(dto.timezone);
    if (dto.wayfindingPoiId) await this.assertOwnsPoi(orgId, dto.wayfindingPoiId);

    const room = await this.prisma.bookableRoom.update({
      where: { id: roomId },
      data: {
        name: dto.name,
        normalizedName: normalizeRoomName(dto.name),
        locationLabel: dto.locationLabel ?? null,
        timezone: dto.timezone,
        capacity: dto.capacity ?? null,
        amenities: dto.amenities ?? [],
        privacyMode: dto.privacyMode ?? existing.privacyMode,
        status: dto.status ?? existing.status,
        wayfindingPoiId: dto.wayfindingPoiId ?? null,
      },
    });
    await this.audit.log({ organizationId: orgId, userId: actorUserId, action: 'room.update', resourceType: 'BookableRoom', resourceId: room.id, metadata: { statusChanged: existing.status !== room.status } });
    if (existing.status !== room.status) {
      await this.audit.log({ organizationId: orgId, userId: actorUserId, action: 'room.status.update', resourceType: 'BookableRoom', resourceId: room.id, metadata: { from: existing.status, to: room.status } });
    }
    await this.refreshDisplaysForRoom(room.id);
    return room;
  }

  // §8.1 — a room with future reservations or an active display binding requires an explicit
  // policy before deletion; recommended (and implemented) behavior is 409 until both are cleared.
  async deleteRoom(orgId: string, roomId: string, actorUserId: string) {
    const room = await this.assertOwnsRoom(orgId, roomId);
    const [futureReservations, activeBindings] = await Promise.all([
      this.prisma.roomReservation.count({ where: { roomId, status: 'CONFIRMED', endsAt: { gt: new Date() } } }),
      this.prisma.roomDisplayBinding.count({ where: { roomId } }),
    ]);
    if (futureReservations > 0 || activeBindings > 0) {
      throw new ConflictException('Remove display bindings and cancel/migrate future reservations before deleting this room');
    }
    await this.prisma.bookableRoom.delete({ where: { id: roomId } });
    await this.audit.log({ organizationId: orgId, userId: actorUserId, action: 'room.delete', resourceType: 'BookableRoom', resourceId: room.id, metadata: { name: room.name } });
  }

  async getRoomAvailability(orgId: string, roomId: string, from: Date, to: Date) {
    const room = await this.assertOwnsRoom(orgId, roomId);
    return this.availability.getAvailability(room, from, to);
  }

  // ── Reservations (native create/edit; external rooms are read-only here — §11.3) ──

  async listReservations(orgId: string, roomId: string, from: Date, to: Date) {
    await this.assertOwnsRoom(orgId, roomId);
    return this.availability.listStoredReservations(roomId, from, to);
  }

  async createReservation(orgId: string, roomId: string, dto: CreateReservationDto, actorUserId: string) {
    const room = await this.assertOwnsRoom(orgId, roomId);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertValidInterval(startsAt, endsAt);
    if (room.providerKey !== 'LUMINA') {
      throw new BadRequestException('Direct reservation create/edit is only supported for Lumina-native rooms in this release');
    }

    const provider = this.providers.get('LUMINA');
    let normalized;
    try {
      normalized = await provider.createReservation({
        room, startsAt, endsAt, title: dto.title, organizerDisplayName: dto.organizerDisplayName,
        idempotencyKey: dto.idempotencyKey ?? `${roomId}:${startsAt.toISOString()}`,
      });
    } catch (err) {
      if (err instanceof RoomBookingConflictError) throw new ConflictException(err.message);
      throw err;
    }

    await this.audit.log({ organizationId: orgId, userId: actorUserId, action: 'room.reservation.create', resourceType: 'RoomReservation', resourceId: normalized.externalEventId, metadata: { roomId, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() } });
    await this.refreshDisplaysForRoom(roomId);
    return normalized;
  }

  async updateReservation(orgId: string, roomId: string, reservationId: string, dto: UpdateReservationDto, actorUserId: string) {
    const room = await this.assertOwnsRoom(orgId, roomId);
    const existing = await this.orgScoped.assertOwns(
      () => this.prisma.roomReservation.findFirst({ where: { id: reservationId, roomId } }),
      'Reservation not found',
    );
    if (room.providerKey !== 'LUMINA' || existing.providerKey !== 'LUMINA') {
      throw new BadRequestException('Direct reservation create/edit is only supported for Lumina-native rooms in this release');
    }
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertValidInterval(startsAt, endsAt);

    try {
      const updated = await this.prisma.roomReservation.update({
        where: { id: reservationId },
        data: { startsAt, endsAt, title: dto.title ?? null, organizerDisplayName: dto.organizerDisplayName ?? null },
      });
      await this.audit.log({ organizationId: orgId, userId: actorUserId, action: 'room.reservation.update', resourceType: 'RoomReservation', resourceId: updated.id, metadata: { roomId } });
      await this.refreshDisplaysForRoom(roomId);
      return updated;
    } catch (err) {
      if (this.isExclusionViolation(err)) throw new ConflictException('The room is no longer available for the requested time');
      throw err;
    }
  }

  async cancelReservation(orgId: string, roomId: string, reservationId: string, actorUserId: string) {
    await this.assertOwnsRoom(orgId, roomId);
    const existing = await this.orgScoped.assertOwns(
      () => this.prisma.roomReservation.findFirst({ where: { id: reservationId, roomId } }),
      'Reservation not found',
    );
    await this.prisma.roomReservation.update({ where: { id: reservationId }, data: { status: 'CANCELLED' } });
    await this.audit.log({ organizationId: orgId, userId: actorUserId, action: 'room.reservation.cancel', resourceType: 'RoomReservation', resourceId: existing.id, metadata: { roomId } });
    await this.refreshDisplaysForRoom(roomId);
  }

  // ── Display bindings ─────────────────────────────────────────────────────

  async listDisplays(orgId: string) {
    return this.prisma.screen.findMany({
      where: { organizationId: orgId },
      select: { id: true, name: true, streamingType: true, roomDisplayBinding: { include: { room: { select: { id: true, name: true } } } } },
      orderBy: { name: 'asc' },
    });
  }

  async updateDisplayBinding(orgId: string, screenId: string, dto: UpdateDisplayBindingDto, actorUserId: string) {
    await this.orgScoped.assertOwns(
      () => this.prisma.screen.findFirst({ where: { id: screenId, organizationId: orgId } }),
      'Screen not found',
    );
    await this.assertOwnsRoom(orgId, dto.roomId);

    const invalidDurations = dto.quickBookingDurationsMinutes.filter((m) => m <= 0 || m > 24 * 60);
    if (invalidDurations.length > 0) throw new BadRequestException('Unsupported quick-booking duration');

    const binding = await this.prisma.roomDisplayBinding.upsert({
      where: { screenId },
      create: {
        screenId, roomId: dto.roomId,
        quickBookingEnabled: dto.quickBookingEnabled,
        quickBookingDurationsMinutes: dto.quickBookingDurationsMinutes,
        startingSoonMinutes: dto.startingSoonMinutes,
      },
      update: {
        roomId: dto.roomId,
        quickBookingEnabled: dto.quickBookingEnabled,
        quickBookingDurationsMinutes: dto.quickBookingDurationsMinutes,
        startingSoonMinutes: dto.startingSoonMinutes,
      },
    });
    await this.audit.log({ organizationId: orgId, userId: actorUserId, action: 'room.display.bind', resourceType: 'RoomDisplayBinding', resourceId: binding.id, metadata: { screenId, roomId: dto.roomId } });
    // 'publish', not 'reload' — the player already soft-refetches its manifest/state on this
    // command (PlayerPage.tsx's 'publish' handler), matching every other screen-config change
    // (orientation, aspect ratio, emergency toggle). A full page reload would be needlessly
    // disruptive for what is otherwise just new content becoming available.
    this.gateway.sendToScreen(screenId, { type: 'publish' });
    return binding;
  }

  async removeDisplayBinding(orgId: string, screenId: string, actorUserId: string) {
    await this.orgScoped.assertOwns(
      () => this.prisma.screen.findFirst({ where: { id: screenId, organizationId: orgId } }),
      'Screen not found',
    );
    const binding = await this.prisma.roomDisplayBinding.findUnique({ where: { screenId } });
    if (!binding) return;
    await this.prisma.roomDisplayBinding.delete({ where: { screenId } });
    await this.audit.log({ organizationId: orgId, userId: actorUserId, action: 'room.display.unbind', resourceType: 'RoomDisplayBinding', resourceId: binding.id, metadata: { screenId } });
    this.gateway.sendToScreen(screenId, { type: 'publish' });
  }

  // ── Book Now (§8.4) ──────────────────────────────────────────────────────

  async bookNow(screenId: string, durationMinutes: number, idempotencyKey: string) {
    const screen = await this.prisma.screen.findUnique({
      where: { id: screenId },
      include: { roomDisplayBinding: { include: { room: true } } },
    });
    const binding = screen?.roomDisplayBinding;
    if (!screen?.organizationId || screen.streamingType !== 'ROOM_BOOKING' || !binding) {
      throw new ForbiddenException('Book Now is not available for this request');
    }
    if (binding.room.status !== 'ACTIVE' || !binding.quickBookingEnabled) {
      throw new ForbiddenException('Book Now is not available for this request');
    }
    if (!binding.quickBookingDurationsMinutes.includes(durationMinutes)) {
      throw new BadRequestException('Duration is not an approved preset for this display');
    }
    if (binding.room.providerKey !== 'LUMINA') {
      throw new BadRequestException('Book Now is only supported for Lumina-native rooms in this release');
    }

    // Idempotency: a repeated tap/retry with the same key returns the same booking rather than
    // creating a duplicate. providerExternalKey is unused for native KIOSK bookings, so the
    // idempotency key is folded into it as a stable, connection-independent dedup value.
    const idempotencyMarker = `kiosk:${screenId}:${idempotencyKey}`;
    const existing = await this.prisma.roomReservation.findUnique({ where: { providerExternalKey: idempotencyMarker } });
    if (existing) return existing;

    const startsAt = new Date();
    const requested = new Date(startsAt.getTime() + durationMinutes * 60_000);
    const next = await this.prisma.roomReservation.findFirst({
      where: { roomId: binding.roomId, status: 'CONFIRMED', startsAt: { gt: startsAt } },
      orderBy: { startsAt: 'asc' },
    });
    const endsAt = next && next.startsAt < requested ? next.startsAt : requested;
    const actualMinutes = (endsAt.getTime() - startsAt.getTime()) / 60_000;
    if (actualMinutes < MIN_BOOK_NOW_MINUTES) {
      throw new ConflictException('Not enough time before the next reservation to book this room');
    }

    try {
      const reservation = await this.prisma.roomReservation.create({
        data: {
          roomId: binding.roomId, startsAt, endsAt,
          providerKey: 'LUMINA', origin: 'KIOSK',
          providerExternalKey: idempotencyMarker,
        },
      });
      await this.audit.log({ organizationId: screen.organizationId, action: 'room.reservation.create', resourceType: 'RoomReservation', resourceId: reservation.id, metadata: { origin: 'KIOSK', screenId, roomId: binding.roomId, durationMinutes: actualMinutes } });
      await this.refreshDisplaysForRoom(binding.roomId);
      return reservation;
    } catch (err) {
      if (this.isExclusionViolation(err)) throw new ConflictException('The room is no longer available for the requested time');
      throw err;
    }
  }

  // ── Shared ───────────────────────────────────────────────────────────────

  async refreshDisplaysForRoom(roomId: string): Promise<void> {
    const bindings = await this.prisma.roomDisplayBinding.findMany({ where: { roomId }, select: { screenId: true } });
    for (const b of bindings) this.gateway.sendToScreen(b.screenId, { type: 'publish' });
  }

  redactPrivacy<T extends { title: string | null; organizerDisplayName: string | null }>(reservation: T, privacyMode: RoomPrivacyMode): T {
    if (privacyMode === 'SHOW_ORGANIZER') return reservation;
    if (privacyMode === 'SHOW_TITLE') return { ...reservation, organizerDisplayName: null };
    return { ...reservation, title: null, organizerDisplayName: null };
  }

  private async assertOwnsRoom(orgId: string, roomId: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.bookableRoom.findFirst({ where: { id: roomId, organizationId: orgId } }),
      'Room not found',
    );
  }

  private async assertOwnsPoi(orgId: string, poiId: string) {
    await this.orgScoped.assertOwns(
      () => this.prisma.poi.findFirst({ where: { id: poiId, floor: { building: { organizationId: orgId } } } }),
      'POI not found',
    );
  }

  private assertValidInterval(startsAt: Date, endsAt: Date): void {
    if (!(startsAt.getTime() < endsAt.getTime())) {
      throw new BadRequestException('startsAt must be before endsAt');
    }
  }

  private isExclusionViolation(err: unknown): boolean {
    const message = err instanceof Error ? err.message : String(err);
    return message.includes('RoomReservation_no_overlap_native_confirmed') || message.includes('23P01');
  }
}
