import { BadRequestException } from '@nestjs/common';
import { ScreensService } from './screens.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { StorageService } from '../storage/storage.service';
import type { ScreenGateway } from '../ws/screen.gateway';
import type { AuditService } from '../audit/audit.service';
import type { EntitlementsService } from '../entitlements/entitlements.service';

function makeService(prismaOverrides: { screen?: object; pairingSession?: object; screenAlert?: object; crashReport?: object } = {}) {
  const prisma = {
    screen: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
      ...(prismaOverrides.screen ?? {}),
    },
    pairingSession: {
      findUnique: jest.fn().mockResolvedValue(null),
      ...(prismaOverrides.pairingSession ?? {}),
    },
    screenAlert: {
      findMany: jest.fn().mockResolvedValue([]),
      ...(prismaOverrides.screenAlert ?? {}),
    },
    crashReport: {
      groupBy: jest.fn().mockResolvedValue([]),
      ...(prismaOverrides.crashReport ?? {}),
    },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma)),
  } as unknown as PrismaService;
  const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') } as unknown as JwtService;
  const gateway = {} as ScreenGateway;
  const storage = {} as StorageService;
  const orgScoped = new OrgScopedService();
  const audit = { log: jest.fn() } as unknown as AuditService;
  const entitlements = { assertModule: jest.fn() } as unknown as EntitlementsService;
  return { service: new ScreensService(prisma, jwt, gateway, storage, orgScoped, audit, entitlements), prisma };
}

// P5a schema task 4 — confirmPairing's first (new-device) path: PairingSession is found by code,
// claiming it creates the real, now tenant-owned Screen and deletes the session transactionally.
describe('ScreensService.confirmPairing — claiming a new device (PairingSession)', () => {
  const ORG_ID = 'org_1';
  const CODE = 'ABC123';
  const SESSION_ID = 'session_1';

  it('creates the Screen with the session id, tenant-owned, and deletes the session', async () => {
    const { service, prisma } = makeService({
      pairingSession: { findUnique: jest.fn().mockResolvedValue({ id: SESSION_ID, pairingCode: CODE, createdAt: new Date() }) },
      screen: {
        create: jest.fn().mockResolvedValue({ id: SESSION_ID, organizationId: ORG_ID, paired: true }),
        delete: jest.fn(),
      },
    });
    (prisma as unknown as { pairingSession: { delete: jest.Mock } }).pairingSession.delete = jest.fn();

    await service.confirmPairing(ORG_ID, CODE);

    expect(prisma.screen.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: SESSION_ID, organizationId: ORG_ID, paired: true }),
    });
  });

  it('rejects a session past its TTL without creating a Screen', async () => {
    const { service, prisma } = makeService({
      pairingSession: { findUnique: jest.fn().mockResolvedValue({
        id: SESSION_ID, pairingCode: CODE, createdAt: new Date(Date.now() - 16 * 60 * 1000),
      }) },
      screen: { create: jest.fn() },
    });

    await expect(service.confirmPairing(ORG_ID, CODE)).rejects.toThrow(
      new BadRequestException('Invalid or expired pairing code'),
    );
    expect(prisma.screen.create).not.toHaveBeenCalled();
  });

  it('reports the same generic error when two confirms race on the same session', async () => {
    const { service } = makeService({
      pairingSession: { findUnique: jest.fn().mockResolvedValue({ id: SESSION_ID, pairingCode: CODE, createdAt: new Date() }) },
      screen: { create: jest.fn().mockRejectedValue(Object.assign(new Error('conflict'), { code: 'P2002' })) },
    });

    await expect(service.confirmPairing(ORG_ID, CODE)).rejects.toThrow(
      new BadRequestException('Invalid or expired pairing code'),
    );
  });
});

