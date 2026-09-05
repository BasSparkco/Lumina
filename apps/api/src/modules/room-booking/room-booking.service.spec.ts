import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RoomBookingService } from './room-booking.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import { RoomBookingConflictError } from './providers/room-calendar-provider';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ScreenGateway } from '../ws/screen.gateway';
import type { AuditService } from '../audit/audit.service';
import type { RoomAvailabilityService } from './room-availability.service';
import type { RoomCalendarProviderRegistry } from './providers/room-calendar-provider.registry';

const ROOM = {
  id: 'room_1', organizationId: 'org_1', providerKey: 'LUMINA', privacyMode: 'BUSY_ONLY',
  status: 'ACTIVE', timezone: 'UTC', normalizedName: 'room a',
};

function makeService(opts: { nativeCreate?: jest.Mock } = {}) {
  const prisma = {
    bookableRoom: {
      findFirst: jest.fn().mockResolvedValue(ROOM),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'room_new', ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...ROOM, ...data })),
      delete: jest.fn(),
    },
    roomReservation: {
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'reservation_1', ...data })),
    },
    roomDisplayBinding: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve({ id: 'binding_1', ...create })),
      findUnique: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
    },
    screen: {
      findFirst: jest.fn().mockResolvedValue({ id: 'screen_1', organizationId: 'org_1' }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    poi: { findFirst: jest.fn().mockResolvedValue({ id: 'poi_1' }) },
  } as unknown as PrismaService;

  const orgScoped = new OrgScopedService();
  const gateway = { sendToScreen: jest.fn() } as unknown as ScreenGateway;
  const audit = { log: jest.fn() } as unknown as AuditService;
  const availability = { getAvailability: jest.fn(), listStoredReservations: jest.fn().mockResolvedValue([]) } as unknown as RoomAvailabilityService;
  const nativeCreate = opts.nativeCreate ?? jest.fn().mockImplementation((input) => Promise.resolve({
    externalEventId: 'ext_1', externalICalUid: null, externalEtag: null,
    startsAt: input.startsAt, endsAt: input.endsAt, title: input.title ?? null,
    organizerDisplayName: input.organizerDisplayName ?? null, status: 'CONFIRMED', providerUpdatedAt: null,
  }));
  const providers = {
    get: jest.fn().mockReturnValue({ key: 'LUMINA', createReservation: nativeCreate }),
  } as unknown as RoomCalendarProviderRegistry;

  return { service: new RoomBookingService(prisma, orgScoped, gateway, audit, availability, providers), prisma, gateway, audit, nativeCreate };
}

describe('RoomBookingService — rooms', () => {
  it('rejects an unsupported timezone', async () => {
    const { service } = makeService();
    await expect(service.createRoom('org_1', { name: 'A', timezone: 'Not/AZone' }, 'user_1')).rejects.toThrow(BadRequestException);
  });

  it('rejects a room lookup for another organization', async () => {
    const { service, prisma } = makeService();
    (prisma.bookableRoom.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.getRoom('org_2', 'room_1')).rejects.toThrow(NotFoundException);
  });

  it('verifies a linked wayfindingPoiId belongs to the same organization', async () => {
    const { service, prisma } = makeService();
    (prisma.poi.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.createRoom('org_1', { name: 'A', timezone: 'UTC', wayfindingPoiId: 'poi_x' }, 'user_1')).rejects.toThrow(NotFoundException);
  });

  it('rejects deleting a room with future reservations', async () => {
    const { service, prisma } = makeService();
    (prisma.roomReservation.count as jest.Mock).mockResolvedValue(1);
    await expect(service.deleteRoom('org_1', 'room_1', 'user_1')).rejects.toThrow(ConflictException);
  });

  it('rejects deleting a room with an active display binding', async () => {
    const { service, prisma } = makeService();
    (prisma.roomDisplayBinding.count as jest.Mock).mockResolvedValue(1);
    await expect(service.deleteRoom('org_1', 'room_1', 'user_1')).rejects.toThrow(ConflictException);
  });
});

describe('RoomBookingService — reservations', () => {
  it('rejects an interval where startsAt is not before endsAt', async () => {
    const { service } = makeService();
    await expect(service.createReservation('org_1', 'room_1', { startsAt: '2026-01-01T10:00:00Z', endsAt: '2026-01-01T09:00:00Z' }, 'user_1'))
      .rejects.toThrow(BadRequestException);
  });

  it('translates a provider conflict into HTTP 409', async () => {
    const nativeCreate = jest.fn().mockRejectedValue(new RoomBookingConflictError());
    const { service } = makeService({ nativeCreate });
    await expect(service.createReservation('org_1', 'room_1', { startsAt: '2026-01-01T10:00:00Z', endsAt: '2026-01-01T11:00:00Z' }, 'user_1'))
      .rejects.toThrow(ConflictException);
  });

  it('refreshes every bound display after a successful reservation change', async () => {
    const { service, prisma, gateway } = makeService();
    (prisma.roomDisplayBinding.findMany as jest.Mock).mockResolvedValue([{ screenId: 'screen_a' }, { screenId: 'screen_b' }]);

    await service.createReservation('org_1', 'room_1', { startsAt: '2026-01-01T10:00:00Z', endsAt: '2026-01-01T11:00:00Z' }, 'user_1');

    expect(gateway.sendToScreen).toHaveBeenCalledWith('screen_a', { type: 'publish' });
    expect(gateway.sendToScreen).toHaveBeenCalledWith('screen_b', { type: 'publish' });
  });

  it('rejects direct create/edit for a non-native (externally sourced) room', async () => {
    const { service, prisma } = makeService();
    (prisma.bookableRoom.findFirst as jest.Mock).mockResolvedValue({ ...ROOM, providerKey: 'MICROSOFT_365' });
    await expect(service.createReservation('org_1', 'room_1', { startsAt: '2026-01-01T10:00:00Z', endsAt: '2026-01-01T11:00:00Z' }, 'user_1'))
      .rejects.toThrow(BadRequestException);
  });
});

