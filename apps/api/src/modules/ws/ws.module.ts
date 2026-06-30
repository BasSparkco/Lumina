import { Module } from '@nestjs/common';
import { ScreenGateway } from './screen.gateway';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [ScreenGateway],
  exports: [ScreenGateway],
})
export class WsModule {}
