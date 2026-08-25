import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { SuperAdminGuard } from './super-admin.guard';

function makeContext(user?: { isSuperAdmin: boolean }): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('SuperAdminGuard', () => {
  it('passes through when the route has no @RequireSuperAdmin() metadata', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new SuperAdminGuard(reflector);
    expect(guard.canActivate(makeContext({ isSuperAdmin: false }))).toBe(true);
  });

  it('allows a super admin through on a protected route', () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const guard = new SuperAdminGuard(reflector);
    expect(guard.canActivate(makeContext({ isSuperAdmin: true }))).toBe(true);
  });

  it('rejects a non-super-admin on a protected route', () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const guard = new SuperAdminGuard(reflector);
    expect(() => guard.canActivate(makeContext({ isSuperAdmin: false }))).toThrow(ForbiddenException);
  });

  it('rejects a missing user on a protected route', () => {
    const reflector = { getAllAndOverride: () => true } as unknown as Reflector;
    const guard = new SuperAdminGuard(reflector);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
