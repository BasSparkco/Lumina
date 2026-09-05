# Shared Module Preflight — Implementation Plan

**Status:** Required before AI Wayfinding and Room Booking implementation  
**Repository:** `https://github.com/BasSparkco/Lumina`  
**Reviewed baseline:** `bdee2b839449c86d5d98000dfb9e55e67cc0d059` on `main` (2026-09-05)  
**Input foundation:** `platform-modules-foundation-v1`  
**Repository planning baseline:** `<record commit P after all three plans are first added to the repository>`  
**Required preflight branch point:** reviewed docs-only planning handoff commit Q; record Q's full hash in the execution/PR log before PF1  
**Output:** one verified handoff commit tagged `modules-shared-preflight-v1`, with its preceding implementation commit recorded in the plans

---

## 1. Purpose

Complete one small shared stabilization pass before AI Wayfinding and Room Booking implementation begins.

This is not a third commercial module. It adds no customer-facing paid feature, database domain, screen mode, AI provider, room, or reservation. It resolves two foundation issues that affect downstream correctness, corrects one documentation error, and freezes the integration rules that keep both module branches from implementing the same shared work differently.

After this plan is complete:

- the AI Wayfinding implementer starts `ai_wayfinding_module_plan.md` from the output commit;
- AI Wayfinding is merged and verified before Room Booking begins by default;
- the Room Booking implementer starts `room_booking_module_plan.md` from the verified main branch after AI Wayfinding; and
- one named integration owner controls the small set of shared wiring files during final merges.

Before implementation, the product owner provides all three plan files and the integration owner adds them to the repository together in one docs-only planning-baseline commit P. No production code, schema, generated file, or dependency update belongs in that commit. The three plans are then reviewed against exact commit P. Any final corrections, together with commit P's full hash in all three plans, form docs-only planning handoff commit Q. PF1 starts from Q. Record Q's full hash in the execution/PR log; do not try to place Q's own hash inside Q.

### 1.1 Default execution order

The recommended order for the current team capacity is:

```text
Shared Preflight
  -> AI Wayfinding
     -> merge and full verification
        -> Room Booking Core
           -> optional Microsoft 365 connector
           -> optional Google Workspace connector
```

AI Wayfinding goes first because it extends an existing, working Wayfinding domain and provides the smaller, faster validation of the new entitlement foundation. Room Booking follows because it introduces a new domain, database conflict rules, screen mode, calendar UI, and optional provider integrations.

The two commercial modules remain architecturally independent. Sequential implementation is a delivery decision, not a runtime dependency. If team capacity increases later, the integration contract in this document still permits both branches to start from the preflight tag.

---

## 2. Scope

This preflight contains exactly four deliverables:

1. Preserve emergency content when a tenant is suspended.
2. Make dashboard capability checks honor module dependencies.
3. Correct the completed foundation's B6 heading.
4. Record and verify the sequential handoff and optional parallel integration contract.

Do not begin either feature module inside this plan.

The initial repository preparation is not a fifth product deliverable: it is the entry gate that makes all three referenced plans real, reviewable repository artifacts before any code changes begin.

---

## 3. Current-State Findings

### 3.1 Tenant suspension currently suppresses emergency output

`PlayerService.getState()` returns early when `Organization.status === 'SUSPENDED'`. The neutral response currently forces:

```ts
emergencyActive: false,
emergencyPlaylist: null,
wayfinding: null,
moduleLeases: [],
```

This correctly prevents ordinary paid content from playing for a suspended tenant, but it also suppresses an emergency playlist or Wayfinding evacuation route that was already active. The foundation already protects evacuation from Wayfinding entitlement disablement and lease expiry; suspension must follow the same life-safety policy.

The earlier foundation text described the eventual suspension adjustment as a small or “one-line” gate. This preflight intentionally requires a stricter response-construction change: ordinary tenant data must not be hydrated or transmitted merely because the player would render emergency content first. That is a safety and data-minimization correction, not an expansion into a new feature module.

### 3.2 Dashboard capability checks do not evaluate dependencies

The API recursively evaluates `MODULE_DEPENDENCIES` in `EntitlementsService.hasModule()`. The dashboard's `CapabilitiesContext.hasModule()` currently checks only the requested module row. That was sufficient while only `WAYFINDING` had customer-facing navigation, but it becomes incorrect as soon as `WAYFINDING_AI` is exposed.

