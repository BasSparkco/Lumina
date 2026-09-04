import { Injectable, CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { ModuleKey } from '@lumina/types';
import type { JwtUser } from '../../common/types/jwt-user';
import { REQUIRED_MODULE_KEY } from './require-module.decorator';
import { EntitlementsService } from './entitlements.service';

/**
 * Must run after JwtAuthGuard on the same route (list it second in @UseGuards) so req.user is
 * populated — same convention as RolesGuard/SuperAdminGuard. Resolves entitlement state live
 * from the database on every request via EntitlementsService; never trusts the JWT for this
 * (see docs/adr/platform-modules-and-entitlements.md).
 *
 * Do not use this guard on Super Admin control-plane endpoints that target another
 * organization — those must use @RequireSuperAdmin() and validate the target org explicitly,
 * since this guard only ever checks the caller's own req.user.orgId.
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<ModuleKey | undefined>(REQUIRED_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    if (!req.user?.orgId) return false;

    // Throws ForbiddenException itself (Nest turns that into a 403) — nothing else to do here.
    await this.entitlements.assertModule(req.user.orgId, required);
    return true;
  }
}
