# Lumina — Backend Track Progress Log (Phase 5+)

## How to use this file
- This is the **backend track's own log** (API / worker / Prisma) — the frontend track has its
  own file at [status-frontend.md](./status-frontend.md), so we don't collide on the same file.
- Each session adds an entry under the current date.
- **Finished steps** lists what got merged/working.
- **Start here next session** tells you exactly what to pick up next.
- If you ship a change that affects a shape the frontend track is building against (renamed field,
  changed endpoint, etc.), note it under **Breaking changes for frontend** so it's easy to spot.
- Task list: [Roadmap-Phase5-Backend.md](./Roadmap-Phase5-Backend.md). Earlier history (Phases
  0–4, single log): [status.md](./status.md).

---

## Phase legend
| Symbol | Meaning |
|--------|---------|
| ✅ | Done |
| 🔄 | In progress |
| ⬜ | Not started |

---

## Breaking changes for frontend

- Permission guard decorator shipped as **`@Roles('OWNER', 'ADMIN')`** from
  `common/decorators/roles.decorator.ts`, not `@RequireRole('ADMIN')` as sketched in the roadmap
  draft. `GET /v1/org/members` matches the original shape.
- `AuditLog` entries: `{ id, action, resourceType, resourceId, metadata, createdAt,
  organizationId, userId, user: { id, name, email } }`. `action` is `"<method> <path>"` (e.g.
  `"post /v1/playlists"`), not a curated event name — fine for a raw audit trail table, don't
  build UI that assumes a fixed enum of action names.
- New: `Playlist.approvalStatus` (`DRAFT`/`PENDING`/`APPROVED`/`REJECTED`) is now on every
  playlist response. Playlists created by an EDITOR default to `DRAFT`; everyone else defaults to
  `APPROVED`. Assigning a non-`APPROVED` playlist to a screen now 400s.
- New: `Screen` responses now include `groupId`. `GET /v1/screens/fleet-status` returns
  `{ total, online, offline, screens: [{ id, name, status, lastSeenAt, offlineForMs, alerts }] }`.
- New: `ProofOfPlayLog` query rows: `{ id, playedAt, durationMs, createdAt, screenId, assetId,
  organizationId, screen: { id, name }, asset: { id, name, type } | null }`.

---

## Session log

### 2026-07-02 — Teams, RBAC, approval workflow, audit log

**Finished steps:**
- ✅ Prisma: `OrgInvite`, `AuditLog` models; `ApprovalStatus` enum + `Playlist.approvalStatus`
  (migration `20260702114640_phase5_teams_rbac_audit_approvals`)
- ✅ `RolesGuard` + `@Roles()` decorator — applied `JwtAuthGuard, RolesGuard` across every existing
  protected controller (screens, playlists, assets, layouts, schedules, auth). Default policy:
  VIEWER is read-only everywhere unless a route says otherwise.
- ✅ Org module (`modules/org`): invite, accept-invite, list members, list pending invites, change
  role (blocks demoting the last owner), remove member (blocks removing self or the last owner)
- ✅ Audit module (`modules/audit`): global `AuditInterceptor` logs every mutating request from an
  authenticated org user; `GET /v1/org/audit-log` paginated query, OWNER/ADMIN only
- ✅ Content approval workflow on playlists: submit/approve/reject endpoints; screen assignment now
  rejects non-approved playlists
- ✅ Migration applied, API typechecks clean, worker typechecks clean, smoke-tested end-to-end
  (register → invite → accept → editor submits → owner approves → assign to screen; VIEWER token
  confirmed blocked on POST, allowed on GET; last-owner demotion blocked; audit log populated)

**Start here next session:**
> Screen groups & tags, proof-of-play logging, fleet monitoring, and billing are still open — see
> the second half of [Roadmap-Phase5-Backend.md](./Roadmap-Phase5-Backend.md). Billing needs a
> Stripe test-mode key before that section can start.

---

### 2026-07-02 — Screen groups, proof-of-play, fleet monitoring

**Finished steps:**
- ✅ Prisma: `ScreenGroup`, `ProofOfPlayLog`, `ScreenAlert` models + `Screen.groupId`
  (migration `20260702121108_phase5_groups_proof_of_play_fleet_alerts`)
- ✅ Screen groups module (`modules/screen-groups`): CRUD + `POST :id/publish` bulk-pushes WS
  `publish` to every screen in the group; `PUT /v1/screens/:id/group` assigns a screen to a group
