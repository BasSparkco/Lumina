import { ConflictException, NotFoundException } from '@nestjs/common';
import { PlatformTenantsService } from './platform-tenants.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { PlatformAuditService } from '../platform-audit/platform-audit.service';
import type { EntitlementsService } from '../entitlements/entitlements.service';
import type { OrgService } from '../org/org.service';
import type { ScreenGateway } from '../ws/screen.gateway';

function makeService(overrides: { prisma?: Record<string, unknown>; entitlements?: Record<string, unknown> } = {}) {
  const prisma = {
    organization: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
    screen: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    platformAuditLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
      fn({
        organization: { create: jest.fn().mockResolvedValue({ id: 'org_1', name: 'Acme', slug: 'acme', status: 'ACTIVE' }) },
        tenantModule: { create: jest.fn() },
      }),
    ),
    ...overrides.prisma,
  } as unknown as PrismaService;

  const audit = { log: jest.fn() } as unknown as PlatformAuditService;
  const entitlements = {
    validateDependencies: jest.fn(),
    setTenantModules: jest.fn().mockResolvedValue({ tenantStatus: 'ACTIVE', modules: [] }),
    getCapabilities: jest.fn().mockResolvedValue({ tenantStatus: 'ACTIVE', modules: [] }),
    ...overrides.entitlements,
  } as unknown as EntitlementsService;
  const org = {
    createOwnerInvite: jest.fn().mockResolvedValue({ id: 'inv_1', email: 'owner@acme.com', token: 'tok_1', expiresAt: new Date() }),
    revokeInvite: jest.fn(),
    listMembers: jest.fn().mockResolvedValue([]),
    listInvites: jest.fn().mockResolvedValue([]),
    updateMemberRole: jest.fn().mockResolvedValue({ id: 'member_1', role: 'ADMIN' }),
    removeMember: jest.fn(),
    revokeMemberSessions: jest.fn().mockResolvedValue({ id: 'member_1' }),
    revokeAllSessions: jest.fn().mockResolvedValue({ revokedCount: 3 }),
  } as unknown as OrgService;
  const gateway = { sendToScreen: jest.fn(), disconnectOrg: jest.fn() } as unknown as ScreenGateway;

  return { service: new PlatformTenantsService(prisma, audit, entitlements, org, gateway), prisma, audit, entitlements, org, gateway };
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
    const { service, prisma } = makeService({
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
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'tenant.create', targetOrganizationId: 'org_1', actorUserId: 'admin_1' }));
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

    await expect(service.updateStatus('missing_org', 'SUSPENDED', 'admin_1', 'reason')).rejects.toThrow(NotFoundException);
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

    await service.updateStatus('org_1', 'SUSPENDED', 'admin_1', 'Non-payment');

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.status.update',
        metadata: expect.objectContaining({ previousStatus: 'ACTIVE', newStatus: 'SUSPENDED' }),
        reason: 'Non-payment',
      }),
    );
  });

  it('rejects a suspend with no reason', async () => {
    const { service } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1', status: 'ACTIVE' }) } },
    });

    await expect(service.updateStatus('org_1', 'SUSPENDED', 'admin_1')).rejects.toThrow(
      'A reason is required to suspend a tenant',
    );
    await expect(service.updateStatus('org_1', 'SUSPENDED', 'admin_1', '   ')).rejects.toThrow(
      'A reason is required to suspend a tenant',
    );
  });

  it('clears any prior suspension reason on reactivation', async () => {
    const { service, prisma } = makeService({
      prisma: {
        organization: {
          findUnique: jest.fn().mockResolvedValue({ id: 'org_1', status: 'SUSPENDED', suspensionReason: 'Non-payment' }),
          update: jest.fn().mockResolvedValue({ id: 'org_1', status: 'ACTIVE', suspensionReason: null }),
        },
      },
    });

    await service.updateStatus('org_1', 'ACTIVE', 'admin_1');

    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org_1' },
      data: { status: 'ACTIVE', suspensionReason: null },
    });
  });

  // P2 (docs/tenant_isolation_and_platform_admin_plan.md) — suspension must disconnect the
  // tenant's dashboard sockets immediately rather than waiting for their next REST call to hit
  // TenantStatusGuard. disconnectOrg only ever reaches the `org:${orgId}` room, which never
  // contains a player (see ScreenGateway), so this never touches a paired screen.
  it('disconnects the tenant\'s dashboard sockets when the new status is SUSPENDED', async () => {
    const { service, gateway } = makeService({
      prisma: {
        organization: {
          findUnique: jest.fn().mockResolvedValue({ id: 'org_1', status: 'ACTIVE' }),
          update: jest.fn().mockResolvedValue({ id: 'org_1', status: 'SUSPENDED' }),
        },
      },
    });

    await service.updateStatus('org_1', 'SUSPENDED', 'admin_1', 'Non-payment');

    expect(gateway.disconnectOrg).toHaveBeenCalledWith('org_1');
  });

  it('does not disconnect anything when reactivating a tenant', async () => {
    const { service, gateway } = makeService({
      prisma: {
        organization: {
          findUnique: jest.fn().mockResolvedValue({ id: 'org_1', status: 'SUSPENDED' }),
          update: jest.fn().mockResolvedValue({ id: 'org_1', status: 'ACTIVE' }),
        },
      },
    });

    await service.updateStatus('org_1', 'ACTIVE', 'admin_1');

    expect(gateway.disconnectOrg).not.toHaveBeenCalled();
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
      {},
    );
  });
});

