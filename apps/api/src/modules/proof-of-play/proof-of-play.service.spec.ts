import { ProofOfPlayService } from './proof-of-play.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { PrismaService } from '../../prisma/prisma.service';

// P8 (docs/tenant_isolation_and_platform_admin_plan.md) — regression coverage for `summary()`,
// added to feed the dashboard Reports page's plays-per-day/plays-per-screen charts now that the
// table itself is server-paginated and can no longer aggregate over its own (partial) result set.
describe('ProofOfPlayService.summary', () => {
  function makeService(rows: { playedAt: Date; screenId: string; screen: { name: string } }[]) {
    const prisma = {
      proofOfPlayLog: { findMany: jest.fn().mockResolvedValue(rows) },
    } as unknown as PrismaService;
    const orgScoped = new OrgScopedService();
    return { service: new ProofOfPlayService(prisma, orgScoped), prisma };
  }

  it('buckets rows by day and by screen, sorted ascending by day and descending by count', async () => {
    const { service } = makeService([
      { playedAt: new Date('2026-09-05T10:00:00Z'), screenId: 'scr_a', screen: { name: 'Lobby' } },
      { playedAt: new Date('2026-09-05T11:00:00Z'), screenId: 'scr_a', screen: { name: 'Lobby' } },
      { playedAt: new Date('2026-09-06T09:00:00Z'), screenId: 'scr_b', screen: { name: 'Kitchen' } },
    ]);

    const result = await service.summary('org_1', {});

    expect(result.byDay).toEqual([
      { day: '2026-09-05', count: 2 },
      { day: '2026-09-06', count: 1 },
    ]);
    expect(result.byScreen).toEqual([
      { screenId: 'scr_a', name: 'Lobby', count: 2 },
      { screenId: 'scr_b', name: 'Kitchen', count: 1 },
    ]);
    expect(result.truncated).toBe(false);
  });

  it('reports truncated when the sample hits the cap', async () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => ({
      playedAt: new Date(2026, 0, 1 + (i % 30)),
      screenId: 'scr_a',
      screen: { name: 'Lobby' },
    }));
    const { service } = makeService(rows);

    const result = await service.summary('org_1', {});

    expect(result.sampledCount).toBe(20_000);
    expect(result.truncated).toBe(true);
  });

  it('passes screenId/from/to filters through to the underlying query', async () => {
    const { service, prisma } = makeService([]);
    const from = new Date('2026-09-01');
    const to = new Date('2026-09-07');

    await service.summary('org_1', { screenId: 'scr_a', from, to });

    expect(prisma.proofOfPlayLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org_1', screenId: 'scr_a', playedAt: { gte: from, lte: to } },
      }),
    );
  });
});
