import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OrgService } from './org.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { ScreenGateway } from '../ws/screen.gateway';

// Regression coverage for the P1 invite-accept race fix and the email-normalization gap —
// see docs/tenant_isolation_and_platform_admin_plan.md P1 tasks 5-6. The old implementation
// read+checked the invite *before* opening a transaction, so two concurrent accepts of the same
// token could both pass the check; these tests pin the atomic-claim replacement so it can't
// silently regress back to a pre-transaction read.
describe('OrgService', () => {
  const ORG_ID = 'org_mine';
  const INVITE = {
    id: 'invite_1',
    email: 'invitee@example.com',
    role: 'EDITOR' as const,
    organizationId: ORG_ID,
    acceptedAt: null as Date | null,
    expiresAt: new Date(Date.now() + 60_000),
  };

  function makeService(prismaOverrides: Record<string, unknown> = {}) {
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'user_1', email: INVITE.email, name: 'New User', role: INVITE.role, organizationId: ORG_ID, authVersion: 1 }),
        update: jest.fn(),
        delete: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
      orgInvite: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(INVITE),
        findUnique: jest.fn().mockResolvedValue(INVITE),
        findFirst: jest.fn().mockResolvedValue(INVITE),
        create: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn((fn: unknown) => (typeof fn === 'function' ? (fn as (tx: unknown) => unknown)(prisma) : Promise.all(fn as Promise<unknown>[]))),
      ...prismaOverrides,
    } as unknown as PrismaService;
    const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token'), verify: jest.fn() } as unknown as JwtService;
    const orgScoped = new OrgScopedService();
    const gateway = { disconnectUser: jest.fn(), disconnectOrg: jest.fn() } as unknown as ScreenGateway;
    return { service: new OrgService(prisma, jwt, orgScoped, gateway), prisma, gateway };
  }

  describe('acceptInvite', () => {
    it('rejects when the conditional claim matches 0 rows (already accepted / expired / unknown token)', async () => {
      const { service, prisma } = makeService({
        orgInvite: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      });

      await expect(service.acceptInvite('bad-token', 'Name', 'password123')).rejects.toThrow(
        new UnauthorizedException('Invite is invalid or has expired'),
      );
      expect((prisma as unknown as { user: { create: jest.Mock } }).user.create).not.toHaveBeenCalled();
    });

    it('rejects with ConflictException when the email already belongs to a user, without creating a duplicate', async () => {
      const { service, prisma } = makeService({
        user: { findUnique: jest.fn().mockResolvedValue({ id: 'existing' }), create: jest.fn() },
      });

      await expect(service.acceptInvite('token', 'Name', 'password123')).rejects.toThrow(
        new ConflictException('Email already in use'),
      );
      expect((prisma as unknown as { user: { create: jest.Mock } }).user.create).not.toHaveBeenCalled();
    });

    it('succeeds on a valid, unclaimed, unexpired token and creates the user with the invite role/org', async () => {
      const { service, prisma } = makeService();

      const result = await service.acceptInvite('token', 'New User', 'password123');

      expect((prisma as unknown as { orgInvite: { updateMany: jest.Mock } }).orgInvite.updateMany).toHaveBeenCalledWith({
        where: { token: 'token', acceptedAt: null, expiresAt: { gt: expect.any(Date) } },
        data: { acceptedAt: expect.any(Date) },
      });
      expect((prisma as unknown as { user: { create: jest.Mock } }).user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: INVITE.email, role: INVITE.role, organizationId: ORG_ID }) }),
      );
      expect(result.user.email).toBe(INVITE.email);
      expect(result.token).toBe('signed.jwt.token');
    });

    it('normalizes the invite email before the existing-user check', async () => {
      const { service, prisma } = makeService({
        orgInvite: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ ...INVITE, email: 'Invitee@Example.com' }),
        },
      });

      await service.acceptInvite('token', 'New User', 'password123');

      expect((prisma as unknown as { user: { findUnique: jest.Mock } }).user.findUnique).toHaveBeenCalledWith({
        where: { email: 'invitee@example.com' },
      });
    });
  });

  describe('invite', () => {
    it('treats an existing member email as a duplicate regardless of case', async () => {
      const { service, prisma } = makeService({
        user: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }) },
      });

      await expect(service.invite(ORG_ID, 'Existing@Example.com', 'EDITOR')).rejects.toThrow(ConflictException);
      expect((prisma as unknown as { user: { findFirst: jest.Mock } }).user.findFirst).toHaveBeenCalledWith({
        where: { organizationId: ORG_ID, email: 'existing@example.com' },
      });
    });

    it('stores the invite email normalized', async () => {
      const { service, prisma } = makeService({
        orgInvite: { create: jest.fn().mockResolvedValue({ id: 'new-invite' }) },
      });

      await service.invite(ORG_ID, 'New@Example.com', 'EDITOR');

      expect((prisma as unknown as { orgInvite: { create: jest.Mock } }).orgInvite.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ email: 'new@example.com' }) }),
      );
    });
  });

  describe('revokeInvite', () => {
    it('404s for an invite belonging to a different org', async () => {
      const { service } = makeService({
        orgInvite: { findFirst: jest.fn().mockResolvedValue(null) },
      });

      await expect(service.revokeInvite('other_org', INVITE.id)).rejects.toThrow(NotFoundException);
    });

    it('deletes a pending invite owned by the caller org', async () => {
      const { service, prisma } = makeService();

      await service.revokeInvite(ORG_ID, INVITE.id);

      expect((prisma as unknown as { orgInvite: { delete: jest.Mock } }).orgInvite.delete).toHaveBeenCalledWith({ where: { id: INVITE.id } });
    });
  });

  describe('getInvitePreview', () => {
    it('404s for a missing, expired, or already-accepted token', async () => {
      const { service } = makeService({
        orgInvite: { findUnique: jest.fn().mockResolvedValue(null) },
      });

      await expect(service.getInvitePreview('bad-token')).rejects.toThrow(new NotFoundException('Invite not found'));
    });

    it('returns a masked email, org name, and role for a valid token — never the raw email or orgId', async () => {
      const { service } = makeService({
        orgInvite: {
          findUnique: jest.fn().mockResolvedValue({ ...INVITE, organization: { name: 'Acme Co' } }),
        },
      });

      const preview = await service.getInvitePreview('token');

      expect(preview).toEqual({ email: 'i***@example.com', organizationName: 'Acme Co', role: INVITE.role });
      expect(preview).not.toHaveProperty('organizationId');
    });
  });

  describe('listMembers / listInvites — tenant scoping', () => {
    it('listMembers only ever queries the caller\'s own organizationId', async () => {
      const { service, prisma } = makeService();

      await service.listMembers(ORG_ID);

      expect((prisma as unknown as { user: { findMany: jest.Mock } }).user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_ID } }),
      );
    });

    it('listInvites only ever queries the caller\'s own organizationId and excludes accepted invites', async () => {
      const { service, prisma } = makeService();

      await service.listInvites(ORG_ID);

      expect((prisma as unknown as { orgInvite: { findMany: jest.Mock } }).orgInvite.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_ID, acceptedAt: null } }),
      );
    });
  });

  describe('updateMemberRole / removeMember — session invalidation side effects', () => {
    it('updateMemberRole bumps authVersion and disconnects the member\'s live socket', async () => {
      const { service, prisma, gateway } = makeService({
        user: {
          findFirst: jest.fn().mockResolvedValue({ id: 'member_1', role: 'EDITOR', organizationId: ORG_ID }),
          update: jest.fn().mockResolvedValue({ id: 'member_1', email: 'm@example.com', name: 'M', role: 'ADMIN', createdAt: new Date() }),
        },
      });

      await service.updateMemberRole(ORG_ID, 'member_1', 'ADMIN');

      expect((prisma as unknown as { user: { update: jest.Mock } }).user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { role: 'ADMIN', authVersion: { increment: 1 } } }),
      );
      expect((gateway as unknown as { disconnectUser: jest.Mock }).disconnectUser).toHaveBeenCalledWith(ORG_ID, 'member_1');
    });

    it('removeMember disconnects the removed member\'s live socket', async () => {
      const { service, gateway } = makeService({
        user: {
          findFirst: jest.fn().mockResolvedValue({ id: 'member_1', role: 'EDITOR', organizationId: ORG_ID }),
          delete: jest.fn(),
        },
      });

      await service.removeMember(ORG_ID, 'member_1', 'someone_else');

      expect((gateway as unknown as { disconnectUser: jest.Mock }).disconnectUser).toHaveBeenCalledWith(ORG_ID, 'member_1');
    });
  });

  describe('removeMember / updateMemberRole — last-owner guard', () => {
    it('rejects demoting the last owner', async () => {
      const { service } = makeService({
        user: {
          findFirst: jest.fn().mockResolvedValue({ id: 'owner_1', role: 'OWNER', organizationId: ORG_ID }),
          count: jest.fn().mockResolvedValue(0),
        },
      });

      await expect(service.updateMemberRole(ORG_ID, 'owner_1', 'EDITOR')).rejects.toThrow(
        'An organization must keep at least one owner',
      );
    });

    it('rejects removing the last owner', async () => {
      const { service } = makeService({
        user: {
          findFirst: jest.fn().mockResolvedValue({ id: 'owner_1', role: 'OWNER', organizationId: ORG_ID }),
          count: jest.fn().mockResolvedValue(0),
          delete: jest.fn(),
        },
      });

      await expect(service.removeMember(ORG_ID, 'owner_1', 'someone_else')).rejects.toThrow(
        'An organization must keep at least one owner',
      );
    });
  });
});