Example of the current mismatch:

```text
WAYFINDING_AI = ACTIVE
WAYFINDING    = expired TRIAL

API result:       WAYFINDING_AI unavailable
Dashboard result: WAYFINDING_AI appears available
```

The dashboard must mirror the API's dependency result for UX and route gating. The API remains the security boundary.

### 3.3 Completed B6 heading is mislabeled

The completed foundation document contains:

```text
### ai_wayfinding_module_plan — Verification and handoff — complete
```

It must be restored to:

```text
### Milestone B6 — Verification and handoff — complete
```

No implementation result or checklist text beneath it changes.

### 3.4 Shared merge surfaces are known

Both downstream modules will eventually touch some of these files:

```text
apps/api/prisma/schema.prisma
apps/api/src/app.module.ts
apps/api/src/modules/player/player.service.ts
apps/api/src/modules/platform-tenants/platform-tenants.service.ts
apps/dashboard/src/app/[locale]/(app)/layout.tsx
apps/dashboard/src/lib/api.ts
apps/dashboard/messages/en.json
apps/dashboard/messages/ar.json
apps/player/src/lib/api.ts
apps/player/src/pages/PlayerPage.tsx
packages/types/src/index.ts
```

The preflight does not add feature placeholders to these files. It defines ownership and commit discipline so sequential handoff is clean and future parallel work remains mergeable.

---

## 4. Frozen Decisions

### 4.1 Emergency policy

Tenant suspension suppresses all ordinary tenant content and paid-module use, but it does not suppress an already active emergency presentation.

Allowed during suspension when `screen.emergencyActive === true`:

- the assigned emergency playlist; or
- the Wayfinding evacuation route when the screen is a configured Wayfinding kiosk.

Not allowed during suspension:

- ordinary asset/playlist playback;
- ordinary Wayfinding directory/search/browsing;
- attract content;
- AI Wayfinding;
- Room Booking;
- new module leases;
- booking, AI, analytics, or other player mutations.

The emergency response is read-only, contains no module lease, and does not reactivate the tenant.

### 4.2 Emergency precedence

Preserve the current player precedence:

1. existing power/stopped behavior remains unchanged by this preflight;
2. emergency playlist has priority when assigned;
3. otherwise a configured Wayfinding kiosk may show the evacuation view;
4. no ordinary content is returned for a suspended tenant.

This plan does not change the larger product policy that currently lets `stopped` or a power rule blank the display before emergency. If that policy needs review, handle it in a separate safety ADR rather than silently expanding this preflight.

### 4.3 Dependency evaluation

Dashboard `hasModule(key)` must return true only when:

- the tenant status is `ACTIVE`;
- the requested assignment is `ACTIVE`, or `TRIAL` with no expiry or a future expiry; and
- every declared dependency recursively meets the same assignment rule.

Missing, disabled, expired, or cyclic dependencies fail closed.

### 4.4 No new entitlement mechanism

Use the existing:

- `MODULE_DEPENDENCIES` catalog;
- `TenantCapabilities` response;
- `EntitlementsService` API enforcement;
- `CapabilitiesContext` and module route hooks; and
- `PlayerModuleLease` mechanism.

Do not add computed dependency rows, JWT entitlement claims, a second capabilities endpoint, or client-specific dependency declarations.

### 4.5 Shared player contracts

The current full `PlayerState` remains partly duplicated between API inference and `apps/player/src/lib/api.ts`. A complete refactor is outside this small preflight.

For both downstream plans, every newly introduced player payload and runtime schema must be defined in `@lumina/types` and imported by API and player. Neither feature branch may introduce another hand-duplicated module-specific payload type.

### 4.6 Integration owner

**Integration Owner: Basil Jerjawi** — the person who completed the platform foundation and controls the main branch.

The integration owner alone merges final changes to shared wiring files. Feature owners retain full ownership of their module-local directories.

---

## 5. Emergency-While-Suspended Implementation

### 5.1 Refactor shape

Do not simply skip the suspended-tenant early return and continue through the normal state builder. That would hydrate and return lower-priority ordinary content even though the player UI happens to render the emergency branch first.

