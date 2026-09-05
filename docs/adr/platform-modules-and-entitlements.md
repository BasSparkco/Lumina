# ADR: Platform Modules and Tenant Entitlements (Phase A)

## Context

`platform_modules_and_tenants_foundation_plan.md` (repo root) specifies the foundation required
before AI Wayfinding and Room Booking can be built in parallel: Super-Admin-provisioned tenants,
per-tenant paid-module entitlement, and Wayfinding converted into the first fully licensed
optional module, used to validate the entitlement system end to end.

This is not a greenfield effort. `Organization` is already the tenant boundary
(`apps/api/prisma/schema.prisma`), tenant-owned records are already scoped through
`organizationId`, `User.isSuperAdmin` already exists as a cross-tenant platform flag, and
`SuperAdminGuard`/`@RequireSuperAdmin()` already protect `/admin/templates` and `GET /org/all`.
What's missing is any concept of module entitlement: `Organization` has no module assignments,
Wayfinding is visible to every tenant, and neither `ScreensService.setStreamingType()` nor
`PlayerService.getState()` check whether a tenant owns the module before serving it.

This ADR records the decisions frozen in Phase A that Phase B, and later the AI Wayfinding and
Room Booking teams, inherit without re-litigating.

## Decision

Module ownership is a **tenant-level** axis, resolved live from the database on every enforced
request — never encoded in the JWT, never merged into `usePermissions()`'s role-rank axis. A
single shared catalog (`@lumina/types`) is the sole source of truth for module keys and their
dependency graph; API, dashboard, and tests all import it rather than declaring their own string
unions.

## Module catalog and dependencies

`packages/types/src/modules.ts` exports the catalog:

```ts
export const MODULE_KEYS = ['WAYFINDING', 'WAYFINDING_AI', 'ROOM_BOOKING', 'INDOOR_POSITIONING'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULE_DEPENDENCIES: Record<ModuleKey, ModuleKey | null> = {
  WAYFINDING: null,
  WAYFINDING_AI: 'WAYFINDING',
  ROOM_BOOKING: null,
  INDOOR_POSITIONING: 'WAYFINDING',
};
```

`SIGNAGE_CORE` is deliberately not a row in this catalog — it is the base product every `ACTIVE`
tenant already has. Whole-tenant suspension is represented by `Organization.status`
(`ACTIVE | SUSPENDED`, Phase B), never by removing a core-module entitlement.

`moduleKey` is persisted as a `String` on `TenantModule` (Phase B), constrained by this catalog
at the service/DTO layer, not as a Prisma enum — the same tradeoff `Screen.aspectRatio` already
makes, to avoid a database migration every time a new commercial module ships. The catalog itself
is the enum; the database column is just storage.

`packages/types/src/index.ts` re-exports every barrel module twice — once via `export *` (types)
and once via an explicit named list, because the dashboard's Vite build can't statically see
through `export *` for runtime values (CJS/ESM interop). `MODULE_KEYS` and `MODULE_DEPENDENCIES`
are runtime values, so they're in the explicit list alongside `FONT_LIBRARY` and
`POI_CATEGORY_PRESETS`. Omitting a runtime export here would compile fine under the API's
ts-node but fail silently in the dashboard build.

## Tenant modules versus user roles

```text
Tenant entitlement answers: "Did this customer buy the module?"
User role answers: "What may this user do inside the purchased module?"
```

These are orthogonal axes and stay visibly separate in code, mirroring how `usePermissions()`
already keeps `isSuperAdmin` separate from role rank rather than folding it into the rank ladder.
Module ownership is tenant-level only — no per-user module overrides in this foundation. If a
tenant doesn't own `WAYFINDING`, no user in that tenant can access it, regardless of role; if the
tenant does own it, normal `RolesGuard` rank rules apply on top. Super Admin status never
silently changes the current tenant context for normal tenant routes.

## Enforcement layers

Every optional module is enforced at five layers, front-end hiding being UX only — API and
runtime are the actual security boundary:

1. **Navigation** — hide unavailable module nav entries.
2. **Dashboard route** — refuse direct navigation to a module page.
3. **API** — `403 Forbidden` for an unavailable module.
4. **Configuration** — reject assigning an unavailable module to a screen/resource.
5. **Runtime/player** — never return licensed payloads to a player belonging to an unlicensed
   tenant.

## Capability response contract

One server-owned shape, resolved live, exposed from one authenticated endpoint:

```ts
interface TenantCapabilities {
  tenantStatus: 'ACTIVE' | 'SUSPENDED';
  modules: Array<{ key: ModuleKey; status: 'ACTIVE' | 'TRIAL' | 'DISABLED'; expiresAt: string | null }>;
}
```

```http
GET /v1/org/capabilities
```

Entitlements are never encoded into the JWT — a JWT stays valid for up to seven days, while a
Super Admin may need a module change to take effect immediately. The server always resolves
current entitlement state at enforcement time, the same reasoning that motivates the live
Super Admin authority rule below.

## Owner-invite re-issue

`OrgInvite` has no `revokedAt`/status field — state is derived purely from
`acceptedAt`/`expiresAt` — and `OrgService.invite()` doesn't check for an existing pending invite
before creating a new one. Re-issuing an owner invite (`POST
/v1/admin/tenants/:tenantId/owner-invite` called a second time) must expire or replace the prior
pending invite row rather than leave two live tokens for the same email, where whichever is
accepted first wins.

## Disabled-module behavior

Disabling a module never deletes data: existing screen bindings and configuration remain stored,
the API rejects new use of the disabled module, the player receives no protected payload, and
re-enabling restores access to the existing data and bindings without reconstruction. A disabled
screen shows Lumina's neutral unavailable/awaiting-content state — it never exposes commercial
licensing details to public visitors.

