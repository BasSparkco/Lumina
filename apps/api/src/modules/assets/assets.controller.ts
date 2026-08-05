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
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { memoryStorage } from 'multer';
import type { AssetCategory, TextSize } from '@lumina/db';
import { FONT_IDS } from '@lumina/types';
import { AssetsService } from './assets.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

const TEXT_SIZES = ['SMALL', 'MEDIUM', 'LARGE', 'XLARGE'] as const;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

class RenameAssetDto { @IsString() name!: string; }
class SetAudioEnabledDto { @IsBoolean() audioEnabled!: boolean; }

class TextStyleDto {
  @IsOptional() @IsIn(FONT_IDS) textFontFamily?: string;
  @IsOptional() @Matches(HEX_COLOR, { message: 'textColor must be a hex color like #RRGGBB' }) textColor?: string;
  @IsOptional() @IsIn(TEXT_SIZES) textSize?: TextSize;
  @IsOptional() @Matches(HEX_COLOR, { message: 'textBackgroundColor must be a hex color like #RRGGBB' }) textBackgroundColor?: string;
}

class CreateTextAssetDto extends TextStyleDto {
  @IsString() name!: string;
  @IsString() @MinLength(1) @MaxLength(5000) content!: string;
}

class UpdateTextAssetDto extends TextStyleDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(5000) content?: string;
}

@ApiTags('assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
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
    });
  }

  @Put(':id/text')
  updateText(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: UpdateTextAssetDto) {
    return this.assets.updateText(user.orgId, id, dto);
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

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.assets.findOne(user.orgId, id);
  }

  @Put(':id')
  rename(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: RenameAssetDto) {
    return this.assets.rename(user.orgId, id, dto.name);
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
