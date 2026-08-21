import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { ScreensService } from './screens.service';
import { CreateScreenDto } from './dto/create-screen.dto';
import { AssignPlaylistDto } from './dto/assign-playlist.dto';
import { AssignAssetDto } from './dto/assign-asset.dto';
import { SetThemeDto } from './dto/set-theme.dto';
import { SetStreamingTypeDto } from './dto/set-streaming-type.dto';
import { SetKioskLocationDto } from './dto/set-kiosk-location.dto';
import { SetKioskAttractPlaylistDto } from './dto/set-kiosk-attract-playlist.dto';
import { SetKioskAttractThemeDto } from './dto/set-kiosk-attract-theme.dto';
import { SetEmergencyDto } from './dto/set-emergency.dto';
import { SetStoppedDto } from './dto/set-stopped.dto';
import { SetShowClockDto } from './dto/set-show-clock.dto';
import { UpdatePrayerDto } from './dto/update-prayer.dto';
import { SetLayoutDto } from './dto/set-layout.dto';
import { SetVolumeDto } from './dto/set-volume.dto';
import { SetGroupDto } from './dto/set-group.dto';
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

  @Put(':id/streaming-type')
  setStreamingType(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: SetStreamingTypeDto) {
    return this.screens.setStreamingType(user.orgId, id, dto.streamingType);
  }

  @Put(':id/asset')
  setAsset(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: AssignAssetDto) {
    return this.screens.setAsset(user.orgId, id, dto.assetId);
  }

  @Put(':id/theme')
  setTheme(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: SetThemeDto) {
    return this.screens.setTheme(user.orgId, id, dto.themeId);
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

  @Put(':id/prayer')
  updatePrayer(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: UpdatePrayerDto,
  ) {
    return this.screens.updatePrayerConfig(user.orgId, id, dto);
  }

  @Put(':id/layout')
  setLayout(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: SetLayoutDto,
  ) {
    return this.screens.setLayout(user.orgId, id, dto.layoutId);
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
