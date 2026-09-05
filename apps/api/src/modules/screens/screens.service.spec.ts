import { BadRequestException } from '@nestjs/common';
import { ScreensService } from './screens.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { JwtService } from '@nestjs/jwt';
import type { StorageService } from '../storage/storage.service';
import type { ScreenGateway } from '../ws/screen.gateway';
import type { AuditService } from '../audit/audit.service';
import type { EntitlementsService } from '../entitlements/entitlements.service';

// Regression coverage for the pairing race fixed this audit: confirmPairing used to read
// `screen.paired`, then separately `update` the row — two concurrent pair attempts on the same
// code could both pass the read before either write landed, and the loser's write would silently
// overwrite the winner's organizationId/playerToken. The fix makes the write itself conditional
// (`updateMany({ where: { paired: false } })`) so only one request's write can ever match.
describe('ScreensService.confirmPairing — pairing race', () => {
  const ORG_ID = 'org_1';
  const CODE = 'ABC123';
  const SCREEN_ID = 'screen_1';

  function makeService(prismaOverrides: Record<string, unknown>) {
    const prisma = {
      screen: {
        findUnique: jest.fn().mockResolvedValue({ id: SCREEN_ID, paired: false, name: 'Unnamed Screen' }),
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: SCREEN_ID, paired: true, organizationId: ORG_ID }),
        ...(prismaOverrides.screen as object ?? {}),
      },
    } as unknown as PrismaService;
    const jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') } as unknown as JwtService;
    const gateway = {} as ScreenGateway;
    const storage = {} as StorageService;
    const orgScoped = new OrgScopedService();
    const audit = { log: jest.fn() } as unknown as AuditService;
    const entitlements = { assertModule: jest.fn() } as unknown as EntitlementsService;
    return { service: new ScreensService(prisma, jwt, gateway, storage, orgScoped, audit, entitlements), prisma };
  }

  it('the write is conditional on paired: false, not just the earlier read', async () => {
    const { service, prisma } = makeService({});

    await service.confirmPairing(ORG_ID, CODE);

    expect(prisma.screen.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: SCREEN_ID, paired: false } }),
    );
  });

  it('loses the race cleanly when another request already paired the screen first', async () => {
    // Simulates the exact race: the read above still saw paired: false, but by the time this
    // request's updateMany runs, a concurrent request already committed — so the conditional
    // WHERE clause matches zero rows.
    const { service } = makeService({ screen: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } });

    await expect(service.confirmPairing(ORG_ID, CODE)).rejects.toThrow(
      new BadRequestException('Screen already paired'),
    );
  });

  it('rejects outright if the read already shows the screen as paired', async () => {
    const { service } = makeService({
      screen: { findUnique: jest.fn().mockResolvedValue({ id: SCREEN_ID, paired: true, name: 'x' }) },
    });

    await expect(service.confirmPairing(ORG_ID, CODE)).rejects.toThrow(
      new BadRequestException('Screen already paired'),
    );
  });
});