**Offline/cached access is a bounded lease, not indefinite and not best-effort-forever.** Every
successful `/player/state` (and `/player/manifest`, which is what actually feeds the offline
caching pipeline) response issues a per-module lease — `{ key, issuedAt, validUntil }` — that the
player persists alongside the cached presentation. Default grace period is seven days (168h),
configurable via `PLAYER_ENTITLEMENT_OFFLINE_GRACE_HOURS`. A restored cached presentation may
render protected module content only while its lease is valid; a missing or malformed lease is
treated as expired. Expiry suppresses the protected runtime branch without deleting the cached
data, so a successful revalidation restores operation without re-downloading anything.

This lease is an operational SaaS control, not a tamper-resistant on-premise license — it does
not resist a customer who controls and modifies the browser code, IndexedDB, OS clock, or server.
Strong anti-tamper/node-locked licensing is explicitly out of scope for this foundation.

**Evacuation is exempt from both entitlement and lease expiry.** If cached state has
`emergencyActive === true`, the player retains enough cached Wayfinding data to render the
evacuation route even when the module is disabled, the tenant is suspended, or the offline lease
has expired. This exemption covers only the evacuation view — it never reopens the normal
directory, search, POI browsing, or attract content. Without this exemption, gating the
`wayfinding` payload on entitlement/lease state would cause an active fire evacuation on a
de-licensed kiosk to fall through to a generic "kiosk location not set" splash instead of showing
an exit route — the same reasoning that already makes `ScreensService.setEmergency` bypass the
unrelated `autoPublish` gate.

## Live Super Admin authority

`JwtAuthGuard` trusts `role`/`isSuperAdmin` from the signed JWT for up to seven days with no live
database re-check — sufficient for ordinary tenant routes, not sufficient for platform
administration. Every `@RequireSuperAdmin()` request must re-read the current `User` row by the
authenticated `sub` and require the current database value `isSuperAdmin === true`. Deleting the
user or revoking the flag takes effect immediately for tenant creation, tenant suspension, module
assignment, and every other Super Admin route. This foundation does not require a live re-check
on every ordinary tenant route — only on the small set of high-impact platform-authority routes.

## Player-side module enforcement pattern (established in Wayfinding, Milestone B5)

Wayfinding is the reference implementation for gating a player-visible payload; any future
player-facing module (a player-visible Room Booking status, say) should follow the same shape
rather than inventing a new one:

1. **Compute an `<x>Entitled` boolean once per request**, live, via `EntitlementsService.hasModule()`
   — never cached, never derived from the JWT. In `PlayerService.getState()` this is
   `wayfindingEntitled`.
2. **Compute a separate `<x>Renderable` boolean** that OR's in any safety/business-rule bypass
   (evacuation, for Wayfinding) on top of the entitlement check. Use `Renderable` to decide what
   the payload contains; use `Entitled` — never `Renderable` — to decide whether to issue an
   offline lease. A bypass must never earn a lease, or an offline kiosk could keep rendering
   protected content indefinitely off the back of one emergency.
3. **Issue a lease only when genuinely entitled**: `{ key: ModuleKey, issuedAt, validUntil }`,
   appended to the shared `moduleLeases: PlayerModuleLease[]` array (`@lumina/types`) — one array
   for every player-facing module, not a parallel per-module mechanism. `validUntil` is
   `issuedAt + PLAYER_ENTITLEMENT_OFFLINE_GRACE_HOURS` (default 168h), read directly from
   `process.env`, not `ConfigService.get()` — see the B3 addendum above for why.
4. **On the player**, gate the module's normal (non-bypass) render branch on a pure
   `isModuleLeaseValid(leases, key)` check (`apps/player/src/lib/moduleLease.ts`) that treats a
   missing or malformed lease as expired — fail closed. This check is a no-op on the live path
   (a freshly-issued lease is always valid) and only actually matters when a presentation is
   restored from offline storage past its grace window. Never delete the cached presentation on
   expiry; only suppress the protected branch until a fresh state renews the lease.
5. **Any bypass branch (evacuation) must be checked before, and independently of, the lease
   check**, so it renders regardless of entitlement, lease validity, or network state. Verified
   live for Wayfinding: an active evacuation on a de-licensed kiosk still shows the exit route.
6. **Write an operational log line when a module is configured but not renderable** — the
   diagnostic signal an operator needs for "why does this kiosk have no active module payload."

## Exported contracts downstream modules must use

- `ModuleKey`, `MODULE_KEYS`, `MODULE_DEPENDENCIES` — `@lumina/types` (`modules.ts`).
- `TenantCapabilities`, `TenantCapabilityModule`, `TenantModuleStatusSchema`,
  `OrganizationStatusSchema` — `@lumina/types` (`modules.ts`).
- `EntitlementsService`, `@RequireModule()` — `apps/api/src/modules/entitlements/**` (Phase B).
- `GET /v1/org/capabilities` — response contract above (Phase B).
- Dashboard `hasModule()` / `useModuleRouteGuard()` — `apps/dashboard/src/hooks/**` (Phase B).

Neither the AI Wayfinding nor the Room Booking owner may add a new entitlement table, guard,
capability endpoint, or competing navigation-gating mechanism — both consume the contracts above
as-is. `AI Wayfinding` uses `@RequireModule('WAYFINDING_AI')` and depends on `WAYFINDING` through
`MODULE_DEPENDENCIES`; `Room Booking` uses `@RequireModule('ROOM_BOOKING')` as an independent
domain module.
