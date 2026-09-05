import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { MediaProcessor } from './processors/media.processor';
import { StorageService } from './storage/storage.service';
import { PrismaService } from './prisma/prisma.service';
import { ConnectorsModule } from './connectors/connectors.module';
import { FleetMonitorModule } from './fleet-monitor/fleet-monitor.module';
import { RoomBookingSyncModule } from './room-booking-sync/room-booking-sync.module';

export const QUEUE_MEDIA = 'media';

// Tries a handful of plausible locations for the monorepo-root .env file, since this same
// module runs both under ts-node (dev, __dirname === apps/worker/src) and from the compiled
// dist/ (prod, __dirname === apps/worker/dist/src) — those resolve differently relative to the
// repo root, and the process may also have been started from the repo root or from apps/worker/
// itself. dotenv tries every path and merges whatever it actually finds; `override` defaults to
// false, so real env vars (e.g. injected by docker-compose in production) always win over
// anything found in a bundled .env file — this only fills in gaps, never overrides.
loadDotenv({
  path: [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
    path.resolve(process.cwd(), 'apps', 'api', '.env'),
    path.resolve(process.cwd(), 'apps', 'worker', '.env'),
    path.resolve(__dirname, '../../..', '.env'),
  ],
  quiet: true,
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => ({ ...process.env })],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
      },
    }),
    ScheduleModule.forRoot(),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => ({
        connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6381' },
      }),
    }),
    BullModule.registerQueue({ name: QUEUE_MEDIA }),
    ConnectorsModule,
    FleetMonitorModule,
    RoomBookingSyncModule,
  ],
  providers: [MediaProcessor, StorageService, PrismaService],
})
export class AppModule {}
