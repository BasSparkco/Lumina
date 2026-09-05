import { Body, Controller, HttpCode, Post, Query, Res } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Response } from 'express';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { Microsoft365ConnectionsService } from './microsoft365-connections.service';
import { ROOM_BOOKING_SYNC_QUEUE } from '../../room-booking-queue.constants';

interface GraphChangeNotification {
  subscriptionId: string;
  clientState?: string;
  changeType: string;
  resource: string;
  resourceData?: { id?: string };
}
interface GraphNotificationBody { value: GraphChangeNotification[] }

// docs/modules/room_booking_module_plan.md §13.3 — public HTTPS callback endpoint. No auth guard
// (Microsoft calls this directly with no Lumina credential); clientState is the sole
// authenticity check. Acknowledges within Graph's required window and does all real work
// (reconciliation) in a BullMQ job, never inline in this request.
//
// KNOWN LIMITATION (disclosed rather than silently assumed correct — no live Microsoft 365
// tenant was available to verify the exact notification payload shape in this environment): the
// current schema tracks one `webhookSubscriptionId` per RoomCalendarConnection, not per room. A
// connection mapping multiple rooms needs either a per-room subscription-tracking table (a
// follow-up migration) or a one-room-per-connection operational convention until then. Room
// resolution below best-effort-parses the resource mailbox address out of Graph's `resource`
// path; verify this against a real tenant before depending on it for production reconciliation.
@Controller('room-booking/integrations/microsoft365')
export class Microsoft365WebhookController {
  private readonly logger = new Logger(Microsoft365WebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: Microsoft365ConnectionsService,
    @InjectQueue(ROOM_BOOKING_SYNC_QUEUE) private readonly syncQueue: Queue,
  ) {}

  @Post('webhook')
  @HttpCode(200)
  async handle(
    @Query('validationToken') validationToken: string | undefined,
    @Body() body: GraphNotificationBody | undefined,
    @Res() res: Response,
  ) {
    // Subscription-creation/renewal validation handshake — must echo the token as plain text.
    if (validationToken) {
      res.type('text/plain').send(validationToken);
      return;
    }

    for (const notification of body?.value ?? []) {
      const room = await this.resolveRoom(notification);
      if (!room) {
        this.logger.warn(`Could not resolve a mapped room for Microsoft 365 notification on subscription ${notification.subscriptionId}`);
        continue;
      }
      const expectedClientState = this.connections.computeClientState(room.calendarConnectionId!);
      if (notification.clientState !== expectedClientState) {
        this.logger.warn(`Rejected Microsoft 365 webhook notification with invalid clientState for room ${room.id}`);
        continue;
      }
      await this.syncQueue.add('reconcile-room', { roomId: room.id }, { removeOnComplete: true, removeOnFail: 50 });
    }

    res.status(202).send();
  }

  private async resolveRoom(notification: GraphChangeNotification) {
    const emailMatch = /users\/([^/]+)\/events/i.exec(notification.resource);
    const emailOrId = emailMatch?.[1] ? decodeURIComponent(emailMatch[1]) : null;
    if (!emailOrId) return null;
    return this.prisma.bookableRoom.findFirst({
      where: {
        providerKey: 'MICROSOFT_365',
        OR: [{ externalResourceEmail: emailOrId }, { externalResourceId: emailOrId }],
      },
    });
  }
}
