# Lumina Tenant Isolation and Platform Administration Remediation Plan

**Repository:** `BasSparkco/Lumina`  
**Baseline reviewed:** `main` at `4114f3b6a03fc7ad0ce914596722835ad3f5dffd` (2026-09-05)  
**Revision:** 2.0 — incorporates the complete independent implementation review received on 2026-09-05  
**Scope:** Tenant isolation, shared platform libraries, member management, authentication/session invalidation, and the Super Admin tenant control plane  
**Priority:** Security and SaaS foundation; complete P0 and the immediate trust-boundary milestones before adding more cross-tenant or tenant-owned persistence

---

## 1. Executive Decision

Lumina already uses `Organization` as its tenant boundary and most mature API services explicitly filter root records by `organizationId`. That is a useful foundation, but it is not yet a complete tenant-isolation system.

The implementation must establish one enforceable rule:

> A request may access tenant-private data only through a server-resolved tenant context. Client-supplied tenant identifiers, object identifiers, browser state, filenames, and URLs never grant access.

Platform-shared content is a separate data class. Tenants may read published shared assets and templates, but only a platform-authorized operator may create, edit, publish, archive, or delete their source records. When a tenant customizes shared content, Lumina creates a tenant-owned copy; it never updates the platform source.

Do not treat the visible Members issue as the only defect. Fixing that page without the remaining milestones would remove the symptom while leaving several architectural gaps.

---

## 2. Confirmed Current-State Findings

### 2.1 Members is not connected to the real tenant API

The deployed Members page and the current repository both import:

```text
apps/dashboard/src/lib/mocks/members.ts
```

That module seeds the same four demo people for every account and stores changes under the single browser-wide key `lumina_mock_members`. Consequently, two tenants used in the same browser see the same mock list. This is not evidence that PostgreSQL returned another tenant's `User` rows, but it is an invalid production behavior and creates exactly the cross-tenant appearance reported.

The real API already contains tenant-scoped endpoints:

- `GET /v1/org/members`
- `GET /v1/org/invites`
- `POST /v1/org/invite`
- `PUT /v1/org/members/:id/role`
- `DELETE /v1/org/members/:id`
- `POST /v1/org/invite/accept`

`OrgService.listMembers()` and the member mutation ownership checks correctly use the caller's JWT `orgId`. The dashboard and invite-acceptance page must be migrated from the mock to these endpoints.

### 2.2 A Super Admin tenant control plane exists, but it is incomplete

Current `main` already contains:

- `/admin/tenants`
- `/admin/tenants/:tenantId`
- `PlatformTenantsController`
- `PlatformTenantsService`
- tenant creation with an OWNER invite
- tenant suspension/reactivation
- optional-module assignment
- owner-invite reissue

The sidebar exposes the page only when `user.isSuperAdmin` is true. The current detail page does not show tenant users, invitations, screen/file/storage counts, activity, owner details, or audit history. It cannot edit tenant identity, transfer ownership, change an owner email, issue a password-reset flow, revoke sessions, or inspect operational health.

The reported absence of the page must therefore be checked as a deployment/account-state issue, not implemented as if no control plane exists.

### 2.3 Tenant scoping is widespread but manually repeated

Assets, playlists, screens, layouts, schedules, screen groups, designs, Wayfinding, AI Wayfinding, and Room Booking generally begin with an `organizationId` filter or an ownership assertion. However, the protection depends on every developer remembering to apply it in every new service method.

`OrgScopedService.assertOwns()` only executes a caller-provided query. It cannot detect that the caller forgot `organizationId`. There is no central tenant-aware repository, Prisma extension, database row-level security policy, or test that fails when a new tenant-root query is unscoped.

### 2.4 Not every tenant-owned table carries a direct tenant key

Root records usually carry `organizationId`, but many child records inherit tenant ownership only through a parent, including `PlaylistItem`, `Zone`, `Floor`, `Poi`, `PoiAlias`, `KioskLocation`, `RouteNode`, `RouteEdge`, `RoomDisplayBinding`, `RoomReservation`, `DesignAssetVersion`, and `AssetBinary`.

Inherited ownership can be valid, but the database currently cannot universally prevent a cross-tenant relationship. Application services must validate both sides before writing, and the schema should add composite tenant constraints to high-risk relations.

`Screen.organizationId` is nullable because anonymous `POST /player/init` pairing creates an unowned screen row. This weakens the principal tenant-root invariant. The endpoint already has a controller-level throttle of 20 requests per 60 seconds; the issue is therefore not an absence of rate limiting, but that anonymous calls still create durable `Screen` records and the current limit may be too coarse for abuse prevention. Pairing requests should become a separate short-lived model so every real `Screen` is tenant-owned and `organizationId` can become required.

`DesignDraft.documentId` is globally unique even though drafts are tenant-owned. It should be unique per tenant (and normally per user/document), not across the entire SaaS platform.

### 2.5 Private media is publicly retrievable when its path is known

`MediaController` is deliberately unauthenticated and builds an object key directly from `:orgId` and `:filename`. The comment relies on the organization ID plus UUID filename being difficult to guess. The same pattern serves screen screenshots.

An unguessable URL is not authorization. URLs can leak through browser history, logs, referrers, screenshots, support messages, analytics, or a copied design payload. Anyone who obtains the URL can retrieve the tenant's file without proving tenant membership or screen authorization.

This fails the strict requirement that one tenant must not see another tenant's files.

### 2.6 Shared-library write authority is modeled as a tenant role

The shared asset library uses `Asset.organizationId = null`, which is an appropriate representation for globally readable platform content. However, its write routes are protected by `@Roles('LIBRARY_MANAGER')`.

`LIBRARY_MANAGER` is a `UserRole` inside a tenant and is selectable when inviting tenant members. Therefore, a tenant-level user can be granted authority over the platform-wide shared library. Shared-library management is platform authority and must not be granted through a tenant role.

Use `isSuperAdmin` for the first production version. If delegation is needed later, introduce an explicit platform role such as `PLATFORM_LIBRARY_MANAGER`; do not reuse `User.role`.

### 2.7 User and WebSocket authorization can remain stale

Dashboard JWT validation currently trusts the `orgId` and `role` embedded in a token for its full lifetime. It does not verify that the user still exists or that the user's current organization and role still match. Removing a member, changing a role, resetting a password, or changing account ownership does not immediately revoke already-issued JWTs.

The WebSocket gateway also joins `org:${payload.orgId}` directly from the token without a live user/tenant check. A removed member can therefore retain REST and WebSocket access until token expiry.

Tenant suspension is checked live, and Super Admin authority is revalidated live, but ordinary membership/session validity is not.

### 2.8 Shared templates are partly versioned already, with two remaining hazards

