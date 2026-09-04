import { CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtUser, ScreenJwtUser } from '../types/jwt-user';

/**
 * Registered globally (APP_GUARD in app.module.ts) so tenant suspension is enforced in exactly
 * one place across every dashboard-authenticated route, per the tenant suspension rule in
 * docs/adr/platform-modules-and-entitlements.md — "do not scatter ad hoc suspension checks
 * through individual services."
 *
 * Global guards run before any controller-level @UseGuards() (including JwtAuthGuard), so
 * req.user isn't populated yet when this runs. It does its own lightweight JWT decode instead —
 * the same manual-verify approach ScreenGateway.handleConnection already uses for the WebSocket
 * side — rather than depending on Passport having already run.
 *
 * Deliberately no-ops (returns true) for: no Authorization header (a public route, or an
 * unauthenticated request that JwtAuthGuard will reject on its own downstream), a token that
 * fails to verify (same — leave rejection to JwtAuthGuard, which gives a clearer error), and a
 * player/screen token (type: 'screen') — suspension there is enforced inside PlayerService,
 * which degrades to a neutral state rather than hard-failing the poll loop, the same shape of
 * decision as a disabled module.
 */
@Injectable()
export class TenantStatusGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return true;

    let payload: Partial<JwtUser & ScreenJwtUser>;
    try {
      payload = this.jwt.verify(header.slice(7));
    } catch {
      return true;
    }

    if (payload.type === 'screen' || !payload.orgId) return true;

    const org = await this.prisma.organization.findUnique({
      where: { id: payload.orgId },
      select: { status: true },
    });
    if (org?.status === 'SUSPENDED') {
      throw new UnauthorizedException('This organization has been suspended');
    }
    return true;
  }
}
