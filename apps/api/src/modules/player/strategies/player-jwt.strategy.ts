import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { ScreenJwtUser } from '../../../common/types/jwt-user';

@Injectable()
export class PlayerJwtStrategy extends PassportStrategy(Strategy, 'player-jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: ScreenJwtUser): ScreenJwtUser {
    if (payload.type !== 'screen') throw new UnauthorizedException();
    return { sub: payload.sub, orgId: payload.orgId, type: 'screen' };
  }
}
