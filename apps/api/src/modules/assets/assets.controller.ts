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
import { IsString } from 'class-validator';
import { memoryStorage } from 'multer';
import { AssetsService } from './assets.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUser } from '../../common/types/jwt-user';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

class RenameAssetDto { @IsString() name!: string; }

@ApiTags('assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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