`DesignTemplate` is platform-owned, its admin endpoints require Super Admin, and a tenant creates a new `DesignAsset` rather than editing the source. This is the correct basic model.

`DesignTemplateVersion` already exists and `adminPublish` already creates an immutable version transactionally. This milestone is therefore not a new versioning subsystem. The missing piece is an explicit published-version pointer and routing all customer reads and design creation through that immutable snapshot.

Remaining issues:

- Customer reads use the live `DesignTemplate.designJson`, so edits made after publishing can become visible before the next explicit publish. Customer reads should resolve an immutable published version.
- `DesignTemplate.thumbnailAssetId` is not constrained to a platform-library asset. A template must never expose a thumbnail belonging to one tenant to all other tenants.

Template visibility through `SELECTED_TENANTS`/`DesignTemplateTenant` is distinct from product entitlement through `TenantModule`/`TenantModuleStatus`. The implementation and admin UI must name these mechanisms separately and must not infer one from the other.

### 2.9 Additional preview mocks are browser-global

Members is not the only route still backed by browser-local demo state. Billing, uptime, approvals, proof-of-play, parts of audit logging, and screen-group tagging/assignment use `localStorage` mocks. These are not PostgreSQL cross-tenant leaks, but their keys are not tenant-scoped and can display one account's browser-local state after another account signs in.

Billing is currently hidden from production navigation and guarded with `useRouteGuard(false)`, so its mock is dormant rather than actively exposed. It remains cleanup work but is the lowest-priority mock. Screen groups must be treated as two separate capabilities: group volume control already uses a real backend API, while group definitions/tagging and screen-to-group assignment remain mocked.

Every production route must either use a real tenant-scoped backend or be visibly disabled as a demo-only feature. A tenant switch/logout must clear in-memory query data, and every sensitive React Query key—not only Members—must include the authenticated organization identity.

### 2.10 Existing platform audit rows violate tenant ownership assumptions

`PlatformTenantsService` and `EntitlementsService.setTenantModules()` currently write a target tenant's `AuditLog` row while setting `userId` to the Super Admin actor from another organization. That cross-organization actor reference is an existing data-integrity defect, not a hypothetical future risk.

Adding a composite `(userId, organizationId)` foreign key or tenant RLS without repairing this representation will fail on existing rows or expose platform-actor identity through tenant audit views. Platform actions require a distinct platform audit model or explicit nullable `platformActorUserId` representation, plus an audit and backfill of historical cross-organization rows before tenant constraints are enabled.

### 2.11 Isolation verification starts from a limited baseline

The reviewed baseline has only 17 API spec files and targeted cross-tenant/IDOR assertions in approximately four areas: designs, room booking, playlists, and AI Wayfinding. P9 is therefore a new systematic security suite, not an incremental completion of broad existing coverage. Estimates and release scheduling must reflect that.

---

## 3. Data Classification Contract

Every persisted record and API response must belong to exactly one class.

| Class | Examples | Read authority | Write authority |
|---|---|---|---|
| Tenant-private | users, invites, tenant assets, playlists, screens, schedules, layouts, designs, buildings, POIs, rooms, reservations, analytics, screenshots | authenticated member of the owning tenant, subject to role | authorized member of the owning tenant |
| Platform-shared published | stock images/video/audio/backgrounds, system themes, published design templates, fonts, provider catalog, system POI categories | authenticated active tenants; player only when referenced by its authorized presentation | Super Admin or explicit platform operator only |
| Platform-private | tenant registry, module assignments, platform audit, unpublished templates, global library drafts | Super Admin/platform operator only | Super Admin/platform operator only |
| Device-private | player state, manifests, commands, screenshots, heartbeat and crash data | the paired screen and authorized members of its tenant | paired screen or authorized member of its tenant |
| Public | login, narrowly limited invite-token validation, pairing initialization | anonymous, rate-limited | only the exact public workflow; never arbitrary data access |

Rules:

1. `organizationId = null` means platform-owned only on models explicitly declared shareable. It must never mean “unscoped” or “unknown.”
2. A tenant may reference shared content only through an explicitly supported read path or by creating a tenant-owned copy.
3. A tenant-private record must never be returned because its ID was supplied by the client without an ownership predicate.
4. Unauthorized and nonexistent object IDs return the same `404` response to prevent tenant enumeration.
5. Super Admin cross-tenant operations use `/admin/*` services and an explicit target tenant. Normal tenant routes never accept a tenant ID.

---

## 4. Target Authorization Architecture

### 4.1 Server-resolved request context

Create a request-scoped `TenantContext` after authentication:

```ts
interface TenantContext {
  userId: string;
  organizationId: string;
  role: UserRole;
  isSuperAdmin: boolean;
  authVersion: number;
  organizationStatus: OrganizationStatus;
}
```

The server loads this from the current `User` and `Organization` rows. Do not trust `organizationId`, role, Super Admin authority, or session version solely because it is present in the JWT.

The JWT remains a signed session locator containing `sub`, `authVersion`, and expiration. The live database record remains authoritative.

### 4.2 Tenant-aware data access

Introduce a small, explicit tenant repository layer rather than a generic CRUD abstraction. It should expose helpers such as:

```ts
tenantDb.assets(ctx).findMany(...)
tenantDb.assets(ctx).findById(id)
tenantDb.playlists(ctx).findById(id)
tenantDb.screens(ctx).findById(id)
```

The helper owns the `organizationId` predicate. Services should not receive a raw tenant ID from controllers and then manually reconstruct filters throughout the code.

For child entities, provide named ownership resolvers through their parent path. Example: `findPoiForTenant(ctx, poiId)` resolves `poi.floor.building.organizationId`.

Keep a dedicated `platformDb` surface for deliberate cross-tenant and shared-library operations. Importing it should be limited to `/admin/*`, entitlement, and platform-library modules.

### 4.3 Database defense in depth

Application checks remain mandatory, but the database should reject cross-tenant relationships even if a future service misses a validation.

For high-risk references:

1. Add `organizationId` to tenant-owned child records where practical.
2. Add composite unique keys such as `@@unique([id, organizationId])` on tenant roots.
3. Replace single-column foreign keys with composite `(resourceId, organizationId)` foreign keys for tenant-to-tenant relations.
4. Keep platform-shared references separate from tenant-private references or force shared content to be copied before it enters a tenant playlist/design.
5. Add migration-time orphan and cross-tenant integrity checks before constraints are enabled.

PostgreSQL Row-Level Security is an optional later containment layer, not a schema-only task and not a prerequisite for the first isolation release. The current API and worker use a shared `PrismaPg` connection role and have no `SET LOCAL`, session-GUC, PgBouncer, or database-role separation infrastructure. RLS therefore requires its own architecture decision and milestone: separate database roles/connections for tenant traffic, platform administration, devices/workers, and migrations; request transactions that set tenant context transaction-locally; failure-safe behavior when the context is absent; and tests proving pooled connections cannot retain a previous tenant context. Do not enable RLS in production until this design passes its dedicated gates.

