import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { ScreensService } from './screens.service';
import { CreateScreenDto } from './dto/create-screen.dto';
import { AssignPlaylistDto } from './dto/assign-playlist.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

class PairDto { @IsString() code!: string; }
class RenameScreenDto { @IsString() name!: string; }

@ApiTags('screens')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('screens')
export class ScreensController {
  constructor(private readonly screens: ScreensService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateScreenDto) {
    return this.screens.create(user.orgId, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.screens.list(user.orgId);
  }

  @Get('fleet-status')
  fleetStatus(@CurrentUser() user: JwtUser) {
    return this.screens.fleetStatus(user.orgId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.findOne(user.orgId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.remove(user.orgId, id);
  }

  @Post(':id/unpair')
  unpair(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.unpair(user.orgId, id);
  }

  @Put(':id')
  rename(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: RenameScreenDto) {
    return this.screens.rename(user.orgId, id, dto.name);
  }

  @Post(':id/assign')
  assign(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: AssignPlaylistDto) {
    return this.screens.assignPlaylist(user.orgId, id, dto.playlistId);
  }

  @Post('pair')
  pair(@CurrentUser() user: JwtUser, @Body() dto: PairDto) {
    return this.screens.confirmPairing(user.orgId, dto.code);
  }

  @Post(':id/publish')
  publish(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.publishToScreen(user.orgId, id);
  }

  @Post(':id/reload')
  reload(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.reloadScreen(user.orgId, id);
  }

  @Post(':id/capture-screenshot')
  captureScreenshot(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.captureScreenshot(user.orgId, id);
  }

  @Get(':id/crash-reports')
  crashReports(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.crashReports(user.orgId, id);
  }

  @Put(':id/emergency')
  setEmergency(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: { active: boolean; playlistId?: string },
  ) {
    return this.screens.setEmergency(user.orgId, id, dto.active, dto.playlistId);
  }

  @Put(':id/stop')
  setStopped(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: { stopped: boolean },
  ) {
    return this.screens.setStopped(user.orgId, id, dto.stopped);
  }

  @Put(':id/show-clock')
  setShowClock(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: { showClock: boolean },
  ) {
    return this.screens.setShowClock(user.orgId, id, dto.showClock);
  }

  @Put(':id/prayer')
  updatePrayer(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: { latitude?: number; longitude?: number; prayerMethod?: string; athanEnabled?: boolean; timezone?: string },
  ) {
    return this.screens.updatePrayerConfig(user.orgId, id, dto);
  }

  @Put(':id/layout')
  setLayout(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: { layoutId: string | null },
  ) {
    return this.screens.setLayout(user.orgId, id, dto.layoutId);
  }

  @Put(':id/volume')
  setVolume(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: { volume: number | null },
  ) {
    return this.screens.setVolume(user.orgId, id, dto.volume);
  }

  @Put(':id/group')
  setGroup(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: { groupId: string | null },
  ) {
    return this.screens.setGroup(user.orgId, id, dto.groupId);
  }
}
