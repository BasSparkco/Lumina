# Lumina Platform Modules and Tenant Provisioning Foundation Plan

**Scope:** Phases A and B only  
**Repository:** `https://github.com/BasSparkco/Lumina`  
**Baseline reviewed:** implementation code reviewed through `1921876c78871a7997794ca463ea5b8af2393748`; the reviewed plan and its repository-specific corrections were committed at `155c400d4e764e9edf678e51471d65cbfc06bbc7` (2026-09-04). The intervening implementation commits (Wayfinding demo seed, Designer2 rebuild, playlist transition overrides, and device-initiated unpair) do not change any finding below. Re-baseline this section against current `main` HEAD immediately before Milestone A1 begins.  
**Purpose:** Establish the shared tenant/module contract and implement the minimum production-ready platform foundation required before AI Wayfinding and Room Booking can be developed in parallel.

---

## 1. Outcome

After this plan is complete:

1. A Super Admin can create a new tenant from the existing Lumina dashboard.
2. A Super Admin can activate or deactivate paid modules for that tenant.
3. Tenant users continue to sign in to the same Lumina application; no separate application or dashboard is introduced.
4. The sidebar, direct dashboard routes, API endpoints, screen configuration, and player payload all enforce the same module entitlement.
5. Existing Wayfinding becomes the first fully licensed optional module and is used to validate the entitlement system end to end.
6. Disabling a module preserves its data and configuration so it can be restored by re-enabling the module.
7. The shared contracts needed by the future `WAYFINDING_AI` and `ROOM_BOOKING` implementations are stable, documented, and tested.
8. Two developers can start AI Wayfinding and Room Booking in parallel without building separate permission systems or modifying the entitlement architecture.

This plan does **not** implement AI conversation features, room booking, calendar integrations, indoor positioning, billing, or payment collection.

---

## 2. Current Repository Assessment

The repository already contains useful platform foundations:

- `Organization` is the tenant boundary in `apps/api/prisma/schema.prisma`.
- Tenant-owned records are scoped through `organizationId`.
- `User.isSuperAdmin` already exists as a cross-tenant platform flag.
- `SuperAdminGuard` and `@RequireSuperAdmin()` already protect `/admin/templates`.
- `GET /org/all` already gives Super Admins a limited cross-tenant organization list.
- `OrgInvite` and the public invite-acceptance flow already support creating an account inside a selected organization.
- The dashboard already filters some navigation items through `usePermissions()`.
- The API already separates tenant role authorization from Super Admin authorization.
- Wayfinding is already a substantial working feature, including buildings, floors, POIs, kiosk locations, route graphs, accessible routing, QR directions, offline operation, analytics, and evacuation behavior.

The missing foundation is module entitlement enforcement:

- `Organization` has no module assignments.
- Wayfinding is visible in the dashboard sidebar for every tenant.
- Wayfinding controllers validate tenant ownership and user role, but not product entitlement.
- `ScreensService.setStreamingType()` accepts `WAYFINDING` for every tenant.
- Wayfinding-specific screen endpoints are not entitlement-gated.
- `PlayerService.getState()` can return Wayfinding payloads without checking whether the tenant owns the module.
- `POST /auth/register` currently creates a new organization and owner without Super Admin approval.
- There is no Super Admin tenant-management page.

The implementation must extend the existing architecture rather than replace its tenant isolation, role guards, screen modes, or player contract.

Two existing services already provide exactly the primitives this plan needs and must be reused, not reimplemented:

- `AuditService` (`apps/api/src/modules/audit/audit.service.ts`) — `log()` and `query()` already accept `{ organizationId, userId, action, resourceType, resourceId, metadata }`, a field-for-field match for Section 9's audit requirements.
- `OrgScopedService.assertOwns()` (`apps/api/src/common/org-scoped.service.ts`) — the existing per-method org-ownership helper used throughout Wayfinding/Screens/etc. `EntitlementsService` and `platform-tenants` services should follow the same convention for consistency, not introduce a competing pattern.

---

## 3. Phase A — Freeze the Shared Contract

Phase A is a short architecture checkpoint. No feature-team work may depend on the module system until these decisions are committed in code and documented.

### 3.1 Module keys

Create a single shared module catalog in a new file such as:

```text
packages/types/src/modules.ts
```

Initial keys:

```ts
export const MODULE_KEYS = [
  'WAYFINDING',
  'WAYFINDING_AI',
  'ROOM_BOOKING',
  'INDOOR_POSITIONING',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];
```

`SIGNAGE_CORE` should not be an optional row. It is the base product required for every active Lumina tenant. Whole-tenant suspension must be represented by tenant status, not by removing a core-module entitlement.

Define dependency metadata in the same catalog:

```ts
WAYFINDING_AI -> requires WAYFINDING
INDOOR_POSITIONING -> requires WAYFINDING
ROOM_BOOKING -> no optional-module dependency
WAYFINDING -> no optional-module dependency
```

