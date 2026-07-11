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

    if (!MUTATING_METHODS.has(req.method) || !user || !('orgId' in user) || !('role' in user)) {
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

  private resourceTypeFromPath(urlPath: string): string {
    const segments = urlPath.split('/').filter(Boolean);
    const start = segments[0] && /^v\d+$/.test(segments[0]) ? 1 : 0;
    return segments[start] ?? 'unknown';
  }
}
