import { Injectable, CanActivate, type ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_SUPER_ADMIN_KEY } from '../decorators/require-super-admin.decorator';
import type { JwtUser } from '../types/jwt-user';

/**
 * Must run after JwtAuthGuard on the same route (list it second in @UseGuards) so req.user is
 * populated. Used by `GET /org/all`, all of `AdminTemplatesController`, and the platform-tenants
 * control plane (docs/adr/platform-modules-and-entitlements.md).
 *
 * Re-reads `User.isSuperAdmin` from the database on every request rather than trusting the JWT
 * claim — the dashboard JWT stays valid for up to seven days with no live re-check anywhere else
 * (see JwtStrategy), which is fine for ordinary tenant routes but not for platform-administration
 * authority: revoking the flag or deleting the account must take effect immediately here, per the
 * live Super Admin authority rule in the ADR.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean | undefined>(IS_SUPER_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    if (!req.user?.sub) throw new ForbiddenException('Requires Super Admin access');

    const user = await this.prisma.user.findUnique({
      where: { id: req.user.sub },
      select: { isSuperAdmin: true },
    });
    if (user?.isSuperAdmin !== true) {
      throw new ForbiddenException('Requires Super Admin access');
    }
    return true;
  }
}