The catalog is the authoritative list used by API validation, Super Admin forms, dashboard capability checks, and tests. Do not duplicate string unions in multiple applications.

`packages/types/src/index.ts` re-exports every barrel module twice: once via `export *` (types only) and once via an explicit named re-export list, because the dashboard's Vite build cannot statically see through `export *` for runtime values (CJS/ESM interop). `MODULE_KEYS` is a runtime array, not just a type, so it needs an explicit named export in `index.ts` alongside `export *`, the same way `FONT_LIBRARY`, `POI_CATEGORY_PRESETS`, and `PLAYLIST_TRANSITION_IDS` already are. Omitting this will silently work in the API (ts-node) and silently fail in the dashboard build.

### 3.2 Tenant-level modules versus user roles

Freeze this authorization rule:

```text
Tenant entitlement answers: "Did this customer buy the module?"
User role answers: "What may this user do inside the purchased module?"
```

Module ownership is tenant-level. Do not add per-user module overrides in this foundation.

Examples:

- If a tenant does not own `WAYFINDING`, no user in that tenant can access it.
- If the tenant owns `WAYFINDING`, an `OWNER` or `ADMIN` can manage it according to normal role rules.
- A read-only user may view allowed data but may not mutate it, following the existing `RolesGuard` policy.
- Super Admin status does not silently change the current tenant context for normal tenant routes.

### 3.3 Enforcement layers

All optional modules must use the same five enforcement layers:

1. **Navigation:** Hide unavailable module entries.
2. **Dashboard route:** Refuse direct navigation to a module page.
3. **API:** Return `403 Forbidden` for an unavailable module.
4. **Configuration:** Reject attempts to assign an unavailable module to a screen or resource.
5. **Runtime/player:** Never return licensed module payloads to a player belonging to an unlicensed tenant.

Frontend hiding is user experience only. API and runtime enforcement are the security boundary.

### 3.4 Stable capability response

Define one server-owned response shape for the current tenant:

```ts
interface TenantCapabilities {
  tenantStatus: 'ACTIVE' | 'SUSPENDED';
  modules: Array<{
    key: ModuleKey;
    status: 'ACTIVE' | 'TRIAL' | 'DISABLED';
    expiresAt: string | null;
  }>;
}
```

Expose it from one authenticated endpoint, recommended:

```http
GET /v1/org/capabilities
```

Do not encode module entitlements into the JWT. A JWT remains valid for days, while a Super Admin may need a module change to take effect immediately. The server must resolve current entitlement state when enforcing a request.

### 3.5 Owner-invite re-issue behavior

`OrgInvite` has no `revokedAt`/status field today — state is derived purely from `acceptedAt`/`expiresAt`, and `OrgService.invite()` does not check for an existing pending invite before creating a new one. Freeze this rule before Section 6's `POST /v1/admin/tenants/:tenantId/owner-invite` is implemented:

- Calling the owner-invite endpoint again for a tenant with an existing unaccepted invite must expire/replace the prior invite row, not create a second live token for the same email.
- The simplest compliant implementation: set the prior pending invite's `expiresAt` to now (or add `revokedAt`) before creating the replacement, so only one invite token for a given tenant/email can ever be accepted.

### 3.6 Disabled-module behavior

Freeze the following rule:

- Disabling a module does not delete module data.
- Existing screen bindings and configuration remain stored.
- The API rejects new use of the disabled module.
- The player receives no protected module payload.
- Re-enabling the module restores access to the existing data and screen bindings.
- A disabled screen should show Lumina's neutral unavailable/awaiting-content state, not expose commercial licensing details to public visitors.
- **Offline/cached module access uses a bounded lease; it is not indefinite.** On every successful `/player/state` response, the server must issue a per-module lease with `issuedAt` and `validUntil`, and the player must persist that lease with the cached presentation. The default offline grace period is seven days (`168` hours) and must be configurable through `PLAYER_ENTITLEMENT_OFFLINE_GRACE_HOURS`. When restoring cached state, the player may render protected module content only while the relevant lease remains valid. Once the lease expires, normal Wayfinding content must stop until the player successfully revalidates with the API. The cached data itself must remain stored so a successful revalidation can restore operation without re-downloading or reconstructing tenant configuration.
- **Emergency routing overrides both entitlement and offline-lease expiry.** If cached state has `emergencyActive === true`, the player must retain enough cached Wayfinding data to render the evacuation route even when the module is disabled, the tenant is suspended, or the offline lease has expired. This exception applies only to the evacuation experience; it must not reopen the normal directory, search, POI browsing, attract content, or other paid Wayfinding UI.
- The bounded player lease is an operational SaaS control, not a tamper-resistant on-premise license. Protecting a deployment where the customer controls the server, database, executable, or device clock requires a separate signed-license/node-locking design and is explicitly outside this foundation.

### 3.7 Live Super Admin authority

Freeze this platform-security rule before the control plane is implemented:

