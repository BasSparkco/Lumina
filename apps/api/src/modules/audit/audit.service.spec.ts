import { AuditService } from './audit.service';
import type { PrismaService } from '../../prisma/prisma.service';

function makeService() {
  const prisma = {
    auditLog: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  } as unknown as PrismaService;
  return { service: new AuditService(prisma), prisma };
}

// P8 — userSearch is new: filters by the acting user's name/email via the AuditLog.user relation.
describe('AuditService.query — userSearch filter (P8)', () => {
  it('builds a case-insensitive name/email OR filter on the related user when userSearch is given', async () => {
    const { service, prisma } = makeService();

    await service.query('org_1', { userSearch: 'sara', page: 1, pageSize: 50 });

    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: { OR: [{ name: { contains: 'sara', mode: 'insensitive' } }, { email: { contains: 'sara', mode: 'insensitive' } }] },
        }),
      }),
    );
  });

  it('omits the user filter entirely when userSearch is blank', async () => {
    const { service, prisma } = makeService();

    await service.query('org_1', { userSearch: '  ', page: 1, pageSize: 50 });

    const call = (prisma.auditLog.findMany as jest.Mock).mock.calls[0]![0];
    expect(call.where.user).toBeUndefined();
  });
});
