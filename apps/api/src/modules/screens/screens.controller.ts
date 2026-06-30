import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { ScreensService } from './screens.service';
import { CreateScreenDto } from './dto/create-screen.dto';
import { AssignPlaylistDto } from './dto/assign-playlist.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

class PairDto { @IsString() code!: string; }

@ApiTags('screens')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.findOne(user.orgId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.screens.remove(user.orgId, id);
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

  @Put(':id/emergency')
  setEmergency(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: { active: boolean; playlistId?: string },
  ) {
    return this.screens.setEmergency(user.orgId, id, dto.active, dto.playlistId);
  }

  @Put(':id/prayer')
  updatePrayer(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() dto: { latitude?: number; longitude?: number; prayerMethod?: string; athanEnabled?: boolean },
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
}
