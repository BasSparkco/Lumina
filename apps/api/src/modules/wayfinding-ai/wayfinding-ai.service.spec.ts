import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { WayfindingAiService } from './wayfinding-ai.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { ScreenGateway } from '../ws/screen.gateway';
import type { AuditService } from '../audit/audit.service';
import type { EntitlementsService } from '../entitlements/entitlements.service';
import type { DestinationResolverService } from './destination-resolver.service';
import type { WayfindingAiUsageService } from './wayfinding-ai-usage.service';

const AI_CONFIG = { id: 'cfg_1', enabled: true, welcomeMessage: 'Hi', welcomeMessageAr: 'مرحبا', maxTurns: 4 };

function makeService(opts: {
  screen?: Record<string, unknown> | null;
  hasModule?: boolean;
  screenRequestsToday?: number;
  tenantRequestsToday?: number;
} = {}) {
  const screenRow = opts.screen === null ? null : {
    id: 's1',
    organizationId: 'org_1',
    streamingType: 'WAYFINDING',
    wayfindingAiConfig: AI_CONFIG,
    kioskLocation: { floor: { building: { id: 'building_1' } } },
    ...opts.screen,
  };

  const prisma = {
    screen: {
      findUnique: jest.fn().mockResolvedValue(screenRow),
      findFirst: jest.fn().mockResolvedValue(screenRow),
      findMany: jest.fn().mockResolvedValue([]),
    },
    building: { findFirst: jest.fn().mockResolvedValue({ id: 'building_1', organizationId: 'org_1' }) },
    poi: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: 'poi_1' }),
    },
    poiAlias: {
      create: jest.fn().mockResolvedValue({ id: 'alias_1', value: 'food court', normalizedValue: 'food court', language: 'en' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'alias_1' }),
      delete: jest.fn(),
    },
    wayfindingAiScreenConfig: { upsert: jest.fn().mockResolvedValue(AI_CONFIG) },
  } as unknown as PrismaService;

  const orgScoped = new OrgScopedService();
  const gateway = { sendToScreen: jest.fn() } as unknown as ScreenGateway;
  const audit = { log: jest.fn() } as unknown as AuditService;
  const entitlements = { hasModule: jest.fn().mockResolvedValue(opts.hasModule ?? true) } as unknown as EntitlementsService;
  const resolver = {
    resolve: jest.fn().mockResolvedValue({
      resolution: { type: 'NO_MATCH', message: 'none' },
      outcome: 'NO_MATCH',
      usedModel: true,
      inputTokens: 1,
      outputTokens: 1,
      resolvedPoiId: null,
    }),
    normalize: jest.fn((value: string) => value.trim().toLowerCase()),
  } as unknown as DestinationResolverService;
  const usage = {
    record: jest.fn(),
    screenRequestsToday: jest.fn().mockResolvedValue(opts.screenRequestsToday ?? 0),
    tenantRequestsToday: jest.fn().mockResolvedValue(opts.tenantRequestsToday ?? 0),
    query: jest.fn().mockResolvedValue([]),
  } as unknown as WayfindingAiUsageService;

  return {
    service: new WayfindingAiService(prisma, orgScoped, gateway, audit, entitlements, resolver, usage),
    prisma, gateway, audit, entitlements, resolver, usage,
  };
}

