import { PlayerService } from './player.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { StorageService } from '../storage/storage.service';
import type { ScreenGateway } from '../ws/screen.gateway';
import type { SchedulesService } from '../schedules/schedules.service';
import type { PowerSchedulesService } from '../power-schedules/power-schedules.service';
import type { ScreensService } from '../screens/screens.service';
import type { EntitlementsService } from '../entitlements/entitlements.service';

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
    const entitlements = {} as EntitlementsService;
    return {
      service: new PlayerService(prisma, storage, gateway, schedules, powerSchedules, screens, entitlements),
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

// A suspended tenant must get a 200 with neutral content, never a 401/404 — both the web and
// Flutter native players treat 401/404 on this endpoint as "this screen's credential is dead"
// and react by wiping local pairing state, which would be a destructive overreaction to a
// temporary, reversible business state. See docs/adr/platform-modules-and-entitlements.md.
describe('PlayerService.getState — suspended tenant returns neutral content, not an error', () => {
  function makeService(screenOverrides: Record<string, unknown>) {
    const prisma = {
      screen: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's1',
          organizationId: 'org_1',
          streamingType: 'PLAYLIST',
          timezone: 'UTC',
          latitude: null,
          longitude: null,
          prayerMethod: 'UmmAlQura',
          athanEnabled: false,
          stopped: false,
          showClock: false,
          orientation: 0,
          aspectRatio: '16:9',
          volume: 80,
          group: null,
          ...screenOverrides,
        }),
      },
      routeEdge: { findMany: jest.fn() },
    } as unknown as PrismaService;
    const storage = {} as StorageService;
    const gateway = {} as ScreenGateway;
    const schedules = { getSchedulesForScreen: jest.fn(), resolveNow: jest.fn() } as unknown as SchedulesService;
    const powerSchedules = { resolveForScreen: jest.fn() } as unknown as PowerSchedulesService;
    const screens = {} as ScreensService;
    const entitlements = { hasModule: jest.fn().mockResolvedValue(false) } as unknown as EntitlementsService;
    return {
      service: new PlayerService(prisma, storage, gateway, schedules, powerSchedules, screens, entitlements),
      schedules,
      powerSchedules,
      entitlements,
    };
  }

  it('returns neutral content and never touches schedule/power resolution when the org is SUSPENDED', async () => {
    const { service, schedules, powerSchedules } = makeService({ organization: { status: 'SUSPENDED' } });

    const state = await service.getState('s1');

    expect(state).toEqual(
      expect.objectContaining({
        screenId: 's1',
        streamingType: 'PLAYLIST',
        emergencyActive: false,
        emergencyPlaylist: null,
        asset: null,
        wayfinding: null,
        scheduleRules: [],
        resolvedPlaylistId: null,
        defaultPlaylist: null,
        poweredOn: true,
        powerScheduleRules: [],
      }),
    );
    expect(schedules.getSchedulesForScreen).not.toHaveBeenCalled();
    expect(powerSchedules.resolveForScreen).not.toHaveBeenCalled();
  });

  it('does not suppress content for an ACTIVE organization', async () => {
    const { service, schedules, powerSchedules } = makeService({
      organization: { status: 'ACTIVE' },
      playlist: null,
      emergencyPlaylist: null,
      asset: null,
      kioskLocation: null,
    });
    (schedules.getSchedulesForScreen as jest.Mock).mockResolvedValue([]);
    (powerSchedules.resolveForScreen as jest.Mock).mockResolvedValue({ poweredOn: true, rules: [] });

    const state = await service.getState('s1');

    expect(powerSchedules.resolveForScreen).toHaveBeenCalled();
    expect(state.streamingType).toBe('PLAYLIST');
  });

  it('leaves a screen with no organization (unassigned) unaffected — the nullable relation resolves to null, not a SUSPENDED status', async () => {
    const { service, schedules, powerSchedules } = makeService({
      organizationId: null,
      organization: null,
      playlist: null,
      emergencyPlaylist: null,
      asset: null,
      kioskLocation: null,
    });
    (schedules.getSchedulesForScreen as jest.Mock).mockResolvedValue([]);
    (powerSchedules.resolveForScreen as jest.Mock).mockResolvedValue({ poweredOn: true, rules: [] });

    await service.getState('s1');

    expect(powerSchedules.resolveForScreen).toHaveBeenCalled();
  });
});