- JWT `isSuperAdmin` is not sufficient authorization for platform-administration operations because it may remain valid for up to seven days.
- Every `@RequireSuperAdmin()` request must re-read the current `User` row by the authenticated `sub` and require the current database value `isSuperAdmin === true`.
- Deleting the user or revoking the flag must take effect immediately for tenant creation, tenant suspension, module assignment, and every other Super Admin route.
- This foundation does not require a full live-role refresh for every ordinary tenant route; it requires live revalidation of the high-impact platform authority.

### 3.8 Phase A deliverable

Add a short Architecture Decision Record:

```text
docs/adr/platform-modules-and-entitlements.md
```

It must contain the decisions in Sections 3.1–3.7 and name the exported contracts that downstream modules must use.

**Phase A exit gate:** module keys, dependency rules, response shape, disabled behavior, bounded offline-lease policy, evacuation exception, owner-invite re-issue behavior, live Super Admin authority rule, and enforcement layers are approved and committed. No AI Wayfinding or Room Booking implementation begins before this gate.

**Plan status:** Milestone A1 is complete. The shared module catalog and dependency metadata, the capability response types, and the ADR are committed (`packages/types/src/modules.ts`, `docs/adr/platform-modules-and-entitlements.md`). Milestone B1 (persistence — `Organization.status`, `TenantModule`, migration and backfill) may begin.

---

## 4. Phase B — Data Model and Migration

### 4.1 Tenant status

Add an explicit tenant lifecycle state:

```prisma
enum OrganizationStatus {
  ACTIVE
  SUSPENDED
}

model Organization {
  // existing fields
  status        OrganizationStatus @default(ACTIVE)
  tenantModules TenantModule[]
}
```

Suspension is different from removing one module. It blocks the tenant as a whole while preserving all tenant data.

### 4.2 Tenant module entitlement

Add:

```prisma
enum TenantModuleStatus {
  ACTIVE
  TRIAL
  DISABLED
}

model TenantModule {
  id             String             @id @default(cuid())
  moduleKey      String
  status         TenantModuleStatus @default(ACTIVE)
  enabledAt      DateTime           @default(now())
  expiresAt      DateTime?
  createdAt      DateTime           @default(now())
  updatedAt      DateTime           @updatedAt

  organizationId String
  organization   Organization       @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@unique([organizationId, moduleKey])
  @@index([organizationId, status])
  @@index([expiresAt])
}
```

Keep `moduleKey` as a string constrained by the shared catalog at the service/DTO layer. This avoids a database enum migration every time a new commercial module is introduced, while still keeping one typed application-level registry.

Do not add speculative generic configuration or quota JSON in this phase. Module-specific limits must be added later with validated schemas when the commercial rule is known. A future screen limit, room limit, or AI usage allowance must not be represented by an unvalidated arbitrary blob.

### 4.3 Migration and backfill

The migration must:

1. Add `Organization.status` with `ACTIVE` as the safe default.
2. Create `TenantModule` and its indexes.
3. Backfill `WAYFINDING` as `ACTIVE` for existing organizations to avoid silently removing a feature that was previously available to all current tenants.
4. Leave `WAYFINDING_AI`, `ROOM_BOOKING`, and `INDOOR_POSITIONING` unassigned.
5. Be safe on both empty development databases and populated production databases.

The seed must ensure the designated Super Admin remains able to access the platform administration area. Avoid making Super Admin creation dependent on public registration.

---

## 5. Phase B — Entitlement Domain Service

Create a shared backend module, recommended location:

```text
apps/api/src/modules/entitlements/
  entitlements.module.ts
  entitlements.service.ts
  entitlement.guard.ts
  require-module.decorator.ts
  module-catalog.service.ts
  entitlements.service.spec.ts
  entitlement.guard.spec.ts
```

### 5.1 Required service operations

`EntitlementsService` must provide at least:

```ts
getCapabilities(organizationId)
hasModule(organizationId, moduleKey)
assertModule(organizationId, moduleKey)
setTenantModules(targetOrganizationId, assignments, actorUserId)
validateDependencies(assignments)
```

An entitlement is usable only when:

- the organization is `ACTIVE`;
- the entitlement status is `ACTIVE`, or it is `TRIAL` and has not expired;
- `expiresAt` is null or later than the current time;
- all declared module dependencies are usable.

Use one clock abstraction or injectable time provider in tests so expiry behavior is deterministic.

Start with direct database reads for correctness. Add caching only after measuring a real need. If caching is added later, every Super Admin entitlement mutation must invalidate it immediately.

### 5.2 Module guard

Add:

```ts
@RequireModule('WAYFINDING')
```

The guard must run after `JwtAuthGuard`, read `req.user.orgId`, and ask `EntitlementsService` for current state. It must return `403 Forbidden` without revealing cross-tenant details.

Do not use the guard on Super Admin control-plane endpoints that target another organization. Those endpoints must use `@RequireSuperAdmin()` and explicitly validate the target organization.

