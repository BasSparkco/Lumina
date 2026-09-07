import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash } from 'bcryptjs';
import type { UserRole } from '@lumina/db';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgScopedService } from '../../common/org-scoped.service';
import { normalizeEmail } from '../../common/normalize-email';
import { ScreenGateway } from '../ws/screen.gateway';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// For the public invite-preview endpoint only — enough for the accept-invite page to say "this
// invite was sent to j***@example.com", never enough to reconstruct the real address.
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

@Injectable()
export class OrgService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly orgScoped: OrgScopedService,
    private readonly gateway: ScreenGateway,
  ) {}

  // Super Admin only (see OrgController) — every tenant, not just the caller's own. Backs the
  // Template tenant-assignment picker (designer.md §10.2/Phase 5); the only cross-tenant
  // Organization listing in the app, so it deliberately lives beside listMembers rather than in
  // the templates module.
  async listAllOrganizations() {
    return this.prisma.organization.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });
  }

  async listMembers(orgId: string) {
    return this.prisma.user.findMany({
      where: { organizationId: orgId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listInvites(orgId: string) {
    return this.prisma.orgInvite.findMany({
      where: { organizationId: orgId, acceptedAt: null },
      select: { id: true, email: true, role: true, token: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async invite(orgId: string, email: string, role: UserRole) {
    const normalizedEmail = normalizeEmail(email);
    const existingUser = await this.prisma.user.findFirst({ where: { organizationId: orgId, email: normalizedEmail } });
    if (existingUser) throw new ConflictException('That email is already a member of this organization');

    // No email delivery is wired up yet — the token is returned directly so the dashboard can
    // show/copy an invite link. Swap for a real email send without changing this shape.
    const invite = await this.prisma.orgInvite.create({
      data: {
        email: normalizedEmail,
        role,
        organizationId: orgId,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    return invite;
  }

  // Ownership-checked (assertOwns) rather than a bare `deleteMany` so revoking someone else's
  // org's invite — or an already-accepted one — 404s instead of silently deleting 0 rows.
  async revokeInvite(orgId: string, inviteId: string) {
    const invite = await this.orgScoped.assertOwns(
      () => this.prisma.orgInvite.findFirst({ where: { id: inviteId, organizationId: orgId, acceptedAt: null } }),
      'Invite not found',
    );
    await this.prisma.orgInvite.delete({ where: { id: invite.id } });
  }

  // Public — reachable by anyone holding an invite link, before they've authenticated. Returns
  // only what the accept-invite page needs to render ("You're invited to join {org} as {role}")
  // and never the raw email, organizationId, or anything else — see
  // docs/adr/tenant-isolation-and-shared-content.md's Public data class. A single NotFoundException
  // covers missing/expired/already-accepted tokens alike so a guess can't distinguish them.
  async getInvitePreview(token: string) {
    const invite = await this.prisma.orgInvite.findUnique({
      where: { token },
      include: { organization: { select: { name: true } } },
    });
    if (invite?.acceptedAt !== null || invite.expiresAt < new Date()) {
      throw new NotFoundException('Invite not found');
    }
    return { email: maskEmail(invite.email), organizationName: invite.organization.name, role: invite.role };
  }

  // Used by the Super Admin tenant-creation and owner-invite-reissue flows (see
  // PlatformTenantsService) — kept separate from `invite()` above rather than adding a role
  // branch to it, since the re-issue semantics here are specific to the single-owner
  // provisioning flow, not the ordinary team member-invite UX.
  //
  // Expires any prior pending OWNER invite for this org first, so re-issuing (e.g. after a
  // typo'd email) never leaves two live tokens where whichever is accepted first silently wins —
  // see docs/adr/platform-modules-and-entitlements.md's owner-invite re-issue decision.
  async createOwnerInvite(organizationId: string, email: string) {
    const normalizedEmail = normalizeEmail(email);
    await this.prisma.orgInvite.updateMany({
      where: { organizationId, role: 'OWNER', acceptedAt: null },
      data: { expiresAt: new Date() },
    });

    return this.prisma.orgInvite.create({
      data: {
        email: normalizedEmail,
        role: 'OWNER',
        organizationId,
        token: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
  }

  async acceptInvite(token: string, name: string, password: string) {
    const passwordHash = await hash(password, 12);

    // Claims the invite with a single conditional UPDATE inside the transaction — never a
    // pre-transaction read-then-check — so two concurrent accepts of the same token can't both
    // pass a stale check: Postgres row-locks the matched invite on UPDATE, so the loser's
    // `updateMany` blocks until the winner commits, then re-evaluates `acceptedAt: null` against
    // the now-committed row and matches 0 rows instead of 1.
    const user = await this.prisma.$transaction(async (tx) => {
      const claim = await tx.orgInvite.updateMany({
        where: { token, acceptedAt: null, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date() },
      });
      if (claim.count !== 1) throw new UnauthorizedException('Invite is invalid or has expired');

      const invite = await tx.orgInvite.findUniqueOrThrow({ where: { token } });

      const existingUser = await tx.user.findUnique({ where: { email: normalizeEmail(invite.email) } });
      if (existingUser) throw new ConflictException('Email already in use');

      return tx.user.create({
        data: {
          email: normalizeEmail(invite.email),
          passwordHash,
          name,
          role: invite.role,
          organizationId: invite.organizationId,
        },
      });
    });

    const jwtToken = this.jwt.sign({ sub: user.id, orgId: user.organizationId, role: user.role, authVersion: user.authVersion });
    return { token: jwtToken, user: { id: user.id, email: user.email, name: user.name, role: user.role, orgId: user.organizationId } };
  }

  // Bumping authVersion in the same write invalidates every JWT this member already holds — the
  // next REST call or WebSocket (re)connection with their old token fails live (see JwtStrategy,
  // ScreenGateway) instead of keeping the old role until the token's 7-day expiry. The socket
  // kick below covers the connection they may *already* have open right now, which a live check
  // at (re)connection time alone wouldn't touch until it naturally reconnects.
  async updateMemberRole(orgId: string, memberId: string, role: UserRole) {
    const member = await this.getMember(orgId, memberId);

    if (member.role === 'OWNER' && role !== 'OWNER') {
      await this.assertNotLastOwner(orgId, memberId);
    }

    const updated = await this.prisma.user.update({
      where: { id: memberId },
      data: { role, authVersion: { increment: 1 } },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
    await this.gateway.disconnectUser(orgId, memberId);
    return updated;
  }

  // P6a (docs/tenant_isolation_and_platform_admin_plan.md §P6a "Safe administrative actions") —
  // an explicit, standalone "revoke this member's sessions" action, independent of any role
  // change or removal (e.g. a Super Admin responding to a suspected compromised account, where
  // the member should stay a member). Same authVersion-bump + live-socket-kick mechanism
  // updateMemberRole/removeMember already use — see their comments for why both are needed
  // (the bump invalidates a token used later; the kick closes a socket already open right now).
  async revokeMemberSessions(orgId: string, memberId: string) {
    const member = await this.getMember(orgId, memberId);
    await this.prisma.user.update({ where: { id: member.id }, data: { authVersion: { increment: 1 } } });
    await this.gateway.disconnectUser(orgId, member.id);
    return { id: member.id };
  }

  // Revokes every member's sessions in the tenant at once, in a single statement rather than one
  // per member — the same "suspected compromise" scenario as revokeMemberSessions, scaled to the
  // whole org (e.g. a Super Admin responding to a tenant-wide credential leak).
  async revokeAllSessions(orgId: string) {
    const { count } = await this.prisma.user.updateMany({
      where: { organizationId: orgId },
      data: { authVersion: { increment: 1 } },
    });
    await this.gateway.disconnectOrg(orgId);
    return { revokedCount: count };
  }

  async removeMember(orgId: string, memberId: string, requestingUserId: string) {
    if (memberId === requestingUserId) throw new BadRequestException("You can't remove yourself");

    const member = await this.getMember(orgId, memberId);
    if (member.role === 'OWNER') await this.assertNotLastOwner(orgId, memberId);

    await this.prisma.user.delete({ where: { id: memberId } });
    // No authVersion bump needed — the row is gone, so JwtStrategy's "user not found" check
    // already rejects any future request/reconnect with this member's old token. This only
    // needs to close the already-open socket, if any.
    await this.gateway.disconnectUser(orgId, memberId);
  }

  // `name` added for designer.md Phase 8 — the only field on Organization that can back the
  // `{{business.name}}` dynamic variable (no phone/logo/website fields exist on this model).
  async getSettings(orgId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId }, select: { autoPublish: true, name: true } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async updateSettings(orgId: string, autoPublish: boolean) {
    return this.prisma.organization.update({ where: { id: orgId }, data: { autoPublish }, select: { autoPublish: true } });
  }

  private async getMember(orgId: string, memberId: string) {
    return this.orgScoped.assertOwns(
      () => this.prisma.user.findFirst({ where: { id: memberId, organizationId: orgId } }),
      'Member not found',
    );
  }

  private async assertNotLastOwner(orgId: string, excludingMemberId: string) {
    const otherOwners = await this.prisma.user.count({
      where: { organizationId: orgId, role: 'OWNER', id: { not: excludingMemberId } },
    });
    if (otherOwners === 0) throw new BadRequestException('An organization must keep at least one owner');
  }
}
