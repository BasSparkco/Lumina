import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EntitlementsService, type ModuleAssignmentInput } from './entitlements.service';
import { ModuleCatalogService } from './module-catalog.service';
import { Clock } from './clock';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const NOW = new Date('2026-09-04T12:00:00.000Z');

function makeService(overrides: { org?: Record<string, unknown>; tenantModule?: Record<string, unknown> } = {}) {
  const prisma = {
    organization: {
      findUnique: jest.fn().mockResolvedValue({ id: 'org_1', status: 'ACTIVE' }),
      ...overrides.org,
    },
    tenantModule: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn(),
      ...overrides.tenantModule,
    },
    $transaction: jest.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  } as unknown as PrismaService;

  const clock = { now: () => NOW } as Clock;
  const catalog = new ModuleCatalogService();
  const audit = { log: jest.fn() } as unknown as AuditService;

  return { service: new EntitlementsService(prisma, catalog, clock, audit), prisma, audit };
}

describe('EntitlementsService.hasModule — active, disabled, trial, expired, suspended-org decisions', () => {
  it('is usable when the tenant module row is ACTIVE with no expiry', async () => {
    const { service } = makeService({
      tenantModule: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', expiresAt: null }) },
    });

    await expect(service.hasModule('org_1', 'WAYFINDING')).resolves.toBe(true);
  });

  it('is not usable when the tenant module row is DISABLED, regardless of expiresAt', async () => {
    const { service } = makeService({
      tenantModule: {
        findUnique: jest.fn().mockResolvedValue({ status: 'DISABLED', expiresAt: new Date('2099-01-01') }),
      },
    });

    await expect(service.hasModule('org_1', 'WAYFINDING')).resolves.toBe(false);
  });

  it('is usable when TRIAL and expiresAt is in the future', async () => {
    const { service } = makeService({
      tenantModule: {
        findUnique: jest.fn().mockResolvedValue({ status: 'TRIAL', expiresAt: new Date('2026-09-10') }),
      },
    });

    await expect(service.hasModule('org_1', 'WAYFINDING')).resolves.toBe(true);
  });

  it('is not usable when TRIAL and expiresAt has already passed', async () => {
    const { service } = makeService({
      tenantModule: {
        findUnique: jest.fn().mockResolvedValue({ status: 'TRIAL', expiresAt: new Date('2026-01-01') }),
      },
    });

    await expect(service.hasModule('org_1', 'WAYFINDING')).resolves.toBe(false);
  });

  it('is not usable when ACTIVE but expiresAt has already passed (a lapsed fixed-term contract)', async () => {
    const { service } = makeService({
      tenantModule: {
        findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', expiresAt: new Date('2026-01-01') }),
      },
    });

    await expect(service.hasModule('org_1', 'WAYFINDING')).resolves.toBe(false);
  });

  it('is not usable when there is no tenant module row at all', async () => {
    const { service } = makeService();

    await expect(service.hasModule('org_1', 'WAYFINDING')).resolves.toBe(false);
  });

  it('is not usable when the organization itself is SUSPENDED, even with an ACTIVE module row', async () => {
    const { service } = makeService({
      org: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1', status: 'SUSPENDED' }) },
      tenantModule: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', expiresAt: null }) },
    });

    await expect(service.hasModule('org_1', 'WAYFINDING')).resolves.toBe(false);
  });

  it('is not usable when the organization does not exist', async () => {
    const { service } = makeService({ org: { findUnique: jest.fn().mockResolvedValue(null) } });

    await expect(service.hasModule('org_1', 'WAYFINDING')).resolves.toBe(false);
  });
});

describe('EntitlementsService — dependent module resolution', () => {
  it('WAYFINDING_AI is not usable when its own row is ACTIVE but WAYFINDING is DISABLED', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ status: 'ACTIVE', expiresAt: null }) // WAYFINDING_AI
      .mockResolvedValueOnce({ status: 'DISABLED', expiresAt: null }); // WAYFINDING dependency
    const { service } = makeService({ tenantModule: { findUnique } });

    await expect(service.hasModule('org_1', 'WAYFINDING_AI')).resolves.toBe(false);
  });

  it('WAYFINDING_AI is usable when both it and its WAYFINDING dependency are usable', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ status: 'ACTIVE', expiresAt: null })
      .mockResolvedValueOnce({ status: 'ACTIVE', expiresAt: null });
    const { service } = makeService({ tenantModule: { findUnique } });

    await expect(service.hasModule('org_1', 'WAYFINDING_AI')).resolves.toBe(true);
  });
});

