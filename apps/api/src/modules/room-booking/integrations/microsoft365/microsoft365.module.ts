import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AuditModule } from '../../../audit/audit.module';
import { EntitlementsModule } from '../../../entitlements/entitlements.module';
import { Microsoft365CalendarProvider } from './microsoft365-calendar.provider';
import { Microsoft365ConnectionsService } from './microsoft365-connections.service';
import { Microsoft365ConnectionsController } from './microsoft365-connections.controller';
import { Microsoft365WebhookController } from './microsoft365-webhook.controller';
import { RoomBookingEncryptionService } from '../../encryption.service';
import { ROOM_BOOKING_SYNC_QUEUE } from '../../room-booking-queue.constants';

// docs/modules/room_booking_module_plan.md §13.1/§13.3 — the Microsoft 365 connector, isolated
// behind the same RoomCalendarProvider interface every other provider uses. Deliberately has no
// dependency on RoomBookingModule at all (its own RoomBookingEncryptionService instance is
// stateless and cheap to duplicate-register) — RoomBookingModule imports this module and
// RoomCalendarProviderRegistry optionally injects Microsoft365CalendarProvider from it, so the
// core module still boots cleanly on a deployment that never imports this one.
@Module({
  imports: [AuditModule, EntitlementsModule, BullModule.registerQueue({ name: ROOM_BOOKING_SYNC_QUEUE })],
  controllers: [Microsoft365ConnectionsController, Microsoft365WebhookController],
  providers: [Microsoft365CalendarProvider, Microsoft365ConnectionsService, RoomBookingEncryptionService],
  exports: [Microsoft365CalendarProvider],
})
export class Microsoft365Module {}
