import { Module } from '@nestjs/common';
import { LayoutsService } from './layouts.service';
import { LayoutsController } from './layouts.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [LayoutsService],
  controllers: [LayoutsController],
  exports: [LayoutsService],
})
export class LayoutsModule {}
