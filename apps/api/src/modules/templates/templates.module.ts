import { Module } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { AdminTemplatesController, TemplatesController } from './templates.controller';
import { AuthModule } from '../auth/auth.module';
import { DesignsModule } from '../designs/designs.module';

@Module({
  imports: [AuthModule, DesignsModule],
  providers: [TemplatesService],
  controllers: [AdminTemplatesController, TemplatesController],
  exports: [TemplatesService],
})
export class TemplatesModule {}
