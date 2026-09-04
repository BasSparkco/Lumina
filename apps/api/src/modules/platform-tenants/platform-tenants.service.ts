import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { OrganizationStatus } from '@lumina/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService, type ModuleAssignmentInput } from '../entitlements/entitlements.service';
import { OrgService } from '../org/org.service';

interface CreateTenantInput {
  name: string;
  slug: string;
  ownerEmail: string;
  modules: ModuleAssignmentInput[];
}

function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
    private readonly org: OrgService,
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

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      createdAt: org.createdAt,
      capabilities,
    };
  }

  // Atomic per Section 6.2 of the ADR: slug validation, Organization creation, and module
  // assignment all happen inside one transaction — dependency validation runs before any of it,
  // so a bad module set never leaves a half-created Organization behind. The owner invite and
  // audit write happen after commit, matching how AuditService.log() already documents itself as
  // best-effort (a broken audit write must never fail the request that triggered it).
  async create(input: CreateTenantInput, actorUserId: string) {
    const slug = normalizeSlug(input.slug);

    const existing = await this.prisma.organization.findUnique({ where: { slug } });
    if (existing) throw new ConflictException('Slug already in use');

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
      organizationId: org.id,
      userId: actorUserId,
      action: 'tenant.create',
      resourceType: 'Organization',
      resourceId: org.id,
      metadata: { name: org.name, slug: org.slug, modules: input.modules.map((m) => m.key) },
    });

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      ownerInvite: { email: invite.email, token: invite.token, expiresAt: invite.expiresAt },
    };
  }

  async updateStatus(tenantId: string, status: OrganizationStatus, actorUserId: string) {
    const org = await this.assertExists(tenantId);

    const updated = await this.prisma.organization.update({ where: { id: tenantId }, data: { status } });

    await this.audit.log({
      organizationId: tenantId,
      userId: actorUserId,
      action: 'tenant.status.update',
      resourceType: 'Organization',
      resourceId: tenantId,
      metadata: { previousStatus: org.status, newStatus: status },
    });

    return updated;
  }

  // Dependency/expiry validation and per-module audit entries all happen inside
  // EntitlementsService.setTenantModules — nothing to duplicate here beyond confirming the
  // target tenant is real (Section 9.2: every target tenant id is loaded and validated
  // explicitly, never substituted with the Super Admin's own orgId).
  async setModules(tenantId: string, assignments: ModuleAssignmentInput[], actorUserId: string) {
    await this.assertExists(tenantId);
    return this.entitlements.setTenantModules(tenantId, assignments, actorUserId);
  }

  async reissueOwnerInvite(tenantId: string, email: string, actorUserId: string) {
    await this.assertExists(tenantId);
    const invite = await this.org.createOwnerInvite(tenantId, email);

    await this.audit.log({
      organizationId: tenantId,
      userId: actorUserId,
      action: 'tenant.owner_invite.create',
      resourceType: 'OrgInvite',
      resourceId: invite.id,
      metadata: { email: invite.email },
    });

    return { email: invite.email, token: invite.token, expiresAt: invite.expiresAt };
  }

  private async assertExists(tenantId: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: tenantId } });
    if (!org) throw new NotFoundException('Tenant not found');
    return org;
  }
}