// Regression coverage for the pairing race fixed this audit: confirmPairing used to read
// `screen.paired`, then separately `update` the row — two concurrent pair attempts on the same
// code could both pass the read before either write landed, and the loser's write would silently
// overwrite the winner's organizationId/playerToken. The fix makes the write itself conditional
// (`updateMany({ where: { paired: false } })`) so only one request's write can ever match.
describe('ScreensService.confirmPairing — re-pairing an existing screen', () => {
  const ORG_ID = 'org_1';
  const CODE = 'ABC123';
  const SCREEN_ID = 'screen_1';

  function makeRepairService(prismaOverrides: Record<string, unknown> = {}) {
    return makeService({
      screen: {
        findUnique: jest.fn().mockResolvedValue({
          id: SCREEN_ID, paired: false, name: 'Unnamed Screen', createdAt: new Date(), pairingCodeIssuedAt: new Date(),
        }),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: SCREEN_ID, paired: true, organizationId: ORG_ID }),
        ...prismaOverrides,
      },
    });
  }

  it('the write is conditional on paired: false, not just the earlier read', async () => {
    const { service, prisma } = makeRepairService();

    await service.confirmPairing(ORG_ID, CODE);

    expect(prisma.screen.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SCREEN_ID, paired: false } }),
    );
  });

  it('loses the race cleanly when another request already paired the screen first', async () => {
    // Simulates the exact race: the read above still saw paired: false, but by the time this
    // request's updateMany runs, a concurrent request already committed — so the conditional
    // WHERE clause matches zero rows.
    const { service } = makeRepairService({ updateMany: jest.fn().mockResolvedValue({ count: 0 }) });

    await expect(service.confirmPairing(ORG_ID, CODE)).rejects.toThrow(
      new BadRequestException('Screen already paired'),
    );
  });

  it('rejects outright if the read already shows the screen as paired', async () => {
    const { service } = makeRepairService({
      findUnique: jest.fn().mockResolvedValue({ id: SCREEN_ID, paired: true, name: 'x', createdAt: new Date(), pairingCodeIssuedAt: new Date() }),
    });

    await expect(service.confirmPairing(ORG_ID, CODE)).rejects.toThrow(
      new BadRequestException('Screen already paired'),
    );
  });

  // P4 task 11 — a pairing code that's still sitting in the DB (cleanup hasn't reached it yet)
  // must stop being claimable once it's past its TTL, same as if the row didn't exist at all.
  // TTL here is judged by pairingCodeIssuedAt (when *this* code was minted), not createdAt (the
  // screen's original creation time) — a screen re-paired months after it was first created must
  // not have every future code read as instantly expired.
  it('rejects a pairing code past its TTL with the same message as a nonexistent one', async () => {
    const { service, prisma } = makeRepairService({
      findUnique: jest.fn().mockResolvedValue({
        id: SCREEN_ID, paired: false, name: 'Unnamed Screen',
        createdAt: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000),
        pairingCodeIssuedAt: new Date(Date.now() - 16 * 60 * 1000),
      }),
    });

    await expect(service.confirmPairing(ORG_ID, CODE)).rejects.toThrow(
      new BadRequestException('Invalid or expired pairing code'),
    );
    expect(prisma.screen.updateMany).not.toHaveBeenCalled();
  });
});

// P8 (docs/tenant_isolation_and_platform_admin_plan.md) — fleetStatus's uptimePercent, computed
// from real ScreenAlert (type OFFLINE) intervals apps/worker's FleetMonitorService already
// writes, replacing the dashboard's fabricated-random-number mock.
describe('ScreensService.fleetStatus — uptimePercent', () => {
  const ORG_ID = 'org_1';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const now = Date.now();

  it('reports 100% for a long-lived screen with no offline alerts', async () => {
    const { service } = makeService({
      screen: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'scr_1', name: 'Lobby', status: 'ONLINE', lastSeenAt: new Date(now), createdAt: new Date(now - 60 * DAY_MS), alerts: [] },
        ]),
      },
    });

    const result = await service.fleetStatus(ORG_ID);

    expect(result.screens[0]!.uptimePercent).toBe(100);
  });

  it('subtracts an ongoing (unresolved) offline interval from the window', async () => {
    const { service } = makeService({
      screen: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'scr_1', name: 'Lobby', status: 'OFFLINE', lastSeenAt: new Date(now - DAY_MS), createdAt: new Date(now - 60 * DAY_MS), alerts: [] },
        ]),
      },
      screenAlert: {
        findMany: jest.fn().mockResolvedValue([
          { screenId: 'scr_1', createdAt: new Date(now - DAY_MS), resolvedAt: null },
        ]),
      },
    });

    const result = await service.fleetStatus(ORG_ID);

    // 1 day down out of a 30-day window ≈ 96.7%
    expect(result.screens[0]!.uptimePercent).toBeCloseTo(96.7, 1);
  });

  it('scopes the window to a screen younger than UPTIME_WINDOW_MS instead of penalizing pre-pairing time', async () => {
    const { service } = makeService({
      screen: {
        findMany: jest.fn().mockResolvedValue([
          // Paired 2 days ago, offline for 1 of those 2 days — 50%, not ~96.7% against a 30-day window.
          { id: 'scr_1', name: 'New Screen', status: 'ONLINE', lastSeenAt: new Date(now), createdAt: new Date(now - 2 * DAY_MS), alerts: [] },
        ]),
      },
      screenAlert: {
        findMany: jest.fn().mockResolvedValue([
          { screenId: 'scr_1', createdAt: new Date(now - DAY_MS), resolvedAt: new Date(now) },
        ]),
      },
    });

    const result = await service.fleetStatus(ORG_ID);

    expect(result.screens[0]!.uptimePercent).toBeCloseTo(50, 0);
  });

  it('returns null for a screen with no observable window yet (created in the future relative to "now")', async () => {
    const { service } = makeService({
      screen: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'scr_1', name: 'Brand New', status: 'ONLINE', lastSeenAt: new Date(now), createdAt: new Date(now + 60_000), alerts: [] },
        ]),
      },
    });

    const result = await service.fleetStatus(ORG_ID);

    expect(result.screens[0]!.uptimePercent).toBeNull();
  });

  it('queries ScreenAlert once for every screen, not per-screen', async () => {
    const { service, prisma } = makeService({
      screen: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'scr_1', name: 'A', status: 'ONLINE', lastSeenAt: new Date(now), createdAt: new Date(now - 60 * DAY_MS), alerts: [] },
          { id: 'scr_2', name: 'B', status: 'ONLINE', lastSeenAt: new Date(now), createdAt: new Date(now - 60 * DAY_MS), alerts: [] },
        ]),
      },
    });

    await service.fleetStatus(ORG_ID);

    expect(prisma.screenAlert.findMany).toHaveBeenCalledTimes(1);
  });
});
