import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { WayfindingAiService } from './wayfinding-ai.service';
import { ResolveWayfindingAiDto } from './dto/resolve-wayfinding-ai.dto';
import { PlayerJwtGuard } from '../../common/guards/player-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { ScreenJwtUser } from '../../common/types/jwt-user';

// docs/modules/ai_wayfinding_module_plan.md §7.2 — the server derives screenId/organizationId/
// building/destination catalog entirely from the authenticated screen token; this request body
// carries only what the visitor actually typed. Per-screen/per-tenant daily quota lives in
// WayfindingAiService (counted from WayfindingAiUsageLog); this throttle is the separate
// burst/abuse guard (§11.2's "per-screen minute throttle").
@ApiTags('wayfinding-ai')
@Controller('player/wayfinding-ai')
export class WayfindingAiPlayerController {
  constructor(private readonly wayfindingAi: WayfindingAiService) {}

  @UseGuards(PlayerJwtGuard)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @Post('resolve')
  resolve(@CurrentUser() screen: ScreenJwtUser, @Body() dto: ResolveWayfindingAiDto) {
    return this.wayfindingAi.resolveForPlayer(screen.sub, {
      message: dto.message,
      language: dto.language,
      recentTurns: dto.recentTurns,
    });
  }
}
