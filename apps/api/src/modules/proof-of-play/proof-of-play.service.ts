import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

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

@Injectable()
export class ProofOfPlayService {
  constructor(private readonly prisma: PrismaService) {}

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

  async exportCsv(orgId: string, opts: { screenId?: string; from?: Date; to?: Date }): Promise<string> {
    if (opts.screenId) {
      const screen = await this.prisma.screen.findFirst({ where: { id: opts.screenId, organizationId: orgId } });
      if (!screen) throw new NotFoundException('Screen not found');
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