### 5.3 Capabilities endpoint

Add `GET /v1/org/capabilities` under normal authenticated tenant context.

Requirements:

- Return only the caller's current organization capabilities.
- Never accept an organization ID from the dashboard caller.
- Include disabled assignments so the dashboard can distinguish unavailable modules from unknown keys if needed.
- Compute expiry and dependency state on the server.
- Use a stable shared TypeScript response type from `packages/types`.

---

## 6. Phase B — Super Admin Tenant Control Plane

Create a dedicated platform administration module rather than expanding ordinary tenant-owned `OrgController` actions indefinitely:

```text
apps/api/src/modules/platform-tenants/
  platform-tenants.module.ts
  platform-tenants.controller.ts
  platform-tenants.service.ts
  dto/create-tenant.dto.ts
  dto/update-tenant-status.dto.ts
  dto/set-tenant-modules.dto.ts
  platform-tenants.service.spec.ts
```

All routes must use:

```ts
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@RequireSuperAdmin()
```

`SuperAdminGuard`'s current doc comment claims no route applies it yet; `GET /org/all` and all of `AdminTemplatesController` already do. Fix the stale comment while this file is central to Phase B.

Implement the live Super Admin authority invariant frozen in Section 3.7. The JWT establishes identity; the current database row establishes platform authority. No `/admin/tenants` or other Super Admin control-plane endpoint may rely only on the JWT's `isSuperAdmin` value.

### 6.1 API surface

Recommended endpoints:

```http
GET    /v1/admin/tenants
POST   /v1/admin/tenants
GET    /v1/admin/tenants/:tenantId
PUT    /v1/admin/tenants/:tenantId/status
PUT    /v1/admin/tenants/:tenantId/modules
POST   /v1/admin/tenants/:tenantId/owner-invite
```

`GET /admin/tenants` should supersede the limited tenant picker use case currently served by `GET /org/all`, but the existing endpoint may remain temporarily for template compatibility.

### 6.2 Create-tenant transaction

Creating a tenant must be atomic:

1. Validate and normalize the requested slug.
2. Create the `Organization` as `ACTIVE`.
3. Create the selected module assignments after dependency validation.
4. Create an `OWNER` `OrgInvite` for the initial owner email.
5. Write a platform audit event.
6. Return the tenant summary and owner invite URL/token.

Reuse the existing invite acceptance flow instead of asking the Super Admin to choose or know the customer's password. Email delivery is not yet present, so the dashboard may initially provide a copyable invite link, matching the current member-invite behavior.

Do not create an owner user with a shared temporary password.

### 6.3 Public registration

The production business flow is Super-Admin-provisioned tenants. Change public registration as follows:

- Add `ALLOW_SELF_REGISTRATION` to environment validation.
- Default it to `false` in production examples/configuration.
- When disabled, `POST /auth/register` must reject registration without creating any records.
- Hide or redirect the dashboard registration page when self-registration is disabled.
- Keep seed/bootstrap tooling as the supported way to establish the first Super Admin.
- Add a test proving registration cannot bypass Super Admin tenant provisioning.

Do not remove the registration implementation entirely; keeping it behind an explicit environment policy preserves development and possible future self-service plans.

While `auth.service.ts` is already being touched for this gate: `AuthService.register()` currently creates the `Organization` and the owner `User` as two sequential, non-transactional `create()` calls (unlike `OrgService.acceptInvite`, which already uses `$transaction`). A failure between the two calls leaves an orphan `Organization` row. Wrap both creates in a `$transaction`, using the same pattern the new create-tenant flow in Section 6.2 requires anyway.

### 6.4 Tenant suspension

When a Super Admin suspends a tenant:

- New logins must be rejected.
- Existing authenticated API requests must be rejected after current tenant status is checked.
- Player state must not expose tenant content.
- Existing data must remain intact.
- The action must be audited.

If fully enforcing tenant suspension across all API routes would require a new global authenticated guard, implement and test that guard as part of this phase. Do not scatter ad hoc suspension checks through individual services.

---

## 7. Phase B — Dashboard Capability Layer

### 7.1 Capability provider and hook

Add a single dashboard capability source, for example:

```text
apps/dashboard/src/context/CapabilitiesContext.tsx
apps/dashboard/src/hooks/useCapabilities.ts
apps/dashboard/src/hooks/useModuleAccess.ts
```

It must:

- Load `GET /org/capabilities` after authentication.
- Expose `hasModule(moduleKey)` and tenant status.
- Deduplicate concurrent requests.
- Provide explicit loading and error states.
- Refetch after Super Admin changes when the current tenant is affected.
- Avoid copying entitlement logic into individual pages.

Do not merge tenant module ownership into `usePermissions()`. Roles and commercial entitlements are different axes and should remain visibly separate in code.

### 7.2 Navigation filtering

Update the main dashboard navigation in:

