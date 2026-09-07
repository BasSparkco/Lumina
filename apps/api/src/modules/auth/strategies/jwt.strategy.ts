import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuthErrorCode } from '../../../common/auth-error-codes';
import type { JwtUser } from '../../../common/types/jwt-user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // Live per-request check (docs/adr/tenant-isolation-and-shared-content.md's TenantContext) —
  // the JWT payload's own orgId/role/authVersion are never trusted on their own: this always
  // returns the current database row's values, so a role change or removal takes effect on the
  // very next request instead of waiting up to the token's 7-day expiry. TenantStatusGuard
  // (registered globally) remains the one place tenant-suspension is enforced — not duplicated
  // here.
  async validate(payload: JwtUser & { type?: string; authVersion?: number }): Promise<JwtUser> {
    if (payload.type === 'screen') throw new UnauthorizedException();

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { organizationId: true, role: true, isSuperAdmin: true, authVersion: true },
    });
    if (!user) {
      throw new UnauthorizedException({ message: 'Session is no longer valid', code: AuthErrorCode.USER_NOT_FOUND });
    }
    if (user.authVersion !== payload.authVersion) {
      throw new UnauthorizedException({ message: 'Session has been invalidated', code: AuthErrorCode.AUTH_VERSION_MISMATCH });
    }

    return {
      sub: payload.sub,
      orgId: user.organizationId,
      role: user.role,
      isSuperAdmin: user.isSuperAdmin,
    };
  }
}
