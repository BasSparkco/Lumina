import { Body, Controller, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { memoryStorage } from 'multer';
import { PlayerService } from './player.service';
import { ProofOfPlayService } from '../proof-of-play/proof-of-play.service';
import { IngestProofOfPlayDto } from '../proof-of-play/dto/ingest-proof-of-play.dto';
import { KioskAnalyticsService } from '../kiosk-analytics/kiosk-analytics.service';
import { IngestKioskEventsDto } from '../kiosk-analytics/dto/ingest-kiosk-events.dto';
import { IngestCrashReportsDto } from './dto/ingest-crash-reports.dto';
import { PlayerJwtGuard } from '../../common/guards/player-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { ScreenJwtUser } from '../../common/types/jwt-user';

class HeartbeatDto {
  @IsString()
  @IsOptional()
  currentAssetId?: string;

  // Item 5 (awaiting-content badge) — whether the player is *currently* resolving to real
  // content right now (not a schedule gap, not an empty/unassigned playlist). Optional so
  // older player builds that don't send it yet leave the screen's flag unchanged.
  @IsBoolean()
  @IsOptional()
  hasContent?: boolean;
}

@ApiTags('player')
@Controller('player')
export class PlayerController {
  constructor(
    private readonly player: PlayerService,
    private readonly proofOfPlay: ProofOfPlayService,
    private readonly kioskAnalytics: KioskAnalyticsService,
  ) {}

  // Step 1: player calls this on boot to get a pairing code. Both `init` and `check` are
  // deliberately unauthenticated (a screen has no credentials yet), so they're the two
  // endpoints in this controller worth throttling by IP — otherwise pairing-code issuance /
  // screenId enumeration has no limit at all.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('init')
  init() {
    return this.player.requestPairingCode();
  }

  // Step 2: player polls this with its screenId every 3s until paired (see PairingPage.tsx) —
  // that's 20 req/min from one screen, so the limit here is sized to tolerate several screens
  // pairing concurrently behind the same NAT/gateway, not just one.
  @Throttle({ default: { limit: 100, ttl: 60_000 } })
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
    return this.player.heartbeat(screen.sub, dto.currentAssetId ?? null, dto.hasContent);
  }

  // Batched flush of the player's local proof-of-play buffer
  @Post('proof-of-play')
  @UseGuards(PlayerJwtGuard)
  ingestProofOfPlay(@CurrentUser() screen: ScreenJwtUser, @Body() dto: IngestProofOfPlayDto) {
    return this.proofOfPlay.ingest(screen.orgId, screen.sub, dto.events);
  }

  // Kiosk analytics (7.4) — popular searches/destinations, session counts. Fire-and-forget from
  // the kiosk (see apps/player/src/lib/kioskAnalytics.ts), same batched-ingest shape as proof-of-
  // play above, just wayfinding-specific events instead of played assets.
  @Post('wayfinding-events')
  @UseGuards(PlayerJwtGuard)
  ingestKioskEvents(@CurrentUser() screen: ScreenJwtUser, @Body() dto: IngestKioskEventsDto) {
    return this.kioskAnalytics.ingest(screen.orgId, screen.sub, dto.events);
  }

  // Periodic or on-demand (see the `capture-screenshot` WS command) live-preview upload —
  // overwrites the screen's single latest screenshot, no history is kept.
  @Post('screenshot')
  @UseGuards(PlayerJwtGuard)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }))
  uploadScreenshot(@CurrentUser() screen: ScreenJwtUser, @UploadedFile() file: Express.Multer.File) {
    return this.player.uploadScreenshot(screen.orgId, screen.sub, file.buffer);
  }

  // Batched flush of the player's local crash/watchdog-recovery buffer — must keep working even
  // if other state sync is currently failing, so it's a plain, independently-guarded endpoint
  // rather than piggybacking on heartbeat or state sync.
  @Post('crash-report')
  @UseGuards(PlayerJwtGuard)
  ingestCrashReports(@CurrentUser() screen: ScreenJwtUser, @Body() dto: IngestCrashReportsDto) {
    return this.player.ingestCrashReports(screen.orgId, screen.sub, dto.events);
  }
}