Create an explicit suspended response path with two outcomes:

```ts
if (tenantSuspended && !screen.emergencyActive) {
  return buildSuspendedNeutralState(screen);
}

if (tenantSuspended && screen.emergencyActive) {
  return buildSuspendedEmergencyState(screen);
}
```

Do not reimplement the existing Wayfinding entitlement, renderability, route-edge, or payload-assembly logic in the suspended branch. Extract that logic into one private helper shared by the normal and suspended paths. A suitable shape is:

```ts
buildWayfindingPayload(screen, {
  includeAttract: boolean,
  allowEmergencyEntitlementBypass: boolean,
})
```

The exact signature may follow local conventions, but the helper must own the existing `wayfindingEntitled` / `wayfindingRenderable` decision and the route-graph payload assembly so there is only one hydration implementation.

- Normal active-tenant rendering calls it with `includeAttract: true` and normal entitlement enforcement.
- Suspended emergency evacuation calls it with `includeAttract: false` and allows the entitlement bypass only while `screen.emergencyActive === true` and no emergency playlist has priority.
- A suspended neutral response never calls it.

Extract the emergency-playlist helper only if necessary to avoid comparable duplication. Keep the refactor private to `PlayerService`; do not create a new controller or public service surface.

### 5.2 Suspended emergency playlist

When an emergency playlist is assigned:

- return `emergencyActive: true`;
- hydrate only the emergency playlist needed by the player;
- return `wayfinding: null` unless the current emergency policy explicitly needs the evacuation fallback;
- return no asset, default playlist, schedule rules, Room Booking payload, or future optional-module payload;
- return `moduleLeases: []`.

### 5.3 Suspended Wayfinding evacuation

When no emergency playlist takes priority and the screen is a configured Wayfinding kiosk:

- return `emergencyActive: true`;
- return the existing Wayfinding directory/route-graph shape required by `WayfindingEvacuationView`;
- return no `WAYFINDING` lease;
- do not expose AI Wayfinding configuration;
- call the shared Wayfinding payload helper with `includeAttract: false`, ensuring attract playlist/theme are null in the emergency-only response;
- return no ordinary asset/playlist/schedule payload.

Reuse the same org-scoped screen relationships already loaded by `PlayerService.getState()`. Do not route through dashboard Wayfinding controllers.

### 5.4 Suspended neutral response

When there is no active emergency, preserve the shipped behavior:

- HTTP 200 rather than 401/404;
- neutral content;
- pairing remains intact;
- no protected payload;
- no module leases;
- stored configuration remains untouched.

### 5.5 Player behavior

The current player already checks emergency playlist and Wayfinding evacuation before normal module-lease rendering. Avoid changing `PlayerPage.tsx` unless a type adjustment or regression fix is actually required.

Confirm that an emergency-only suspended response cannot reach Directory, normal POI browsing, attract content, AI, or Room Booking branches.

---

## 6. Dependency-Aware Dashboard Implementation

### 6.1 Capability resolver

Create `apps/dashboard/src/lib/moduleCapabilities.ts` as the required pure resolver and update `CapabilitiesContext` to import it. The resolver imports the runtime dependency catalog:

```ts
import {
  MODULE_DEPENDENCIES,
  type ModuleKey,
  type TenantCapabilities,
} from '@lumina/types';
```

Implement one pure dependency-aware resolver in that library file:

```ts
function hasUsableModule(
  capabilities: TenantCapabilities,
  key: ModuleKey,
  now: Date,
  visiting: Set<ModuleKey> = new Set(),
): boolean {
  if (capabilities.tenantStatus !== 'ACTIVE') return false;
  if (visiting.has(key)) return false;

  const assignment = capabilities.modules.find((module) => module.key === key);
  if (!assignment) return false;

  const usable =
    assignment.status === 'ACTIVE' ||
    (assignment.status === 'TRIAL' &&
      (!assignment.expiresAt || new Date(assignment.expiresAt) > now));
  if (!usable) return false;

  const dependency = MODULE_DEPENDENCIES[key];
  if (!dependency) return true;

  const next = new Set(visiting);
  next.add(key);
  return hasUsableModule(capabilities, dependency, now, next);
}
```

