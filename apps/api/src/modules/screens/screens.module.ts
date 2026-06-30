import { Module } from '@nestjs/common';
import { ScreensService } from './screens.service';
import { ScreensController } from './screens.controller';
import { AuthModule } from '../auth/auth.module';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [AuthModule, WsModule],
  providers: [ScreensService],
  controllers: [ScreensController],
  exports: [ScreensService],
})
export class ScreensModule {}