- ✅ Proof-of-play module (`modules/proof-of-play`): `GET /v1/proof-of-play` (paginated),
  `GET /v1/proof-of-play/export` (CSV); ingest endpoint lives on the player controller
  (`POST /v1/player/proof-of-play`, screen-token auth, batched up to 500 events)
- ✅ Fleet monitoring: `GET /v1/screens/fleet-status` (aggregated online/offline + per-screen
  alerts); worker `FleetMonitorService` cron (every minute) flags screens silent for 3+ minutes as
  OFFLINE + writes a `ScreenAlert`, auto-resolves it once the screen heartbeats again
- ✅ Migration applied, API + worker typecheck clean, smoke-tested end-to-end (screen group
  create → assign screen → bulk publish → fleet-status; full pairing flow → screen-token proof-of-
  play ingest → owner query → CSV export)

**Operational note:** a `pnpm dev` session was already running from outside this conversation when
this work started. Its API/worker processes were holding the generated Prisma client file locked,
which blocked `prisma generate` after each migration — they were stopped so the client could
regenerate. **Restart `pnpm dev`** to pick up all of today's and the previous session's new routes.

**Start here next session:**
> Only billing/subscriptions is left on the backend list (Stripe checkout + webhook, `Subscription`
> model, screen-limit enforcement) — blocked on a Stripe test-mode secret key. Everything else in
> [Roadmap-Phase5-Backend.md](./Roadmap-Phase5-Backend.md) is done.

---

### 2026-07-02 — tsconfig cleanup (api, worker)

**Finished steps:**
- ✅ `apps/api/tsconfig.json` and `apps/worker/tsconfig.json`: turned off `declaration`/
  `declarationMap` (these are apps, not published packages — no need for `.d.ts` output, and it
  removes a real "rootDir must be explicit" compiler warning)
