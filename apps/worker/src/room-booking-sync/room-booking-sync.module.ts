import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RoomBookingEncryptionService } from './room-booking-encryption.service';
import { RoomBookingReconciliationService } from './room-booking-reconciliation.service';
import { RoomBookingSyncProcessor } from './room-booking-sync.processor';
import { RoomBookingRenewalService } from './room-booking-renewal.service';
import { ROOM_BOOKING_SYNC_QUEUE } from './room-booking-queue.constants';

// docs/modules/room_booking_module_plan.md §13 — Microsoft 365 connector, worker side: consumes
// 'reconcile-room' jobs enqueued by apps/api's webhook controller, plus its own subscription-
// renewal and periodic-fallback cron jobs (RoomBookingRenewalService).
@Module({
  imports: [BullModule.registerQueue({ name: ROOM_BOOKING_SYNC_QUEUE })],
  providers: [
    PrismaService,
    RoomBookingEncryptionService,
    RoomBookingReconciliationService,
    RoomBookingSyncProcessor,
    RoomBookingRenewalService,
  ],
})
export class RoomBookingSyncModule {}