### 4.4 Platform authorization

Do not overload tenant roles with platform privileges.

Initial rule:

```text
User.role                 -> authority inside User.organizationId
User.isSuperAdmin         -> platform control-plane authority
```

If platform delegation is later required, replace the boolean with or add a typed platform-role model. Platform roles must be live-validated and separately audited.

### 4.5 Session revocation

Add `User.authVersion Int @default(1)` (or a session table). Include it in new JWTs and compare it on every authenticated request and WebSocket connection.

Increment `authVersion` when:

- a password is reset or changed;
- email/login identity changes;
- role changes;
- ownership is transferred;
- a member is disabled/removed;
- an administrator selects “revoke sessions.”

Deleting a user must invalidate access immediately because authentication now requires a live user row.

Super Admin session-revocation actions in P6a depend directly on this primitive. They must not be scheduled or released independently of P2.

### 4.6 Dashboard identity and cache boundary

Authentication state is also a client-side tenant boundary. Every sensitive React Query key must include at least the live `organizationId` and the relevant resource identity. On login, logout, user change, organization change, or detected `authVersion` mismatch, cancel in-flight requests and clear the entire authenticated query cache before rendering the next identity. Do not solve this only inside the Members page.

---

## 5. Implementation Milestones

### P0 — Freeze risky feature expansion and establish the isolation inventory

**Status: done (2026-09-05).** ADR, ownership matrix, and PR-template engineering rule all landed — see `docs/tenant-isolation/README.md` and `ownership-matrix.md`. Freeze lifted 2026-09-05 once P1–P3 passed. Task 3 (generated inventory replacing the hand-built matrix) is deferred to P9, as the plan itself allows.

**Goal:** Prevent new unclassified persistence while the boundary is repaired.

Tasks:

1. Create `docs/adr/tenant-isolation-and-shared-content.md` containing Sections 3 and 4 of this plan.
2. Build a working ownership matrix for every model, route, event, storage prefix, and dashboard surface touched by P1–P7. Do not attempt to keep an exhaustive hand-written list synchronized indefinitely.
3. Generate the exhaustive repository inventory from Prisma schema and route/event/storage declarations in P9, check the generated artifact in, and fail CI when it differs from the source or contains an unclassified item.
4. Label each item tenant-private, platform-shared, platform-private, device-private, or public, and record its authoritative ownership path.
5. Add an engineering rule: every new Prisma model and endpoint must declare its ownership class in the PR.
6. Freeze new tenant-owned Room Booking/Wayfinding persistence until P1–P3 pass. Existing features may receive isolation fixes and tests.

**Exit gate:** Every surface touched by P1–P7 is classified, the ADR is approved, and the generated exhaustive-inventory mechanism is specified for P9.

### P1 — Replace Members and invite mocks with the real tenant backend

**Status: done (2026-09-05).** `membersApi`, `DELETE /org/invites/:id`, `GET /org/invite/:token`, the transactional accept-race fix, and email normalization all shipped — see `docs/tenant-isolation/README.md`.

**Goal:** Remove the reported symptom and make membership genuinely tenant-scoped.

Backend tasks:

1. Keep `GET /org/members` restricted to the current tenant.
2. Keep `GET /org/invites` restricted to the current tenant and return only pending, non-expired invitations by default.
3. Add `DELETE /org/invites/:id` to revoke a pending invite after an ownership check.
4. Add a public, rate-limited `GET /org/invite/:token` endpoint returning only the minimum acceptance metadata: masked email, tenant display name, role, and validity. Do not expose tenant IDs or member lists.
5. Fix the invite-accept race explicitly: claim the token inside the transaction with a conditional update such as `WHERE acceptedAt IS NULL AND expiresAt > now()`, verify exactly one row changed, and convert a lost race to the same clean invalid/used response. Do not rely on a pre-transaction read. Add any supporting index/constraint required by the selected implementation.
6. Normalize emails consistently before uniqueness checks.

Dashboard tasks:

1. Add a real `membersApi` to `apps/dashboard/src/lib/api.ts`.
2. Remove the `@/lib/mocks/members` import and `PreviewFeatureNotice` from Members.
3. Fetch members and pending invites separately, then render a single list with `ACTIVE` and `INVITED` statuses.
4. Connect invite, role change, member removal, copy-link, and invite revocation to the backend.
5. Replace the mock acceptance flow on `/accept-invite` with real API calls.
6. Remove `LIBRARY_MANAGER` from the tenant invite role picker as part of P3.
7. Namespace Members and invites query keys with the live `organizationId`. P2 owns the dashboard-wide cache invalidation mechanism.

Tests:

- Tenant A lists only Tenant A members and invites.
- Tenant A receives `404` when changing/removing Tenant B member or invite IDs.
- A viewer/editor cannot manage membership.
- An owner cannot remove the last owner.
- A revoked, expired, accepted, or concurrently accepted token cannot be reused.
- After P2's identity-cache boundary is in place, logging from Tenant A into Tenant B in the same browser never renders A's cached member list.

**Exit gate:** No production membership or invitation path imports the mock module or uses `localStorage`.

### P2 — Introduce live membership/session validation for HTTP and WebSocket

**Status: done (2026-09-05).** `User.authVersion`, live `JwtStrategy`/`PlayerJwtStrategy` lookups, `ScreenGateway` live-checks, and the dashboard query-key/cache-clear boundary all shipped — see `docs/tenant-isolation/README.md`.

**Goal:** Make user removal, role changes, credential changes, and suspension effective immediately.

Tasks:

1. Add `User.authVersion` and include it in JWTs.
2. Replace the current payload-only JWT strategy with a live lookup of the user and organization.
3. Populate `TenantContext` from live data and use the current role/org/status.
4. Reject missing users, mismatched `authVersion`, suspended tenants, and invalid organization membership.
5. Update `ScreenGateway.handleConnection()` to validate dashboard users live before joining an organization room.
6. Validate screen existence, pairing state, stored player-token identity/version, and organization before joining a screen room.
7. Disconnect existing sockets when membership is removed, role/ownership changes, tenant suspension occurs, or sessions are revoked.
8. Rotate/invalidate player credentials on unpair rather than relying only on `paired` checks in REST.
9. Namespace all sensitive dashboard React Query keys by live `organizationId` and resource identity.
10. On login, logout, user/org change, and `authVersion` failure, cancel in-flight authenticated requests and clear the complete authenticated query cache before rendering data for the next identity.

Tests:

