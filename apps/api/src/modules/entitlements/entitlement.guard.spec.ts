import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { EntitlementGuard } from './entitlement.guard';
import { REQUIRED_MODULE_KEY } from './require-module.decorator';
import type { EntitlementsService } from './entitlements.service';

function makeContext(user: Record<string, unknown> | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function makeReflector(requiredModule: string | undefined) {
  return { getAllAndOverride: jest.fn().mockReturnValue(requiredModule) } as unknown as Reflector;
}

describe('EntitlementGuard', () => {
  it('allows the request through untouched when the route has no @RequireModule() at all', async () => {
    const entitlements = { assertModule: jest.fn() } as unknown as EntitlementsService;
    const guard = new EntitlementGuard(makeReflector(undefined), entitlements);

    await expect(guard.canActivate(makeContext({ orgId: 'org_1' }))).resolves.toBe(true);
    expect(entitlements.assertModule).not.toHaveBeenCalled();
  });

  it('denies the request when req.user has no orgId (should never happen after JwtAuthGuard, but fail closed)', async () => {
    const entitlements = { assertModule: jest.fn() } as unknown as EntitlementsService;
    const guard = new EntitlementGuard(makeReflector('WAYFINDING'), entitlements);

    await expect(guard.canActivate(makeContext(undefined))).resolves.toBe(false);
    expect(entitlements.assertModule).not.toHaveBeenCalled();
  });

  it('asks EntitlementsService for the caller\'s own orgId, never a value from anywhere else on the request', async () => {
    const entitlements = { assertModule: jest.fn().mockResolvedValue(undefined) } as unknown as EntitlementsService;
    const guard = new EntitlementGuard(makeReflector('WAYFINDING'), entitlements);

    await expect(guard.canActivate(makeContext({ orgId: 'org_1' }))).resolves.toBe(true);
    expect(entitlements.assertModule).toHaveBeenCalledWith('org_1', 'WAYFINDING');
  });

  it('propagates the ForbiddenException EntitlementsService.assertModule throws for an unlicensed tenant', async () => {
    const entitlements = {
      assertModule: jest.fn().mockRejectedValue(new Error('Module not available for this organization')),
    } as unknown as EntitlementsService;
    const guard = new EntitlementGuard(makeReflector('WAYFINDING'), entitlements);

    await expect(guard.canActivate(makeContext({ orgId: 'org_1' }))).rejects.toThrow(
      'Module not available for this organization',
    );
  });

  it('reads the required module key from REQUIRED_MODULE_KEY metadata', async () => {
    const entitlements = { assertModule: jest.fn() } as unknown as EntitlementsService;
    const reflector = makeReflector('WAYFINDING');
    const guard = new EntitlementGuard(reflector, entitlements);
    const context = makeContext({ orgId: 'org_1' });

    await guard.canActivate(context);

    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(REQUIRED_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  });
});