```text
apps/dashboard/src/app/[locale]/(app)/layout.tsx
```

Extend `NavItem` with a module requirement, for example:

```ts
requiredModule?: ModuleKey
```

Mark the existing `/wayfinding` entry as requiring `WAYFINDING`.

Navigation must wait for capabilities before rendering optional module entries, preventing a brief flash of unauthorized navigation.

### 7.3 Route protection

Add a module-aware route guard, separate from the existing role-oriented `useRouteGuard()`:

```ts
useModuleRouteGuard('WAYFINDING')
```

Apply it to the Wayfinding management page. A direct URL visit by an unlicensed tenant must redirect to a safe dashboard page and must not start protected data queries.

The API remains the final authority; this route guard is defense in depth and prevents noisy `403` requests.

### 7.4 Super Admin pages

Add:

```text
apps/dashboard/src/app/[locale]/(app)/admin/tenants/page.tsx
apps/dashboard/src/app/[locale]/(app)/admin/tenants/[tenantId]/page.tsx
```

Minimum UI:

- Tenant list with name, slug, status, module summary, and created date.
- Create Tenant action.
- Initial owner email and copyable invite link.
- Tenant detail page.
- Active/suspended control with confirmation.
- Module checklist/status editor.
- Optional trial expiry input.
- Dependency-aware validation before submit.
- Clear success and error feedback.
- Super Admin-only navigation item.

Do not add pricing, invoices, Stripe checkout, plan marketing, or usage billing to this page.

---

## 8. Phase B — Convert Existing Wayfinding into the First Licensed Module

Wayfinding is the vertical slice used to prove the platform foundation. Do not rebuild its current feature set.

### 8.1 API controllers

Apply `@RequireModule('WAYFINDING')` to all tenant-authenticated Wayfinding management surfaces:

- buildings and floors;
- POI categories and POIs;
- route graph nodes and edges;
- building evacuation and kiosk screen-group synchronization;
- authenticated Wayfinding analytics/report queries.

Keep player-authenticated ingestion under separate runtime rules; it must validate entitlement using the screen's organization rather than a dashboard JWT organization.

### 8.2 Screen configuration

Update `ScreensService` so the server rejects:

- setting `streamingType` to `WAYFINDING` without the entitlement;
- setting or changing a kiosk location without the entitlement;
- setting Wayfinding attract content without the entitlement;
- Wayfinding-specific building operations without the entitlement.

Do not rely on the dashboard to prevent these requests.

The Screens page must:

- hide the `WAYFINDING` streaming-type option when unavailable;
- avoid fetching buildings/POIs for an unavailable tenant;
- hide kiosk location and attract-content controls when unavailable;
- preserve the selected `WAYFINDING` value in stored data if the module is later disabled, while presenting a clear admin-side unavailable state.

### 8.3 Player state

Before hydrating Wayfinding data, `PlayerService.getState()` must validate `WAYFINDING` against the organization associated with the paired screen. `PlayerService` queries `Building`/`Floor`/`Poi`/`RouteNode`/`RouteEdge` directly and does not go through the Wayfinding module's own services — gating the four Wayfinding controllers with `@RequireModule` has no effect on this path, so this check must be added explicitly inside `PlayerService`.

Apply the same check inside `PlayerService.getManifest()`, not just `getState()`. `getManifest()` wraps `getState()` and is the payload actually consumed by the OPFS/offline-caching pipeline (`presentation-preparer.ts` / `rewrite-player-state.ts`) that gets persisted and restored on player boot — the state returned by `getState()` alone is not what ends up cached for offline use.

`PlayerState` is not currently a shared type in `packages/types` despite the name. It is independently defined twice: as an untyped inferred return from `apps/api/src/modules/player/player.service.ts`'s `getState()`, and as a hand-written interface at `apps/player/src/lib/api.ts:384-408` that the player app's presentation layer (`apps/player/src/lib/presentation/types.ts`) imports directly. Extend both by hand and keep them in sync; do not assume `packages/types` enforces this today.

Extend the player-side lease collection rather than a Wayfinding-only timestamp, for example:

```ts
interface PlayerModuleLease {
  key: ModuleKey;
  issuedAt: string;
  validUntil: string;
}

interface PlayerState {
  // existing fields
  moduleLeases: PlayerModuleLease[];
}
```

Lease behavior:

- Issue a lease only after the server has resolved the module as currently usable for that screen's organization.
- Calculate `validUntil` from the server clock using `PLAYER_ENTITLEMENT_OFFLINE_GRACE_HOURS`, defaulting to `168` hours.
- Persist the lease as part of the same cached player-state snapshot; do not create a second cache with independent lifecycle rules.
- Validate the cached lease in the player restore/apply path before rendering protected module UI.
- Treat a missing or malformed lease as expired for normal paid-module rendering.
- Do not delete the cached presentation when a lease expires; suppress its protected runtime branch until a fresh server state renews the lease.
- Keep the mechanism generic so Room Booking or another future player-facing module can use the same contract without adding a parallel offline-license system.

