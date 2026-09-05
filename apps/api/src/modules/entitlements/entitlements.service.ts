import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ModuleKey, TenantCapabilities, TenantModuleStatus } from '@lumina/types';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ModuleCatalogService } from './module-catalog.service';
import { Clock } from './clock';

export interface ModuleAssignmentInput {
  key: ModuleKey;
  status: TenantModuleStatus;
  expiresAt?: Date | null;
}

function auditActionForStatus(status: TenantModuleStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'tenant.module.activate';
    case 'DISABLED':
      return 'tenant.module.disable';
    case 'TRIAL':
      return 'tenant.module.trial.update';
  }
}

// Shared by the DB-row check (hasModule/getCapabilities) and the pure array check
// (validateDependencies) so "is this entitlement usable" has exactly one definition — see the
// four bullet points in docs/adr/platform-modules-and-entitlements.md's capability section.
// DISABLED never passes here regardless of expiresAt; ACTIVE/TRIAL both still require
// expiresAt to be null or in the future.
function isAssignmentUsable(status: TenantModuleStatus, expiresAt: Date | null, now: Date): boolean {
  if (status !== 'ACTIVE' && status !== 'TRIAL') return false;
  return expiresAt === null || expiresAt > now;
}

/**
 * Resolves per-tenant module entitlement live from the database on every call — never from the
 * JWT, never cached across a Super Admin mutation without invalidation (see
 * docs/adr/platform-modules-and-entitlements.md). Start with direct reads for correctness; add
 * caching only after measuring a real need.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: ModuleCatalogService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async getCapabilities(organizationId: string): Promise<TenantCapabilities> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { status: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const rows = await this.prisma.tenantModule.findMany({ where: { organizationId } });

    return {
      tenantStatus: org.status,
      modules: rows
        .filter((row) => this.catalog.isValidKey(row.moduleKey))
        .map((row) => ({
          key: row.moduleKey as ModuleKey,
          status: row.status,
          expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
        })),
    };
  }

  async hasModule(organizationId: string, moduleKey: ModuleKey): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { status: true },
    });
    if (org?.status !== 'ACTIVE') return false;

    return this.isUsable(organizationId, moduleKey, this.clock.now());
  }

  async assertModule(organizationId: string, moduleKey: ModuleKey): Promise<void> {
    const usable = await this.hasModule(organizationId, moduleKey);
    // Deliberately generic — never names the organization, its plan, or why the check failed,
    // so a 403 here can't be used to probe another tenant's entitlement state.
    if (!usable) throw new ForbiddenException('Module not available for this organization');
  }

  // Pure and synchronous: `assignments` is the full desired end-state for the tenant (the
  // Super Admin module editor submits every module's status at once, not a partial patch), so
  // a dependency's usability can be checked against the array itself with no DB access.
  validateDependencies(assignments: ModuleAssignmentInput[]): void {
    const now = this.clock.now();
    const byKey = new Map(assignments.map((a) => [a.key, a]));

    for (const assignment of assignments) {
      if (!isAssignmentUsable(assignment.status, assignment.expiresAt ?? null, now)) continue;

      const dependency = this.catalog.dependencyOf(assignment.key);
      if (!dependency) continue;

      const dependencyAssignment = byKey.get(dependency);
      const dependencyUsable =
        !!dependencyAssignment &&
        isAssignmentUsable(dependencyAssignment.status, dependencyAssignment.expiresAt ?? null, now);

      if (!dependencyUsable) {
        throw new BadRequestException(`${assignment.key} requires ${dependency} to also be active or on an unexpired trial`);
      }
    }
  }

  async setTenantModules(
    targetOrganizationId: string,
    assignments: ModuleAssignmentInput[],
    actorUserId: string,
  ): Promise<TenantCapabilities> {
    const org = await this.prisma.organization.findUnique({
      where: { id: targetOrganizationId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    this.validateDependencies(assignments);

    const existing = await this.prisma.tenantModule.findMany({ where: { organizationId: targetOrganizationId } });
    const existingByKey = new Map(existing.map((row) => [row.moduleKey, row]));

    await this.prisma.$transaction(
      assignments.map((assignment) =>
        this.prisma.tenantModule.upsert({
          where: { organizationId_moduleKey: { organizationId: targetOrganizationId, moduleKey: assignment.key } },
          update: { status: assignment.status, expiresAt: assignment.expiresAt ?? null },
          create: {
            organizationId: targetOrganizationId,
            moduleKey: assignment.key,
            status: assignment.status,
            expiresAt: assignment.expiresAt ?? null,
          },
        }),
      ),
    );

    for (const assignment of assignments) {
      const prior = existingByKey.get(assignment.key);
      const priorExpiresAt = prior?.expiresAt ?? null;
      const newExpiresAt = assignment.expiresAt ?? null;
      const unchanged =
        !!prior &&
        prior.status === assignment.status &&
        priorExpiresAt?.getTime() === newExpiresAt?.getTime();
      if (unchanged) continue;

      await this.audit.log({
        organizationId: targetOrganizationId,
        userId: actorUserId,
        action: auditActionForStatus(assignment.status),
        resourceType: 'TenantModule',
        resourceId: prior?.id,
        metadata: {
          moduleKey: assignment.key,
          previousStatus: prior?.status ?? null,
          newStatus: assignment.status,
          expiresAt: newExpiresAt ? newExpiresAt.toISOString() : null,
        },
      });
    }

    return this.getCapabilities(targetOrganizationId);
  }

  private async isUsable(organizationId: string, moduleKey: ModuleKey, now: Date): Promise<boolean> {
    const row = await this.prisma.tenantModule.findUnique({
      where: { organizationId_moduleKey: { organizationId, moduleKey } },
    });
    if (!row || !isAssignmentUsable(row.status, row.expiresAt, now)) return false;

    const dependency = this.catalog.dependencyOf(moduleKey);
    if (!dependency) return true;

    return this.isUsable(organizationId, dependency, now);
  }
}
