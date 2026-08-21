import { Module } from '@nestjs/common';
import { KioskAnalyticsService } from './kiosk-analytics.service';
import { KioskAnalyticsController } from './kiosk-analytics.controller';

@Module({
  providers: [KioskAnalyticsService],
  controllers: [KioskAnalyticsController],
  exports: [KioskAnalyticsService],
})
export class KioskAnalyticsModule {}