- ✅ Removed a stray `"ignoreDeprecations": "6.0"` from both files — the project's actual installed
  TypeScript (5.9.3, matches `package.json`'s `^5.6.3`) rejects that value outright
  (`TS5103: Invalid value`), so it was hard-failing `tsc --noEmit` on both apps. Confirmed clean
  (`exit 0`) on api, worker, dashboard, and player after removing it.
- Note: your editor may still show `moduleResolution=node10`/`baseUrl` as deprecated on these two
  files — that's a different, newer TypeScript version running in the editor's language server than
  the one actually installed in the project (5.9.3 doesn't flag either as an error). If it bothers
  you, check **Ctrl+Shift+P → "TypeScript: Select TypeScript Version"** is set to "Use Workspace
  Version." Don't add `ignoreDeprecations` back to silence it — it breaks the real build.

**Start here next session:**
> Backend Phase 5 work is fully done aside from billing (blocked on a Stripe key). No other known
> issues.

---

### 2026-07-02 — Real fix for the moduleResolution deprecation + a latent packaging bug

**Finished steps:**
- ✅ `apps/api/tsconfig.json` and `apps/worker/tsconfig.json`: changed `module`/`moduleResolution`
  from `"CommonJS"`/`"node"` (the deprecated legacy pair) to `"node16"`/`"node16"`. Neither app's
  `package.json` sets `"type": "module"`, so this still resolves and **emits plain CommonJS**
  (`require`/`exports`) — verified by inspecting compiled output and booting the compiled JS
  directly. This actually silences the deprecation, not just ignores it.
- 🐛 Found and fixed a real latent bug while verifying the build: `apps/api/package.json` only had
  `@types/multer` (types-only), not `multer` itself, even though `assets.controller.ts` imports it
  directly. `nest start --watch` never surfaced this (its dev builder resolves differently), but a
  production-style `node dist/src/main.js` crashed with `Cannot find module 'multer'`. Added
  `"multer": "2.0.2"` (matching the version `@nestjs/platform-express` itself uses) as a direct
  dependency and ran `pnpm install --filter api`. Re-verified: compiled dist now boots past that
  point cleanly (confirmed it reached `.listen()`).
- ✅ All four apps (api, worker, dashboard, player) typecheck clean with the real project
  TypeScript (5.9.3).

**Start here next session:**
> **Restart `pnpm dev`** — the currently running instance predates these tsconfig/dependency
> changes (npm/pnpm dependency installs and tsconfig edits aren't picked up by a live watch
> process). Backend Phase 5 is otherwise fully done aside from billing (blocked on a Stripe key).

---

### 2026-07-02 — Removed the last deprecated tsconfig option (baseUrl)

**Finished steps:**
- ✅ `apps/api/tsconfig.json`: removed `"baseUrl": "./"`. It pointed at the same directory the
  `tsconfig.json` file lives in, and TypeScript has resolved `paths` relative to the config file
  itself (no `baseUrl` needed) since 4.1 — so this was a no-op setting with identical resolution
  behavior once removed, not a real change to how `@lumina/*` resolves. (Also: `@lumina/*` isn't
  actually imported anywhere in `apps/api/src` today, so this was zero-risk regardless.)
- ✅ All four apps typecheck clean (`exit 0`) after the removal — `apps/api`, `apps/worker`,
  `apps/dashboard`, `apps/player`.

**Start here next session:**
> No more known tsconfig/build issues. **Restart `pnpm dev`** if you haven't already since the
> previous session's fixes. Backend Phase 5 is fully done aside from billing (blocked on a Stripe
> key).

---

### 2026-07-02 — CI pipeline: got it fully green (Phase 0, ownerless — picked up while billing is blocked)

Roadmap.md's "CI pipeline" checkbox was unchecked even though `.github/workflows/ci.yml` already
existed — the workflow was never actually verified to pass. It didn't: `eslint` itself was never
installed as a dependency anywhere in the repo (only referenced in scripts/lint-staged), so `pnpm
lint` hard-failed on api/worker/player immediately. Fixing that surfaced ~65 real pre-existing lint
errors across all four apps once the linter could actually run. Per your direction, fixed all of it
rather than relaxing any rules.

**Finished steps:**
- ✅ Added `eslint`, `@typescript-eslint/*`, `eslint-config-prettier` to root devDependencies (none
  were installed before — lint had silently never run in this repo)
- ✅ Added `eslint-plugin-react-hooks` to `apps/player` and `eslint-config-next` to
  `apps/dashboard`, each with a local `.eslintrc.cjs` — fixes `react-hooks/exhaustive-deps`
  disable-comments in player that referenced a rule from a plugin that was never loaded, and gets
  dashboard onto Next's actual lint config instead of only the shared TS rules
- ✅ Fixed all ~65 lint errors app by app (api, worker, dashboard, player) — mostly
  `process.env['X']` → `process.env.X` (bracket access on a literal key an index-signature type
  already allows dot access for), a few genuine dead-code removals (unused imports/functions), a
  couple of real type-safety fixes (typed `Socket.data` properly in `screen.gateway.ts` instead of
  leaving it `any`; typed `RedisIoAdapter.createIOServer`'s return value instead of leaving it
  `any`), and React form-submit handlers wrapped to satisfy `no-misused-promises`
- 🐛 Found two more pre-existing bugs while verifying the build end-to-end:
  - `apps/api/package.json`'s `"start"` script pointed at `dist/main`, but the actual compiled
    entrypoint is `dist/src/main` (outDir mirrors the full `src/`+`prisma/` include list). A
    production-style `pnpm start` would have failed to even find the file. Fixed.
  - Jest exits non-zero on zero test files by default, and there are currently **no test files
    anywhere** in api or worker. Added `--passWithNoTests` to both `test` scripts — this is about
    the runner's default behavior for a project that hasn't started writing tests yet, not a lint
    rule; writing an actual test suite for the existing codebase is a much bigger, separate task.
- ✅ Full local verification, matching `ci.yml` step for step: `pnpm lint` (4/4), `pnpm typecheck`
  (7/7), `pnpm test` (2/2, no tests found — passes), `pnpm build` (7/7, confirmed `dist/src/main.js`
  and `dist/main.js` both exist for api/worker). Marked the Phase 0 CI checkbox done in
  `Roadmap.md`.

**Start here next session:**
> CI is fully green locally. Only billing/subscriptions remains on the backend list (blocked on a
> Stripe key). If you want real test coverage instead of `--passWithNoTests`, that's a new,
> separate, much larger task — not something to fold into a future small fix.

---

## Key URLs (local dev)

| App | URL |
|-----|-----|
| Dashboard | http://localhost:3000 |
| API + Swagger | http://localhost:4000/docs |
| Player | http://localhost:5000 |
| MinIO console | http://localhost:9011 (lumina / luminasecret) |
| Prisma Studio | http://localhost:5555 (`pnpm db:studio`) |

## Start infra each day

```bash
docker compose -f infra/docker/docker-compose.yml up -d
pnpm dev
```