Equivalent implementation details are acceptable, but the semantics and cycle-safe failure behavior are required.

### 6.2 Single consumer path

- `CapabilitiesContext.hasModule()` must call the pure resolver.
- Remove or update the stale context comment that says dependency walking is deliberately omitted.
- `useModuleAccess()` and `useModuleRouteGuard()` continue consuming the context.
- Navigation continues using the same context helper.
- Super Admin assignment validation continues using the shared catalog and remains separate from current-tenant capability evaluation.
- Do not duplicate dependency walking inside individual pages.

### 6.3 Time behavior

Use a single `now` value per evaluation, not multiple `new Date()` calls during one recursion. React Query refresh/invalidation remains responsible for live capability refresh after server changes. This preflight does not add a client polling loop solely for trial expiry.

---

## 7. Documentation and Integration Contract

### 7.1 Foundation correction

Change the erroneous B6 heading in `platform_modules_and_tenants_foundation_plan.md`. In the same file's §16 Known Limitations, update the existing "One open policy question, unresolved" paragraph (the tenant-suspension/evacuation note) to mark it **resolved**, replacing the "unresolved... confirm before this reaches a real customer" language with a short pointer to the ADR addendum below. Preserve the rest of the completed checklist and known-limitations record unchanged.

Add a new addendum to `docs/adr/platform-modules-and-entitlements.md` recording the resolution. This is the first ADR statement on tenant-suspension-and-evacuation policy — the ADR does not currently contain one, so this addendum is not a duplicate of existing ADR content; it is a duplicate only of the foundation plan's note above, which is why that note must point here instead of restating the policy. The addendum must record:

- emergency content survives tenant suspension without leases;
- normal content remains suppressed;
- dashboard capability checks walk the shared dependency catalog; and
- new module-specific player payloads belong in `@lumina/types`.

Explicitly note that the implementation is stricter than the foundation's earlier “one-line” shorthand because it prevents ordinary content from being hydrated and transmitted in a suspended emergency response.

### 7.2 Planning baseline and branch points

Before PF1:

1. the product owner supplies `modules_shared_preflight_plan.md`, `ai_wayfinding_module_plan.md`, and `room_booking_module_plan.md`;
2. the integration owner adds all three to the repository in one docs-only planning-baseline commit P;
3. review the three files against exact commit P;
4. apply accepted review corrections and record P's full hash in all three plans in docs-only planning handoff commit Q;
5. record Q's full hash in the execution/PR log; and
6. create the preflight implementation branch from exact commit Q.

Commit P can be named inside Q. Commit Q cannot contain its own hash; its identity is captured by the branch/PR record and later ancestry of `modules-shared-preflight-v1`.

Use a two-commit handoff after implementation because a Git commit cannot contain its own hash:

1. **Implementation commit A:** merge the verified code, tests, ADR resolution, and foundation-heading correction to `main`.
2. Record commit A's full hash in the three plan documents and mark the applicable preflight checklist/status items complete.
3. **Handoff commit B:** commit only those documentation/status updates.
4. Create tag `modules-shared-preflight-v1` on commit B.
5. Create the AI Wayfinding feature branch from that tag/commit, never from `bdee2b8` or from the earlier planning-baseline commit.

Commit A is the auditable implementation identity. Commit B/tag is the complete branch point containing both the implementation and the documents that identify it.

After AI Wayfinding is complete:

1. merge it to `main` and run the full verification gate;
2. create the verified AI implementation commit;
3. record that full implementation hash in the AI and Room Booking plans in a following docs-only handoff commit;
4. tag the handoff commit if the AI plan adopts a release tag; and
5. create the Room Booking feature branch from the docs handoff commit on verified post-AI `main`.

If the team deliberately returns to parallel execution, Room Booking may instead branch from `modules-shared-preflight-v1`; the integration owner then applies the shared-file rules below.

Suggested branches:

```text
feature/ai-wayfinding-module
feature/room-booking-module
```

### 7.3 Commit discipline

Each module branch must separate:

- module-local domain commits;
- database/migration commits;
- dashboard/player feature commits; and
- final shared-wiring commits.

This makes integration review and conflict resolution explicit. Do not mix opportunistic unrelated refactors into either module branch.

---

## 8. Expected File Changes

