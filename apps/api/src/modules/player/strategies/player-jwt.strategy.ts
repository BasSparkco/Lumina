import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ScreenJwtUser } from '../../../common/types/jwt-user';

@Injectable()
export class PlayerJwtStrategy extends PassportStrategy(Strategy, 'player-jwt') {
  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  // The JWT itself has a 10-year expiry and no built-in revocation, so a still-signature-valid
  // token from a screen that's since been unpaired or deleted would otherwise keep authenticating
  // forever — the only thing telling a connected player to stop is a best-effort socket push
  // (see ScreensService.unpair/remove), which a backgrounded/reconnecting device can miss. This
  // DB check is the backstop: every guarded request re-confirms the screen still exists and is
  // still paired, so an unpair/delete reaches even an already-online device on its very next
  // heartbeat or state poll instead of requiring a full app restart.
  //
  // 404 vs 401 matters here: PlayerService.getState() has thrown NotFoundException for a
  // nonexistent screen since long before this check existed, and every player build in the field
  // already knows how to recover from that specific status (see loadState() in PlayerPage.tsx —
  // clears its cache and re-pairs). Collapsing "deleted" into the same 401 as "unpaired" would
  // silently break that recovery for any device still running an older bundle (a kiosk tab that's
  // been open for weeks doesn't fetch new JS on its own) — it has no 401 handling at all, so it'd
  // just keep looping stale content forever instead of self-healing.
  async validate(payload: ScreenJwtUser): Promise<ScreenJwtUser> {
    if (payload.type !== 'screen') throw new UnauthorizedException();
    const screen = await this.prisma.screen.findUnique({
      where: { id: payload.sub },
      select: { paired: true },
    });
    if (!screen) throw new NotFoundException();
    if (!screen.paired) throw new UnauthorizedException();
    return { sub: payload.sub, orgId: payload.orgId, type: 'screen' };
  }
}
