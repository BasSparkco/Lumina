import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { TenantStatusGuard } from './tenant-status.guard';
import type { PrismaService } from '../../prisma/prisma.service';

function makeContext(authorization: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
  } as unknown as ExecutionContext;
}

describe('TenantStatusGuard — global suspension enforcement', () => {
  it('passes through untouched when there is no Authorization header (public route)', async () => {
    const jwt = { verify: jest.fn() } as unknown as JwtService;
    const prisma = { organization: { findUnique: jest.fn() } } as unknown as PrismaService;
    const guard = new TenantStatusGuard(jwt, prisma);

    await expect(guard.canActivate(makeContext(undefined))).resolves.toBe(true);
    expect(jwt.verify).not.toHaveBeenCalled();
  });

  it('passes through when the token fails to verify — that rejection is JwtAuthGuard\'s job, not this guard\'s', async () => {
    const jwt = {
      verify: jest.fn().mockImplementation(() => {
        throw new Error('invalid signature');
      }),
    } as unknown as JwtService;
    const prisma = { organization: { findUnique: jest.fn() } } as unknown as PrismaService;
    const guard = new TenantStatusGuard(jwt, prisma);

    await expect(guard.canActivate(makeContext('Bearer bad.token'))).resolves.toBe(true);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('passes through a player/screen token untouched — suspension there is PlayerService\'s job', async () => {
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 'screen_1', orgId: 'org_1', type: 'screen' }) } as unknown as JwtService;
    const prisma = { organization: { findUnique: jest.fn() } } as unknown as PrismaService;
    const guard = new TenantStatusGuard(jwt, prisma);

    await expect(guard.canActivate(makeContext('Bearer screen.token'))).resolves.toBe(true);
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
  });

  it('allows a dashboard token through when the organization is ACTIVE', async () => {
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 'user_1', orgId: 'org_1', role: 'OWNER' }) } as unknown as JwtService;
    const prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    } as unknown as PrismaService;
    const guard = new TenantStatusGuard(jwt, prisma);

    await expect(guard.canActivate(makeContext('Bearer good.token'))).resolves.toBe(true);
  });

  it('rejects a dashboard token whose organization is currently SUSPENDED, even mid-session on an old JWT', async () => {
    const jwt = { verify: jest.fn().mockReturnValue({ sub: 'user_1', orgId: 'org_1', role: 'OWNER' }) } as unknown as JwtService;
    const prisma = {
      organization: { findUnique: jest.fn().mockResolvedValue({ status: 'SUSPENDED' }) },
    } as unknown as PrismaService;
    const guard = new TenantStatusGuard(jwt, prisma);

    await expect(guard.canActivate(makeContext('Bearer good.token'))).rejects.toThrow(UnauthorizedException);
  });
});