Expected implementation files:

```text
apps/api/src/modules/player/player.service.ts
apps/api/src/modules/player/player.service.spec.ts
apps/dashboard/src/context/CapabilitiesContext.tsx
apps/dashboard/src/lib/moduleCapabilities.ts
apps/dashboard/test/module-capabilities.test.*
apps/dashboard/package.json
docs/adr/platform-modules-and-entitlements.md
platform_modules_and_tenants_foundation_plan.md
ai_wayfinding_module_plan.md
room_booking_module_plan.md
```

Verify-only files; change them only if a proven regression or type mismatch requires it:

```text
apps/player/src/lib/api.ts
apps/player/src/pages/PlayerPage.tsx
apps/api/src/modules/player/player-manifest.ts
apps/player/src/lib/presentation/presentation-preparer.ts
apps/player/src/lib/presentation/rewrite-player-state.ts
```

`PlayerService.getManifest()` wraps `getState()`, so the manifest and offline-caching pipeline inherit the suspended-emergency fix automatically without code changes to these files. Do not skip verifying them: include a manifest/offline-cache check in the acceptance scenario (§10) rather than assuming this path is exercised by construction.

No Prisma schema or migration is expected. If implementation appears to require a database change, stop and reassess scope.

---

## 9. Tests

### 9.1 API tests

Add cases proving:

- suspended tenant without emergency receives neutral HTTP 200 state;
- suspended tenant with emergency playlist receives only emergency content and no lease;
- suspended Wayfinding kiosk with active emergency receives the evacuation payload and no lease;
- suspended emergency response contains no normal asset, playlist, schedule, attract, or optional-module payload;
- removing suspension restores normal behavior without configuration reconstruction;
- deleted/unpaired screen behavior is unchanged.

Extend the existing `PlayerService.getState — WAYFINDING entitlement, evacuation bypass, and offline lease` fixture suite in `player.service.spec.ts` for the suspended-plus-evacuation cases. Do not create a second plain suspension fixture that reconstructs Wayfinding relationships separately.

### 9.2 Dashboard dependency tests

Cover the pure resolver:

- active independent module;
- active dependent module with active dependency;
- active dependent module with missing dependency;
- disabled dependency;
- expired trial dependency;
- unexpired trial dependency;
- suspended tenant;
- dependency cycle fails closed;
- `ROOM_BOOKING` remains independent;
- `WAYFINDING_AI` and `INDOOR_POSITIONING` both require usable `WAYFINDING`.

The dashboard currently has no general test runner. Add a committed script-based resolver test and a stable `test:module-capabilities` package script, following the repository's compile-then-run pattern. Do not leave this logic verified only by visual inspection.

### 9.3 Regression verification

Run:

- API typecheck, lint, and full unit suite;
- dashboard typecheck and lint;
- player typecheck and lint for touched files;
- existing player integration/presentation scripts;
- a live browser check of capability-gated navigation; and
- a live player check of suspended emergency behavior.

Root `pnpm test` does not execute the player's named script tests, and the dashboard currently contributes no `test` task to the root test pipeline. Therefore run and record the relevant commands individually in addition to the root/API checks, including at minimum:

```text
pnpm --filter dashboard test:module-capabilities
pnpm --filter player test:presentation
pnpm --filter player test:integration
```

If the final implementation adds another named player or dashboard script, run that exact script explicitly and add it to the handoff record. Do not state that `pnpm test` or CI covered these scripts unless the repository pipeline is deliberately updated to invoke them.

---

## 10. Acceptance Scenario

1. Start from reviewed planning handoff commit Q, whose ancestry includes `bdee2b8`, with a tenant owning `WAYFINDING` and `WAYFINDING_AI`.
2. Confirm both modules are visible while both assignments are usable.
3. Expire or disable `WAYFINDING` while leaving `WAYFINDING_AI` active.
4. Confirm AI navigation and direct route become unavailable without starting AI-specific requests.
5. Confirm API entitlement behavior matches the dashboard result.
6. Re-enable Wayfinding and confirm AI visibility returns without changing the AI row.
7. Configure a Wayfinding kiosk and verify ordinary rendering.
8. Activate evacuation and confirm the route renders.
9. Suspend the tenant while evacuation remains active.
10. Confirm the player still receives HTTP 200 and renders the evacuation route with no module lease.
11. Confirm Directory/normal Wayfinding and all future optional-module entry points remain unavailable.
12. Repeat with an emergency playlist and confirm only emergency content is returned.
13. Clear emergency while the tenant remains suspended and confirm neutral output.
14. Reactivate the tenant and confirm stored configuration returns.
15. Confirm the foundation document heading and ADR are correct.
16. Fetch `/player/manifest` for the suspended-with-active-evacuation screen from step 10 and confirm it reflects only the evacuation payload — no ordinary asset, playlist, schedule, attract, or optional-module manifest entries.

