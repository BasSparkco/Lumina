import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlatformTenantsService } from './platform-tenants.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { EntitlementsService } from '../entitlements/entitlements.service';
import type { OrgService } from '../org/org.service';

function makeService(overrides: { prisma?: Record<string, unknown>; entitlements?: Record<string, unknown> } = {}) {
  const prisma = {
    organization: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        organization: { create: jest.fn().mockResolvedValue({ id: 'org_1', name: 'Acme', slug: 'acme', status: 'ACTIVE' }) },
        tenantModule: { create: jest.fn() },
      }),
    ),
    ...overrides.prisma,
  } as unknown as PrismaService;

  const audit = { log: jest.fn() } as unknown as AuditService;
  const entitlements = {
    validateDependencies: jest.fn(),
    setTenantModules: jest.fn().mockResolvedValue({ tenantStatus: 'ACTIVE', modules: [] }),
    getCapabilities: jest.fn().mockResolvedValue({ tenantStatus: 'ACTIVE', modules: [] }),
    ...overrides.entitlements,
  } as unknown as EntitlementsService;
  const org = { createOwnerInvite: jest.fn().mockResolvedValue({ id: 'inv_1', email: 'owner@acme.com', token: 'tok_1', expiresAt: new Date() }) } as unknown as OrgService;

  return { service: new PlatformTenantsService(prisma, audit, entitlements, org), prisma, audit, entitlements, org };
}

describe('PlatformTenantsService.create — atomic tenant creation', () => {
  it('rejects a slug already in use before touching the transaction or validating dependencies', async () => {
    const { service, prisma, entitlements } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'existing' }) } },
    });

    await expect(
      service.create({ name: 'Acme', slug: 'acme', ownerEmail: 'owner@acme.com', modules: [] }, 'admin_1'),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(entitlements.validateDependencies).not.toHaveBeenCalled();
  });

  it('validates module dependencies before creating the organization, so a bad module set never leaves a half-created tenant', async () => {
    const { service, prisma, entitlements } = makeService({
      entitlements: {
        validateDependencies: jest.fn().mockImplementation(() => {
          throw new Error('WAYFINDING_AI requires WAYFINDING');
        }),
        setTenantModules: jest.fn(),
        getCapabilities: jest.fn(),
      },
    });

    await expect(
      service.create(
        { name: 'Acme', slug: 'acme', ownerEmail: 'owner@acme.com', modules: [{ key: 'WAYFINDING_AI', status: 'ACTIVE' }] },
        'admin_1',
      ),
    ).rejects.toThrow('WAYFINDING_AI requires WAYFINDING');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates the organization and its module assignments inside one transaction', async () => {
    const { service, prisma } = makeService();

    await service.create(
      { name: 'Acme', slug: 'ACME', ownerEmail: 'owner@acme.com', modules: [{ key: 'WAYFINDING', status: 'ACTIVE' }] },
      'admin_1',
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('normalizes the slug to lowercase before checking uniqueness and creating the org', async () => {
    const { service, prisma } = makeService();

    await service.create({ name: 'Acme', slug: 'ACME', ownerEmail: 'owner@acme.com', modules: [] }, 'admin_1');

    expect(prisma.organization.findUnique).toHaveBeenCalledWith({ where: { slug: 'acme' } });
  });

  it('creates the owner invite and writes a tenant.create audit entry after the transaction commits', async () => {
    const { service, audit, org } = makeService();

    const result = await service.create(
      { name: 'Acme', slug: 'acme', ownerEmail: 'owner@acme.com', modules: [] },
      'admin_1',
    );

    expect(org.createOwnerInvite).toHaveBeenCalledWith('org_1', 'owner@acme.com');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'tenant.create', organizationId: 'org_1', userId: 'admin_1' }));
    expect(result.ownerInvite.email).toBe('owner@acme.com');
  });
});

describe('PlatformTenantsService — target tenant is always loaded and validated explicitly', () => {
  it('detail() throws NotFoundException for a tenant id that does not exist', async () => {
    const { service } = makeService();

    await expect(service.detail('missing_org')).rejects.toThrow(NotFoundException);
  });

  it('updateStatus() throws NotFoundException for a tenant id that does not exist', async () => {
    const { service } = makeService();

    await expect(service.updateStatus('missing_org', 'SUSPENDED', 'admin_1')).rejects.toThrow(NotFoundException);
  });

  it('setModules() throws NotFoundException for a tenant id that does not exist, without ever calling EntitlementsService', async () => {
    const { service, entitlements } = makeService();

    await expect(service.setModules('missing_org', [], 'admin_1')).rejects.toThrow(NotFoundException);
    expect(entitlements.setTenantModules).not.toHaveBeenCalled();
  });

  it('reissueOwnerInvite() throws NotFoundException for a tenant id that does not exist', async () => {
    const { service } = makeService();

    await expect(service.reissueOwnerInvite('missing_org', 'x@example.com', 'admin_1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('PlatformTenantsService.updateStatus — audited with previous and new status', () => {
  it('writes a tenant.status.update audit entry recording both the previous and new status', async () => {
    const { service, audit } = makeService({
      prisma: {
        organization: {
          findUnique: jest.fn().mockResolvedValue({ id: 'org_1', status: 'ACTIVE' }),
          update: jest.fn().mockResolvedValue({ id: 'org_1', status: 'SUSPENDED' }),
        },
      },
    });

    await service.updateStatus('org_1', 'SUSPENDED', 'admin_1');

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.status.update',
        metadata: expect.objectContaining({ previousStatus: 'ACTIVE', newStatus: 'SUSPENDED' }),
      }),
    );
  });
});

describe('PlatformTenantsService.setModules — delegates entirely to EntitlementsService', () => {
  it('does not duplicate dependency validation or audit logic — EntitlementsService.setTenantModules owns both', async () => {
    const { service, entitlements } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) } },
    });

    await service.setModules('org_1', [{ key: 'WAYFINDING', status: 'DISABLED' }], 'admin_1');

    expect(entitlements.setTenantModules).toHaveBeenCalledWith(
      'org_1',
      [{ key: 'WAYFINDING', status: 'DISABLED' }],
      'admin_1',
    );
  });
});
