import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsArray, IsInt, IsString, Min } from 'class-validator';
import { PlaylistsService } from './playlists.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';

class CreatePlaylistDto { @IsString() name!: string; }
class RenamePlaylistDto { @IsString() name!: string; }
class AddItemDto { @IsString() assetId!: string; @IsInt() @Min(1) durationSecs: number = 10; }
class UpdateItemDto { @IsInt() @Min(1) durationSecs!: number; }
class ReorderDto { @IsArray() @IsString({ each: true }) ids!: string[]; }

@ApiTags('playlists')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('playlists')
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreatePlaylistDto) {
    return this.playlists.create(user.orgId, dto.name);
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
    return this.playlists.addItem(user.orgId, id, dto.assetId, dto.durationSecs);
  }

  @Put(':id/items/:itemId')
  updateItem(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemDto,
  ) {
    return this.playlists.updateItem(user.orgId, id, itemId, dto.durationSecs);
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
}
