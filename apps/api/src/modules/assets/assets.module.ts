import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { MediaController } from './media.controller';

@Module({
  imports: [BullModule.registerQueue({ name: 'media' })],
  providers: [AssetsService],
  controllers: [AssetsController, MediaController],
  exports: [AssetsService],
})
export class AssetsModule {}