- A removed member's existing JWT immediately fails REST and WebSocket authorization.
- A changed role takes effect without waiting for JWT expiry.
- Password reset and email change invalidate all previous sessions.
- A suspended tenant cannot retain an existing dashboard socket.
- An unpaired/deleted screen token cannot reconnect.
- Switching from Tenant A to Tenant B in the same browser cannot render any cached A resource, including members, assets, playlists, screens, designs, rooms, or reports.

**Exit gate:** No authorization decision uses JWT `orgId` or role without a live authoritative check.

### P3 — Separate platform-shared library authority from tenant roles

**Status: done (2026-09-05).** `LIBRARY_MANAGER` removed (one non-production holder migrated to `EDITOR`), shared-library routes moved to `SuperAdminGuard`, `Asset.sourceLibraryAssetId` + `platform/assets/...` prefix, `PlatformAuditLog` for library mutations. Task 4 (a delegated platform library-permission page) deliberately deferred, not required for the first release. See `docs/tenant-isolation/README.md`.

**Goal:** Allow every tenant to consume the landlord's curated library without allowing any tenant to administer it.

Tasks:

1. Audit production for every existing `LIBRARY_MANAGER` assignment, identify whether it is actively used, and decide each holder's migration/support path before changing authorization.
2. Change shared asset-library create/update/delete routes from `@Roles('LIBRARY_MANAGER')` to live-validated Super Admin protection only after task 1 is resolved.
3. Remove `LIBRARY_MANAGER` from tenant invitation and role-management UI and migrate/remove existing tenant-role assignments without silently granting platform authority.
4. If delegated library operations are required, add a separate platform permission and platform admin page later.
5. Retain `Asset.organizationId = null` only for platform assets. Use a dedicated `platform/assets/...` storage prefix rather than an organization-looking prefix.
6. Add `sourceLibraryAssetId` to tenant copies. A tenant copy may change tenant metadata without changing the platform source.
7. Prevent tenant deletion from deleting a shared binary. Track binary ownership explicitly rather than inferring it from a reference count at deletion time.
8. Apply the same policy to system themes and system POI categories.
9. Audit every shared-library mutation as a platform event with actor, action, resource, time, and metadata diff.
10. Require template thumbnails and other catalog preview media to reference only platform-shared assets or a dedicated platform template-media namespace. P7 consumes this rule and validates embedded template references at publish time.

**Exit gate:** A tenant OWNER/ADMIN/EDITOR/VIEWER cannot mutate platform-shared content through UI or direct API calls.

### P4 — Secure media, thumbnails, derived files, and screenshots

**Status: done (2026-09-05, deployed 2026-09-06).** Every media URL now resolves through `MediaController` by database identity behind a short-lived signed token (`MediaTokenService`); all ~20 `storage.publicUrl` call sites migrated; task 11's pairing-abuse controls (rate limits, TTL, cleanup) shipped as an interim hardening ahead of P5a's full `PairingSession` redesign. Tasks 9 (storage reconciliation job) and 10 (retire legacy unauthenticated routes) deliberately deferred — see `docs/tenant-isolation/README.md`.

**Goal:** Stop treating knowledge of a URL as permission.

Tasks:

1. Remove unauthenticated arbitrary key construction from `MediaController`.
2. Resolve downloads by database identity (`assetId`/`binaryId`/`screenId`), not by `orgId + filename` supplied in the URL.
3. For dashboard clients, authorize the current tenant (or platform-shared visibility) before returning/streaming a binary.
4. For players, authorize the paired screen and confirm that the binary is present in its current server-issued manifest.
5. Use short-lived signed CDN/object URLs or authenticated binary endpoints. Never expose internal storage keys as authorization tokens.
6. Prioritize screenshots ahead of generic assets because their keys are deterministic (`{orgId}/screenshots/{screenId}.jpg`) and their contents may be operationally sensitive. Require dashboard tenant authorization and use a shorter TTL than ordinary immutable assets; screenshots must never be permanent public bearer URLs. `screenId` is a CUID rather than a sequential ID, so describe the risk as deterministic/leakable, not trivially enumerable.
7. Keep offline player caching functional by using immutable binary IDs/checksums and refreshing expired delivery URLs through the manifest.
8. Use appropriate private cache headers and prevent referrer leakage. A signed immutable URL may be cached only until its authorization semantics permit.
9. Add an object-storage reconciliation job that reports orphan objects, wrong prefixes, missing DB rows, and cross-tenant key/row mismatches without deleting automatically.
10. Rotate exposed URL patterns after migration and ensure old unauthenticated routes return `404/410`.
11. Before P5a replaces unowned screens with pairing sessions, review the existing `POST /player/init` throttle (currently 20 requests/60 seconds) and add abuse controls appropriate to an anonymous row-creating workflow: per-source and global limits, bounded outstanding requests, short TTL, cleanup, metrics, and alerting. A new anonymous request must create only a short-lived pairing record, never a durable tenant resource.

Tests:

- A Tenant A token cannot download Tenant B asset, thumbnail, document page, design thumbnail, floor plan, or screenshot.
- A valid shared-library asset is readable but not writable by both tenants.
- A player cannot fetch an arbitrary asset from its own tenant if it is not authorized by its presentation manifest.
- Leaking a former media URL does not preserve indefinite access.
- Anonymous pairing bursts cannot create an unbounded number of durable database rows.

**Exit gate:** Every private binary request has an authenticated tenant or device authorization decision.

### P5a — Harden tenant relations and database invariants

**Status: done (2026-09-06).** All four pre-migration audits ran clean (or were repaired). `AuditLog`/`DesignDraft` fixes and `PlatformAuditLog.targetOrganizationId` deployed 2026-09-05. The `PairingSession` model + `Screen.organizationId NOT NULL` (schema task 4) and the full composite-tenant-FK/trigger set across every relation on this section's list (schema tasks 1/2/7) — `Screen`, `Schedule`, `PowerSchedule`, `Zone`, `PlaylistItem`, `Floor`, `Poi`, `KioskLocation`, `RouteNode`, `RouteEdge`, `RoomDisplayBinding`, `RoomReservation`, `BookableRoom.wayfindingPoiId`, `DesignAsset` — deployed 2026-09-06. Plain composite FKs were not used (they can't express "or the parent is shared," and conflict with existing `ON DELETE SET NULL` columns); 15 hand-written Postgres triggers do the enforcement instead, same convention as `AuditLog`'s own trigger. Verified directly against real data (a deliberate cross-tenant write was rejected) and deployed to production with zero container restarts. Full detail in `docs/tenant-isolation/README.md`.

**Goal:** Make common cross-tenant references impossible even if a service bug is introduced, without making RLS a prerequisite.

Pre-migration audits and decisions:

