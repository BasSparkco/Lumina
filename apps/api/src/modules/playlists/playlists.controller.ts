import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import type { TransitionStyle, PlaybackOrder } from '@lumina/db';
import { PlaylistsService } from './playlists.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

const PLAYLIST_ITEM_KINDS = ['ASSET', 'THEME', 'LAYOUT', 'DESIGN'] as const;

class CreatePlaylistDto { @IsString() name!: string; }
class RenamePlaylistDto { @IsString() name!: string; }
class AddItemDto {
  @IsIn(PLAYLIST_ITEM_KINDS) @IsOptional() kind: (typeof PLAYLIST_ITEM_KINDS)[number] = 'ASSET';
  @IsString() @IsOptional() assetId?: string;
  @IsString() @IsOptional() themeId?: string;
  @IsString() @IsOptional() layoutId?: string;
  @IsString() @IsOptional() designAssetId?: string;
  @IsInt() @Min(1) durationSecs = 10;
  @IsBoolean() @IsOptional() muted?: boolean;
  @IsBoolean() @IsOptional() playFullVideo?: boolean;
  @IsNumber() @Min(1) @Max(4) @IsOptional() cropZoom?: number;
  @IsNumber() @IsOptional() cropOffsetX?: number;
  @IsNumber() @IsOptional() cropOffsetY?: number;
}
class UpdateItemDto {
  @IsInt() @Min(1) durationSecs!: number;
  @IsBoolean() @IsOptional() muted?: boolean;
  @IsBoolean() @IsOptional() playFullVideo?: boolean;
  @IsNumber() @Min(1) @Max(4) @IsOptional() cropZoom?: number | null;
  @IsNumber() @IsOptional() cropOffsetX?: number | null;
  @IsNumber() @IsOptional() cropOffsetY?: number | null;
}
class ReorderDto { @IsArray() @IsString({ each: true }) ids!: string[]; }
class UpdateConfigDto {
  @IsOptional() @IsIn(['NONE', 'CROSSFADE']) transitionStyle?: TransitionStyle;
  // Bounds agreed with the Android side so the CMS can never save a value the player would
  // silently clamp or reject — keep these in sync if that range changes.
  @IsOptional() @IsInt() @Min(100) @Max(3000) transitionDurationMs?: number;
  @IsOptional() @IsIn(['SEQUENTIAL', 'SHUFFLE']) playbackOrder?: PlaybackOrder;
}

@ApiTags('playlists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreatePlaylistDto) {
    return this.playlists.create(user.orgId, dto.name, user.role);
  }

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.playlists.list(user.orgId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.playlists.findOne(user.orgId, id);
  }

  @Put(':id')
  rename(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: RenamePlaylistDto) {
    return this.playlists.rename(user.orgId, id, dto.name);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.playlists.remove(user.orgId, id);
  }

  @Post(':id/items')
  addItem(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: AddItemDto) {
    return this.playlists.addItem(
      user.orgId, id, dto.kind, dto.durationSecs,
      { assetId: dto.assetId, themeId: dto.themeId, layoutId: dto.layoutId, designAssetId: dto.designAssetId },
      dto.muted, dto.playFullVideo, dto.cropZoom, dto.cropOffsetX, dto.cropOffsetY,
    );
  }

  @Put(':id/items/:itemId')
  updateItem(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.playlists.updateItem(
      user.orgId, id, itemId, dto.durationSecs, dto.muted, dto.playFullVideo,
      dto.cropZoom, dto.cropOffsetX, dto.cropOffsetY,
    );
  }

  @Delete(':id/items/:itemId')
  removeItem(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.playlists.removeItem(user.orgId, id, itemId);
  }

  @Put(':id/reorder')
  reorder(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: ReorderDto) {
    return this.playlists.reorderItems(user.orgId, id, dto.ids);
  }

  @Put(':id/config')
  updateConfig(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: UpdateConfigDto) {
    return this.playlists.updateConfig(user.orgId, id, dto);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.playlists.submit(user.orgId, id);
  }

  @Post(':id/approve')
  @Roles('OWNER', 'ADMIN')
  approve(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.playlists.approve(user.orgId, id);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'ADMIN')
  reject(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.playlists.reject(user.orgId, id);
  }
}
