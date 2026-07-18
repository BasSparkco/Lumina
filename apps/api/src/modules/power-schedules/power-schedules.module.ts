import { Module } from '@nestjs/common';
import { PowerSchedulesService } from './power-schedules.service';
import { PowerSchedulesController } from './power-schedules.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [PowerSchedulesService],
  controllers: [PowerSchedulesController],
  exports: [PowerSchedulesService],
})
export class PowerSchedulesModule {}
