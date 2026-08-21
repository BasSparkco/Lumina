import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface KioskEventInput {
  type: 'SESSION_START' | 'SEARCH' | 'POI_VIEW';
  query?: string;
  poiId?: string;
  poiName?: string;
}

interface QueryOptions {
  screenId?: string;
  from?: Date;
  to?: Date;
}

// Kiosk analytics (7.4) — extends the existing proof-of-play ingest/query shape (see
// ProofOfPlayService, which this mirrors line-for-line) with wayfinding-specific events rather
// than building a parallel analytics system.
@Injectable()
export class KioskAnalyticsService {
  // The dashboard's Kiosk Activity tab aggregates (top searches, top destinations, session
  // count) over the *entire* filtered range client-side — it's not a paged table like Proof of
  // Play, so this stays a capped bulk fetch rather than page/pageSize. The cap exists so a single
  // request can't return an unbounded result set; `total` (below) lets the caller detect and
  // surface truncation instead of silently showing incomplete aggregates.
  private readonly MAX_EVENTS = 5000;

  constructor(private readonly prisma: PrismaService) {}

  async ingest(orgId: string, screenId: string, events: KioskEventInput[]) {
    if (events.length === 0) return { ok: true, count: 0 };
    await this.prisma.kioskEvent.createMany({
      data: events.map(e => ({
        organizationId: orgId,
        screenId,
        type: e.type,
        query: e.query,
        poiId: e.poiId,
        poiName: e.poiName,
      })),
    });
    return { ok: true, count: events.length };
  }

  async list(orgId: string, opts: QueryOptions) {
    const where = {
      organizationId: orgId,
      ...(opts.screenId ? { screenId: opts.screenId } : {}),
      ...(opts.from || opts.to
        ? { createdAt: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lte: opts.to } : {}) } }
        : {}),
    };

    const [events, total] = await this.prisma.$transaction([
      this.prisma.kioskEvent.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: this.MAX_EVENTS,
        include: {
          screen: {
            select: {
              id: true, name: true,
              kioskLocation: { select: { floor: { select: { building: { select: { name: true } } } } } },
            },
          },
        },
      }),
      this.prisma.kioskEvent.count({ where }),
    ]);

    return {
      items: events.map(e => ({
        id: e.id,
        type: e.type,
        query: e.query,
        poiId: e.poiId,
        poiName: e.poiName,
        createdAt: e.createdAt.toISOString(),
        screenId: e.screenId,
        screenName: e.screen.name,
        buildingName: e.screen.kioskLocation?.floor.building.name ?? null,
      })),
      total,
    };
  }
}