// §8.4 of the ADR: a WAYFINDING change must reach already-connected kiosks promptly, via a
// fan-out over the org's WAYFINDING-mode screens — the same pattern BuildingsService.setEvacuation
// already uses, not a second notification mechanism.
describe('PlatformTenantsService.setModules — WS fan-out on WAYFINDING changes', () => {
  it('pushes a reload to every WAYFINDING-mode screen in the org when WAYFINDING is among the assignments', async () => {
    const { service, gateway } = makeService({
      prisma: {
        organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) },
        screen: { findMany: jest.fn().mockResolvedValue([{ id: 'screen_1' }, { id: 'screen_2' }]) },
      },
    });

    await service.setModules('org_1', [{ key: 'WAYFINDING', status: 'DISABLED' }], 'admin_1');

    expect(gateway.sendToScreen).toHaveBeenCalledTimes(2);
    expect(gateway.sendToScreen).toHaveBeenCalledWith('screen_1', { type: 'reload' });
    expect(gateway.sendToScreen).toHaveBeenCalledWith('screen_2', { type: 'reload' });
  });

  it('only queries screens scoped to this org and streamingType WAYFINDING', async () => {
    const { service, prisma } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) } },
    });

    await service.setModules('org_1', [{ key: 'WAYFINDING', status: 'ACTIVE' }], 'admin_1');

    expect(prisma.screen.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', streamingType: 'WAYFINDING' },
      select: { id: true },
    });
  });

  it('does not touch the screen gateway at all for a module with no fan-out rule of its own', async () => {
    const { service, gateway, prisma } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) } },
    });

    // INDOOR_POSITIONING has no player-visible payload/fan-out implemented yet — WAYFINDING,
    // WAYFINDING_AI, and ROOM_BOOKING each have their own dedicated fan-out below; this proves a
    // module change never triggers one of those unrelated fan-outs by accident.
    await service.setModules('org_1', [{ key: 'INDOOR_POSITIONING', status: 'ACTIVE' }], 'admin_1');

    expect(prisma.screen.findMany).not.toHaveBeenCalled();
    expect(gateway.sendToScreen).not.toHaveBeenCalled();
  });
});

// docs/modules/room_booking_module_plan.md §12 — same dedicated fan-out pattern as WAYFINDING
// above, scoped to ROOM_BOOKING-mode screens.
describe('PlatformTenantsService.setModules — WS fan-out on ROOM_BOOKING changes', () => {
  it('pushes a reload to every ROOM_BOOKING-mode screen in the org when ROOM_BOOKING is among the assignments', async () => {
    const { service, gateway } = makeService({
      prisma: {
        organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) },
        screen: { findMany: jest.fn().mockResolvedValue([{ id: 'screen_1' }]) },
      },
    });

    await service.setModules('org_1', [{ key: 'ROOM_BOOKING', status: 'DISABLED' }], 'admin_1');

    expect(gateway.sendToScreen).toHaveBeenCalledWith('screen_1', { type: 'reload' });
  });

  it('only queries screens scoped to this org and streamingType ROOM_BOOKING', async () => {
    const { service, prisma } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) } },
    });

    await service.setModules('org_1', [{ key: 'ROOM_BOOKING', status: 'ACTIVE' }], 'admin_1');

    expect(prisma.screen.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', streamingType: 'ROOM_BOOKING' },
      select: { id: true },
    });
  });
});