This lease bounds ordinary offline use but is not claimed to resist a customer who controls and modifies the browser code, IndexedDB, operating-system clock, or on-premise server. Strong anti-tamper licensing remains a separate product-security concern.

**Evacuation bypass (required, not optional):** `Screen.emergencyActive` combined with a populated `wayfinding` payload drives the player's fullscreen evacuation-route view; if `emergencyActive` is true but `wayfinding` is unavailable, the player falls through to a generic "kiosk location not set" splash instead of showing an exit route. The entitlement check added here must not suppress the `wayfinding` payload while `emergencyActive === true` for that screen. This mirrors how `ScreensService.setEmergency` already bypasses the unrelated `autoPublish` gate for the same reason — evacuation display must never be blocked by unrelated business-rule enforcement.

For an unlicensed or expired tenant (outside of an active evacuation):

- return no Wayfinding building, POI, route graph, floor-plan, analytics, or attract-content payload;
- return a neutral state that the existing player can render safely;
- do not delete `KioskLocation` or change `Screen.streamingType`;
- write an operational log/metric suitable for diagnosing why the screen has no active module payload;
- avoid revealing commercial account details on the public display.

When the module is re-enabled, the next state refresh/publish must restore the previous Wayfinding configuration.

### 8.4 Live entitlement changes

After a Super Admin changes `WAYFINDING` for a tenant:

- notify or publish to all affected screens so they refresh promptly;
- invalidate dashboard capability queries for the current browser session when applicable;
- guarantee server-side enforcement immediately even if a dashboard or player has cached old state.

The existing WebSocket publish infrastructure should be reused. Do not create a second screen-notification mechanism. Concretely: there is no org-wide WebSocket room that includes players today (only dashboard sockets join `org:${orgId}`; players only join `screen:${screenId}`), so this must be a fan-out loop over the affected organization's screens calling `ScreenGateway.sendToScreen(screenId, { type: 'reload' })` per screen — the same pattern `BuildingsService.setEvacuation` already uses to push to every kiosk in a building.

---

## 9. Security and Audit Requirements

1. All tenant-management APIs are Super Admin-only on the server.
2. Every target tenant ID is loaded explicitly and validated; never substitute the Super Admin's own `orgId` for the target.
3. A normal tenant owner cannot grant modules to their own tenant.
4. DTOs accept only module keys from the shared catalog.
5. Dependency validation is performed server-side.
6. Module state is not trusted from the client, cookies, local storage, or JWT claims.
7. Cross-tenant responses return only fields required by the platform administration UI.
8. Tenant creation, status changes, owner invitations, and module changes are audited.
9. Audit metadata records previous and new module states without storing invite tokens, passwords, or secrets.
10. Disabling or suspending access never deletes customer data.

Recommended audit actions:

```text
tenant.create
tenant.status.update
tenant.owner_invite.create
tenant.modules.update
tenant.module.activate
tenant.module.disable
tenant.module.trial.update
```

---

## 10. Testing Strategy

### 10.1 Unit tests

Test:

- module key validation;
- dependency validation;
- active, disabled, trial, expired, and tenant-suspended decisions;
- `@RequireModule` guard allow/deny behavior;
- deterministic expiry using a controlled clock;
- Super Admin guard behavior remains independent from tenant role rank.

### 10.2 Service and API tests

Test:

- only Super Admin can list/create/update tenants;
- tenant creation transaction creates organization, module assignments, owner invite, and audit entry;
- a transaction failure leaves no partial tenant;
- public registration cannot create a tenant when disabled;
- a normal tenant cannot modify its own entitlements;
- a tenant cannot query another tenant's capabilities;
- dependency-invalid assignments are rejected;
- Wayfinding APIs return `403` without entitlement and work with entitlement;
- disabling Wayfinding preserves all existing Wayfinding rows;
- re-enabling Wayfinding restores access;
- assigning `WAYFINDING` streaming type is rejected without entitlement;
- player state excludes Wayfinding data after disable/expiry;
- suspended tenant login/API/player access is blocked.
- revoking `User.isSuperAdmin` immediately blocks platform-administration requests made with an already-issued JWT;
- a missing/deleted Super Admin user is rejected even when the JWT contains `isSuperAdmin: true`;
- a cached Wayfinding presentation renders normally before its offline lease expires and stops normal module rendering afterward;
- an active evacuation route remains available from cached data after entitlement or offline-lease expiry, without reopening the normal Wayfinding UI.

### 10.3 Dashboard tests

Test at least these states:

- Super Admin sees the Tenants navigation and management pages.
- Normal users never see platform administration entries.
- Tenant with Wayfinding sees `/wayfinding` and the screen mode.
- Tenant without Wayfinding sees neither.
- Direct `/wayfinding` navigation redirects without protected queries.
- Loading capabilities does not flash unauthorized navigation.
- Super Admin module updates display dependency errors correctly.
- Creating a tenant produces a usable owner invitation flow.

