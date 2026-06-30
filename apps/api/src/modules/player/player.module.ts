import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { PlayerService } from './player.service';
import { PlayerController } from './player.controller';
import { PlayerJwtStrategy } from './strategies/player-jwt.strategy';
import { AuthModule } from '../auth/auth.module';
import { WsModule } from '../ws/ws.module';
import { SchedulesModule } from '../schedules/schedules.module';

@Module({
  imports: [PassportModule, AuthModule, WsModule, SchedulesModule],
  providers: [PlayerService, PlayerJwtStrategy],
  controllers: [PlayerController],
})
export class PlayerModule {}
