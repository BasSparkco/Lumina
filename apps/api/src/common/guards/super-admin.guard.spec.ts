import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { SuperAdminGuard } from './super-admin.guard';
import type { PrismaService } from '../../prisma/prisma.service';

function makeContext(user: Record<string, unknown> | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function makeReflector(required: boolean | undefined) {
  return { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
}

// Regression coverage for the live Super Admin authority rule (see
// docs/adr/platform-modules-and-entitlements.md): the JWT's isSuperAdmin claim can be up to
// seven days stale, so this guard must re-read the current database row on every request rather
// than trusting req.user.isSuperAdmin.
describe('SuperAdminGuard — live database revalidation', () => {
  it('allows the request through untouched when the route has no @RequireSuperAdmin() at all', async () => {
    const prisma = { user: { findUnique: jest.fn() } } as unknown as PrismaService;
    const guard = new SuperAdminGuard(makeReflector(undefined), prisma);

    await expect(guard.canActivate(makeContext({ sub: 'user_1', isSuperAdmin: true }))).resolves.toBe(true);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('rejects a JWT claiming isSuperAdmin: true when the current database row says otherwise (revoked mid-session)', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isSuperAdmin: false }) },
    } as unknown as PrismaService;
    const guard = new SuperAdminGuard(makeReflector(true), prisma);

    await expect(guard.canActivate(makeContext({ sub: 'user_1', isSuperAdmin: true }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects when the user row is gone entirely, even with isSuperAdmin: true still in the JWT', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } } as unknown as PrismaService;
    const guard = new SuperAdminGuard(makeReflector(true), prisma);

    await expect(guard.canActivate(makeContext({ sub: 'user_1', isSuperAdmin: true }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows the request when the current database row still says isSuperAdmin: true', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ isSuperAdmin: true }) },
    } as unknown as PrismaService;
    const guard = new SuperAdminGuard(makeReflector(true), prisma);

    await expect(guard.canActivate(makeContext({ sub: 'user_1', isSuperAdmin: true }))).resolves.toBe(true);
  });

  it('never trusts the JWT alone — a stale isSuperAdmin: true claim with no matching database row is rejected, not just logged', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ isSuperAdmin: false }) } } as unknown as PrismaService;
    const guard = new SuperAdminGuard(makeReflector(true), prisma);

    await expect(guard.canActivate(makeContext({ sub: 'user_1', isSuperAdmin: true }))).rejects.toThrow(
      'Requires Super Admin access',
    );
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { id: 'user_1' }, select: { isSuperAdmin: true } });
  });

  it('fails closed when req.user has no sub at all', async () => {
    const prisma = { user: { findUnique: jest.fn() } } as unknown as PrismaService;
    const guard = new SuperAdminGuard(makeReflector(true), prisma);

    await expect(guard.canActivate(makeContext(undefined))).rejects.toThrow(ForbiddenException);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});
