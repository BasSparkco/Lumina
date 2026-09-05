import { Injectable } from '@nestjs/common';
import type { WayfindingAiUsageOutcome } from '@lumina/types';
import { PrismaService } from '../../prisma/prisma.service';

export interface RecordUsageInput {
  organizationId: string;
  screenId: string;
  language: string;
  outcome: WayfindingAiUsageOutcome;
  provider: string;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  usedModel: boolean;
  resolvedPoiId: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

// docs/modules/ai_wayfinding_module_plan.md §6.3/§11.2/§12 — operational/cost record only, never
// raw visitor text (the `message` the visitor typed never reaches this service). Also the source
// of truth for the per-screen/per-tenant daily quota (§11.2): counted from these rows rather than
// a separate counter table, so the quota and the usage history can never drift apart.
@Injectable()
export class WayfindingAiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordUsageInput): Promise<void> {
    await this.prisma.wayfindingAiUsageLog.create({
      data: {
        organizationId: input.organizationId,
        screenId: input.screenId,
        language: input.language,
        outcome: input.outcome,
        provider: input.provider,
        model: input.model,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        latencyMs: input.latencyMs,
        usedModel: input.usedModel,
        resolvedPoiId: input.resolvedPoiId,
      },
    });
  }

  async countSince(scope: { screenId: string } | { organizationId: string }, since: Date): Promise<number> {
    return this.prisma.wayfindingAiUsageLog.count({
      where: { ...scope, createdAt: { gte: since } },
    });
  }

  // Rolling 24h window (not calendar-midnight) — a burst that straddles midnight shouldn't reset
  // the quota partway through, and this needs no timezone handling per tenant/screen.
  async screenRequestsToday(screenId: string): Promise<number> {
    return this.countSince({ screenId }, new Date(Date.now() - DAY_MS));
  }

  async tenantRequestsToday(organizationId: string): Promise<number> {
    return this.countSince({ organizationId }, new Date(Date.now() - DAY_MS));
  }

  async query(organizationId: string, opts: { from?: Date; to?: Date; screenId?: string }) {
    return this.prisma.wayfindingAiUsageLog.findMany({
      where: {
        organizationId,
        ...(opts.screenId ? { screenId: opts.screenId } : {}),
        ...(opts.from || opts.to
          ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  // §11.3 — deletes usage rows past the configured retention window. Not wired to a scheduler in
  // this pass (no job scheduler infra is introduced by this module); invoke from an operational
  // cron/worker task once AI_WAYFINDING_USAGE_LOG_RETENTION_DAYS's production value is set.
  async purgeOlderThan(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * DAY_MS);
    const { count } = await this.prisma.wayfindingAiUsageLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }
}
