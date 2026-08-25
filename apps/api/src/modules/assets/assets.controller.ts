import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { memoryStorage } from 'multer';
import type { AssetCategory, TextSize, TickerDirection } from '@lumina/db';
import { FONT_IDS } from '@lumina/types';
import { AssetsService } from './assets.service';
import { AppsService } from '../apps/apps.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

const TEXT_SIZES = ['SMALL', 'MEDIUM', 'LARGE', 'XLARGE'] as const;
const TICKER_DIRECTIONS = ['LEFT_TO_RIGHT', 'RIGHT_TO_LEFT', 'TOP_TO_BOTTOM', 'BOTTOM_TO_TOP'] as const;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

class RenameAssetDto { @IsString() name!: string; }
class SetAudioEnabledDto { @IsBoolean() audioEnabled!: boolean; }

class TextStyleDto {
  @IsOptional() @IsIn(FONT_IDS) textFontFamily?: string;
  @IsOptional() @Matches(HEX_COLOR, { message: 'textColor must be a hex color like #RRGGBB' }) textColor?: string;
  @IsOptional() @IsIn(TEXT_SIZES) textSize?: TextSize;
  @IsOptional() @Matches(HEX_COLOR, { message: 'textBackgroundColor must be a hex color like #RRGGBB' }) textBackgroundColor?: string;
  @IsOptional() @IsBoolean() textTickerEnabled?: boolean;
  @IsOptional() @IsIn(TICKER_DIRECTIONS) textTickerDirection?: TickerDirection;
  @IsOptional() @IsInt() @Min(10) @Max(600) textTickerSpeed?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) textTickerCrossOffset?: number;
}

class CreateTextAssetDto extends TextStyleDto {
  @IsString() name!: string;
  @IsString() @MinLength(1) @MaxLength(5000) content!: string;
}

class UpdateTextAssetDto extends TextStyleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(5000) content?: string;
}

class ImportStockPhotoDto { @IsInt() @Min(1) photoId!: number; }
class ImportStockVideoDto { @IsInt() @Min(1) videoId!: number; }

class CreateAppAssetDto {
  @IsString() providerId!: string;
  @IsUrl() sourceUrl!: string;
  @IsOptional() @IsString() name?: string;
}

class AppPlaylistItemDto {
  @IsUrl() sourceUrl!: string;
}

const PLAYBACK_ORDERS = ['SEQUENTIAL', 'SHUFFLE'] as const;

class CreateAppPlaylistDto {
  @IsString() providerId!: string;
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsIn(PLAYBACK_ORDERS) playbackOrder!: (typeof PLAYBACK_ORDERS)[number];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => AppPlaylistItemDto)
  items!: AppPlaylistItemDto[];
}

const ASSET_CATEGORIES = ['BACKGROUND', 'ICON', 'ILLUSTRATION', 'STOCK_PHOTO', 'LOGO', 'VIDEO_LOOP', 'AUDIO_JINGLE', 'GENERIC'] as const;

class LibraryUploadMetaDto {
  @IsOptional() @IsIn(ASSET_CATEGORIES) category?: AssetCategory;
  // Multipart fields always arrive as strings — comma-separated here, split in the controller method below.
  @IsOptional() @IsString() tags?: string;
}

class UpdateLibraryAssetDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsIn(ASSET_CATEGORIES) category?: AssetCategory;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
}

