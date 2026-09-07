import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

// P4 task 11 / P5a schema task 4 (docs/tenant_isolation_and_platform_admin_plan.md) —
// `POST /player/init` creates a short-lived `PairingSession` row for every pairing attempt,
// including ones nobody ever completes (ScreensService.confirmPairing deletes it the moment it's
// claimed, transactionally with creating the real, now tenant-owned Screen — P5a's schema task 4
// replaced the old design of a durable, tenant-nullable Screen row existing from init time).
// Nothing else deletes an unclaimed one, so an abandoned or abusive stream of init calls would
// otherwise accumulate rows forever. "Short TTL" is enforced independently at read time by
// ScreensService.confirmPairing (rejects an expired code before this job ever gets to it) and at
// issuance time by PlayerService.requestPairingCode (won't create more once too many outstanding
// ones exist) — this job's only job is reclaiming the ones nobody claimed in time.
//
// Also clears a stale *re-pair* code sitting on an already tenant-owned Screen (unpair() minted
// it, nobody ever re-paired) — not a security fix (confirmPairing already rejects it as expired
// by pairingCodeIssuedAt), just hygiene: pairingCode is @unique, so a dead value would otherwise
// occupy that keyspace forever instead of freeing up for reuse.
//
// PAIRING_CODE_TTL_MS must match apps/api's two copies of the same constant (ScreensService,
// PlayerService) — see the comment on ScreensService's copy for why this is three independent
// constants rather than a shared cross-app import.
const PAIRING_CODE_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class PairingCleanupService {
  private readonly logger = new Logger(PairingCleanupService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanupExpiredPairingCodes() {
    const cutoff = new Date(Date.now() - PAIRING_CODE_TTL_MS);

    const { count } = await this.prisma.pairingSession.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) this.logger.log(`Deleted ${count} expired, never-claimed pairing session(s)`);

    const { count: staleRepairCodes } = await this.prisma.screen.updateMany({
      where: { pairingCode: { not: null }, pairingCodeIssuedAt: { lt: cutoff } },
      data: { pairingCode: null, pairingCodeIssuedAt: null },
    });
    if (staleRepairCodes > 0) this.logger.log(`Cleared ${staleRepairCodes} stale re-pair code(s)`);
  }
}
