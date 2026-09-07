import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AuditService } from './audit.service';
import type { JwtUser } from '../../common/types/jwt-user';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: JwtUser }>();
    const user = req.user;

    // P8 (docs/tenant_isolation_and_platform_admin_plan.md) — `/admin/**` routes
    // (PlatformTenantsController, AdminTemplatesController) are Super-Admin-only platform
    // actions, not this tenant's business (P0's ownership matrix: platform-private, not
    // tenant-private), even though the acting user's JWT carries their own `orgId`/`role`.
    // Without this exclusion every Super Admin action on another tenant — suspend, module
    // change, session revoke — would also land in the *acting* admin's own org's tenant-facing
    // AuditLog, mislabeled as if it were an action on their own org. PlatformTenantsController's
    // mutations already have their own dedicated, correctly-attributed trail
    // (PlatformAuditLog/PlatformAuditService, P3/P5a/P6a) — this interceptor would only add
    // confusing noise there.
    if (!MUTATING_METHODS.has(req.method) || !user || !('orgId' in user) || !('role' in user) || this.isAdminRoute(req.path)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap(() => {
        void this.audit.log({
          organizationId: user.orgId,
          userId: user.sub,
          action: `${req.method.toLowerCase()} ${req.path}`,
          resourceType: this.resourceTypeFromPath(req.path),
          resourceId: typeof req.params?.id === 'string' ? req.params.id : undefined,
        });
      }),
    );
  }

  private isAdminRoute(urlPath: string): boolean {
    const segments = urlPath.split('/').filter(Boolean);
    const start = segments[0] && /^v\d+$/.test(segments[0]) ? 1 : 0;
    return segments[start] === 'admin';
  }

  // 'org' is a routing wrapper (OrgController nests members/invites/settings under it), not a
  // resource type on its own — without this, every member invite/role-change/removal and every
  // org-settings update would log resourceType "org" instead of the actually-mutated resource,
  // which is most of what the tenant-facing Audit Log page exists to show.
  private resourceTypeFromPath(urlPath: string): string {
    const segments = urlPath.split('/').filter(Boolean);
    const start = segments[0] && /^v\d+$/.test(segments[0]) ? 1 : 0;
    const first = segments[start] ?? 'unknown';
    if (first === 'org' && segments[start + 1]) return segments[start + 1]!;
    return first;
  }
}
