import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { OrgScopedModule } from './common/org-scoped.module';
import { validateEnv } from './config/env.validation';
import { StorageModule } from './modules/storage/storage.module';
import { AuthModule } from './modules/auth/auth.module';
import { AssetsModule } from './modules/assets/assets.module';
import { AppsModule } from './modules/apps/apps.module';
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
import { WayfindingModule } from './modules/wayfinding/wayfinding.module';
import { EntitlementsModule } from './modules/entitlements/entitlements.module';
import { KioskAnalyticsModule } from './modules/kiosk-analytics/kiosk-analytics.module';
import { DesignsModule } from './modules/designs/designs.module';
import { TemplatesModule } from './modules/templates/templates.module';

// Tries a handful of plausible locations for the monorepo-root .env file, since this same
// module runs both under ts-node (dev, __dirname === apps/api/src) and from the compiled
// dist/ (prod, __dirname === apps/api/dist/src) — those resolve differently relative to the
// repo root, and the process may also have been started from the repo root or from apps/api/
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
      // Runs during ConfigModule's own provider init, before any other module (Prisma, S3,
      // JWT strategies, ...) gets a chance to instantiate — a missing/malformed required var
      // throws here and NestFactory.create() rejects before app.listen() is ever reached,
      // instead of the previous behavior of surfacing as a confusing failure deep inside
      // whichever service happened to be the first to actually read that var.
      validate: validateEnv,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        level: process.env.LOG_LEVEL ?? 'info',
        // Without this, pino-http's default req serializer logs every header verbatim —
        // including the bearer JWT (dashboard sessions and, worse, the 10-year non-revocable
        // player/screen token) on every single request at the default 'info' level.
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          censor: '[Redacted]',
        },
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: () => ({
        connection: { url: process.env.REDIS_URL ?? 'redis://localhost:6381' },
      }),
    }),
    // Global per-IP baseline (nothing was throttled before this at all). Sensitive/unauthenticated
    // endpoints — login/register, player pairing — layer a tighter @Throttle() override on top of
    // this in their own controllers; this default just stops unbounded hammering of everything else.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    PrismaModule,
    OrgScopedModule,
    StorageModule,
    AuthModule,
    AssetsModule,
    AppsModule,
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
    WayfindingModule,
    EntitlementsModule,
    KioskAnalyticsModule,
    DesignsModule,
    TemplatesModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