describe('WayfindingAiService.resolveForPlayer', () => {
  it('rejects with a generic error when the screen has no organization', async () => {
    const { service } = makeService({ screen: { organizationId: null } });
    await expect(service.resolveForPlayer('s1', { message: 'x', language: 'en' })).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the screen is not a configured Wayfinding kiosk', async () => {
    const { service } = makeService({ screen: { streamingType: 'PLAYLIST' } });
    await expect(service.resolveForPlayer('s1', { message: 'x', language: 'en' })).rejects.toThrow(ForbiddenException);
  });

  it('rejects when no WayfindingAiScreenConfig row exists', async () => {
    const { service } = makeService({ screen: { wayfindingAiConfig: null } });
    await expect(service.resolveForPlayer('s1', { message: 'x', language: 'en' })).rejects.toThrow(ForbiddenException);
  });

  it('rejects when the administrator has not enabled AI for this screen', async () => {
    const { service } = makeService({ screen: { wayfindingAiConfig: { ...AI_CONFIG, enabled: false } } });
    await expect(service.resolveForPlayer('s1', { message: 'x', language: 'en' })).rejects.toThrow(ForbiddenException);
  });

  it('re-checks entitlement live and rejects generically when unentitled, without logging usage', async () => {
    const { service, entitlements, usage } = makeService({ hasModule: false });

    await expect(service.resolveForPlayer('s1', { message: 'x', language: 'en' })).rejects.toThrow(ForbiddenException);

    expect(entitlements.hasModule).toHaveBeenCalledWith('org_1', 'WAYFINDING_AI');
    expect(usage.record).not.toHaveBeenCalled();
  });

  it('rejects and records RATE_LIMITED when the per-screen daily quota is exhausted', async () => {
    const { service, usage, resolver } = makeService({ screenRequestsToday: 200 });

    await expect(service.resolveForPlayer('s1', { message: 'x', language: 'en' })).rejects.toThrow(ForbiddenException);

    expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'RATE_LIMITED' }));
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('rejects and records QUOTA_EXCEEDED when the per-tenant daily quota is exhausted', async () => {
    const { service, usage } = makeService({ tenantRequestsToday: 2000 });

    await expect(service.resolveForPlayer('s1', { message: 'x', language: 'en' })).rejects.toThrow(ForbiddenException);

    expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'QUOTA_EXCEEDED' }));
  });

  it('resolves successfully, caps recentTurns to the screen maxTurns, and records usage', async () => {
    const { service, resolver, usage } = makeService();
    const recentTurns = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, text: `turn ${i}` }));

    const result = await service.resolveForPlayer('s1', { message: 'find coffee', language: 'en', recentTurns });

    expect(result).toEqual({ type: 'NO_MATCH', message: 'none' });
    expect(resolver.resolve).toHaveBeenCalledWith(expect.objectContaining({
      message: 'find coffee',
      recentTurns: recentTurns.slice(-4), // AI_CONFIG.maxTurns
    }));
    expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org_1', screenId: 's1', outcome: 'NO_MATCH', usedModel: true,
    }));
  });
});

describe('WayfindingAiService dashboard operations', () => {
  it('updateScreenConfig upserts, audits, and reloads the screen', async () => {
    const { service, prisma, audit, gateway } = makeService();

    await service.updateScreenConfig('org_1', 's1', AI_CONFIG, 'user_1');

    expect(prisma.wayfindingAiScreenConfig.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { screenId: 's1' } }));
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'wayfindingAi.config.update', organizationId: 'org_1' }));
    expect(gateway.sendToScreen).toHaveBeenCalledWith('s1', { type: 'reload' });
  });

  it('rejects an eligible-screen lookup for a screen belonging to another organization', async () => {
    const { service, prisma } = makeService();
    (prisma.screen.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.getScreenConfig('org_2', 's1')).rejects.toThrow(NotFoundException);
  });

  it('testResolve loads the building org-scoped and never writes to the usage log', async () => {
    const { service, resolver, usage } = makeService();

    const result = await service.testResolve('org_1', 'building_1', 'coffee', 'en');

    expect(result).toEqual({ type: 'NO_MATCH', message: 'none' });
    expect(resolver.resolve).toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
  });

  it('testResolve rejects a building belonging to another organization', async () => {
    const { service, prisma } = makeService();
    (prisma.building.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.testResolve('org_1', 'building_x', 'coffee', 'en')).rejects.toThrow(NotFoundException);
  });

  it('addAlias normalizes the value and rejects a POI from another organization', async () => {
    const { service, prisma } = makeService();

    await service.addAlias('org_1', 'poi_1', 'Food Court', 'en');

    expect(prisma.poiAlias.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ value: 'Food Court', normalizedValue: 'food court', language: 'en' }),
    }));

    (prisma.poi.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.addAlias('org_2', 'poi_1', 'x', 'en')).rejects.toThrow(NotFoundException);
  });

  it('removeAlias rejects an alias belonging to another organization', async () => {
    const { service, prisma } = makeService();
    (prisma.poiAlias.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(service.removeAlias('org_2', 'alias_1')).rejects.toThrow(NotFoundException);
  });
});