### 10.4 End-to-end acceptance scenario

Automate or manually verify this exact scenario against the real development stack:

1. Sign in as Super Admin.
2. Create Tenant A with `WAYFINDING` active.
3. Create Tenant B without `WAYFINDING`.
4. Accept each tenant's owner invitation.
5. Confirm Tenant A sees and uses Wayfinding.
6. Confirm Tenant B cannot see the navigation entry, open the page directly, call the API, or select the screen mode.
7. Configure a real Wayfinding building/kiosk for Tenant A.
8. Disable `WAYFINDING` for Tenant A.
9. Confirm the dashboard loses access and the player stops receiving Wayfinding payloads.
10. Confirm the building, floors, POIs, route graph, and kiosk binding still exist in the database.
11. Re-enable `WAYFINDING`.
12. Confirm the previous configuration works again without reconstruction.
13. Suspend Tenant A and confirm login, API, and player runtime are blocked while data remains intact.

---

## 11. Implementation Sequence

### Milestone A1 — Contract freeze — complete

- [x] Add shared module keys and dependency metadata. (`packages/types/src/modules.ts`)
- [x] Add shared capability response types. (`TenantCapabilities` in `packages/types/src/modules.ts`)
- [x] Write the entitlement ADR. (`docs/adr/platform-modules-and-entitlements.md`)
- [x] Approve disabled-module and tenant-suspension behavior. (two-pass technical review, see commit history)

### Milestone B1 — Persistence

- [ ] Add organization/module status models.
- [ ] Create migration and existing-tenant backfill.
- [ ] Update seed/bootstrap behavior.
- [ ] Verify migration on empty and populated database copies.

### Milestone B2 — Backend entitlement kernel

- [ ] Add entitlement module/service/decorator/guard, following `OrgScopedService`'s existing org-ownership conventions.
- [ ] Add capabilities endpoint.
- [ ] Add dependency and expiry validation.
- [ ] Add unit and API tests.

### Milestone B3 — Super Admin control plane API

- [ ] Add tenant list/detail/create/status/module APIs.
- [ ] Reuse owner invitation flow; expire/replace any prior pending invite when re-issuing (Section 3.5).
- [ ] Add platform audit events via the existing `AuditService.log()` — do not build new audit infrastructure.
- [ ] Gate public registration through environment policy; wrap `AuthService.register()`'s org+user creation in a `$transaction` while touching this file.
- [ ] Add suspension enforcement.
- [ ] Make `SuperAdminGuard` revalidate `User.isSuperAdmin` from the database on every protected request, and fix its stale "no route uses this" doc comment.

### Milestone B4 — Dashboard foundation

- [ ] Add capability provider/hooks.
- [ ] Add module-aware navigation and route guard.
- [ ] Add Super Admin tenant list/create/detail/module UI.
- [ ] Add English and Arabic translations.

### Milestone B5 — Wayfinding vertical slice

- [ ] Gate Wayfinding controllers and analytics.
- [ ] Gate Wayfinding screen configuration.
- [ ] Gate Wayfinding queries and controls in the dashboard.
- [ ] Gate player state hydration directly inside `PlayerService` (controller-level gating alone does not cover this path — see Section 8.3).
- [ ] Verify the evacuation bypass: an active evacuation on a de-licensed kiosk still shows the exit route, not the "kiosk location not set" splash.
- [ ] Add the configurable seven-day offline module lease to fresh player state and enforce it when restoring cached state.
- [ ] Verify lease expiry stops normal Wayfinding but never disables the cached evacuation route.
- [ ] Refresh affected screens after entitlement changes via a `ScreenGateway.sendToScreen` fan-out over the org's screens (Section 8.4).
- [ ] Verify disable/re-enable preserves data.

### Milestone B6 — Verification and handoff

- [ ] Run API, dashboard, player, type-check, lint, and relevant unit suites.
- [ ] Run the end-to-end acceptance scenario.
- [ ] Document stable downstream integration contracts.
- [ ] Record known limitations without expanding this phase's scope.
- [ ] Tag/merge the foundation before parallel module work begins.

---

## 12. Files Expected to Change

This list is directional; implementation may refine names while preserving boundaries.

### Shared packages

```text
packages/types/src/modules.ts
packages/types/src/index.ts
```

### API

```text
apps/api/prisma/schema.prisma
apps/api/prisma/migrations/<timestamp>_add_tenant_modules/migration.sql
apps/api/src/app.module.ts
apps/api/src/config/env.validation.ts
apps/api/src/modules/entitlements/**
apps/api/src/modules/platform-tenants/**
apps/api/src/modules/auth/auth.service.ts
apps/api/src/modules/auth/auth.controller.ts
apps/api/src/modules/org/org.controller.ts
apps/api/src/modules/org/org.service.ts
apps/api/src/modules/wayfinding/**
apps/api/src/modules/screens/screens.service.ts
apps/api/src/modules/player/player.service.ts
apps/api/src/modules/kiosk-analytics/**
```

