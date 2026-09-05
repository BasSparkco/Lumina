import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { RoomBookingReconciliationService } from './room-booking-reconciliation.service';
import { ROOM_BOOKING_SYNC_QUEUE } from './room-booking-queue.constants';

interface ReconcileRoomJob { roomId: string }

// Consumer side of the producer/consumer split — apps/api's Microsoft365WebhookController is the
// producer (enqueues 'reconcile-room' on a Graph change notification); this never runs inline in
// that request handler, matching the existing 'media' queue's api/worker split.
@Processor(ROOM_BOOKING_SYNC_QUEUE)
export class RoomBookingSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(RoomBookingSyncProcessor.name);

  constructor(private readonly reconciliation: RoomBookingReconciliationService) {
    super();
  }

  async process(job: Job<ReconcileRoomJob>) {
    if (job.name !== 'reconcile-room') {
      this.logger.warn(`Ignoring unknown job name "${job.name}" on ${ROOM_BOOKING_SYNC_QUEUE}`);
      return;
    }
    await this.reconciliation.reconcileRoom(job.data.roomId);
  }
}
