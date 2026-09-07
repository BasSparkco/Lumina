import { ForbiddenException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

function makeContext(user: Record<string, unknown> | undefined, method = 'GET'): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user, method }) }),
  } as unknown as ExecutionContext;
}

function makeReflector(explicitRoles: string[] | undefined) {
  return { getAllAndOverride: jest.fn().mockReturnValue(explicitRoles) } as unknown as Reflector;
}

// P1 verification: confirms a VIEWER/EDITOR-role request never reaches a membership-management
// route in the first place — that rejection happens here, not inside OrgService, since
// updateMemberRole/removeMember/revokeInvite carry @Roles('OWNER','ADMIN').
describe('RolesGuard — membership-management routes require OWNER/ADMIN', () => {
  it('rejects an EDITOR calling a route explicitly restricted to OWNER/ADMIN', () => {
    const guard = new RolesGuard(makeReflector(['OWNER', 'ADMIN']));

    expect(() => guard.canActivate(makeContext({ sub: 'u1', role: 'EDITOR' }, 'PUT'))).toThrow(
      new ForbiddenException('Requires role: OWNER or ADMIN'),
    );
  });

  it('rejects a VIEWER calling a route explicitly restricted to OWNER/ADMIN', () => {
    const guard = new RolesGuard(makeReflector(['OWNER', 'ADMIN']));

    expect(() => guard.canActivate(makeContext({ sub: 'u1', role: 'VIEWER' }, 'DELETE'))).toThrow(ForbiddenException);
  });

  it('allows an ADMIN calling a route explicitly restricted to OWNER/ADMIN', () => {
    const guard = new RolesGuard(makeReflector(['OWNER', 'ADMIN']));

    expect(guard.canActivate(makeContext({ sub: 'u1', role: 'ADMIN' }, 'PUT'))).toBe(true);
  });

  it('rejects a VIEWER writing to a route with no explicit @Roles() at all (default read-only)', () => {
    const guard = new RolesGuard(makeReflector(undefined));

    expect(() => guard.canActivate(makeContext({ sub: 'u1', role: 'VIEWER' }, 'POST'))).toThrow(ForbiddenException);
  });

  it('allows a VIEWER reading a route with no explicit @Roles() at all', () => {
    const guard = new RolesGuard(makeReflector(undefined));

    expect(guard.canActivate(makeContext({ sub: 'u1', role: 'VIEWER' }, 'GET'))).toBe(true);
  });
});