describe('RoomBookingService — display bindings', () => {
  it('rejects an unsupported quick-booking duration', async () => {
    const { service } = makeService();
    await expect(service.updateDisplayBinding('org_1', 'screen_1', {
      roomId: 'room_1', quickBookingEnabled: true, quickBookingDurationsMinutes: [0], startingSoonMinutes: 10,
    }, 'user_1')).rejects.toThrow(BadRequestException);
  });

  it('binds a screen to a room and reloads it', async () => {
    const { service, gateway } = makeService();
    await service.updateDisplayBinding('org_1', 'screen_1', {
      roomId: 'room_1', quickBookingEnabled: true, quickBookingDurationsMinutes: [15, 30], startingSoonMinutes: 10,
    }, 'user_1');
    expect(gateway.sendToScreen).toHaveBeenCalledWith('screen_1', { type: 'publish' });
  });
});

describe('RoomBookingService.bookNow', () => {
  function makeBoundScreen(overrides: Record<string, unknown> = {}) {
    return {
      id: 'screen_1', organizationId: 'org_1', streamingType: 'ROOM_BOOKING',
      roomDisplayBinding: {
        roomId: 'room_1', quickBookingEnabled: true, quickBookingDurationsMinutes: [15, 30, 60],
        room: { ...ROOM, providerKey: 'LUMINA' },
      },
      ...overrides,
    };
  }

  it('rejects when the screen has no room binding', async () => {
    const { service, prisma } = makeService();
    (prisma.screen.findUnique as jest.Mock).mockResolvedValue({ id: 'screen_1', organizationId: 'org_1', streamingType: 'ASSET', roomDisplayBinding: null });
    await expect(service.bookNow('screen_1', 30, 'key-1')).rejects.toThrow(ForbiddenException);
  });

  it('rejects a duration that is not an approved preset for this display', async () => {
    const { service, prisma } = makeService();
    (prisma.screen.findUnique as jest.Mock).mockResolvedValue(makeBoundScreen());
    await expect(service.bookNow('screen_1', 45, 'key-1')).rejects.toThrow(BadRequestException);
  });

  it('rejects Book Now for a non-native mapped room', async () => {
    const { service, prisma } = makeService();
    (prisma.screen.findUnique as jest.Mock).mockResolvedValue(makeBoundScreen({
      roomDisplayBinding: { roomId: 'room_1', quickBookingEnabled: true, quickBookingDurationsMinutes: [30], room: { ...ROOM, providerKey: 'MICROSOFT_365' } },
    }));
    await expect(service.bookNow('screen_1', 30, 'key-1')).rejects.toThrow(BadRequestException);
  });

  it('a repeated call with the same idempotency key returns the existing booking rather than creating a duplicate', async () => {
    const { service, prisma } = makeService();
    (prisma.screen.findUnique as jest.Mock).mockResolvedValue(makeBoundScreen());
    const existing = { id: 'existing_reservation' };
    (prisma.roomReservation.findUnique as jest.Mock).mockResolvedValue(existing);

    const result = await service.bookNow('screen_1', 30, 'key-1');

    expect(result).toBe(existing);
    expect(prisma.roomReservation.create).not.toHaveBeenCalled();
  });

  it('caps endsAt before the next confirmed reservation and rejects if too little time remains', async () => {
    const { service, prisma } = makeService();
    (prisma.screen.findUnique as jest.Mock).mockResolvedValue(makeBoundScreen());
    (prisma.roomReservation.findFirst as jest.Mock).mockResolvedValue({ startsAt: new Date(Date.now() + 2 * 60_000) }); // next meeting in 2 minutes
    await expect(service.bookNow('screen_1', 30, 'key-1')).rejects.toThrow(ConflictException);
  });

  it('creates a KIOSK-origin reservation and refreshes bound displays on success', async () => {
    const { service, prisma, gateway, audit } = makeService();
    (prisma.screen.findUnique as jest.Mock).mockResolvedValue(makeBoundScreen());
    (prisma.roomDisplayBinding.findMany as jest.Mock).mockResolvedValue([{ screenId: 'screen_1' }]);

    await service.bookNow('screen_1', 30, 'key-1');

    expect(prisma.roomReservation.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ origin: 'KIOSK', providerKey: 'LUMINA' }),
    }));
    expect(gateway.sendToScreen).toHaveBeenCalledWith('screen_1', { type: 'publish' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'room.reservation.create' }));
  });
});

describe('RoomBookingService.redactPrivacy', () => {
  const reservation = { title: 'Budget Review', organizerDisplayName: 'Jane Doe' };

  it('SHOW_ORGANIZER keeps everything', () => {
    const { service } = makeService();
    expect(service.redactPrivacy(reservation, 'SHOW_ORGANIZER')).toEqual(reservation);
  });

  it('SHOW_TITLE hides the organizer but keeps the title', () => {
    const { service } = makeService();
    expect(service.redactPrivacy(reservation, 'SHOW_TITLE')).toEqual({ title: 'Budget Review', organizerDisplayName: null });
  });

  it('BUSY_ONLY hides both title and organizer', () => {
    const { service } = makeService();
    expect(service.redactPrivacy(reservation, 'BUSY_ONLY')).toEqual({ title: null, organizerDisplayName: null });
  });
});
