import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { WayfindingAiService } from './wayfinding-ai.service';
import { UpdateWayfindingAiScreenConfigDto } from './dto/update-wayfinding-ai-screen-config.dto';
import { TestResolveWayfindingAiDto } from './dto/resolve-wayfinding-ai.dto';
import { CreatePoiAliasDto } from './dto/create-poi-alias.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { EntitlementGuard } from '../entitlements/entitlement.guard';
import { RequireModule } from '../entitlements/require-module.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

// docs/modules/ai_wayfinding_module_plan.md §7.1 — same guard stack and default RolesGuard
// policy (VIEWER/LIBRARY_MANAGER read-only, everyone else full access) already used for ordinary
// Wayfinding configuration (buildings.controller.ts) — no new role level introduced.
@ApiTags('wayfinding-ai')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard, EntitlementGuard)
@RequireModule('WAYFINDING_AI')
@Controller('wayfinding-ai')
export class WayfindingAiController {
  constructor(private readonly wayfindingAi: WayfindingAiService) {}

  @Get('screens')
  listScreens(@CurrentUser() user: JwtUser) {
    return this.wayfindingAi.listEligibleScreens(user.orgId);
  }

  @Get('screens/:screenId/config')
  getConfig(@CurrentUser() user: JwtUser, @Param('screenId') screenId: string) {
    return this.wayfindingAi.getScreenConfig(user.orgId, screenId);
  }

  @Put('screens/:screenId/config')
  updateConfig(
    @CurrentUser() user: JwtUser,
    @Param('screenId') screenId: string,
    @Body() dto: UpdateWayfindingAiScreenConfigDto,
  ) {
    return this.wayfindingAi.updateScreenConfig(user.orgId, screenId, dto, user.sub);
  }

  @Get('buildings/:buildingId/pois')
  listPoisWithAliases(@CurrentUser() user: JwtUser, @Param('buildingId') buildingId: string) {
    return this.wayfindingAi.listPoisWithAliases(user.orgId, buildingId);
  }

  @Post('pois/:poiId/aliases')
  addAlias(@CurrentUser() user: JwtUser, @Param('poiId') poiId: string, @Body() dto: CreatePoiAliasDto) {
    return this.wayfindingAi.addAlias(user.orgId, poiId, dto.value, dto.language);
  }

  @Delete('aliases/:aliasId')
  removeAlias(@CurrentUser() user: JwtUser, @Param('aliasId') aliasId: string) {
    return this.wayfindingAi.removeAlias(user.orgId, aliasId);
  }

  @Get('usage')
  getUsage(
    @CurrentUser() user: JwtUser,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('screenId') screenId?: string,
  ) {
    return this.wayfindingAi.getUsage(user.orgId, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      screenId,
    });
  }

  // Dashboard-authenticated test console (§8.2) — rate-limited independently of the player
  // endpoint's per-screen/per-tenant daily quota, since this never touches WayfindingAiUsageLog.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('test-resolve')
  testResolve(@CurrentUser() user: JwtUser, @Body() dto: TestResolveWayfindingAiDto) {
    return this.wayfindingAi.testResolve(user.orgId, dto.buildingId, dto.message, dto.language);
  }
}
