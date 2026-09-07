import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { MediaController } from './media.controller';
import { AppsModule } from '../apps/apps.module';
import { PlatformAuditModule } from '../platform-audit/platform-audit.module';

@Module({
  imports: [BullModule.registerQueue({ name: 'media' }), AppsModule, PlatformAuditModule],
  providers: [AssetsService],
  controllers: [AssetsController, MediaController],
  exports: [AssetsService],
})
export class AssetsModule {}