1. Count every `Screen` where `organizationId IS NULL` and classify it as never-claimed, expired, or otherwise orphaned. Decide an explicit retention action—normally delete after a documented TTL or archive outside `Screen`. Never assign a placeholder tenant.
2. Detect duplicate `DesignDraft.documentId` values under the proposed tenant/user uniqueness scope before dropping the global unique constraint.
3. Find every `AuditLog` whose `userId` belongs to a different organization, identify its platform action source, and preserve the audit report.
4. Detect cross-tenant and orphan relationships for every constraint below. Stop migration and produce a repair report; never guess ownership automatically.

Schema and service tasks:

1. Add `organizationId` to high-risk child tables where a direct tenant key materially improves enforcement, then backfill through verified parent paths.
2. Add composite tenant foreign keys for:
   - screen to playlist, emergency playlist, asset, and screen group;
   - schedule to screen and playlist;
   - layout zone to layout plus tenant asset/playlist;
   - playlist item to playlist plus tenant asset/theme/layout/design;
   - floor to building and tenant floor-plan asset;
   - POI to floor/category/icon asset;
   - room display bindings/reservations to room and screen;
   - design versions/drafts/thumbnails to their tenant roots.
3. Change `DesignDraft` uniqueness from global `documentId` to the explicitly chosen tenant/user scope only after its duplicate audit passes.
4. Introduce a short-lived `PairingRequest`/`PairingSession` model. `POST /player/init` creates this record, and tenant claim creates the real tenant-owned `Screen` transactionally. Apply the P4 abuse controls and cleanup policy, resolve existing unowned rows, then make `Screen.organizationId` non-nullable.
5. Replace the vague nullable-relation task with concrete invariants:
   - tenant `AuditLog.userId`, when present, must belong to the same tenant;
   - platform actors are stored in an explicit platform audit representation, not forced into tenant ownership;
   - `BookableRoom.wayfindingPoiId` must resolve through floor/building to the same tenant;
   - shared-vs-private asset references must use an explicit shared reference or a tenant-owned copy, never an ambiguous nullable tenant key.
6. Redesign audit representation before adding its composite FK. Introduce a platform audit stream (preferred) or an explicit `platformActorUserId`/actor type, migrate and backfill existing cross-org rows, and prevent tenant-visible audit responses from leaking platform actor details not intended for tenants.
7. Add composite unique keys on tenant roots and composite foreign keys/check constraints in controlled, separately reversible migrations.

**Exit gate:** All audits are clean or explicitly repaired; real screens are tenant-owned; historical cross-org audit actors are migrated; and deliberately attempting a cross-tenant relation fails at both service and database layers.

### P5b — Optional PostgreSQL RLS and database-role separation

**Goal:** Add database-level containment only if the compliance/threat model requires it after P5a is stable.

This is a separate architecture project, not a bullet inside a schema migration. Produce and approve a dedicated design document covering:

1. Separate least-privilege database roles/connections for tenant API, platform API, player/worker, reporting, and migrations.
2. Prisma request/worker transaction boundaries and `SET LOCAL`/`set_config` behavior.
3. Fail-closed handling when tenant context is missing.
4. Platform-shared rows and explicit platform bypass paths.
5. Background job tenant iteration without stale connection state.
6. Pooling tests that repeatedly switch Tenant A/Tenant B and prove no session variable leaks between requests.
7. Observability, staged enforcement, rollback, and emergency access procedures.

**Default scope decision:** P5b does not block the first isolation release. P1–P5a plus centralized tenant access, live authorization, composite constraints, protected media, and the P9 suite are the required baseline. Promote P5b to a release requirement only when a documented compliance or threat-model decision requires RLS.

**Exit gate if selected:** RLS policies pass direct SQL bypass tests and pooled-connection isolation tests under production-equivalent topology before enforcement is enabled.

### P6a — Complete security-critical Super Admin controls

**Goal:** Give the landlord production-grade provisioning, account recovery, authorization, and audit controls without waiting for the larger operational dashboard.

**Hard dependency:** P6a session revocation, owner identity change, ownership transfer, and member-disable actions require P2's live `authVersion` validation. Do not ship these actions on payload-only JWT validation.

**Status: first pass done (2026-09-06), deployed to production.** Covered: suspend/reactivate with a required reason (`Organization.suspensionReason`); cross-tenant members/invites list and management (role change/ownership transfer, remove, invite revoke) by exposing `OrgService`'s existing tenant-parameterized methods to `PlatformTenantsController`; explicit one-user and whole-tenant session revocation (`OrgService.revokeMemberSessions`/`revokeAllSessions`, new — bump `authVersion` + live socket disconnect, reusing the exact primitive P2 already wired through `JwtStrategy`/`ScreenGateway`); tenant display-name edit; owner-email uniqueness check before tenant creation; `PlatformAuditLog` gained `reason`/`result`/`ipAddress`/`userAgent` columns, populated on every write in this controller, plus a read endpoint (`GET /admin/tenants/:id/audit`) — none existed before. Dashboard tenant-detail page extended with members/invites tables, session-revocation buttons, a suspension-reason prompt, and an audit-log section. 31 new/updated unit tests plus a live smoke test against a real dev database (suspend-without-reason correctly 400s, session revocation/role-change/audit-read all verified over HTTP). See `docs/tenant-isolation/README.md` for full detail.

