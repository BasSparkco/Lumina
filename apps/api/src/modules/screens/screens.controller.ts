import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';
import { ScreensService } from './screens.service';
import { CreateScreenDto } from './dto/create-screen.dto';
import { AssignPlaylistDto } from './dto/assign-playlist.dto';
import { AssignAssetDto } from './dto/assign-asset.dto';
import { SeekScreenDto } from './dto/seek-screen.dto';
import { SetScreenSpeedDto } from './dto/set-screen-speed.dto';
import { SetStreamingTypeDto } from './dto/set-streaming-type.dto';
import { SetKioskLocationDto } from './dto/set-kiosk-location.dto';
import { SetKioskAttractPlaylistDto } from './dto/set-kiosk-attract-playlist.dto';
import { SetKioskAttractThemeDto } from './dto/set-kiosk-attract-theme.dto';
import { SetEmergencyDto } from './dto/set-emergency.dto';
import { SetStoppedDto } from './dto/set-stopped.dto';
import { SetShowClockDto } from './dto/set-show-clock.dto';
import { UpdatePrayerDto } from './dto/update-prayer.dto';
import { SetVolumeDto } from './dto/set-volume.dto';
import { SetOrientationDto } from './dto/set-orientation.dto';
import { SetAspectRatioDto } from './dto/set-aspect-ratio.dto';
import { SetGroupDto } from './dto/set-group.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

class PairDto { @IsString() code!: string; }
class RenameScreenDto { @IsString() name!: string; }
class ReorderDto { @IsArray() @IsString({ each: true }) ids!: string[]; }

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

  // Must come before @Get(':id')/@Put(':id') — otherwise Nest matches "reorder" as the :id param.
  @Put('reorder')
  reorder(@CurrentUser() user: JwtUser, @Body() dto: ReorderDto) {
    return this.screens.reorder(user.orgId, dto.ids);
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
    return this.screens.unpair(user.orgId, id, { type: 'DASHBOARD', userId: user.sub });
  }

  @Put(':id')
  rename(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: RenameScreenDto) {
    return this.screens.rename(user.orgId, id, dto.name);
  }

  @Post(':id/assign')
  assign(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: AssignPlaylistDto) {
    return this.screens.assignPlaylist(user.orgId, id, dto.playlistId);
  }

  @Put(':id/streaming-type')
  setStreamingType(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: SetStreamingTypeDto) {
    return this.screens.setStreamingType(user.orgId, id, dto.streamingType);
  }

  @Put(':id/asset')
  setAsset(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: AssignAssetDto) {
    return this.screens.setAsset(user.orgId, id, dto.assetId);
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

  @Post(':id/clear-cache')
  clearCache(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.clearCacheScreen(user.orgId, id);
  }

  @Post(':id/capture-screenshot')
  captureScreenshot(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.captureScreenshot(user.orgId, id);
  }

  // Custom Player (appsroadmap.md Phase 9)
  @Post(':id/pause')
  pauseScreen(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.pauseScreen(user.orgId, id);
  }

  @Post(':id/resume')
  resumeScreen(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.resumeScreen(user.orgId, id);
  }

  @Post(':id/seek')
  seekScreen(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: SeekScreenDto) {
    return this.screens.seekScreen(user.orgId, id, dto.toSeconds);
  }

  @Post(':id/speed')
  setScreenSpeed(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: SetScreenSpeedDto) {
    return this.screens.setScreenSpeed(user.orgId, id, dto.rate);
  }

  @Get(':id/crash-reports')
  crashReports(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.crashReports(user.orgId, id);
  }

  @Put(':id/emergency')
  setEmergency(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetEmergencyDto,
  ) {
    return this.screens.setEmergency(user.orgId, id, dto.active, dto.playlistId);
  }

  @Put(':id/stop')
  setStopped(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetStoppedDto,
  ) {
    return this.screens.setStopped(user.orgId, id, dto.stopped);
  }

  @Put(':id/show-clock')
  setShowClock(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetShowClockDto,
  ) {
    return this.screens.setShowClock(user.orgId, id, dto.showClock);
  }

  @Put(':id/orientation')
  setOrientation(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetOrientationDto,
  ) {
    return this.screens.setOrientation(user.orgId, id, dto.orientation);
  }

  @Put(':id/aspect-ratio')
  setAspectRatio(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetAspectRatioDto,
  ) {
    return this.screens.setAspectRatio(user.orgId, id, dto.aspectRatio);
  }

  @Put(':id/prayer')
  updatePrayer(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdatePrayerDto,
  ) {
    return this.screens.updatePrayerConfig(user.orgId, id, dto);
  }

  @Put(':id/volume')
  setVolume(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetVolumeDto,
  ) {
    return this.screens.setVolume(user.orgId, id, dto.volume);
  }

  @Put(':id/group')
  setGroup(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetGroupDto,
  ) {
    return this.screens.setGroup(user.orgId, id, dto.groupId);
  }

  @Put(':id/kiosk-location')
  setKioskLocation(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetKioskLocationDto,
  ) {
    return this.screens.setKioskLocation(user.orgId, id, dto.floorId, dto.x, dto.y);
  }

  @Delete(':id/kiosk-location')
  clearKioskLocation(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.clearKioskLocation(user.orgId, id);
  }

  @Put(':id/kiosk-attract-playlist')
  setKioskAttractPlaylist(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetKioskAttractPlaylistDto,
  ) {
    return this.screens.setKioskAttractPlaylist(user.orgId, id, dto.playlistId);
  }

  @Put(':id/kiosk-attract-theme')
  setKioskAttractTheme(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetKioskAttractThemeDto,
  ) {
    return this.screens.setKioskAttractTheme(user.orgId, id, dto.themeId);
  }
}