// P6a gap #10 — checked before anything else in create(), so a colliding owner email never
// leaves a half-provisioned tenant behind.
describe('PlatformTenantsService.create — owner email uniqueness', () => {
  it('rejects when the owner email already belongs to an existing account', async () => {
    const { service, prisma } = makeService({
      prisma: { user: { findUnique: jest.fn().mockResolvedValue({ id: 'existing_user' }) } },
    });

    await expect(
      service.create({ name: 'Acme', slug: 'acme', ownerEmail: 'taken@example.com', modules: [] }, 'admin_1'),
    ).rejects.toThrow(ConflictException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('PlatformTenantsService — cross-tenant member/invite management (P6a)', () => {
  it('listMembers/listInvites delegate to OrgService with the target tenant id, after confirming it exists', async () => {
    const { service, org, prisma } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) } },
    });

    await service.listMembers('org_1');
    await service.listInvites('org_1');

    expect(org.listMembers).toHaveBeenCalledWith('org_1');
    expect(org.listInvites).toHaveBeenCalledWith('org_1');
    expect(prisma.organization.findUnique).toHaveBeenCalledWith({ where: { id: 'org_1' } });
  });

  it('updateMemberRole delegates to OrgService and writes a platform audit entry', async () => {
    const { service, org, audit } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) } },
    });

    await service.updateMemberRole('org_1', 'member_1', 'OWNER', 'admin_1');

    expect(org.updateMemberRole).toHaveBeenCalledWith('org_1', 'member_1', 'OWNER');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.member.role_update', targetOrganizationId: 'org_1', resourceId: 'member_1' }),
    );
  });

  it('removeMember delegates to OrgService and writes a platform audit entry', async () => {
    const { service, org, audit } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) } },
    });

    await service.removeMember('org_1', 'member_1', 'admin_1');

    expect(org.removeMember).toHaveBeenCalledWith('org_1', 'member_1', 'admin_1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.member.remove', targetOrganizationId: 'org_1', resourceId: 'member_1' }),
    );
  });

  it('revokeOwnerInvite delegates to OrgService.revokeInvite and writes a platform audit entry', async () => {
    const { service, org, audit } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) } },
    });

    await service.revokeOwnerInvite('org_1', 'invite_1', 'admin_1');

    expect(org.revokeInvite).toHaveBeenCalledWith('org_1', 'invite_1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.owner_invite.revoke', targetOrganizationId: 'org_1', resourceId: 'invite_1' }),
    );
  });
});

describe('PlatformTenantsService — session revocation (P6a)', () => {
  it('revokeMemberSessions delegates to OrgService and writes a platform audit entry', async () => {
    const { service, org, audit } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) } },
    });

    const result = await service.revokeMemberSessions('org_1', 'member_1', 'admin_1');

    expect(org.revokeMemberSessions).toHaveBeenCalledWith('org_1', 'member_1');
    expect(result).toEqual({ id: 'member_1' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.member.revoke_sessions', targetOrganizationId: 'org_1', resourceId: 'member_1' }),
    );
  });

  it('revokeAllSessions delegates to OrgService and records the revoked count in the audit entry', async () => {
    const { service, org, audit } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) } },
    });

    const result = await service.revokeAllSessions('org_1', 'admin_1');

    expect(org.revokeAllSessions).toHaveBeenCalledWith('org_1');
    expect(result).toEqual({ revokedCount: 3 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.revoke_all_sessions', metadata: { revokedCount: 3 } }),
    );
  });
});

describe('PlatformTenantsService.updateName (P6a)', () => {
  it('updates the name and writes a platform audit entry with the previous and new name', async () => {
    const { service, prisma, audit } = makeService({
      prisma: {
        organization: {
          findUnique: jest.fn().mockResolvedValue({ id: 'org_1', name: 'Old Name' }),
          update: jest.fn().mockResolvedValue({ id: 'org_1', name: 'New Name' }),
        },
      },
    });

    await service.updateName('org_1', 'New Name', 'admin_1');

    expect(prisma.organization.update).toHaveBeenCalledWith({ where: { id: 'org_1' }, data: { name: 'New Name' } });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'tenant.name.update', metadata: { previousName: 'Old Name', newName: 'New Name' } }),
    );
  });
});

describe('PlatformTenantsService.listAuditLog (P6a)', () => {
  it('queries PlatformAuditLog scoped to the target tenant, newest first', async () => {
    const { service, prisma } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) } },
    });

    await service.listAuditLog('org_1');

    expect(prisma.platformAuditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { targetOrganizationId: 'org_1' }, orderBy: { createdAt: 'desc' } }),
    );
  });

  it('caps an oversized requested limit at 200', async () => {
    const { service, prisma } = makeService({
      prisma: { organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_1' }) } },
    });

    await service.listAuditLog('org_1', 10_000);

    expect(prisma.platformAuditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
  });
});

describe('PlatformTenantsService.detail — owner identity and suspension reason (P6a)', () => {
  it('includes the tenant\'s suspension reason and longest-standing OWNER in the response', async () => {
    const { service, prisma } = makeService({
      prisma: {
        organization: {
          findUnique: jest.fn().mockResolvedValue({ id: 'org_1', name: 'Acme', slug: 'acme', status: 'SUSPENDED', suspensionReason: 'Non-payment', createdAt: new Date() }),
        },
        user: { findFirst: jest.fn().mockResolvedValue({ id: 'user_1', email: 'owner@acme.com', name: 'Owner' }) },
      },
    });

    const result = await service.detail('org_1');

    expect(result.suspensionReason).toBe('Non-payment');
    expect(result.owner).toEqual({ id: 'user_1', email: 'owner@acme.com', name: 'Owner' });
  });
});