describe('EntitlementsService.assertModule', () => {
  it('throws a generic ForbiddenException that names neither the org nor a reason', async () => {
    const { service } = makeService();

    await expect(service.assertModule('org_1', 'WAYFINDING')).rejects.toThrow(ForbiddenException);
    await expect(service.assertModule('org_1', 'WAYFINDING')).rejects.toThrow(
      'Module not available for this organization',
    );
  });

  it('resolves without throwing when the module is usable', async () => {
    const { service } = makeService({
      tenantModule: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE', expiresAt: null }) },
    });

    await expect(service.assertModule('org_1', 'WAYFINDING')).resolves.toBeUndefined();
  });
});

describe('EntitlementsService.validateDependencies', () => {
  const catalog = new ModuleCatalogService();
  const clock = { now: () => NOW } as Clock;
  const service = new EntitlementsService({} as PrismaService, catalog, clock, {} as AuditService);

  it('rejects activating WAYFINDING_AI without WAYFINDING in the same assignment set', () => {
    const assignments: ModuleAssignmentInput[] = [{ key: 'WAYFINDING_AI', status: 'ACTIVE' }];

    expect(() => service.validateDependencies(assignments)).toThrow(BadRequestException);
  });

  it('rejects activating WAYFINDING_AI when WAYFINDING is present but DISABLED', () => {
    const assignments: ModuleAssignmentInput[] = [
      { key: 'WAYFINDING_AI', status: 'ACTIVE' },
      { key: 'WAYFINDING', status: 'DISABLED' },
    ];

    expect(() => service.validateDependencies(assignments)).toThrow(BadRequestException);
  });

  it('accepts activating WAYFINDING_AI alongside an active WAYFINDING', () => {
    const assignments: ModuleAssignmentInput[] = [
      { key: 'WAYFINDING_AI', status: 'ACTIVE' },
      { key: 'WAYFINDING', status: 'ACTIVE' },
    ];

    expect(() => service.validateDependencies(assignments)).not.toThrow();
  });

  it('accepts disabling WAYFINDING_AI on its own — a disabled module has no dependency to satisfy', () => {
    const assignments: ModuleAssignmentInput[] = [{ key: 'WAYFINDING_AI', status: 'DISABLED' }];

    expect(() => service.validateDependencies(assignments)).not.toThrow();
  });

  it('accepts ROOM_BOOKING alone — it has no optional-module dependency', () => {
    const assignments: ModuleAssignmentInput[] = [{ key: 'ROOM_BOOKING', status: 'ACTIVE' }];

    expect(() => service.validateDependencies(assignments)).not.toThrow();
  });
});

describe('EntitlementsService.setTenantModules', () => {
  it('rejects an invalid assignment set before writing anything', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.setTenantModules('org_1', [{ key: 'WAYFINDING_AI', status: 'ACTIVE' }], 'user_1'),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for a target organization that does not exist', async () => {
    const { service } = makeService({ org: { findUnique: jest.fn().mockResolvedValue(null) } });

    await expect(
      service.setTenantModules('missing_org', [{ key: 'WAYFINDING', status: 'ACTIVE' }], 'user_1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('writes one audit entry per module whose status actually changed, and none for unchanged ones', async () => {
    const { service, audit } = makeService({
      tenantModule: {
        findMany: jest.fn().mockResolvedValue([{ id: 'tm_1', moduleKey: 'WAYFINDING', status: 'ACTIVE', expiresAt: null }]),
      },
    });

    await service.setTenantModules(
      'org_1',
      [
        { key: 'WAYFINDING', status: 'ACTIVE' }, // unchanged — no audit entry
        { key: 'ROOM_BOOKING', status: 'ACTIVE' }, // new — one audit entry
      ],
      'user_1',
    );

    expect(audit.log).toHaveBeenCalledTimes(1);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.module.activate', metadata: expect.objectContaining({ moduleKey: 'ROOM_BOOKING' }) }),
    );
  });

  it('uses the disable/trial audit actions for those transitions', async () => {
    const { service, audit } = makeService({
      tenantModule: {
        findMany: jest.fn().mockResolvedValue([{ id: 'tm_1', moduleKey: 'WAYFINDING', status: 'ACTIVE', expiresAt: null }]),
      },
    });

    await service.setTenantModules('org_1', [{ key: 'WAYFINDING', status: 'DISABLED' }], 'user_1');

    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'tenant.module.disable' }));
  });
});