@ApiTags('assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly apps: AppsService,
    @InjectQueue('media') private readonly mediaQueue: Queue,
  ) {}

  @Post('upload')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }))
  upload(@CurrentUser() user: JwtUser, @UploadedFile() file: Express.Multer.File) {
    return this.assets.upload(user.orgId, file, async (assetId, key, type, mimeType) => {
      await this.mediaQueue.add('generate-thumbnail', { assetId, key, type, mimeType });
    });
  }

  @Post('upload-audio')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }))
  uploadAudioFromVideo(@CurrentUser() user: JwtUser, @UploadedFile() file: Express.Multer.File) {
    return this.assets.uploadAudioFromVideo(user.orgId, file, async (assetId, sourceKey, targetKey, deleteSourceKey) => {
      await this.mediaQueue.add('extract-audio', { assetId, sourceKey, targetKey, deleteSourceKey });
    });
  }

  @Post(':id/extract-audio')
  extractAudioFromVideo(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.assets.extractAudioFromVideo(user.orgId, id, async (assetId, sourceKey, targetKey, deleteSourceKey) => {
      await this.mediaQueue.add('extract-audio', { assetId, sourceKey, targetKey, deleteSourceKey });
    });
  }

  @Post(':id/reprocess')
  reprocess(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.assets.reprocess(user.orgId, id, async (assetId, key, type, mimeType) => {
      await this.mediaQueue.add('generate-thumbnail', { assetId, key, type, mimeType });
    });
  }

  @Post('text')
  createText(@CurrentUser() user: JwtUser, @Body() dto: CreateTextAssetDto) {
    return this.assets.createText(user.orgId, dto.name, dto.content, {
      textFontFamily: dto.textFontFamily,
      textColor: dto.textColor,
      textSize: dto.textSize,
      textBackgroundColor: dto.textBackgroundColor,
      textTickerEnabled: dto.textTickerEnabled,
      textTickerDirection: dto.textTickerDirection,
      textTickerSpeed: dto.textTickerSpeed,
      textTickerCrossOffset: dto.textTickerCrossOffset,
    });
  }

  @Put(':id/text')
  updateText(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: UpdateTextAssetDto) {
    return this.assets.updateText(user.orgId, id, dto);
  }

  // Re-resolves server-side (rather than trusting whatever preview the Apps tab's /apps/resolve
  // call showed the user) so the stored appConfig always reflects a real, current lookup.
  @Post('apps')
  async createApp(@CurrentUser() user: JwtUser, @Body() dto: CreateAppAssetDto) {
    const resolved = await this.apps.resolve(dto.providerId, dto.sourceUrl);
    return this.assets.createApp(user.orgId, resolved, dto.name);
  }

  // Same re-resolve-server-side principle as createApp above, applied to every item.
  @Post('apps/playlist')
  async createAppPlaylist(@CurrentUser() user: JwtUser, @Body() dto: CreateAppPlaylistDto) {
    const resolved = await this.apps.resolveMany(dto.providerId, dto.items.map(i => i.sourceUrl));
    return this.assets.createAppPlaylist(user.orgId, dto.providerId, dto.name.trim(), resolved, dto.playbackOrder);
  }

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.assets.list(user.orgId);
  }

  // Must be registered before `:id` below — a literal path segment ('library') only wins over
  // a route param when Nest sees it first.
  @Get('library')
  listLibrary(@Query('category') category?: AssetCategory, @Query('search') search?: string) {
    return this.assets.listLibrary(category, search);
  }

  @Post('library/:id/use')
  useFromLibrary(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.assets.copyFromLibrary(user.orgId, id);
  }

  // The three routes below manage the shared library itself (organizationId: null) rather than
  // any tenant's own assets — restricted to LIBRARY_MANAGER, not the default "anyone but VIEWER"
  // policy every other route in this controller falls under (see RolesGuard).
  @Post('library')
  @Roles('LIBRARY_MANAGER')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } }))
  uploadLibraryAsset(@UploadedFile() file: Express.Multer.File, @Body() dto: LibraryUploadMetaDto) {
    const tags = dto.tags ? dto.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : undefined;
    return this.assets.uploadToLibrary(file, dto.category, tags, async (assetId, key, type, mimeType) => {
      await this.mediaQueue.add('generate-thumbnail', { assetId, key, type, mimeType });
    });
  }

  @Put('library/:id')
  @Roles('LIBRARY_MANAGER')
  updateLibraryAsset(@Param('id') id: string, @Body() dto: UpdateLibraryAssetDto) {
    return this.assets.updateLibraryAsset(id, dto);
  }

  @Delete('library/:id')
  @Roles('LIBRARY_MANAGER')
  removeLibraryAsset(@Param('id') id: string) {
    return this.assets.removeFromLibrary(id);
  }

  @Get('stock/search')
  async searchStockPhotos(@Query('query') query?: string, @Query('page') page?: string) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    return {
      configured: this.assets.stockPhotosConfigured(),
      photos: await this.assets.searchStockPhotos(query, pageNum),
    };
  }

  @Post('stock/import')
  importStockPhoto(@CurrentUser() user: JwtUser, @Body() dto: ImportStockPhotoDto) {
    return this.assets.importStockPhoto(user.orgId, dto.photoId, async (assetId, key, type, mimeType) => {
      await this.mediaQueue.add('generate-thumbnail', { assetId, key, type, mimeType });
    });
  }

  @Get('stock-videos/search')
  async searchStockVideos(@Query('query') query?: string, @Query('page') page?: string) {
    const pageNum = Math.max(1, parseInt(page ?? '1', 10) || 1);
    return {
      configured: this.assets.stockPhotosConfigured(),
      videos: await this.assets.searchStockVideos(query, pageNum),
    };
  }

  @Post('stock-videos/import')
  importStockVideo(@CurrentUser() user: JwtUser, @Body() dto: ImportStockVideoDto) {
    return this.assets.importStockVideo(user.orgId, dto.videoId, async (assetId, key, type, mimeType) => {
      await this.mediaQueue.add('generate-thumbnail', { assetId, key, type, mimeType });
    });
  }

  @Get('icons/search')
  async searchIcons(@Query('query') query?: string, @Query('prefixes') prefixes?: string) {
    return { icons: await this.assets.searchIcons(query ?? '', (prefixes ?? '').split(',').filter(Boolean)) };
  }

  @Get('icons/svg')
  async fetchIconSvg(@Query('icon') icon?: string) {
    return { svg: await this.assets.fetchIconSvg(icon ?? '') };
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.assets.findOne(user.orgId, id);
  }

  @Put(':id')
  rename(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: RenameAssetDto) {
    return this.assets.rename(user.orgId, id, dto.name);
  }

  // Called by the editor's "existing asset" picker (Layouts/Themes Add Item) whenever an asset
  // is picked, so that picker can offer a "recently used" sort.
  @Post(':id/touch')
  touch(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.assets.touch(user.orgId, id);
  }

  @Put(':id/audio')
  setAudioEnabled(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: SetAudioEnabledDto) {
    return this.assets.setAudioEnabled(user.orgId, id, dto.audioEnabled);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.assets.remove(user.orgId, id);
  }
}