### Player

```text
apps/player/src/lib/api.ts
apps/player/src/pages/PlayerPage.tsx
apps/player/src/lib/presentation/activation-coordinator.ts
apps/player/src/lib/presentation/rewrite-player-state.ts
apps/player/src/lib/presentation/types.ts
apps/player/src/lib/presentation/<relevant lease tests>
```

### Dashboard

```text
apps/dashboard/src/context/CapabilitiesContext.tsx
apps/dashboard/src/hooks/useCapabilities.ts
apps/dashboard/src/hooks/useModuleAccess.ts
apps/dashboard/src/hooks/useModuleRouteGuard.ts
apps/dashboard/src/lib/api.ts
apps/dashboard/src/app/[locale]/(app)/layout.tsx
apps/dashboard/src/app/[locale]/(app)/admin/tenants/**
apps/dashboard/src/app/[locale]/(app)/wayfinding/page.tsx
apps/dashboard/src/app/[locale]/(app)/screens/page.tsx
apps/dashboard/src/app/[locale]/(app)/reports/page.tsx
apps/dashboard/messages/en.json
apps/dashboard/messages/ar.json
```

### Documentation

```text
docs/adr/platform-modules-and-entitlements.md
Roadmap.md
```

---

## 13. Parallel Work Boundary After This Plan

AI Wayfinding and Room Booking may begin in parallel only after all of the following are merged and stable:

- `ModuleKey` and module dependency exports;
- `TenantModule` persistence and migration;
- `EntitlementsService`;
- `@RequireModule()`;
- `GET /org/capabilities` response contract;
- dashboard `hasModule()` and route-guard contract;
- Super Admin module-assignment API;
- Wayfinding end-to-end entitlement test proving all enforcement layers;
- documented pattern for player-side module enforcement.

The full visual polish of the Super Admin tenant page does not have to block parallel work if the assignment API and shared contracts are complete and tested.

After the gate:

- The AI Wayfinding owner uses `@RequireModule('WAYFINDING_AI')` and depends on `WAYFINDING` through the shared catalog.
- The Room Booking owner uses `@RequireModule('ROOM_BOOKING')` and creates a separate domain module.
- Neither owner adds new entitlement tables, guards, capability endpoints, or competing navigation logic.
- One integration owner controls edits to high-conflict shared files such as `schema.prisma`, `app.module.ts`, the main dashboard layout, shared API client exports, player contracts, and translation roots.

Recommended branches/worktrees:

```text
feature/platform-modules
feature/ai-wayfinding
feature/room-booking
```

The two feature branches must start from the merged platform foundation, not from the pre-foundation baseline.

---

## 14. Definition of Done

Phases A and B are complete only when:

- [ ] Tenant/module decisions are documented in an ADR.
- [ ] Super Admin can create a tenant inside the existing Lumina dashboard.
- [ ] The initial owner can activate an account through the existing invitation mechanism.
- [ ] Public tenant creation is disabled by production policy.
- [ ] Super Admin can activate, trial, disable, and expire modules.
- [ ] Module dependencies are validated by the server.
- [ ] Tenant status and module status are enforced independently.
- [ ] Wayfinding is hidden and blocked for unlicensed tenants at every required layer.
- [ ] Direct API calls cannot bypass module restrictions.
- [ ] Player payloads cannot bypass module restrictions.
- [ ] Cached normal module payloads stop rendering after the bounded offline lease expires.
- [ ] Emergency evacuation routing remains available after entitlement or offline-lease expiry without restoring normal Wayfinding access.
- [ ] Disabled module data remains intact and returns after reactivation.
- [ ] Existing tenants retain current Wayfinding access after migration.
- [ ] Tenant creation and entitlement changes are audited.
- [ ] Revoked Super Admin authority takes effect immediately for platform-administration routes, regardless of JWT age.
- [ ] Relevant unit, integration, and end-to-end tests pass.
- [ ] The downstream parallel-work contracts are exported, documented, and stable.

At this point, create and execute the separate `ai_wayfinding_module_plan.md` and `room_booking_module_plan.md` in parallel.

---

## 15. Explicit Non-Goals

Do not add any of the following while executing this plan:

- AI chat, speech-to-text, LLM providers, or semantic destination search;
- new Wayfinding map/routing functionality;
- room, booking, check-in, or calendar models;
- Microsoft 365 or Google Workspace integrations;
- BLE beacon or live indoor-positioning support;
- Stripe, invoices, automatic payment handling, or public pricing plans;
- per-user module overrides;
- customer-visible module purchasing or self-upgrade flows;
- deletion of data when access is disabled;
- a second dashboard, application, authentication system, or player.

These boundaries are required to keep the foundation small, testable, and safe for the parallel phase that follows.