// Section 8.3 of docs/adr/platform-modules-and-entitlements.md: WAYFINDING must never leak to
// an unlicensed tenant's player, an active evacuation must never be suppressed by that same
// check, and a usable module must issue an offline lease (used by both apps/player and the
// Flutter native player to bound cached rendering — see flutter_player_entitlement_sync_roadmap.md).
describe('PlayerService.getState — WAYFINDING entitlement, evacuation bypass, and offline lease', () => {
  const kioskFixture = {
    floorId: 'floor_1',
    x: 50,
    y: 50,
    attractPlaylist: null,
    attractTheme: null,
    floor: {
      building: {
        id: 'building_1',
        name: 'Test Mall',
        floors: [
          {
            id: 'floor_1',
            level: 0,
            label: 'Ground',
            floorPlanAsset: null,
            pois: [],
            routeNodes: [],
          },
        ],
      },
    },
  };

  function makeService(screenOverrides: Record<string, unknown>, hasModule: boolean) {
    const prisma = {
      screen: {
        findUnique: jest.fn().mockResolvedValue({
          id: 's1',
          organizationId: 'org_1',
          organization: { status: 'ACTIVE' },
          streamingType: 'WAYFINDING',
          timezone: 'UTC',
          latitude: null,
          longitude: null,
          prayerMethod: 'UmmAlQura',
          athanEnabled: false,
          stopped: false,
          showClock: false,
          orientation: 0,
          aspectRatio: '16:9',
          volume: 80,
          group: null,
          emergencyActive: false,
          emergencyPlaylist: null,
          asset: null,
          playlist: null,
          kioskLocation: kioskFixture,
          ...screenOverrides,
        }),
      },
      routeEdge: { findMany: jest.fn().mockResolvedValue([]) },
    } as unknown as PrismaService;
    const storage = { publicUrl: jest.fn((k: string) => `https://media.test/${k}`) } as unknown as StorageService;
    const gateway = {} as ScreenGateway;
    const schedules = { getSchedulesForScreen: jest.fn().mockResolvedValue([]), resolveNow: jest.fn() } as unknown as SchedulesService;
    const powerSchedules = { resolveForScreen: jest.fn().mockResolvedValue({ poweredOn: true, rules: [] }) } as unknown as PowerSchedulesService;
    const screens = {} as ScreensService;
    const entitlements = { hasModule: jest.fn().mockResolvedValue(hasModule) } as unknown as EntitlementsService;
    return { service: new PlayerService(prisma, storage, gateway, schedules, powerSchedules, screens, entitlements), entitlements };
  }

  it('returns the full wayfinding payload and a lease when the module is entitled', async () => {
    const { service, entitlements } = makeService({}, true);

    const state = await service.getState('s1');

    expect(entitlements.hasModule).toHaveBeenCalledWith('org_1', 'WAYFINDING');
    expect(state.wayfinding).not.toBeNull();
    expect(state.wayfinding?.building.id).toBe('building_1');
    expect(state.moduleLeases).toEqual([
      expect.objectContaining({ key: 'WAYFINDING', issuedAt: expect.any(String), validUntil: expect.any(String) }),
    ]);
    const lease = state.moduleLeases[0]!;
    expect(new Date(lease.validUntil).getTime()).toBeGreaterThan(new Date(lease.issuedAt).getTime());
  });

  it('suppresses the wayfinding payload and issues no lease when the module is not entitled', async () => {
    const { service } = makeService({}, false);

    const state = await service.getState('s1');

    expect(state.wayfinding).toBeNull();
    expect(state.moduleLeases).toEqual([]);
  });

  it('evacuation bypass: still returns the wayfinding payload during an active emergency even when unentitled', async () => {
    const { service } = makeService({ emergencyActive: true }, false);

    const state = await service.getState('s1');

    expect(state.wayfinding).not.toBeNull();
  });

  it('evacuation bypass does not itself earn an offline lease — only genuine entitlement does', async () => {
    const { service } = makeService({ emergencyActive: true }, false);

    const state = await service.getState('s1');

    expect(state.moduleLeases).toEqual([]);
  });

  it('never checks entitlement for a screen not in WAYFINDING mode', async () => {
    const { service, entitlements } = makeService({ streamingType: 'PLAYLIST', kioskLocation: null }, true);

    await service.getState('s1');

    expect(entitlements.hasModule).not.toHaveBeenCalled();
  });

  // docs/modules/modules_shared_preflight_plan.md §4.1/§5.2/§5.3 — tenant suspension must not
  // suppress an already-active emergency playlist or Wayfinding evacuation route, the same
  // safety exemption this suite already covers for module disablement/lease expiry above. These
  // cases reuse this suite's own makeService()/kioskFixture rather than reconstructing a second
  // Wayfinding fixture, per the plan's explicit instruction not to duplicate that hydration.
  describe('suspended tenant with an active emergency', () => {
    const emergencyPlaylistFixture = {
      id: 'ep1',
      name: 'Fire Evacuation',
      transitionStyle: 'NONE',
      transitionDurationMs: 0,
      playbackOrder: 'SEQUENTIAL',
      items: [],
    };

    it('suspended + no emergency: returns neutral HTTP-200-shaped content, no lease, entitlement never checked', async () => {
      const { service, entitlements } = makeService(
        { organization: { status: 'SUSPENDED' }, emergencyActive: false },
        true,
      );

      const state = await service.getState('s1');

      expect(state).toEqual(
        expect.objectContaining({
          screenId: 's1',
          emergencyActive: false,
          emergencyPlaylist: null,
          asset: null,
          wayfinding: null,
          scheduleRules: [],
          resolvedPlaylistId: null,
          defaultPlaylist: null,
          poweredOn: true,
          powerScheduleRules: [],
          moduleLeases: [],
        }),
      );
      expect(entitlements.hasModule).not.toHaveBeenCalled();
    });

    it('suspended + emergency playlist assigned: returns only the emergency playlist, no lease, no wayfinding, no wayfinding entitlement check', async () => {
      const { service, entitlements } = makeService(
        {
          organization: { status: 'SUSPENDED' },
          emergencyActive: true,
          emergencyPlaylist: emergencyPlaylistFixture,
        },
        true,
      );

      const state = await service.getState('s1');

      expect(state.emergencyActive).toBe(true);
      expect(state.emergencyPlaylist).not.toBeNull();
      expect(state.emergencyPlaylist?.id).toBe('ep1');
      expect(state.wayfinding).toBeNull();
      expect(state.moduleLeases).toEqual([]);
      expect(state.asset).toBeNull();
      expect(state.scheduleRules).toEqual([]);
      expect(state.defaultPlaylist).toBeNull();
      // Emergency playlist takes priority over evacuation (§4.2) — the entitlement bypass path
      // for the evacuation view must not even be consulted when a playlist already won.
      expect(entitlements.hasModule).not.toHaveBeenCalled();
    });

    it('suspended + no emergency playlist + configured Wayfinding kiosk: returns the evacuation payload with no lease, regardless of entitlement', async () => {
      const { service, entitlements } = makeService(
        {
          organization: { status: 'SUSPENDED' },
          emergencyActive: true,
          emergencyPlaylist: null,
        },
        false, // unentitled — the bypass, not genuine entitlement, must be what renders this
      );

      const state = await service.getState('s1');

      expect(state.emergencyActive).toBe(true);
      expect(state.emergencyPlaylist).toBeNull();
      expect(state.wayfinding).not.toBeNull();
      expect(state.wayfinding?.building.id).toBe('building_1');
      expect(state.moduleLeases).toEqual([]);
      expect(state.asset).toBeNull();
      expect(state.scheduleRules).toEqual([]);
      expect(state.defaultPlaylist).toBeNull();
      // Live entitlement is still re-checked even though the bypass, not the result, is what
      // renders this — a lease must never be issued off the back of an unentitled bypass.
      expect(entitlements.hasModule).toHaveBeenCalledWith('org_1', 'WAYFINDING');
    });

    it('suspended + evacuation response never includes attract playlist/theme even when configured', async () => {
      const { service } = makeService(
        {
          organization: { status: 'SUSPENDED' },
          emergencyActive: true,
          emergencyPlaylist: null,
          kioskLocation: {
            ...kioskFixture,
            attractPlaylist: { id: 'attract1', name: 'Idle Loop', transitionStyle: 'NONE', transitionDurationMs: 0, playbackOrder: 'SEQUENTIAL', items: [] },
            attractTheme: null,
          },
        },
        true,
      );

      const state = await service.getState('s1');

      expect(state.wayfinding?.attractPlaylist).toBeNull();
      expect(state.wayfinding?.attractTheme).toBeNull();
    });

    it('suspended + emergency active but neither a playlist nor a configured Wayfinding kiosk: renders no ordinary content and no evacuation payload', async () => {
      const { service } = makeService(
        {
          organization: { status: 'SUSPENDED' },
          streamingType: 'PLAYLIST',
          emergencyActive: true,
          emergencyPlaylist: null,
          kioskLocation: null,
        },
        true,
      );

      const state = await service.getState('s1');

      expect(state.emergencyActive).toBe(true);
      expect(state.emergencyPlaylist).toBeNull();
      expect(state.wayfinding).toBeNull();
      expect(state.moduleLeases).toEqual([]);
    });

    it('removing suspension restores normal rendering without reconstructing configuration', async () => {
      const { service, entitlements } = makeService({ organization: { status: 'ACTIVE' } }, true);

      const state = await service.getState('s1');

      expect(state.wayfinding).not.toBeNull();
      expect(state.moduleLeases).toEqual([
        expect.objectContaining({ key: 'WAYFINDING' }),
      ]);
      expect(entitlements.hasModule).toHaveBeenCalledWith('org_1', 'WAYFINDING');
    });
  });
});
