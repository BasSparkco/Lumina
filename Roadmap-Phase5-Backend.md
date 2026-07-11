# Phase 5 (Backend track) — Multi-tenant teams, RBAC & operations

> Part of [Roadmap.md](./Roadmap.md) Phase 5. This file covers the **API / worker / Prisma**
> side of Phase 5, owned by the backend track. UI work lives in
> [Roadmap-Phase5-Frontend.md](./Roadmap-Phase5-Frontend.md). Log daily progress in
> [status-backend.md](./status-backend.md).

Legend: ☐ todo · ◐ in progress · ☑ done

---

## Shared contract (land first, unblocks frontend)

The frontend track needs stable shapes to build against before your endpoints are fully wired up.
Ship this first, even as stubs returning mock data, and tell the frontend track once it's pushed:

- ☑ `UserRole` enum finalized (`OWNER`, `ADMIN`, `EDITOR`, `VIEWER`) — unchanged, already correct
  in `schema.prisma`
- ☑ `GET /v1/org/members` — list org members with role
- ☑ Permission guard/decorator shape — shipped as `@Roles('OWNER', 'ADMIN')` (see
  `common/decorators/roles.decorator.ts` + `common/guards/roles.guard.ts`), **not**
  `@RequireRole()` as originally sketched — name differs from this file's earlier draft
- ☐ `Screen.groupId` / `ScreenGroup` field names — needed for frontend group filters/bulk actions
- ☑ `AuditLog` model field names shipped (see Audit log section below); `ProofOfPlayLog` still
  pending

---

## Teams & RBAC

- ☑ Prisma migration: `OrgInvite` model (email, role, token, expiresAt, acceptedAt) — invite flow;
  `User` already supported multiple rows per `Organization`, no schema change needed there
- ☑ Invite endpoint: `POST /v1/org/invite` (OWNER/ADMIN only, email + role) → invite record with
  token in the response (no email delivery wired up yet — dashboard should show/copy the link)
- ☑ Accept invite endpoint: `POST /v1/org/invite/accept` (public — token + name + password) →
  creates the user, returns a session token same shape as login
- ☑ `GET /v1/org/invites` — list pending invites (not in the original list, added since the
  members page needs it)
- ☑ `PUT /v1/org/members/:id/role` — change a member's role (OWNER/ADMIN only; blocks demoting the
  organization's last owner)
- ☑ `DELETE /v1/org/members/:id` — remove a member (OWNER/ADMIN only; can't remove self or the last
  owner)
- ☑ Permission guard applied globally via `RolesGuard` (`JwtAuthGuard, RolesGuard` on every
  protected controller): explicit `@Roles(...)` overrides where used, default policy blocks VIEWER
  from any non-GET request everywhere else. Editor vs owner/admin distinction is enforced per
  endpoint via explicit `@Roles()` (e.g. approve/reject, invite, member management), not a global
  editor policy — add `@Roles()` to any new sensitive endpoint you write.

## Content approval workflow

- ☑ Prisma: `ApprovalStatus` enum (`DRAFT`, `PENDING`, `APPROVED`, `REJECTED`) on `Playlist`
  (defaults to `APPROVED`; playlists created by an EDITOR default to `DRAFT` instead)
- ☑ `POST /v1/playlists/:id/submit` — editor submits for review (DRAFT/REJECTED → PENDING)
- ☑ `POST /v1/playlists/:id/approve` / `POST /v1/playlists/:id/reject` — OWNER/ADMIN only
  (PENDING → APPROVED/REJECTED)
- ☑ Assigning a playlist to a screen (`screens.service.assignPlaylist`) now rejects anything that
  isn't `APPROVED` — this is the actual publish gate, not the WS push itself

## Audit log

- ☑ Prisma: `AuditLog` model (organizationId, userId, action, resourceType, resourceId,
  metadata Json?, createdAt)
- ☑ `AuditInterceptor` registered globally (`APP_INTERCEPTOR`) — logs every mutating request
  (POST/PUT/PATCH/DELETE) automatically from an authenticated org user; failures to write are
  swallowed/logged so a broken audit write never fails the real request
- ☑ `GET /v1/org/audit-log?resourceType=&from=&to=&page=&pageSize=` — paginated, OWNER/ADMIN only

**Exit criteria (backend):** role changes, approvals, and every mutating action across the app are
enforced server-side and recorded in the audit log, independent of whatever the dashboard UI does.

---

## Screen groups & tags

- ☑ Prisma: `ScreenGroup` model + `Screen.groupId` (one-group-per-screen, not many-to-many tags —
  simpler and matches the "bulk publish by location/group" exit criteria)
- ☑ `POST/GET/PUT/DELETE /v1/screen-groups`
- ☑ `PUT /v1/screens/:id/group` — assign/remove a screen's group (mirrors the existing
  `:id/layout` pattern)
- ☑ Bulk publish endpoint: `POST /v1/screen-groups/:id/publish` — pushes WS `publish` to every
  screen in the group

## Proof-of-play logging

- ☑ Prisma: `ProofOfPlayLog` model (screenId, assetId?, playedAt, durationMs, organizationId)
- ☑ `POST /v1/player/proof-of-play` (screen-token auth) — batched ingest, up to 500 events per
  call; this is the endpoint the player track's `flushPlayLog()` stub should call
- ☑ `GET /v1/proof-of-play?screenId=&from=&to=&page=&pageSize=` — paginated query
- ☑ CSV export endpoint: `GET /v1/proof-of-play/export?screenId=&from=&to=`

## Fleet monitoring

- ☑ `GET /v1/screens/fleet-status` — total/online/offline counts + per-screen status, lastSeenAt,
  offlineForMs, and unresolved alerts
- ☑ Alerting: worker cron (`FleetMonitorService`, every minute) flags screens with no heartbeat
  for 3+ minutes as OFFLINE and writes a `ScreenAlert` row; auto-resolves the alert once the screen
  reports back in

## Billing/subscriptions

- ☐ Stripe integration (checkout session, webhook handler for subscription events)
- ☐ Prisma: `Subscription` model on `Organization` (plan, status, screenLimit, currentPeriodEnd)
- ☐ Enforce `screenLimit` when pairing a new screen
- ☐ `GET /v1/org/billing` — current plan/usage; `POST /v1/org/billing/checkout`

**Blocked:** billing needs a Stripe test-mode secret key before this section can start.

**Exit criteria (backend):** groups can be bulk-published, proof-of-play is queryable/exportable,
fleet status is computable via API without opening the dashboard, and screen limits are enforced
by plan (billing pending a Stripe key).

---

## Notes for coordinating with the frontend track

- Push migrations early and often — frontend can run `pnpm db:studio` locally to see real shapes
  instead of waiting on you to describe them.
- If you need to change a field name/endpoint shape after the frontend has started building against
  it, flag it in `status-backend.md` under **Breaking changes for frontend** so it's easy to spot.
