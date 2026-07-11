import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

const OFFLINE_THRESHOLD_MS = 3 * 60 * 1000;

@Injectable()
export class FleetMonitorService {
  private readonly logger = new Logger(FleetMonitorService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkFleet() {
    await Promise.allSettled([this.flagNewlyOffline(), this.resolveRecovered()]);
  }

  private async flagNewlyOffline() {
    const cutoff = new Date(Date.now() - OFFLINE_THRESHOLD_MS);
    const staleScreens = await this.prisma.screen.findMany({
      where: {
        status: 'ONLINE',
        paired: true,
        lastSeenAt: { lt: cutoff },
      },
    });

    for (const screen of staleScreens) {
      if (!screen.organizationId) continue;
      await this.prisma.screen.update({ where: { id: screen.id }, data: { status: 'OFFLINE' } });
      await this.prisma.screenAlert.create({
        data: {
          type: 'OFFLINE',
          message: `${screen.name} has not reported in over ${OFFLINE_THRESHOLD_MS / 60_000} minutes`,
          screenId: screen.id,
          organizationId: screen.organizationId,
        },
      });
      this.logger.warn(`Screen ${screen.id} (${screen.name}) marked OFFLINE`);
    }
  }

  private async resolveRecovered() {
    const unresolvedAlerts = await this.prisma.screenAlert.findMany({
      where: { type: 'OFFLINE', resolvedAt: null },
      include: { screen: true },
    });

    for (const alert of unresolvedAlerts) {
      if (alert.screen.status === 'ONLINE') {
        await this.prisma.screenAlert.update({ where: { id: alert.id }, data: { resolvedAt: new Date() } });
        this.logger.log(`Screen ${alert.screenId} recovered — alert resolved`);
      }
    }
  }
}
