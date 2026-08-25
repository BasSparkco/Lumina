import { Module } from '@nestjs/common';
import { DesignsService } from './designs.service';
import { DesignsController } from './designs.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [DesignsService],
  controllers: [DesignsController],
  exports: [DesignsService],
})
export class DesignsModule {}
