import fs from 'node:fs';
import path from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './modules/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { AssetsModule } from './modules/assets/assets.module';
import { ScreensModule } from './modules/screens/screens.module';
import { PlaylistsModule } from './modules/playlists/playlists.module';
import { PlayerModule } from './modules/player/player.module';
import { WsModule } from './modules/ws/ws.module';
import { LayoutsModule } from './modules/layouts/layouts.module';
import { ThemesModule } from './modules/themes/themes.module';
import { SchedulesModule } from './modules/schedules/schedules.module';
import { PowerSchedulesModule } from './modules/power-schedules/power-schedules.module';
import { FeedsModule } from './modules/feeds/feeds.module';
import { OrgModule } from './modules/org/org.module';
import { AuditModule } from './modules/audit/audit.module';
import { ScreenGroupsModule } from './modules/screen-groups/screen-groups.module';
import { ProofOfPlayModule } from './modules/proof-of-play/proof-of-play.module';

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
        level: process.env.LOG_LEVEL ?? 'info',
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => ({
        connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6381' },
      }),
    }),
    PrismaModule,
    StorageModule,
    AuthModule,
    AssetsModule,
    ScreensModule,
    PlaylistsModule,
    PlayerModule,
    WsModule,
    LayoutsModule,
    ThemesModule,
    SchedulesModule,
    PowerSchedulesModule,
    FeedsModule,
    OrgModule,
    AuditModule,
    ScreenGroupsModule,
    ProofOfPlayModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
