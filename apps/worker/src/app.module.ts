import fs from 'node:fs';
import path from 'node:path';
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

export const QUEUE_MEDIA = 'media';

function loadEnvFile() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
    path.resolve(process.cwd(), 'apps', 'api', '.env'),
    path.resolve(process.cwd(), 'apps', 'worker', '.env'),
    path.resolve(__dirname, '../../..', '.env'),
  ];

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 0) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
    break;
  }
}

loadEnvFile();

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
  ],
  providers: [MediaProcessor, StorageService, PrismaService],
})
export class AppModule {}
