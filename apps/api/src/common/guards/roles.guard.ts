import { Injectable, CanActivate, type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { JwtUser } from '../types/jwt-user';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Must run after JwtAuthGuard on the same route (list it second in @UseGuards) so req.user is
 * populated. Default policy when no @Roles() is present: VIEWER is read-only everywhere.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    const user = req.user;
    if (!user || !('role' in user)) return true;

    const explicitRoles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (explicitRoles && explicitRoles.length > 0) {
      if (!explicitRoles.includes(user.role)) {
        throw new ForbiddenException(`Requires role: ${explicitRoles.join(' or ')}`);
      }
      return true;
    }

    // LIBRARY_MANAGER shares VIEWER's read-only default: it only gets write access via routes
    // that explicitly opt it in with @Roles('LIBRARY_MANAGER') (the shared-library routes above),
    // never by falling through this default-allow branch onto some tenant's own private data.
    if ((user.role === 'VIEWER' || user.role === 'LIBRARY_MANAGER') && !SAFE_METHODS.has(req.method)) {
      throw new ForbiddenException('This role has read-only access here');
    }
    return true;
  }
}
