import { Module } from '@nestjs/common';
import { ScreenGroupsService } from './screen-groups.service';
import { ScreenGroupsController } from './screen-groups.controller';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [WsModule],
  providers: [ScreenGroupsService],
  controllers: [ScreenGroupsController],
})
export class ScreenGroupsModule {}