---

## 11. Milestones

### Milestone PF0 — Committed planning baseline

- [ ] Add all three plan files to the repository in docs-only commit P.
- [ ] Re-review all three plans against exact commit P.
- [ ] Apply accepted corrections and record P's full hash in all three plans in docs-only commit Q.
- [ ] Record Q's full hash in the execution/PR log.
- [ ] Name the integration owner.
- [ ] Create the preflight implementation branch from exact commit Q.

### Milestone PF1 — Safety response

- [ ] Extract one private Wayfinding payload builder shared by normal and suspended paths.
- [ ] Implement explicit suspended neutral/emergency state paths without hydrating ordinary content.
- [ ] Preserve emergency playlist and Wayfinding evacuation only.
- [ ] Suppress all ordinary content and leases.
- [ ] Add API regression tests.

### Milestone PF2 — Capability dependencies

- [ ] Add the required pure dependency-aware dashboard resolver.
- [ ] Route all dashboard capability consumers through it.
- [ ] Remove or correct the stale no-dependency-walk comment.
- [ ] Add repeatable tests for dependency, expiry, suspension, and cycles.

### Milestone PF3 — Documentation and ownership

- [ ] Correct the B6 heading.
- [ ] Resolve the existing ADR note without duplicating it.
- [ ] Freeze shared-file and commit discipline.
- [ ] Confirm both module plans contain the two-commit baseline/handoff rule.

### Milestone PF4 — Verification and AI branch release

- [ ] Run all required checks.
- [ ] Run the dashboard and player script tests individually and record their results.
- [ ] Run the acceptance scenario.
- [ ] Merge verified implementation commit A to `main`.
- [ ] Record commit A's full hash in all three plans.
- [ ] Create docs-only handoff commit B.
- [ ] Tag commit B as `modules-shared-preflight-v1`.
- [ ] Create the AI Wayfinding feature branch from the tagged commit.
- [ ] Record that Room Booking starts from verified `main` after AI Wayfinding unless parallel execution is explicitly re-approved.

---

## 12. Definition of Done

The preflight is complete only when:

- tenant suspension never suppresses an already active emergency playlist or Wayfinding evacuation route;
- suspended emergency output contains no ordinary content and earns no module lease;
- dashboard capability checks recursively honor the shared dependency catalog;
- the dashboard and API agree for missing, disabled, or expired dependencies;
- `ROOM_BOOKING` remains independent;
- the foundation B6 heading is corrected;
- the ADR records the new safety and dependency decisions;
- the existing unresolved ADR note is marked resolved rather than duplicated;
- regression and live acceptance checks pass;
- one integration owner is named;
- all three plans exist in the repository and record planning-baseline commit P;
- preflight implementation started from reviewed planning handoff commit Q, whose hash is recorded in the execution/PR log;
- the verified implementation commit A is recorded in the plans;
- the docs-only handoff commit B is tagged `modules-shared-preflight-v1`;
- the AI Wayfinding branch starts from that exact tagged handoff commit; and
- the Room Booking plan records the sequential rule that its exact baseline is the verified post-AI `main` commit.

---

## 13. Non-Goals

Do not add any of the following during this preflight:

- AI provider SDKs or API keys;
- AI prompts, chat UI, aliases, or usage logs;
- rooms, reservations, calendars, or connector credentials;
- `ROOM_BOOKING` streaming mode;
- new entitlement tables or module keys;
- a full PlayerState refactor;
- generic plugin frameworks;
- new WebSocket rooms or notification mechanisms;
- unrelated player power/emergency policy changes;
- a second dashboard, player, or authentication system.