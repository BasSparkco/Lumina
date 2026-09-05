import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import type { WayfindingAiDestination, WayfindingAiLanguage } from '@lumina/types';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import { ScreenGateway } from '../ws/screen.gateway';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { DestinationResolverService } from './destination-resolver.service';
import { WayfindingAiUsageService } from './wayfinding-ai-usage.service';
import type { UpdateWayfindingAiScreenConfigDto } from './dto/update-wayfinding-ai-screen-config.dto';

export interface PlayerResolveInput {
  message: string;
  language: WayfindingAiLanguage;
  recentTurns?: { role: 'user' | 'assistant'; text: string }[];
}

// Generic on purpose (§7.2): never reveals whether the failure was licensing, configuration, or
// a provider outage, so this endpoint can't be used to probe another tenant's entitlement state
// or a screen's configuration.
class AiUnavailableException extends ForbiddenException {
  constructor() {
    super('AI Wayfinding is not available for this request');
  }
}

@Injectable()
export class WayfindingAiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orgScoped: OrgScopedService,
    private readonly gateway: ScreenGateway,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly resolver: DestinationResolverService,
    private readonly usage: WayfindingAiUsageService,
  ) {}

  // ── Dashboard ────────────────────────────────────────────────────────────

  async listEligibleScreens(orgId: string) {
    return this.prisma.screen.findMany({
      where: { organizationId: orgId, streamingType: 'WAYFINDING', kioskLocation: { isNot: null } },
      select: {
        id: true,
        name: true,
        wayfindingAiConfig: true,
        kioskLocation: { select: { floor: { select: { building: { select: { id: true, name: true } } } } } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async getScreenConfig(orgId: string, screenId: string) {
    const screen = await this.assertEligibleScreen(orgId, screenId);
    return screen.wayfindingAiConfig;
  }

  async updateScreenConfig(orgId: string, screenId: string, dto: UpdateWayfindingAiScreenConfigDto, actorUserId: string) {
    const screen = await this.assertEligibleScreen(orgId, screenId);
    const previous = screen.wayfindingAiConfig;

    const config = await this.prisma.wayfindingAiScreenConfig.upsert({
      where: { screenId },
      create: {
        screenId,
        enabled: dto.enabled,
        welcomeMessage: dto.welcomeMessage,
        welcomeMessageAr: dto.welcomeMessageAr,
        maxTurns: dto.maxTurns,
      },
      update: {
        enabled: dto.enabled,
        welcomeMessage: dto.welcomeMessage,
        welcomeMessageAr: dto.welcomeMessageAr,
        maxTurns: dto.maxTurns,
      },
    });

    await this.audit.log({
      organizationId: orgId,
      userId: actorUserId,
      action: 'wayfindingAi.config.update',
      resourceType: 'WayfindingAiScreenConfig',
      resourceId: config.id,
      metadata: { screenId, previousEnabled: previous?.enabled ?? null, newEnabled: dto.enabled },
    });

    // §9.1/§10 — an entitlement or config change must reach an already-connected kiosk promptly,
    // same reload-fan-out pattern PoisService/PlatformTenantsService already use.
    this.gateway.sendToScreen(screenId, { type: 'reload' });

    return config;
  }

  // §8.2 "Destination aliases — edit aliases within the existing POI ownership boundary." Not
  // one of §7.1's listed dashboard endpoints, but the plan's dashboard section requires it, so
  // it lives here (WAYFINDING_AI-gated) rather than extending the ordinary Wayfinding POI
  // endpoints, which stay entitlement-free for WAYFINDING itself.
  async listPoisWithAliases(orgId: string, buildingId: string) {
    await this.orgScoped.assertOwns(
      () => this.prisma.building.findFirst({ where: { id: buildingId, organizationId: orgId } }),
      'Building not found',
    );
    return this.prisma.poi.findMany({
      where: { floor: { buildingId } },
      include: { aliases: true, floor: true },
      orderBy: { name: 'asc' },
    });
  }

  async addAlias(orgId: string, poiId: string, value: string, language: 'en' | 'ar') {
    const poi = await this.orgScoped.assertOwns(
      () => this.prisma.poi.findFirst({ where: { id: poiId, floor: { building: { organizationId: orgId } } } }),
      'POI not found',
    );
    const normalizedValue = this.resolver.normalize(value);
    try {
      return await this.prisma.poiAlias.create({
        data: { poiId: poi.id, value, normalizedValue, language },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException('This alias already exists for this POI and language');
      }
      throw err;
    }
  }

  async removeAlias(orgId: string, aliasId: string) {
    await this.orgScoped.assertOwns(
      () => this.prisma.poiAlias.findFirst({ where: { id: aliasId, poi: { floor: { building: { organizationId: orgId } } } } }),
      'Alias not found',
    );
    await this.prisma.poiAlias.delete({ where: { id: aliasId } });
  }

  async getUsage(orgId: string, opts: { from?: Date; to?: Date; screenId?: string }) {
    if (opts.screenId) await this.assertEligibleScreen(orgId, opts.screenId);
    return this.usage.query(orgId, opts);
  }

  // Dashboard-authenticated test console (§8.2/§7.1) — never a physical screen token, never
  // writes to WayfindingAiUsageLog (it changes no player state and burns no per-screen quota),
  // still subject to the same deterministic-first/provider-second resolution pipeline everyone
  // else uses so what an administrator sees here matches production behavior exactly.
  async testResolve(orgId: string, buildingId: string, message: string, language: WayfindingAiLanguage) {
    const building = await this.orgScoped.assertOwns(
      () => this.prisma.building.findFirst({ where: { id: buildingId, organizationId: orgId } }),
      'Building not found',
    );
    const destinations = await this.loadDestinationsForBuilding(building.id);
    const outcome = await this.resolver.resolve({ message, language, recentTurns: [], destinations });
    return outcome.resolution;
  }

  // ── Player ───────────────────────────────────────────────────────────────

  async resolveForPlayer(screenId: string, input: PlayerResolveInput) {
    const screen = await this.prisma.screen.findUnique({
      where: { id: screenId },
      include: {
        wayfindingAiConfig: true,
        kioskLocation: { include: { floor: { include: { building: true } } } },
      },
    });
    if (!screen?.organizationId) throw new AiUnavailableException();

    const configured = screen.streamingType === 'WAYFINDING' && !!screen.kioskLocation;
    const enabled = configured && screen.wayfindingAiConfig?.enabled === true;
    if (!enabled) throw new AiUnavailableException();

    // Live re-check on every call (§10) — never trusts a cached/JWT-encoded entitlement. This
    // single call also covers "tenant is ACTIVE" (EntitlementsService.hasModule short-circuits
    // false for a non-ACTIVE org) and the WAYFINDING_AI -> WAYFINDING dependency walk.
    const entitled = await this.entitlements.hasModule(screen.organizationId, 'WAYFINDING_AI');
    if (!entitled) throw new AiUnavailableException();

    const [screenCount, tenantCount] = await Promise.all([
      this.usage.screenRequestsToday(screenId),
      this.usage.tenantRequestsToday(screen.organizationId),
    ]);
    const screenLimit = Number(process.env.AI_WAYFINDING_DAILY_REQUEST_LIMIT_PER_SCREEN) || 200;
    const tenantLimit = Number(process.env.AI_WAYFINDING_DAILY_REQUEST_LIMIT_PER_TENANT) || 2000;
    if (screenCount >= screenLimit || tenantCount >= tenantLimit) {
      await this.usage.record({
        organizationId: screen.organizationId,
        screenId,
        language: input.language,
        outcome: screenCount >= screenLimit ? 'RATE_LIMITED' : 'QUOTA_EXCEEDED',
        provider: process.env.AI_WAYFINDING_PROVIDER ?? 'openai',
        model: process.env.AI_WAYFINDING_MODEL ?? 'unset',
        inputTokens: null,
        outputTokens: null,
        latencyMs: 0,
        usedModel: false,
        resolvedPoiId: null,
      });
      throw new AiUnavailableException();
    }

    const maxTurns = screen.wayfindingAiConfig!.maxTurns;
    const recentTurns = (input.recentTurns ?? []).slice(-maxTurns);
    const destinations = await this.loadDestinationsForBuilding(screen.kioskLocation!.floor.building.id);

    const startedAt = Date.now();
    const outcome = await this.resolver.resolve({
      message: input.message,
      language: input.language,
      recentTurns,
      destinations,
    });
    const latencyMs = Date.now() - startedAt;

    await this.usage.record({
      organizationId: screen.organizationId,
      screenId,
      language: input.language,
      outcome: outcome.outcome,
      provider: process.env.AI_WAYFINDING_PROVIDER ?? 'openai',
      model: process.env.AI_WAYFINDING_MODEL ?? 'unset',
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      latencyMs,
      usedModel: outcome.usedModel,
      resolvedPoiId: outcome.resolvedPoiId,
    });

    return outcome.resolution;
  }

  // ── Shared ───────────────────────────────────────────────────────────────

  private async assertEligibleScreen(orgId: string, screenId: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.screen.findFirst({
        where: { id: screenId, organizationId: orgId, streamingType: 'WAYFINDING', kioskLocation: { isNot: null } },
        include: { wayfindingAiConfig: true },
      }),
      'Eligible Wayfinding screen not found',
    );
  }

  // Only the destination fields the provider is allowed to see (§3.7/§7.3) — no coordinates, no
  // route geometry, no unrelated tenant data. Scoped to one building at a time.
  private async loadDestinationsForBuilding(buildingId: string): Promise<WayfindingAiDestination[]> {
    const pois = await this.prisma.poi.findMany({
      where: { floor: { buildingId } },
      include: { category: true, aliases: true, floor: true },
    });
    return pois.map((p) => ({
      id: p.id,
      name: p.name,
      nameAr: p.nameAr,
      aliases: p.aliases.map((a) => ({ value: a.value, language: a.language })),
      category: p.category.label,
      floorLabel: p.floor.label,
      status: p.status,
      description: p.description,
      descriptionAr: p.descriptionAr,
    }));
  }
}
