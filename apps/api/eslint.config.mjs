import { baseConfig } from '../../eslint.config.mjs';
import tenantIsolationPlugin from './eslint-rules/no-raw-tenant-prisma-delegate.cjs';

export default [
  ...baseConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // P9 (docs/tenant_isolation_and_platform_admin_plan.md §P9 task 9) — flags a raw
    // `this.prisma.<tenantModel>.<method>()` call whose where-clause isn't organizationId-scoped.
    // Scoped off (rather than the rule special-casing these files itself) for the codebase's
    // known-legitimate cross-tenant access points: OrgScopedService is the trusted implementation
    // every other service's ownership check delegates to; PlatformTenantsService/the admin
    // controllers and services are genuine Super Admin cross-tenant operations
    // (SuperAdminGuard-gated); prisma/**scripts are operator-run audits/seeds/migrations, not
    // request-handling code; test/** fixtures deliberately set up and assert against both
    // tenants' data in the same process; player.service.ts backs player.controller.ts's
    // device-private routes (PlayerJwtGuard) where every screenId argument is the caller's own
    // verified identity (@CurrentUser() from the player JWT's `sub`, never a client-supplied
    // param naming a *different* screen) — the device-private (DP) self-access class from
    // docs/tenant-isolation/ownership-matrix.md §3, structurally distinct from a tenant-private
    // (TP) lookup that needs an organizationId check because the caller could name any resource.
    files: ['src/**/*.ts'],
    ignores: ['src/common/org-scoped.service.ts', 'src/modules/platform-tenants/**', 'src/modules/player/player.service.ts'],
    plugins: { 'tenant-isolation': tenantIsolationPlugin },
    rules: {
      'tenant-isolation/no-raw-tenant-prisma-delegate': 'error',
    },
  },
  {
    // typescript-eslint's project-service type resolution doesn't pick up @types/jest's ambient
    // globals (describe/it/expect/jest) for these files the way a plain `tsc` program does, so
    // every jest.fn()/expect() call reads as a method on `any` — the type-aware "unsafe-*" rules
    // exist to catch real `any` leaks in application code, not this. Jest itself (via ts-jest,
    // configured separately in jest.config.ts/test/jest-e2e.json) still fully type-checks these
    // files when they run. *.e2e-spec.ts (P9) hits the same friction from a different source too:
    // INestApplication.getHttpServer() and supertest's request() are intentionally loosely typed
    // (Nest supports multiple underlying HTTP adapters), so every `request(app.getHttpServer())`
    // call in an e2e test reads as `any` the same way a jest global does.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
];
