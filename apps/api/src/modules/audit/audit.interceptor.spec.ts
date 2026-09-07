import { of } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { AuditInterceptor } from './audit.interceptor';
import type { AuditService } from './audit.service';

// P8 (docs/tenant_isolation_and_platform_admin_plan.md) — regression coverage for the two data-
// quality defects fixed while wiring the dashboard's Audit Log page to this real backend for the
// first time: (1) every Super Admin action on another tenant (/admin/**) used to also log into
// the *acting* admin's own org's tenant-facing AuditLog, mislabeled as an action on their own
// org; (2) every org-nested mutation (member invite/role-change/removal, org settings) logged
// resourceType "org" instead of the actually-mutated resource, since 'org' is a routing wrapper
// (OrgController), not a resource type.
function makeContext(method: string, path: string, params: Record<string, string> = {}, user: unknown = { sub: 'user_1', orgId: 'org_1', role: 'ADMIN' }) {
  const req = { method, path, params, user };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  const next: CallHandler = { handle: () => of({ ok: true }) };
  return { context, next };
}

describe('AuditInterceptor', () => {
  function makeInterceptor() {
    const audit = { log: jest.fn() } as unknown as AuditService;
    return { interceptor: new AuditInterceptor(audit), audit };
  }

  it('does not log a mutation under /admin/** — those have their own PlatformAuditLog trail', (done) => {
    const { interceptor, audit } = makeInterceptor();
    const { context, next } = makeContext('PUT', '/v1/admin/tenants/tenant_1/status', { tenantId: 'tenant_1' });

    interceptor.intercept(context, next).subscribe(() => {
      expect(audit.log).not.toHaveBeenCalled();
      done();
    });
  });

  it('logs a normal tenant mutation with resourceType derived from the path', (done) => {
    const { interceptor, audit } = makeInterceptor();
    const { context, next } = makeContext('PUT', '/v1/screens/scr_1', { id: 'scr_1' });

    interceptor.intercept(context, next).subscribe(() => {
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org_1', userId: 'user_1', resourceType: 'screens', resourceId: 'scr_1' }),
      );
      done();
    });
  });

  it('resolves the real resource under the "org" routing wrapper instead of logging resourceType "org"', (done) => {
    const { interceptor, audit } = makeInterceptor();
    const { context, next } = makeContext('POST', '/v1/org/invite');

    interceptor.intercept(context, next).subscribe(() => {
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'invite' }));
      done();
    });
  });

  it('skips a GET request', (done) => {
    const { interceptor, audit } = makeInterceptor();
    const { context, next } = makeContext('GET', '/v1/screens');

    interceptor.intercept(context, next).subscribe(() => {
      expect(audit.log).not.toHaveBeenCalled();
      done();
    });
  });

  it('skips a request with no authenticated tenant user (e.g. a player JWT)', (done) => {
    const { interceptor, audit } = makeInterceptor();
    const { context, next } = makeContext('POST', '/v1/player/init', {}, { screenId: 'scr_1' });

    interceptor.intercept(context, next).subscribe(() => {
      expect(audit.log).not.toHaveBeenCalled();
      done();
    });
  });
});
