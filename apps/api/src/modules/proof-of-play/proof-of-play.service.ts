import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedService } from '../../common/org-scoped.service';

interface ProofOfPlayEvent {
  assetId?: string;
  playedAt: string;
  durationMs: number;
}

interface QueryOptions {
  screenId?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

const SUMMARY_SAMPLE_LIMIT = 20_000;

@Injectable()
export class ProofOfPlayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScoped: OrgScopedService,
  ) {}

  async ingest(orgId: string, screenId: string, events: ProofOfPlayEvent[]) {
    if (events.length === 0) return { ok: true, count: 0 };
    await this.prisma.proofOfPlayLog.createMany({
      data: events.map(e => ({
        organizationId: orgId,
        screenId,
        assetId: e.assetId,
        playedAt: new Date(e.playedAt),
        durationMs: e.durationMs,
      })),
    });
    return { ok: true, count: events.length };
  }

  private whereFor(orgId: string, opts: { screenId?: string; from?: Date; to?: Date }) {
    return {
      organizationId: orgId,
      ...(opts.screenId ? { screenId: opts.screenId } : {}),
      ...(opts.from ?? opts.to
        ? { playedAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
    };
  }

  async query(orgId: string, opts: QueryOptions) {
    const where = this.whereFor(orgId, opts);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.proofOfPlayLog.findMany({
        where,
        orderBy: { playedAt: 'desc' },
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: {
          screen: { select: { id: true, name: true } },
          asset: { select: { id: true, name: true, type: true } },
        },
      }),
      this.prisma.proofOfPlayLog.count({ where }),
    ]);
    return { items, total, page: opts.page, pageSize: opts.pageSize };
  }

  // P8 (docs/tenant_isolation_and_platform_admin_plan.md) — the dashboard Reports page's two
  // charts (plays per day, plays per screen) used to aggregate client-side over the *entire*
  // mock history; server-side pagination means the table's own paginated `query()` above can no
  // longer feed that aggregation with the full filtered set. Capped at `SUMMARY_SAMPLE_LIMIT`
  // lightweight rows (playedAt + screenId only, no asset join) rather than an unbounded query —
  // same order of magnitude as exportCsv's existing 50k cap — with `truncated` telling the
  // caller when the cap was hit, same convention as KioskEventsResult.total vs items.length on
  // the dashboard's other Reports tab.
  async summary(orgId: string, opts: { screenId?: string; from?: Date; to?: Date }) {
    const where = this.whereFor(orgId, opts);
    const rows = await this.prisma.proofOfPlayLog.findMany({
      where,
      select: { playedAt: true, screenId: true, screen: { select: { name: true } } },
      orderBy: { playedAt: 'desc' },
      take: SUMMARY_SAMPLE_LIMIT,
    });

    const byDay = new Map<string, number>();
    const byScreen = new Map<string, { screenId: string; name: string; count: number }>();
    for (const row of rows) {
      const day = row.playedAt.toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
      const entry = byScreen.get(row.screenId) ?? { screenId: row.screenId, name: row.screen.name, count: 0 };
      entry.count += 1;
      byScreen.set(row.screenId, entry);
    }

    return {
      byDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, count]) => ({ day, count })),
      byScreen: [...byScreen.values()].sort((a, b) => b.count - a.count),
      sampledCount: rows.length,
      truncated: rows.length >= SUMMARY_SAMPLE_LIMIT,
    };
  }

  async exportCsv(orgId: string, opts: { screenId?: string; from?: Date; to?: Date }): Promise<string> {
    if (opts.screenId) {
      await this.orgScoped.assertOwns(
        () => this.prisma.screen.findFirst({ where: { id: opts.screenId, organizationId: orgId } }),
        'Screen not found',
      );
    }

    const where = this.whereFor(orgId, opts);
    const rows = await this.prisma.proofOfPlayLog.findMany({
      where,
      orderBy: { playedAt: 'desc' },
      include: {
        screen: { select: { name: true } },
        asset: { select: { name: true } },
      },
      take: 50_000,
    });

    const header = 'playedAt,screenId,screenName,assetId,assetName,durationMs';
    const lines = rows.map(r =>
      [
        r.playedAt.toISOString(),
        r.screenId,
        csvEscape(r.screen.name),
        r.assetId ?? '',
        csvEscape(r.asset?.name ?? ''),
        String(r.durationMs),
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
