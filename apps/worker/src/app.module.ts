import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { MediaProcessor } from './processors/media.processor';
import { StorageService } from './storage/storage.service';
import { PrismaService } from './prisma/prisma.service';
import { ConnectorsModule } from './connectors/connectors.module';

export const QUEUE_MEDIA = 'media';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env['NODE_ENV'] !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
      },
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_MEDIA }),
    ConnectorsModule,
  ],
  providers: [MediaProcessor, StorageService, PrismaService],
})
export class AppModule {}