**Explicitly deferred, not attempted this pass** (each is a real design decision, not a quick add — sizing them here so the next session can pick up deliberately):
- Password-reset-link initiation — no password-reset mechanism exists anywhere in the app yet (self-service or admin); needs its own token/expiry/consumption-endpoint design.
- Owner email change with uniqueness + verification + session revocation — the "verification" step needs an email-delivery decision this app doesn't have yet (invites today are copy-link only, no email sending).
- Slug change (this section's own "high-friction migration flow" framing) — deferred rather than half-built.
- Optional locale/timezone/default-settings fields on `Organization` at creation time — no such fields exist on the model; skipped as explicitly optional in this section's own tenant-creation task list.
- Automatic failure-path audit logging (`result: 'failure'` on a caught exception) — the column exists and defaults to `'success'`; nothing currently catches and logs a failed action.
- A distinct non-deleting "disabled" `User` state — member removal still hard-deletes (existing `OrgService.removeMember` behavior), which already preserves audit history via `AuditLog.userId`'s `SetNull`, just not via a reversible disable.
- `DesignTemplateTenant`/`SELECTED_TENANTS` assignment UI next to `TenantModule` on the tenant detail page (this section's "keep visibly distinct" requirement) — that UI still lives only in template management, not surfaced here.

#### Tenant creation

Preserve the existing atomic tenant/module creation and owner-invite flow, then add:

- validated unique normalized owner email;
- optional locale/time zone/default settings;
- module presets and trial expirations;
- invitation delivery status plus copy/reissue/revoke actions;
- a complete platform audit event.

Do not create or display a permanent owner password to the Super Admin.

#### Minimum tenant detail

Provide the security-critical subset first:

1. **Identity & status:** tenant name, slug, owner state, status, suspension reason, and creation date.
2. **Users & invites:** members, roles, owners, session-revocation actions, and pending/expired invites.
3. **Modules:** entitlement and trial/expiry controls. Keep `TenantModule` entitlement visibly distinct from template `SELECTED_TENANTS` assignments.
4. **Audit:** platform actions targeting the tenant and the deliberately tenant-visible administrative subset.

#### Safe administrative actions

Implement:

- edit tenant display name;
- change slug only through a high-friction migration flow because URLs/storage keys may depend on it;
- suspend/reactivate with a required reason;
- change module assignments;
- resend/revoke the pending owner invite;
- initiate an owner password-reset link;
- change an owner email through uniqueness validation, verification, and session revocation;
- transfer OWNER authority while guaranteeing at least one owner;
- revoke one user's sessions or all tenant user sessions;
- disable/remove a member while preserving attributed audit history.

Do not add hard tenant deletion in this milestone. Add an archive/data-retention design separately. Do not add invisible Super Admin impersonation. Any future support impersonation must be explicit, time-limited, visibly indicated, least-privilege, and fully audited.

#### Platform audit

Introduce an explicit platform audit stream with:

- platform actor user ID;
- target tenant ID;
- action and resource;
- before/after metadata diff with secrets redacted;
- reason/ticket reference where required;
- IP/user-agent/request ID;
- timestamp and result.

Do not depend on a tenant `AuditLog.userId` relation to represent cross-tenant platform actors implicitly. This is a repair of existing behavior: current tenant-management and entitlement actions already create cross-org actor references. Coordinate with P5a to audit and backfill those rows rather than applying a forward-only fix.

**Exit gate:** The Super Admin can create a tenant/owner invitation, secure or recover an owner account, suspend/reactivate a tenant, manage entitlements, revoke sessions, and inspect the platform audit trail without direct database edits. Every action is live-authorized and audited.

### P6b — Add Super Admin operational visibility

**Status: done (2026-09-07).** Server-side pagination/search/sort/filter on the tenant list, every usage metric computed via grouped aggregate queries (never N+1 per tenant), and the full operational tenant-detail breakdown (screens, content & storage, module usage counters, paginated/filterable audit) — see `docs/tenant-isolation/README.md`. Player-version tracking is out of scope — no such field or telemetry mechanism exists anywhere in this codebase yet (checked apps/player and the schema); adding one is a separate, larger change than this pass.

**Goal:** Add scalable fleet, usage, content, and health visibility without blocking the security-critical P6a release.

#### Tenant list

Add server-side pagination, search, sorting, and filters. Each row should show:

- tenant name, slug, status, creation date;
- owner name/email and pending-owner state;
- active member and pending-invite counts;
- screens total/online/offline;
- tenant assets count and logical storage bytes;
- playlists, designs, rooms, and buildings counts;
- assigned `TenantModule` modules/trials and expiry warnings;
- last user activity and last screen heartbeat;
- open operational/security alerts.

Do not compute all counts with per-tenant N+1 queries. Use grouped aggregate queries or a maintained tenant-usage summary with documented freshness semantics.

#### Operational tenant detail

Extend tenant detail with:

1. **Overview:** usage, health, recent activity, and alerts.
2. **Screens:** status, last seen, player version, sync state, and storage state.
3. **Content & storage:** counts and bytes by asset/content type; metadata only by default.
4. **Modules:** dependencies and usage counters in addition to P6a controls.
5. **Audit and activity:** filterable operational and security history with server-side pagination.

**Exit gate:** The Super Admin can inspect fleet health and per-tenant usage at production scale without N+1 query behavior. P6b is operational scope and does not block the isolation Definition of Done.

### P7 — Make published templates immutable and safe to distribute

**Status: done (2026-09-07).** `DesignTemplate.publishedVersionId` added and backfilled; `customerList`/`customerGet`/`createDesign` resolve the immutable `DesignTemplateVersion` snapshot, never the live mutable row; `adminPublish` validates every embedded assetId is platform-shared before snapshotting and points `publishedVersionId` at the new version atomically — see `docs/tenant-isolation/README.md`.

**Goal:** Preserve one landlord-managed shared template catalog with isolated tenant derivatives.

**Existing foundation:** `DesignTemplateVersion` already exists and `adminPublish` already writes an immutable snapshot transactionally. Reuse it; do not design a second version model.

Tasks:

1. Add `publishedVersionId` (or equivalent) to `DesignTemplate`, referencing the existing `DesignTemplateVersion` model, and backfill it from the current published version after verifying history.
2. Switch `customerList`, `customerGet`, and tenant `createDesign` to read the pointed immutable version, never the mutable `DesignTemplate.designJson` admin row.
3. Update the existing publish transaction so it creates/reuses the immutable snapshot and changes `publishedVersionId` atomically.
4. Enforce P3's platform-media policy for template thumbnails and embedded media: platform-shared assets or a dedicated platform template-media namespace only.
5. Validate every asset reference inside the versioned `designJson` before publish. Reject tenant-private asset IDs.
6. Opening/customizing a template always creates a tenant-owned `DesignAsset` and tenant-owned draft/version history.
7. Existing tenant designs never change when a source template is edited, unpublished, or archived.
8. Preserve `SELECTED_TENANTS` authorization through `DesignTemplateTenant` and test direct-ID access from unassigned tenants. Do not confuse template assignment with `TenantModule` entitlement.

**Exit gate:** No template operation can expose one tenant's media/design data to another tenant.

### P8 — Remove or isolate every remaining browser-global production mock

**Status: essentially done (2026-09-07); only a real Stripe/subscription backend remains, deliberately out of scope for this pass.** Task 1 (inventory) done — see `docs/tenant-isolation/README.md`. Task 2's first priority, Audit Log, is done: the dashboard now reads apps/api's real, already-globally-wired `AuditInterceptor`/`AuditService` (`GET /org/audit-log`) instead of `lib/auditLog.ts`'s per-browser localStorage mock; every manual `useAuditLog()` recording call site (60 across 9 files) removed as redundant, since the interceptor already logs every mutating request server-side regardless of client. Two real data-quality bugs fixed in the interceptor while wiring this up: `/admin/**` platform actions no longer also pollute the acting Super Admin's own org's tenant AuditLog (they already have their own `PlatformAuditLog` trail, P3/P5a/P6a), and the `org` routing-wrapper prefix no longer masks the real resource type for member/invite/settings mutations.

Priority 2 (proof of play/reports) is also done, and turned out bigger than Audit Log: the backend (`GET/POST /proof-of-play`, CSV export) already existed too, but **nothing in `apps/player` ever called the ingest endpoint** — a gap already documented in `aboutlumina-player.md`'s own prior player audit. Fixed for real rather than just swapping the dashboard to a real-but-empty API: `apps/player` gained a durable IndexedDB-backed proof-of-play queue (`lib/db.ts`'s new `proofOfPlayQueue` store) that records an event on every playlist-item transition (`ZonePlayer.tsx`) and flushes it in batches on the existing 30s heartbeat cycle (`lib/proofOfPlay.ts`) — never dropping an event on a flaky connection, since a row is only deleted from the queue after the server acknowledges it. A new `ProofOfPlayService.summary()`/`GET /proof-of-play/summary` (day/screen aggregate counts, capped sample) feeds the dashboard Reports page's charts, since the table itself is now server-paginated and can't aggregate over its own partial page the way the old mock's full in-memory list could. `PreviewFeatureNotice` removed from Reports.

Priority 3 (screen-group tagging/assignment) is also done — this one needed no new backend work at all: `ScreenGroup` (create/list/rename/remove/bulk-publish/set-volume) and `Screen.groupId` assignment (`PUT /screens/:id/group`) were already fully real, just used by the *Power Schedule* page only. The Screens page was calling a separate `lib/mocks/screenGroups.ts` localStorage mock for its own group chips/assignment UI the whole time — meaning a group created on one page was invisible on the other, an existing product bug this migration fixes as a side effect. Both pages now share one `screenGroupsApi` client and query key (`['screenGroups']`); `screensApi.setGroup` added for assignment; the mock's separate `getAssignments()` call is gone since `groupId` is already a plain field on every `/screens` row.

Priority 4 (approvals) is also done. Unlike screen-groups, this one had a real, deployed, but incomplete backend: `Playlist.approvalStatus` and the `submit`/`approve`/`reject` state machine (`PlaylistsController`) already existed and were already enforced (EDITOR-created playlists start `DRAFT`, others `APPROVED`; `submit`/`approve`/`reject` validate the transition) — but nothing recorded *who* submitted/reviewed or *why* something was rejected, and `reject` took no comment at all. Added `Playlist.submittedById`/`submittedAt`/`reviewedById`/`reviewedAt`/`rejectionComment` (migration `20260907124359_p8_playlist_approval_review_fields`) and a `RejectPlaylistDto`. The dashboard's org-wide "require approval" toggle had no real backend equivalent at all (the real policy is role-based and fixed, not a toggle) — removed from the UI rather than fabricated. `lib/mocks/approvals.ts` deleted.

Priority 5 (uptime) is also done, and turned out smaller than it first looked. The mock's own comment said a real uptime % "can't be computed from real data" (`Screen` only stores current status, never a history) — true, but `ScreenAlert` (already written every minute by `apps/worker`'s `FleetMonitorService`, `type: 'OFFLINE'`, with `createdAt`/`resolvedAt`) already *is* an offline-interval history, just never read for this. No new table or write path needed: `ScreensService.uptimePercents()` sums each screen's `ScreenAlert` overlap with a 30-day rolling window (one batched query, not per-screen) and folds the result into the existing `fleetStatus()` endpoint the dashboard already called for crash counts. `lib/mocks/uptime.ts` deleted.

Task 7 (verify Billing's direct-routing exposure) — checked: `billing/page.tsx` is already `useRouteGuard(false)` (unconditionally, for every role, not just nav-hidden) — direct navigation renders nothing, confirming the plan's own claim. But the same grep found a real, live bug this task exists to catch: the Screens page (fully real, actively used) imported the billing mock's `planLimit`/`currentPlan` to cap screen pairing at a plan-derived limit — a **per-browser, unauthenticated, trivially-editable localStorage value** (`lib/mocks/billing.ts` defaulted every fresh browser to `STARTER`/10 screens) gating a real action, with the only "upgrade" path pointing at the now-dark Billing page — meaning any tenant that ever reached 10 paired screens would be permanently blocked from pairing more, with no working recovery route. Fixed by removing the screen-limit enforcement from the Screens page entirely (`lib/mocks/billing.ts` and the Billing page itself untouched — already correctly gated per task 3's own fallback, this was specifically the leak into a *different*, unguarded page).

Remaining priority (billing) not started this pass — still mock-backed with `PreviewFeatureNotice` shown, task 3's flag-gating not yet applied. Billing is deliberately last per the plan's own task 7.

**Goal:** Eliminate account-to-account UI contamination on shared browsers.

Tasks:

1. Inventory `apps/dashboard/src/lib/mocks/*` and `apps/dashboard/src/lib/auditLog.ts` consumers.
2. Replace production navigation features with real backend APIs in priority order: audit log, proof of play/reports, screen-group tagging/assignment, approvals, uptime, then billing.
3. Until a backend exists, hide the feature behind an explicit demo/development flag rather than presenting browser-local data as tenant data.
4. For legitimate user preferences stored locally (theme, sidebar state, date/time format), classify them as device preferences and decide whether they should be global per browser or namespaced per user.
5. Remove stale mock invite tokens and seed identities from production bundles.
6. Preserve the already-real screen-group volume API; do not replace or regress it while building the separate tagging/assignment backend.
7. Keep Billing last because it is already absent from production navigation and guarded off. Verify that direct routing and production bundles cannot present its mock as live account data.

**Parallelization:** P8 has no hard dependency on P3–P5a and may run in parallel once P0 classification and P2's dashboard cache boundary are agreed.

**Exit gate:** No production page presents shared `localStorage` business records as authoritative SaaS data.

### P9 — Tenant-isolation verification suite and rollout

**Status: started (2026-09-07) — the two-tenant fixture and a first HTTP e2e IDOR slice are done and wired into CI; the other 8 required-suite categories and the entire 11-step production rollout sequence have not been started.** See `docs/tenant-isolation/README.md` for the full writeup. This is a deliberately bounded first slice given the baseline note directly below — not an attempt at the complete matrix in one pass.

**Goal:** Turn isolation into a release gate instead of a convention.

**Baseline:** Treat this as a new systematic security suite. At the reviewed commit there are 17 API spec files and targeted cross-tenant/IDOR assertions in only about four areas; do not estimate P9 as a small extension of mature coverage.

Build a reusable two-tenant test fixture:

- Tenant A: owner, admin, editor, viewer, assets, playlists, screens, designs, building, room.
- Tenant B: equivalent distinct records.
- Platform: Super Admin, shared assets, global and selected-tenant templates.
- Devices: one paired screen per tenant plus revoked/unpaired credentials.

For every resource endpoint, run the same matrix:

| Attempt | Expected result |
|---|---|
| A lists A resources | only A records |
| A gets B ID | `404` |
| A updates/deletes B ID | `404`, no mutation |
| A links A resource to B resource | `404` and DB constraint failure if service protection is bypassed |
| B reads published global content | success |
| B mutates published global source | `403` |
| unassigned B reads selected-tenant template | `404` |
| Super Admin uses explicit `/admin` operation | success plus platform audit |
| removed user reuses old JWT/socket | rejected |
| revoked player reuses old credential | rejected |

Required suites:

1. Unit tests for ownership resolvers and guards.
2. Service integration tests against PostgreSQL, not only mocked Prisma delegates.
3. HTTP end-to-end IDOR tests for every controller.
4. WebSocket room-isolation tests.
5. Media URL/download authorization tests.
6. Object-storage prefix/reconciliation tests.
7. If P5b is selected, RLS tests including missing-context failure and pooled-connection tenant switching.
8. Dashboard tests for cache clearing and direct-route guards.
9. A concrete CI enforcement mechanism:
   - maintain one machine-readable model classification/ownership manifest;
   - generate/check the exhaustive P0 inventory from the Prisma schema and declared routes/events/storage surfaces;
   - implement a custom ESLint rule (for example `no-raw-tenant-prisma-delegate`) that flags direct tenant-root Prisma delegate access outside allow-listed tenant/platform repositories;
   - run the generator diff and ESLint rule in `.github/workflows/ci.yml`;
   - fail CI for any new unclassified model/surface or forbidden raw delegate access. A grep-only check is not sufficient for semantic TypeScript access.
10. Migration tests for historical cross-org `AuditLog` rows, unowned screens, and duplicate `DesignDraft.documentId` values.

Rollout sequence:

1. Back up PostgreSQL and object storage; verify restore procedures.
2. Run the read-only integrity audit in production and preserve its report. Explicitly count/classify unowned screens, cross-org `AuditLog` actors, duplicate draft document IDs under the proposed scope, and every planned composite relation.
3. Deploy additive schema fields and dual-write/backfill code.
4. Backfill and verify counts/checksums per tenant.
5. Enable composite constraints in a separate controlled migration.
6. Deploy authenticated media delivery while both URL formats are temporarily understood internally.
7. Update dashboard and players, confirm offline caching, and observe manifest-refresh telemetry across the active fleet.
8. Disable old public media routes only after the defined fleet-refresh threshold is observed; do not use a fixed waiting period. Preserve a controlled rollback path for offline players that return with stale manifests.
9. If P5b is approved, deploy its database roles and transaction-scoped context in a non-enforcing environment, pass pooled-connection tests, then stage RLS enforcement with its own rollback plan.
10. Run two-tenant smoke tests on production using dedicated test tenants.
11. Monitor `403/404`, auth-version failures, media failures, WebSocket disconnects, pairing abuse/expiry, manifest refresh, and storage reconciliation alerts.

Rollback must revert application behavior without dropping newly added columns or deleting backfilled data. Never roll back by disabling ownership checks globally.

**Final exit gate:** The complete matrix passes in CI and production smoke tests, and no tenant-private record or binary is reachable with another tenant's user or player credential.

---

## 6. Recommended Execution Order

```text
P0   Working inventory, ADR, and generated-inventory design
 -> P1   Real Members/invites and exact invite-race fix
 -> P2   Live sessions, WebSockets, authVersion, and dashboard-wide cache boundary
 -> P3   Platform library authority (audit LIBRARY_MANAGER holders before guard change)
 -> P4   Private media/screenshots and anonymous pairing abuse controls
 -> P5a  Composite constraints, data audits/backfills, platform-audit repair,
         pairing-session migration, and required Screen ownership
 -> P6a  Security-critical Super Admin actions (explicitly depends on P2)
 -> P7   Existing template-version model wired to an immutable published pointer
 -> P6b  Operational tenant statistics, health, and scalable detail UI
 -> P9   Verification suite and production rollout

Parallel track after P0/P2 design:
P8   Remove or hide remaining production mocks while P3-P5a proceed

Optional later hardening after P5a stability and an explicit requirement decision:
P5b  PostgreSQL RLS, database-role separation, and Prisma transaction context
```

P1–P4 are the immediate application security and trust boundary. P6a builds on them rather than introducing powerful cross-tenant operations before session, media, and platform-role rules are stable. P6b is operational scope and may trail P7 without blocking the isolation gate. P3 and P7 must be cross-reviewed because both govern platform-shared assets and template preview media.

Room Booking and AI Wayfinding may continue only for code that does not add new persistence or weaken the boundary. Their tenant-owned development resumes normally after P2/P3, while P4/P5a tests are added to every relevant resource. `BookableRoom.wayfindingPoiId` is an explicit P5a tenant-integrity target.

---

## 7. Required Production Decisions and Discovery Gates

These questions do not block editing the plan, but they block the affected production changes. Record each answer in the implementation issue/ADR before proceeding.

| Decision | Required evidence | Recommended default | Blocks |
|---|---|---|---|
| Are any production tenants actively relying on `LIBRARY_MANAGER`? | Read-only list of holders, tenant, last relevant activity, and support owner | Audit and contact/triage holders before changing the guard; never convert them to platform authority automatically | P3 authorization flip |
| What is the count and intended disposition of unowned `Screen` rows? | Classify never-claimed, expired, and anomalous rows with age distribution | Delete expired pairing-only rows under an approved TTL; archive only when a real retention requirement exists; never attach them to a placeholder tenant | P5a `Screen.organizationId NOT NULL` |
| Is PostgreSQL RLS required by compliance or the threat model now? | Written compliance/threat-model decision and production connection topology | No for the first remediation release; complete P5a and P9 first, keeping P5b as future hardening unless explicitly required | P5b only |
| How should existing cross-org `AuditLog` rows be handled? | Full read-only audit with action source and actor/target organization | Backfill/re-attribute all recoverable historical rows into the new platform-audit representation; quarantine irreparable rows with preserved raw evidence rather than leaving invalid relations | P5a/P6a audit migration |

---

## 8. Definition of Done

The project is complete only when all of the following are true:

- Members and invites come from the current tenant's backend records.
- Every tenant-private root or child has a generated classification and documented ownership path.
- Cross-tenant object IDs return `404` and cannot create cross-tenant relations.
- Removing a user or resetting credentials invalidates active HTTP and WebSocket sessions immediately.
- Private media and screenshots require tenant/device authorization.
- Shared assets/templates are readable by authorized tenants and writable only by platform authority.
- Tenant customization creates tenant-owned copies and never mutates platform sources.
- The Super Admin can create and inspect tenants, view users, suspend/reactivate, manage modules, recover owner access, and revoke sessions from one audited control plane; operational usage/health statistics are delivered in P6b without weakening these controls.
- Remaining mocks cannot display browser-global business records in production.
- A two-tenant automated isolation matrix is mandatory in CI.
- Production migration and smoke-test evidence is retained with the release.

RLS is part of Definition of Done only if the decision gate promotes P5b into the release scope. Its absence must not weaken the required application, database-constraint, media, session, audit, and verification controls above.
