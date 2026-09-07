# ADR: Tenant Isolation and Shared-Content Authorization

**Status:** Accepted
**Date:** 2026-09-05
**Source:** `docs/tenant_isolation_and_platform_admin_plan.md` (Revision 2.0)

## Context

Lumina uses `Organization` as its tenant boundary. Most mature API services already filter root records by `organizationId`, but this protection is manually repeated per service rather than centrally enforced, several child models only inherit tenant ownership through a parent relation, private media is served from an unauthenticated, key-guessing-resistant-only endpoint, and dashboard/WebSocket sessions trust JWT claims for their full lifetime rather than re-checking the live database. A visible symptom (the Members page rendering shared browser-local mock data across accounts) prompted a full audit; that audit found the deeper architectural gaps recorded in `docs/tenant_isolation_and_platform_admin_plan.md`.

This ADR is the durable policy record that the plan's remediation milestones (P1–P9) implement against. It fixes the data-classification contract and the target authorization architecture so that later work has one stable reference instead of re-deriving these rules per milestone.

## Decision

> A request may access tenant-private data only through a server-resolved tenant context. Client-supplied tenant identifiers, object identifiers, browser state, filenames, and URLs never grant access.

Platform-shared content is a separate data class. Tenants may read published shared assets and templates, but only a platform-authorized operator may create, edit, publish, archive, or delete their source records. When a tenant customizes shared content, Lumina creates a tenant-owned copy; it never updates the platform source.

### Data Classification Contract

Every persisted record and API response must belong to exactly one class.

| Class | Examples | Read authority | Write authority |
|---|---|---|---|
| Tenant-private | users, invites, tenant assets, playlists, screens, schedules, layouts, designs, buildings, POIs, rooms, reservations, analytics, screenshots | authenticated member of the owning tenant, subject to role | authorized member of the owning tenant |
| Platform-shared published | stock images/video/audio/backgrounds, system themes, published design templates, fonts, provider catalog, system POI categories | authenticated active tenants; player only when referenced by its authorized presentation | Super Admin or explicit platform operator only |
| Platform-private | tenant registry, module assignments, platform audit, unpublished templates, global library drafts | Super Admin/platform operator only | Super Admin/platform operator only |
| Device-private | player state, manifests, commands, screenshots, heartbeat and crash data | the paired screen and authorized members of its tenant | paired screen or authorized member of its tenant |
| Public | login, narrowly limited invite-token validation, pairing initialization | anonymous, rate-limited | only the exact public workflow; never arbitrary data access |

Rules:

1. `organizationId = null` means platform-owned only on models explicitly declared shareable. It must never mean "unscoped" or "unknown."
2. A tenant may reference shared content only through an explicitly supported read path or by creating a tenant-owned copy.
3. A tenant-private record must never be returned because its ID was supplied by the client without an ownership predicate.
4. Unauthorized and nonexistent object IDs return the same `404` response to prevent tenant enumeration.
5. Super Admin cross-tenant operations use `/admin/*` services and an explicit target tenant. Normal tenant routes never accept a tenant ID.

### Target Authorization Architecture

#### Server-resolved request context

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

#### Tenant-aware data access

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

#### Database defense in depth

Application checks remain mandatory, but the database should reject cross-tenant relationships even if a future service misses a validation.

For high-risk references:

1. Add `organizationId` to tenant-owned child records where practical.
2. Add composite unique keys such as `@@unique([id, organizationId])` on tenant roots.
3. Replace single-column foreign keys with composite `(resourceId, organizationId)` foreign keys for tenant-to-tenant relations.
4. Keep platform-shared references separate from tenant-private references or force shared content to be copied before it enters a tenant playlist/design.
5. Add migration-time orphan and cross-tenant integrity checks before constraints are enabled.

PostgreSQL Row-Level Security is an optional later containment layer, not a schema-only task and not a prerequisite for the first isolation release. The current API and worker use a shared `PrismaPg` connection role and have no `SET LOCAL`, session-GUC, PgBouncer, or database-role separation infrastructure. RLS therefore requires its own architecture decision and milestone (P5b): separate database roles/connections for tenant traffic, platform administration, devices/workers, and migrations; request transactions that set tenant context transaction-locally; failure-safe behavior when the context is absent; and tests proving pooled connections cannot retain a previous tenant context. Do not enable RLS in production until this design passes its dedicated gates.

#### Platform authorization

Do not overload tenant roles with platform privileges.

Initial rule:

```text
User.role                 -> authority inside User.organizationId
User.isSuperAdmin         -> platform control-plane authority
```

If platform delegation is later required, replace the boolean with or add a typed platform-role model. Platform roles must be live-validated and separately audited.

#### Session revocation

Add `User.authVersion Int @default(1)` (or a session table). Include it in new JWTs and compare it on every authenticated request and WebSocket connection.

Increment `authVersion` when:

- a password is reset or changed;
- email/login identity changes;
- role changes;
- ownership is transferred;
- a member is disabled/removed;
- an administrator selects "revoke sessions."

Deleting a user must invalidate access immediately because authentication now requires a live user row.

Super Admin session-revocation actions (P6a) depend directly on this primitive. They must not be scheduled or released independently of P2.

#### Dashboard identity and cache boundary

Authentication state is also a client-side tenant boundary. Every sensitive React Query key must include at least the live `organizationId` and the relevant resource identity. On login, logout, user change, organization change, or detected `authVersion` mismatch, cancel in-flight requests and clear the entire authenticated query cache before rendering the next identity. Do not solve this only inside the Members page.

## Engineering rule

Every new Prisma model and every new or changed API route, WebSocket event, or storage-key prefix must state its ownership class (tenant-private / platform-shared / platform-private / device-private / public) and ownership path in its PR description, and the PR must update `docs/tenant-isolation/ownership-matrix.md` accordingly. See the PR template checklist. Reviewers should block a PR that touches persistence, routes, events, or storage without this declaration.

This is a manual review rule until P9 lands the generated-inventory CI check (`docs/tenant_isolation_and_platform_admin_plan.md`, P9 task 9), which will fail CI automatically on an unclassified surface instead of relying on reviewer diligence.

## Freeze

Starting from this ADR's merge date, new tenant-owned **persistence** in Room Booking and Wayfinding/AI Wayfinding (new Prisma models, new tenant-scoped columns, or new tenant-owned tables in those modules) is frozen until the P1–P3 exit gates in `docs/tenant_isolation_and_platform_admin_plan.md` pass. Existing Room Booking/Wayfinding/AI Wayfinding code may still receive isolation fixes and tests during the freeze — the freeze blocks new persistence surface, not maintenance of what already exists.

This is a documented team policy, not a code-enforced gate — there is no CI mechanism to block a migration file today. It should be treated as binding by reviewers until P9's static checks exist.

## Consequences

- P1–P9 implement against this ADR rather than re-deriving policy per milestone.
- `docs/tenant-isolation/ownership-matrix.md` is the living inventory this ADR's classification rules apply to; keep them in sync.
- Any deviation (e.g., a new model that doesn't fit the five classes cleanly) should be raised as an ADR amendment, not silently special-cased in code.
