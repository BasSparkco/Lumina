import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@lumina/db';
import { PrismaService } from '../../prisma/prisma.service';

interface PlatformAuditEntry {
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  metadata?: Prisma.InputJsonValue;
  // P5a — set for a platform action that targets one tenant (tenant create/status/module/
  // owner-invite). Omit for a no-target-tenant action (shared-library mutations, P3).
  targetOrganizationId?: string;
  // P6a (docs/tenant_isolation_and_platform_admin_plan.md §P6a "Platform audit") — the
  // human-entered justification or ticket reference for an action that requires one (e.g. a
  // tenant suspension). Omitted for actions with no such requirement.
  reason?: string;
  // Defaults to 'success' at the schema level. Callers on a caught-exception path should pass
  // 'failure' explicitly; nothing currently does this automatically (every existing call site
  // only ever logs its own success path) — see the model comment in schema.prisma.
  result?: 'success' | 'failure';
  ipAddress?: string;
  userAgent?: string;
}

// Platform-scoped counterpart to AuditService (../audit/audit.service.ts) — for actions with no
// target tenant (e.g. shared-library mutations, P3) or where the actor and target tenant are
// different organizations (tenant management, P5a), neither of which AuditLog's required,
// same-org-as-actor-assuming organizationId can represent without misattributing the entry. See
// PlatformAuditLog in schema.prisma for why this is a separate table rather than a column there.
@Injectable()
export class PlatformAuditService {
  private readonly logger = new Logger(PlatformAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Swallows its own errors, matching AuditService.log() — a broken audit write must never fail
  // the platform action that triggered it.
  async log(entry: PlatformAuditEntry): Promise<void> {
    try {
      await this.prisma.platformAuditLog.create({ data: entry });
    } catch (err) {
      this.logger.error(`Failed to write platform audit log: ${(err as Error).message}`);
    }
  }
}
