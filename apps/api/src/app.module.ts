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
import { SchedulesModule } from './modules/schedules/schedules.module';
import { FeedsModule } from './modules/feeds/feeds.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env['NODE_ENV'] !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true } }
            : undefined,
        level: process.env['LOG_LEVEL'] ?? 'info',
      },
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
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
    SchedulesModule,
    FeedsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
