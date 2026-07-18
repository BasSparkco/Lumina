import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { memoryStorage } from 'multer';
import type { TextFontFamily, TextSize } from '@lumina/db';
import { AssetsService } from './assets.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

const TEXT_FONT_FAMILIES = ['SANS', 'SERIF', 'MONOSPACE', 'ROUNDED', 'CONDENSED', 'IMPACT', 'HANDWRITTEN'] as const;
const TEXT_SIZES = ['SMALL', 'MEDIUM', 'LARGE', 'XLARGE'] as const;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

class RenameAssetDto { @IsString() name!: string; }

class TextStyleDto {
  @IsOptional() @IsIn(TEXT_FONT_FAMILIES) textFontFamily?: TextFontFamily;
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
    return this.assets.upload(user.orgId, file, async (assetId, key, type) => {
      await this.mediaQueue.add('generate-thumbnail', { assetId, key, type });
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

  @Get(':id')
  findOne(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.assets.findOne(user.orgId, id);
  }

  @Put(':id')
  rename(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() dto: RenameAssetDto) {
    return this.assets.rename(user.orgId, id, dto.name);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.assets.remove(user.orgId, id);
  }
}
