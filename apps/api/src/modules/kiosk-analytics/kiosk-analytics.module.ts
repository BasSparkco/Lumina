import { Module } from '@nestjs/common';
import { KioskAnalyticsService } from './kiosk-analytics.service';
import { KioskAnalyticsController } from './kiosk-analytics.controller';
import { EntitlementsModule } from '../entitlements/entitlements.module';

@Module({
  imports: [EntitlementsModule],
  providers: [KioskAnalyticsService],
  controllers: [KioskAnalyticsController],
  exports: [KioskAnalyticsService],
})
export class KioskAnalyticsModule {}
