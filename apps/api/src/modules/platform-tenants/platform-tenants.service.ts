import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { OrganizationStatus } from '@lumina/types';
import type { Prisma, UserRole } from '@lumina/db';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAuditService } from '../platform-audit/platform-audit.service';
import { EntitlementsService, type ModuleAssignmentInput } from '../entitlements/entitlements.service';
import { OrgService } from '../org/org.service';
import { ScreenGateway } from '../ws/screen.gateway';
import { normalizeEmail } from '../../common/normalize-email';

interface CreateTenantInput {
  name: string;
  slug: string;
  ownerEmail: string;
  modules: ModuleAssignmentInput[];
}

// P6b (docs/tenant_isolation_and_platform_admin_plan.md §"Tenant list") — server-side pagination,
// search, sort, and filters, so the list scales past a handful of tenants without shipping every
// row to the browser.
export interface TenantListOptions {
  search?: string;
  status?: OrganizationStatus;
  moduleKey?: string;
  sortBy?: 'name' | 'createdAt' | 'status';
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
// A module expiring within this window surfaces as an alert/warning on the tenant list and
// detail page, giving the Super Admin advance notice before a TRIAL/licensed module silently
// lapses (EntitlementsService itself only reacts once `expiresAt` has actually passed).
const MODULE_EXPIRY_WARNING_DAYS = 14;

interface TenantUsageSummary {
  members: { active: number; pendingInvites: number };
  owner: { id: string; name: string; email: string } | null;
  pendingOwnerInvite: boolean;
  screens: { total: number; online: number; offline: number };
  storage: { assetsCount: number; bytes: number };
  content: { playlists: number; designs: number; rooms: number; buildings: number };
  lastUserActivityAt: Date | null;
  lastScreenHeartbeatAt: Date | null;
}

// Every mutating method below takes this optional, purely-for-audit context — never used for
// authorization (SuperAdminGuard already ran) — so PlatformAuditLog's ipAddress/userAgent columns
// (P6a §P6a "Platform audit") are populated the same way for every action in this service instead
// of some rows having them and others not depending on which method happened to remember to.
export interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly entitlements: EntitlementsService,
    private readonly org: OrgService,
    private readonly gateway: ScreenGateway,
  ) {}

  // P6b (docs/tenant_isolation_and_platform_admin_plan.md §"Tenant list") — every usage metric
  // below is computed with one grouped aggregate query across the given org ids, never a
  // per-tenant loop, so the list scales with page size, not fleet size. Shared by `list` (one page
  // of tenants) and `detail` (a single tenant, as a one-element id list) so both read the exact
  // same definitions instead of two independently-drifting implementations.
  private async computeUsageSummaries(orgIds: string[]): Promise<Map<string, TenantUsageSummary>> {
    const summaries = new Map<string, TenantUsageSummary>();
    if (orgIds.length === 0) return summaries;
    const where = { organizationId: { in: orgIds } };

    const [screensByStatus, screenHeartbeat, owners, pendingInvites, pendingOwnerInvites, assetAgg, playlistCounts, designCounts, roomCounts, buildingCounts, lastActivity] =
      await Promise.all([
        this.prisma.screen.groupBy({ by: ['organizationId', 'status'], where, _count: true }),
        this.prisma.screen.groupBy({ by: ['organizationId'], where, _max: { lastSeenAt: true } }),
        // `role: 'OWNER'` isn't unique (a transfer briefly leaves two, P6a) — ordered ascending so
        // the first row seen per org below is the longest-standing owner, matching the single-
        // tenant `detail()` lookup this replaces.
        this.prisma.user.findMany({
          where: { organizationId: { in: orgIds }, role: 'OWNER' },
          select: { id: true, name: true, email: true, organizationId: true },
          orderBy: { createdAt: 'asc' },
        }),
        this.prisma.orgInvite.groupBy({ by: ['organizationId'], where: { ...where, acceptedAt: null, expiresAt: { gt: new Date() } }, _count: true }),
        this.prisma.orgInvite.findMany({
          where: { organizationId: { in: orgIds }, role: 'OWNER', acceptedAt: null, expiresAt: { gt: new Date() } },
          select: { organizationId: true },
        }),
        this.prisma.asset.groupBy({ by: ['organizationId'], where, _count: true, _sum: { sizeBytes: true } }),
        this.prisma.playlist.groupBy({ by: ['organizationId'], where, _count: true }),
        this.prisma.designAsset.groupBy({ by: ['organizationId'], where: { ...where, deletedAt: null }, _count: true }),
        this.prisma.bookableRoom.groupBy({ by: ['organizationId'], where, _count: true }),
        this.prisma.building.groupBy({ by: ['organizationId'], where, _count: true }),
        this.prisma.auditLog.groupBy({ by: ['organizationId'], where, _max: { createdAt: true } }),
      ]);

    const ownerByOrg = new Map<string, { id: string; name: string; email: string }>();
    for (const o of owners) if (!ownerByOrg.has(o.organizationId)) ownerByOrg.set(o.organizationId, { id: o.id, name: o.name, email: o.email });
    const pendingOwnerOrgIds = new Set(pendingOwnerInvites.map((i) => i.organizationId));
    const screensByOrg = new Map<string, { total: number; online: number; offline: number }>();
    for (const row of screensByStatus) {
      const cur = screensByOrg.get(row.organizationId) ?? { total: 0, online: 0, offline: 0 };
      cur.total += row._count;
      if (row.status === 'ONLINE') cur.online = row._count;
      else cur.offline = row._count;
      screensByOrg.set(row.organizationId, cur);
    }
    const heartbeatByOrg = new Map(screenHeartbeat.map((r) => [r.organizationId, r._max.lastSeenAt]));
    const pendingInvitesByOrg = new Map(pendingInvites.map((r) => [r.organizationId, r._count]));
    const assetByOrg = new Map(assetAgg.map((r) => [r.organizationId, { count: r._count, bytes: Number(r._sum.sizeBytes ?? 0) }]));
    const playlistByOrg = new Map(playlistCounts.map((r) => [r.organizationId, r._count]));
    const designByOrg = new Map(designCounts.map((r) => [r.organizationId, r._count]));
    const roomByOrg = new Map(roomCounts.map((r) => [r.organizationId, r._count]));
    const buildingByOrg = new Map(buildingCounts.map((r) => [r.organizationId, r._count]));
    const lastActivityByOrg = new Map(lastActivity.map((r) => [r.organizationId, r._max.createdAt]));

    for (const orgId of orgIds) {
      summaries.set(orgId, {
        members: { active: 0, pendingInvites: pendingInvitesByOrg.get(orgId) ?? 0 },
        owner: ownerByOrg.get(orgId) ?? null,
        pendingOwnerInvite: pendingOwnerOrgIds.has(orgId),
        screens: screensByOrg.get(orgId) ?? { total: 0, online: 0, offline: 0 },
        storage: { assetsCount: assetByOrg.get(orgId)?.count ?? 0, bytes: assetByOrg.get(orgId)?.bytes ?? 0 },
        content: {
          playlists: playlistByOrg.get(orgId) ?? 0,
          designs: designByOrg.get(orgId) ?? 0,
          rooms: roomByOrg.get(orgId) ?? 0,
          buildings: buildingByOrg.get(orgId) ?? 0,
        },
        lastUserActivityAt: lastActivityByOrg.get(orgId) ?? null,
        lastScreenHeartbeatAt: heartbeatByOrg.get(orgId) ?? null,
      });
    }

    // Active-member counts come from a separate groupBy (not folded into Promise.all above)
    // because it has no `where` filter in common with the others — every org in `orgIds` gets a
    // count here, whereas the calls above only ever needed a WHERE org IN (...).
    const memberCounts = await this.prisma.user.groupBy({ by: ['organizationId'], where, _count: true });
    for (const row of memberCounts) {
      const s = summaries.get(row.organizationId);
      if (s) s.members.active = row._count;
    }

    return summaries;
  }

  private moduleExpiryWarnings(modules: { key: string; status: string; expiresAt: Date | string | null }[]): string[] {
    const warnAfter = Date.now() + MODULE_EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
    return modules
      .filter((m) => {
        if (m.status === 'DISABLED' || !m.expiresAt) return false;
        const expiresAtMs = new Date(m.expiresAt).getTime();
        return expiresAtMs <= warnAfter && expiresAtMs > Date.now();
      })
      .map((m) => m.key);
  }

  private tenantAlerts(status: OrganizationStatus, summary: TenantUsageSummary, expiringModules: string[]): string[] {
    const alerts: string[] = [];
    if (status === 'SUSPENDED') alerts.push('SUSPENDED');
    if (!summary.owner && !summary.pendingOwnerInvite) alerts.push('NO_OWNER');
    if (expiringModules.length > 0) alerts.push('MODULE_EXPIRING_SOON');
    // Fleet fully dark, not just one offline screen among many — a single unplugged display isn't
    // worth surfacing at the tenant-list level, an entirely unreachable fleet is.
    if (summary.screens.total > 0 && summary.screens.online === 0) alerts.push('SCREENS_OFFLINE');
    return alerts;
  }

  // P6b §"Tenant list" — server-side pagination/search/sort/filters plus the per-tenant summary
  // columns the plan calls for, all computed via computeUsageSummaries above rather than N+1
  // per-tenant queries.
  async list(opts: TenantListOptions = {}) {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));
    const where: Prisma.OrganizationWhereInput = {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.search?.trim() ? { OR: [{ name: { contains: opts.search.trim(), mode: 'insensitive' } }, { slug: { contains: opts.search.trim(), mode: 'insensitive' } }] } : {}),
      ...(opts.moduleKey ? { tenantModules: { some: { moduleKey: opts.moduleKey, status: { not: 'DISABLED' } } } } : {}),
    };
    const sortBy = opts.sortBy ?? 'name';
    const sortDir = opts.sortDir ?? 'asc';

    const [total, orgs] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({
        where,
        include: { tenantModules: true },
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const summaries = await this.computeUsageSummaries(orgs.map((o) => o.id));

    const items = orgs.map((org) => {
      const summary = summaries.get(org.id)!;
      const modules = org.tenantModules.map((m) => ({ key: m.moduleKey, status: m.status, expiresAt: m.expiresAt }));
      const expiringModules = this.moduleExpiryWarnings(modules);
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        status: org.status,
        createdAt: org.createdAt,
        modules,
        expiringModules,
        usage: summary,
        alerts: this.tenantAlerts(org.status, summary, expiringModules),
      };
    });

    return { items, total, page, pageSize };
  }

  async detail(tenantId: string) {
    const org = await this.assertExists(tenantId);
    const capabilities = await this.entitlements.getCapabilities(tenantId);
    const summaries = await this.computeUsageSummaries([tenantId]);
    const usage = summaries.get(tenantId)!;
    const expiringModules = this.moduleExpiryWarnings(capabilities.modules);

    // P6b §"Operational tenant detail" #2 ("Screens") — full per-screen operational state, not
    // just the aggregate counts `usage.screens` already carries.
    const screens = await this.prisma.screen.findMany({
      where: { organizationId: tenantId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        status: true,
        lastSeenAt: true,
        syncState: true,
        assetsTotal: true,
        assetsReady: true,
        assetsFailed: true,
        cacheBytes: true,
        freeStorageBytes: true,
        storagePersistent: true,
        streamingType: true,
        paired: true,
      },
    });

    // P6b §"Operational tenant detail" #3 ("Content & storage") — counts/bytes by asset type;
    // `usage.storage`/`usage.content` above already carry the cross-type totals shared with the
    // list view, this adds the per-type breakdown that's only worth computing for one tenant.
    const assetsByType = await this.prisma.asset.groupBy({
      by: ['type'],
      where: { organizationId: tenantId },
      _count: true,
      _sum: { sizeBytes: true },
    });

    // P6b §"Operational tenant detail" #4 ("Modules: ... usage counters") — how many of this
    // tenant's screens actually exercise each player-facing module today, alongside P6a's existing
    // entitlement controls. Screen.streamingType/wayfindingAiConfig are the same fields
    // PlatformTenantsService.setModules already reads to decide which screens to reload on an
    // entitlement change (see above) — reused here rather than re-deriving "which screens use
    // module X" a second way.
    const [wayfindingScreens, wayfindingAiScreens, roomBookingScreens] = await Promise.all([
      this.prisma.screen.count({ where: { organizationId: tenantId, streamingType: 'WAYFINDING' } }),
      this.prisma.screen.count({ where: { organizationId: tenantId, streamingType: 'WAYFINDING', wayfindingAiConfig: { isNot: null } } }),
      this.prisma.screen.count({ where: { organizationId: tenantId, streamingType: 'ROOM_BOOKING' } }),
    ]);

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      suspensionReason: org.suspensionReason,
      createdAt: org.createdAt,
      owner: usage.owner,
      capabilities,
      usage,
      expiringModules,
      alerts: this.tenantAlerts(org.status, usage, expiringModules),
      screens,
      content: {
        byAssetType: assetsByType.map((r) => ({ type: r.type, count: r._count, bytes: Number(r._sum.sizeBytes ?? 0) })),
      },
      moduleUsage: { WAYFINDING: wayfindingScreens, WAYFINDING_AI: wayfindingAiScreens, ROOM_BOOKING: roomBookingScreens },
    };
  }

  // Atomic per Section 6.2 of the ADR: slug validation, Organization creation, and module
  // assignment all happen inside one transaction — dependency validation runs before any of it,
  // so a bad module set never leaves a half-created Organization behind. The owner invite and
  // audit write happen after commit, matching how AuditService.log() already documents itself as
  // best-effort (a broken audit write must never fail the request that triggered it).
  async create(input: CreateTenantInput, actorUserId: string, ctx: AuditContext = {}) {
    const slug = normalizeSlug(input.slug);

    const existing = await this.prisma.organization.findUnique({ where: { slug } });
    if (existing) throw new ConflictException('Slug already in use');

    // P6a gap #10 — checked before creating anything: an owner email already registered to some
    // account (any tenant — User.email is globally unique) would otherwise only surface as a
    // confusing "Email already in use" failure days later when that person tries to accept the
    // invite, by which point the Organization/modules/invite already exist half-provisioned.
    const normalizedOwnerEmail = normalizeEmail(input.ownerEmail);
    const existingOwner = await this.prisma.user.findUnique({ where: { email: normalizedOwnerEmail } });
    if (existingOwner) throw new ConflictException('That email is already registered to an existing account');

    this.entitlements.validateDependencies(input.modules);

    const org = await this.prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({ data: { name: input.name, slug, status: 'ACTIVE' } });

      for (const assignment of input.modules) {
        await tx.tenantModule.create({
          data: {
            organizationId: created.id,
            moduleKey: assignment.key,
            status: assignment.status,
            expiresAt: assignment.expiresAt ?? null,
          },
        });
      }

      return created;
    });

    const invite = await this.org.createOwnerInvite(org.id, input.ownerEmail);

    await this.audit.log({
      targetOrganizationId: org.id,
      actorUserId,
      action: 'tenant.create',
      resourceType: 'Organization',
      resourceId: org.id,
      metadata: { name: org.name, slug: org.slug, modules: input.modules.map((m) => m.key) },
      ...ctx,
    });

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      ownerInvite: { email: invite.email, token: invite.token, expiresAt: invite.expiresAt },
    };
  }

  async updateStatus(tenantId: string, status: OrganizationStatus, actorUserId: string, reason?: string, ctx: AuditContext = {}) {
    const org = await this.assertExists(tenantId);

    // P6a §"Safe administrative actions" — "suspend/reactivate with a required reason".
    // Reactivating clears any prior reason rather than leaving a stale one from the last
    // suspension sitting on the tenant.
    if (status === 'SUSPENDED' && !reason?.trim()) {
      throw new BadRequestException('A reason is required to suspend a tenant');
    }

    const updated = await this.prisma.organization.update({
      where: { id: tenantId },
      data: { status, suspensionReason: status === 'SUSPENDED' ? reason!.trim() : null },
    });

    await this.audit.log({
      targetOrganizationId: tenantId,
      actorUserId,
      action: 'tenant.status.update',
      resourceType: 'Organization',
      resourceId: tenantId,
      metadata: { previousStatus: org.status, newStatus: status },
      reason: status === 'SUSPENDED' ? reason?.trim() : undefined,
      ...ctx,
    });

    // Kicks every dashboard socket in the tenant immediately rather than waiting for
    // TenantStatusGuard to catch their next REST call — never reaches a player/screen socket
    // (only dashboards join `org:${orgId}`, see ScreenGateway), so a suspended tenant's paired
    // screens keep playing (including any active emergency playlist) exactly as before.
    if (status === 'SUSPENDED') {
      await this.gateway.disconnectOrg(tenantId);
    }

    return updated;
  }

  // Dependency/expiry validation and per-module audit entries all happen inside
  // EntitlementsService.setTenantModules — nothing to duplicate here beyond confirming the
  // target tenant is real (Section 9.2: every target tenant id is loaded and validated
  // explicitly, never substituted with the Super Admin's own orgId).
  async setModules(tenantId: string, assignments: ModuleAssignmentInput[], actorUserId: string, ctx: AuditContext = {}) {
    await this.assertExists(tenantId);
    const result = await this.entitlements.setTenantModules(tenantId, assignments, actorUserId, ctx);

    // §8.4 of the ADR: a WAYFINDING change must reach already-connected kiosks promptly rather
    // than waiting for their next unrelated poll. No org-wide WS room includes players today
    // (see ScreenGateway) — only dashboards join `org:${orgId}` — so this is a fan-out loop over
    // the org's WAYFINDING-mode screens, the same pattern BuildingsService.setEvacuation already
    // uses. `reload` makes the player re-fetch state, which now naturally reflects the new
    // entitlement (PlayerService.getState() resolves it live) — no second notification mechanism.
    if (assignments.some((a) => a.key === 'WAYFINDING')) {
      const screens = await this.prisma.screen.findMany({
        where: { organizationId: tenantId, streamingType: 'WAYFINDING' },
        select: { id: true },
      });
      for (const screen of screens) {
        this.gateway.sendToScreen(screen.id, { type: 'reload' });
      }
    }

    // docs/modules/ai_wayfinding_module_plan.md §10 — same pattern as the WAYFINDING case above,
    // scoped to screens actually configured for AI (a WayfindingAiScreenConfig row exists)
    // rather than every WAYFINDING-mode screen in the org, since an entitlement change is only
    // player-visible on a kiosk an administrator already opted into the assistant.
    if (assignments.some((a) => a.key === 'WAYFINDING_AI')) {
      const screens = await this.prisma.screen.findMany({
        where: { organizationId: tenantId, streamingType: 'WAYFINDING', wayfindingAiConfig: { isNot: null } },
        select: { id: true },
      });
      for (const screen of screens) {
        this.gateway.sendToScreen(screen.id, { type: 'reload' });
      }
    }

    // docs/modules/room_booking_module_plan.md §12 — reload every screen currently in
    // ROOM_BOOKING mode, same pattern as the WAYFINDING case above. Unlike the AI case, this
    // isn't further scoped to "has a display binding" — an entitlement change is what makes the
    // mode itself renderable/not, so even an unbound ROOM_BOOKING screen (showing the neutral
    // "no binding" state) should re-fetch and reflect the new entitlement immediately.
    if (assignments.some((a) => a.key === 'ROOM_BOOKING')) {
      const screens = await this.prisma.screen.findMany({
        where: { organizationId: tenantId, streamingType: 'ROOM_BOOKING' },
        select: { id: true },
      });
      for (const screen of screens) {
        this.gateway.sendToScreen(screen.id, { type: 'reload' });
      }
    }

    return result;
  }

  async reissueOwnerInvite(tenantId: string, email: string, actorUserId: string, ctx: AuditContext = {}) {
    await this.assertExists(tenantId);
    const invite = await this.org.createOwnerInvite(tenantId, email);

    await this.audit.log({
      targetOrganizationId: tenantId,
      actorUserId,
      action: 'tenant.owner_invite.create',
      resourceType: 'OrgInvite',
      resourceId: invite.id,
      metadata: { email: invite.email },
      ...ctx,
    });

    return { email: invite.email, token: invite.token, expiresAt: invite.expiresAt };
  }

  // P6a gap #9 — a Super Admin revoking a pending owner invite for an arbitrary tenant.
  // OrgService.revokeInvite already takes orgId as a parameter (it's not hardcoded to the
  // caller's own org, just always called with one via OrgController's self-service routes today),
  // so this is a thin wrapper adding the platform-audit write, not new business logic.
  async revokeOwnerInvite(tenantId: string, inviteId: string, actorUserId: string, ctx: AuditContext = {}) {
    await this.assertExists(tenantId);
    await this.org.revokeInvite(tenantId, inviteId);
    await this.audit.log({
      targetOrganizationId: tenantId,
      actorUserId,
      action: 'tenant.owner_invite.revoke',
      resourceType: 'OrgInvite',
      resourceId: inviteId,
      ...ctx,
    });
  }

  // P6a gap #7 — tenant display-name edit. Deliberately separate from the slug (gap #8, not
  // implemented this pass — see docs/tenant-isolation/README.md): the plan calls out a slug
  // change as needing a "high-friction migration flow" since URLs/storage keys may depend on it,
  // while the display name has no such dependency anywhere in the codebase (grepped: nothing
  // derives a storage key, route, or lookup from Organization.name).
  async updateName(tenantId: string, name: string, actorUserId: string, ctx: AuditContext = {}) {
    const org = await this.assertExists(tenantId);
    const updated = await this.prisma.organization.update({ where: { id: tenantId }, data: { name } });
    await this.audit.log({
      targetOrganizationId: tenantId,
      actorUserId,
      action: 'tenant.name.update',
      resourceType: 'Organization',
      resourceId: tenantId,
      metadata: { previousName: org.name, newName: name },
      ...ctx,
    });
    return updated;
  }

  // P6a §"Minimum tenant detail" task 2 ("Users & invites") — OrgService's member/invite methods
  // already take orgId as a parameter rather than assuming the caller's own org (OrgController's
  // self-service routes just always pass user.orgId today), so every method below is a thin
  // wrapper: confirm the target tenant is real, delegate, and add the platform-audit write the
  // self-service versions don't have (they're not Super-Admin actions, so they don't need one).

  async listMembers(tenantId: string) {
    await this.assertExists(tenantId);
    return this.org.listMembers(tenantId);
  }

  async listInvites(tenantId: string) {
    await this.assertExists(tenantId);
    return this.org.listInvites(tenantId);
  }

  // Covers both an ordinary role change and an OWNER-authority transfer (plan §"Safe
  // administrative actions": "transfer OWNER authority while guaranteeing at least one owner") —
  // OrgService.updateMemberRole's existing assertNotLastOwner guard already makes a transfer safe
  // as two calls (promote the new owner, then demote the old one): promoting is unrestricted, and
  // demoting only succeeds once another OWNER — the one just promoted — already exists. No
  // separate "transfer" method or endpoint is needed.
  async updateMemberRole(tenantId: string, memberId: string, role: UserRole, actorUserId: string, ctx: AuditContext = {}) {
    await this.assertExists(tenantId);
    const updated = await this.org.updateMemberRole(tenantId, memberId, role);
    await this.audit.log({
      targetOrganizationId: tenantId,
      actorUserId,
      action: 'tenant.member.role_update',
      resourceType: 'User',
      resourceId: memberId,
      metadata: { newRole: role },
      ...ctx,
    });
    return updated;
  }

  // "Disable/remove a member while preserving attributed audit history" — this reuses
  // OrgService.removeMember's existing hard-delete (with its assertNotLastOwner guard), which
  // already preserves audit history the same way every other actor-deletion in this schema does:
  // AuditLog.userId is SetNull, not Cascade, so the tenant's own audit rows survive the user's
  // removal. A distinct non-deleting "disabled" User state is not implemented this pass — see
  // docs/tenant-isolation/README.md.
  async removeMember(tenantId: string, memberId: string, actorUserId: string, ctx: AuditContext = {}) {
    await this.assertExists(tenantId);
    await this.org.removeMember(tenantId, memberId, actorUserId);
    await this.audit.log({
      targetOrganizationId: tenantId,
      actorUserId,
      action: 'tenant.member.remove',
      resourceType: 'User',
      resourceId: memberId,
      ...ctx,
    });
  }

  // P6a §"Safe administrative actions" — "revoke one user's ... sessions", independent of any
  // role change or removal.
  async revokeMemberSessions(tenantId: string, memberId: string, actorUserId: string, ctx: AuditContext = {}) {
    await this.assertExists(tenantId);
    const result = await this.org.revokeMemberSessions(tenantId, memberId);
    await this.audit.log({
      targetOrganizationId: tenantId,
      actorUserId,
      action: 'tenant.member.revoke_sessions',
      resourceType: 'User',
      resourceId: memberId,
      ...ctx,
    });
    return result;
  }

  // P6a §"Safe administrative actions" — "... or all tenant user sessions".
  async revokeAllSessions(tenantId: string, actorUserId: string, ctx: AuditContext = {}) {
    await this.assertExists(tenantId);
    const result = await this.org.revokeAllSessions(tenantId);
    await this.audit.log({
      targetOrganizationId: tenantId,
      actorUserId,
      action: 'tenant.revoke_all_sessions',
      resourceType: 'Organization',
      resourceId: tenantId,
      metadata: { revokedCount: result.revokedCount },
      ...ctx,
    });
    return result;
  }

  // P6a §"Minimum tenant detail" task 4 ("Audit: platform actions targeting the tenant") — the
  // read side platform actions have been written to since P3/P5a but nothing ever queried back
  // until now. Actor is included (name/email) so the dashboard doesn't need a second lookup per
  // row; deliberately not exposing the actor's own organizationId here (a platform actor's own
  // tenant membership is Super-Admin-internal, not this tenant's business).
  // P6b §"Operational tenant detail" #5 ("Audit and activity: filterable ... with server-side
  // pagination") — page/pageSize replace the old flat `limit`; `action` narrows by a
  // case-insensitive substring match against the dot-namespaced action string (e.g.
  // "tenant.member" matches every member-related action) so the Super Admin can filter without
  // needing to know the exact action name.
  async listAuditLog(tenantId: string, opts: { page?: number; pageSize?: number; action?: string } = {}) {
    await this.assertExists(tenantId);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? DEFAULT_PAGE_SIZE));
    const where: Prisma.PlatformAuditLogWhereInput = {
      targetOrganizationId: tenantId,
      ...(opts.action?.trim() ? { action: { contains: opts.action.trim(), mode: 'insensitive' } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.platformAuditLog.count({ where }),
      this.prisma.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    return { items, total, page, pageSize };
  }

  private async assertExists(tenantId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: tenantId } });
    if (!org) throw new NotFoundException('Tenant not found');
    return org;
  }
}
