import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { FeedsService, REDIS } from './feeds.service';
import { FeedsController } from './feeds.controller';

@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis(config.getOrThrow<string>('REDIS_URL')),
    },
    FeedsService,
  ],
  controllers: [FeedsController],
  exports: [FeedsService, REDIS],
})
export class FeedsModule {}
