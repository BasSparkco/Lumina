import { Injectable, CanActivate, type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_SUPER_ADMIN_KEY } from '../decorators/require-super-admin.decorator';
import type { JwtUser } from '../types/jwt-user';

/**
 * Must run after JwtAuthGuard on the same route (list it second in @UseGuards) so req.user is
 * populated. No route currently applies @RequireSuperAdmin() — this is scaffolding ahead of the
 * Template admin endpoints (designer.md Phase 5), not dead code to remove.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(IS_SUPER_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    if (req.user?.isSuperAdmin !== true) {
      throw new ForbiddenException('Requires Super Admin access');
    }
    return true;
  }
}
