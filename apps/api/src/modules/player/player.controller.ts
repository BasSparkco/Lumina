import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PlayerService } from './player.service';
import { PlayerJwtGuard } from '../../common/guards/player-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { ScreenJwtUser } from '../../common/types/jwt-user';

class HeartbeatDto {
  @IsString()
  @IsOptional()
  currentAssetId?: string;
}

@ApiTags('player')
@Controller('player')
export class PlayerController {
  constructor(private readonly player: PlayerService) {}

  // Step 1: player calls this on boot to get a pairing code
  @Post('init')
  init() {
    return this.player.requestPairingCode();
  }

  // Step 2: player polls this with its screenId until paired
  @Get('check')
  check(@Query('screenId') screenId: string) {
    return this.player.checkPairingById(screenId);
  }

  // After pairing: get current assigned playlist (signed URLs) — legacy
  @Get('playlist')
  @UseGuards(PlayerJwtGuard)
  getPlaylist(@CurrentUser() screen: ScreenJwtUser) {
    return this.player.getPlaylist(screen.sub);
  }

  // Full player state: layout zones + schedule rules + emergency + default playlist
  @Get('state')
  @UseGuards(PlayerJwtGuard)
  getState(@CurrentUser() screen: ScreenJwtUser) {
    return this.player.getState(screen.sub);
  }

  // Periodic heartbeat from player
  @Post('heartbeat')
  @UseGuards(PlayerJwtGuard)
  heartbeat(@CurrentUser() screen: ScreenJwtUser, @Body() dto: HeartbeatDto) {
    return this.player.heartbeat(screen.sub, dto.currentAssetId ?? null);
  }
}
