import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { OrganizationStatus } from '@lumina/types';
import type { UserRole } from '@lumina/db';
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

  async list() {
    const orgs = await this.prisma.organization.findMany({
      include: { tenantModules: true },
      orderBy: { name: 'asc' },
    });

    return orgs.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      createdAt: org.createdAt,
      modules: org.tenantModules.map((m) => ({ key: m.moduleKey, status: m.status, expiresAt: m.expiresAt })),
    }));
  }

  async detail(tenantId: string) {
    const org = await this.assertExists(tenantId);
    const capabilities = await this.entitlements.getCapabilities(tenantId);
    // P6a §"Minimum tenant detail" task 1 — owner identity. `role: 'OWNER'` isn't unique (P6a
    // explicitly allows a transfer to briefly leave two), so this reports the longest-standing one
    // (`createdAt asc`) as "the" owner shown on this page — a display convenience, not an
    // authorization decision (every actual owner action already loads the specific member by id).
    const owner = await this.prisma.user.findFirst({
      where: { organizationId: tenantId, role: 'OWNER' },
      select: { id: true, email: true, name: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      suspensionReason: org.suspensionReason,
      createdAt: org.createdAt,
      owner,
      capabilities,
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
  async listAuditLog(tenantId: string, limit = 100) {
    await this.assertExists(tenantId);
    return this.prisma.platformAuditLog.findMany({
      where: { targetOrganizationId: tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 200),
      include: { actor: { select: { id: true, name: true, email: true } } },
    });
  }

  private async assertExists(tenantId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: tenantId } });
    if (!org) throw new NotFoundException('Tenant not found');
    return org;
  }
}
