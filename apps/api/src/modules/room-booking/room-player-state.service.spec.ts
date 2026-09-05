import { RoomPlayerStateService } from './room-player-state.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { RoomBookingService } from './room-booking.service';

const ROOM = {
  id: 'room_1', name: 'Room A', locationLabel: 'L1', timezone: 'UTC', capacity: 8,
  amenities: ['TV'], status: 'ACTIVE', privacyMode: 'BUSY_ONLY',
};
const BINDING = { roomId: 'room_1', quickBookingEnabled: true, quickBookingDurationsMinutes: [15, 30], startingSoonMinutes: 10 };

function makeService(reservations: unknown[] = []) {
  const prisma = {
    bookableRoom: { findUnique: jest.fn().mockResolvedValue(ROOM) },
    roomReservation: { findMany: jest.fn().mockResolvedValue(reservations) },
  } as unknown as PrismaService;
  const roomBooking = {
    redactPrivacy: jest.fn((r: { title: string | null; organizerDisplayName: string | null }, mode: string) =>
      mode === 'BUSY_ONLY' ? { ...r, title: null, organizerDisplayName: null } : r),
  } as unknown as RoomBookingService;
  return { service: new RoomPlayerStateService(prisma, roomBooking), prisma, roomBooking };
}

describe('RoomPlayerStateService.buildPayload', () => {
  it('returns null when the bound room no longer exists', async () => {
    const { service, prisma } = makeService();
    (prisma.bookableRoom.findUnique as jest.Mock).mockResolvedValue(null);
    expect(await service.buildPayload(BINDING)).toBeNull();
  });

  it('applies server-side privacy redaction to every reservation before returning it', async () => {
    const { service, roomBooking } = makeService([
      { id: 'r1', startsAt: new Date(), endsAt: new Date(Date.now() + 3600_000), title: 'Secret Meeting', organizerDisplayName: 'Jane', status: 'CONFIRMED' },
    ]);

    const payload = await service.buildPayload(BINDING);

    expect(roomBooking.redactPrivacy).toHaveBeenCalled();
    expect(payload!.reservations[0]).toEqual(expect.objectContaining({ title: null, organizerDisplayName: null }));
  });

  it('includes the display config (quick booking, starting-soon threshold) from the binding', async () => {
    const { service } = makeService([]);
    const payload = await service.buildPayload(BINDING);
    expect(payload!.display).toEqual({
      privacyMode: 'BUSY_ONLY', quickBookingEnabled: true, quickBookingDurationsMinutes: [15, 30], startingSoonMinutes: 10,
    });
  });

  it('never includes a reservation that has already fully ended', async () => {
    const { service, prisma } = makeService();
    await service.buildPayload(BINDING);
    const call = (prisma.roomReservation.findMany as jest.Mock).mock.calls[0][0];
    expect(call.where.endsAt.gt).toBeInstanceOf(Date);
    expect(call.where.status).toBe('CONFIRMED');
  });

  it('caps the reservation query itself, not just the response — never asks Prisma for an unbounded result set', async () => {
    const { service, prisma } = makeService([]);
    await service.buildPayload(BINDING);
    const call = (prisma.roomReservation.findMany as jest.Mock).mock.calls[0][0];
    expect(call.take).toBeGreaterThan(0);
    expect(call.take).toBeLessThanOrEqual(20);
  });
});
