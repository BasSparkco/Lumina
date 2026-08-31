import { PlayerService } from './player.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { ScreenGateway } from '../ws/screen.gateway';
import type { SchedulesService } from '../schedules/schedules.service';
import type { PowerSchedulesService } from '../power-schedules/power-schedules.service';
import type { ScreensService } from '../screens/screens.service';

// Covers the player's pairing/heartbeat path — the one every physical screen depends on to go
// from "just unboxed" to "showing content," and to be reported online. These are deliberately
// scoped to that path, not the much larger state-hydration surface (getState/getPlaylist).
describe('PlayerService — pairing and heartbeat', () => {
  function makeService(prismaOverrides: Record<string, unknown> = {}) {
    const prisma = {
      screen: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        ...(prismaOverrides.screen as object ?? {}),
      },
    } as unknown as PrismaService;
    const storage = {} as StorageService;
    const gateway = { sendStatusToOrg: jest.fn() } as unknown as ScreenGateway;
    const schedules = {} as SchedulesService;
    const powerSchedules = {} as PowerSchedulesService;
    const screens = {} as ScreensService;
    return {
      service: new PlayerService(prisma, storage, gateway, schedules, powerSchedules, screens),
      prisma,
      gateway,
    };
  }

  describe('requestPairingCode', () => {
    it('creates an unpaired screen with the generated code and returns both', async () => {
      const { service, prisma } = makeService({
        screen: {
          findUnique: jest.fn().mockResolvedValue(null), // no collision on the first try
          create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'screen_new', ...data })),
        },
      });

      const result = await service.requestPairingCode();

      expect(result.screenId).toBe('screen_new');
      expect(result.pairingCode).toHaveLength(6);
      expect(prisma.screen.create).toHaveBeenCalledWith({
        data: { name: 'Unnamed Screen', pairingCode: result.pairingCode, paired: false },
      });
    });

    it('retries the code on a collision instead of creating a duplicate', async () => {
      const { service, prisma } = makeService({
        screen: {
          // First lookup: code taken. Second lookup: free.
          findUnique: jest.fn()
            .mockResolvedValueOnce({ id: 'existing_screen' })
            .mockResolvedValue(null),
          create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'screen_new', ...data })),
        },
      });

      await service.requestPairingCode();

      expect(prisma.screen.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('checkPairingById', () => {
    it('reports not paired for an unknown screen id', async () => {
      const { service } = makeService({ screen: { findUnique: jest.fn().mockResolvedValue(null) } });
      await expect(service.checkPairingById('nonexistent')).resolves.toEqual({ paired: false });
    });

    it('reports not paired while the screen is still awaiting pairing', async () => {
      const { service } = makeService({
        screen: { findUnique: jest.fn().mockResolvedValue({ id: 's1', paired: false, playerToken: null }) },
      });
      await expect(service.checkPairingById('s1')).resolves.toEqual({ paired: false });
    });

    it('returns the token once the dashboard has confirmed pairing', async () => {
      const { service } = makeService({
        screen: { findUnique: jest.fn().mockResolvedValue({ id: 's1', paired: true, playerToken: 'jwt-abc' }) },
      });
      await expect(service.checkPairingById('s1')).resolves.toEqual({ paired: true, token: 'jwt-abc' });
    });
  });

  describe('heartbeat', () => {
    it('marks the screen online with a fresh lastSeenAt', async () => {
      const { service, prisma } = makeService({
        screen: {
          update: jest.fn().mockResolvedValue({ id: 's1', organizationId: 'org_1', status: 'ONLINE' }),
        },
      });

      await service.heartbeat('s1', 'asset_1');

      expect(prisma.screen.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { lastSeenAt: expect.any(Date), status: 'ONLINE' },
      });
    });

    it('only includes hasContent in the write when the caller actually sent it', async () => {
      const { service, prisma } = makeService({
        screen: { update: jest.fn().mockResolvedValue({ id: 's1', organizationId: 'org_1' }) },
      });

      await service.heartbeat('s1', null, true);

      expect(prisma.screen.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ hasContent: true }) }),
      );
    });

    it('notifies the org over the socket gateway when the screen belongs to one', async () => {
      const { service, gateway } = makeService({
        screen: { update: jest.fn().mockResolvedValue({ id: 's1', organizationId: 'org_1' }) },
      });

      await service.heartbeat('s1', null);

      expect(gateway.sendStatusToOrg).toHaveBeenCalledWith('org_1', 's1', 'ONLINE');
    });
  });
});
