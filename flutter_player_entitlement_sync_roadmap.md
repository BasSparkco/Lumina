# Flutter Player — Platform Modules & Tenants Sync Roadmap

**Purpose:** what, if anything, the native Flutter player team (`github.com/BasSparkco/Lumina_player`) needs to do as a result of `platform_modules_and_tenants_foundation_plan.md`.
**Read against:** `Lumina_player` at its current `main` HEAD as of 2026-09-04, cloned and read directly from GitHub for this roadmap.
**Companion reading:** `docs/adr/platform-modules-and-entitlements.md` (this repo), `Lumina_player/roadmap.md` and `Lumina_player/status.md` (the native app's own planning docs).

This follows the two-step SOP established for player work: implement in `apps/player` (web) first, then hand the native team a structured spec — this document is that handoff, produced after reading `Lumina_player`'s actual source rather than guessing at its shape.

---

## 1. Bottom line

**No Flutter changes are required for Milestones A1–B3** (module catalog, entitlement service, Super Admin tenant control plane, tenant suspension). All of that is backend/dashboard-only, and the one piece that does touch the player contract — tenant suspension — was verified live to be a no-op from the Flutter app's point of view (see §2).

**Milestone B5 (Wayfinding player-side entitlement gating) does not apply to `Lumina_player` yet, because `Lumina_player` has no Wayfinding implementation at all.** Its own `roadmap.md` marks Wayfinding as "Phase 9 — Not started," with a note that the audit behind that verdict found zero Wayfinding traces anywhere in the dashboard repo. That was accurate when it was written — it predates Wayfinding existing in this repo. It's now stale: Wayfinding is a substantial, shipped feature (buildings, floors, POIs, route graphs, kiosk locations, evacuation). See §3.

---

## 2. Tenant suspension — verified compatible, zero Flutter changes needed

`platform_modules_and_tenants_foundation_plan.md` §6.4 requires that a suspended tenant's player "must not expose tenant content." The natural-seeming implementation — reject with `401` — would have been actively harmful here:

`Lumina_player/lib/data/repositories/player_repository.dart` treats **any `401` or `404`** from `/player/state` as a dead screen credential:

```dart
bool _isRevoked(ApiException e) => e.statusCode == 401 || e.statusCode == 404;
```

...and `ScreenRevokedException`'s doc comment confirms the reaction: drop local pairing credentials and return to the pairing screen. A suspended tenant is a temporary, reversible administrative state — not a dead credential — so triggering that path would have unpaired every affected kiosk the moment its tenant was suspended, requiring a manual re-pair to recover even after the suspension was lifted.

**Fix shipped in this repo** (`apps/api/src/modules/player/player.service.ts`): `PlayerService.getState()` now checks `screen.organization.status`, and if `SUSPENDED`, returns a normal `200` with every content field null/empty — the same shape as a screen with nothing assigned. `getManifest()` inherits this automatically since it wraps `getState()`.

**Verified directly against `Lumina_player/lib/domain/models/player_state.dart`'s actual parser**, not just inspection: every field the neutral response sets (`asset: null`, `defaultPlaylist: null`, `emergencyPlaylist: null`, `scheduleRules: []`, `resolvedPlaylistId: null`, `emergencyActive: false`, `volume`, `streamingType`, etc.) is exactly what that `fromJson` already expects and already handles today for an ordinary "no content assigned" screen. **No Dart code needs to change.**

**One open policy question, not decided unilaterally:** the neutral state sets `emergencyActive: false` unconditionally, meaning an in-progress fire evacuation would also go dark if its tenant were suspended mid-emergency. The module-disable case (§8.3 of the plan) explicitly carves out an evacuation bypass; tenant suspension currently does not. Confirm before this reaches a real customer whether suspension should carry the same exception.

---

## 3. Wayfinding — the real fork in the road

### 3.1 What exists today

- **This repo (`Lumina`, web):** Wayfinding is fully built — `Building`/`Floor`/`Poi`/`PoiCategory`/`RouteNode`/`RouteEdge`/`KioskLocation` models, buildings/POI/route CRUD, evacuation mode, kiosk screen-group sync, analytics, and full player-side rendering (`WayfindingKioskMap`, `WayfindingDirectoryBoard`, `WayfindingEvacuationView`, on-device Dijkstra routing) in `apps/player`.
- **`Lumina_player` (Flutter):** none of this exists. `lib/domain/models/player_state.dart` doesn't even have a `wayfinding` field — the model simply doesn't parse it, so today's Flutter app silently ignores that key in the API response entirely (it does not crash; it just never reads it). There is no `lib/features/wayfinding/` directory, no routing engine, no kiosk map, no evacuation view.

### 3.2 Why the gap exists — and why it's now stale

`Lumina_player/roadmap.md`'s Phase 9 section is explicit about this being a deliberate, reasoned decision, not an oversight:

> **Status: ⚪ Not started — no reference exists...** A dedicated audit... found zero matches, anywhere, in any form. None of the files cited below exist... **Skipped for now; revisit only if the backend ever grows real wayfinding schema/data to port against.**

That trigger condition — "if the backend ever grows real wayfinding schema/data" — **has now been met.** This isn't a criticism of that decision; skipping a feature with nothing to port against and no source of truth to check output against was the right call at the time. It just means the verdict needs revisiting now, independent of anything in the entitlements plan.

### 3.3 What this means for Milestone B5 specifically

Milestone B5 (`@RequireModule('WAYFINDING')` gating inside `PlayerService.getState()`, the bounded offline module lease, the evacuation-bypass exemption) is being designed and implemented against `apps/player`'s existing Wayfinding rendering. Two separate things follow from Wayfinding not existing in Flutter yet:

1. **Nothing in B5 is blocked by Flutter's absence of Wayfinding.** B5 ships for the web player on its own timeline; there's no cross-app dependency to wait on.
2. **B5's gating logic has literally nothing to protect in the Flutter app today** — there's no `wayfinding` field being parsed, so there's no risk of an unlicensed Flutter kiosk showing Wayfinding content, because it can't show Wayfinding content at all yet, licensed or not.

**If/when the native team decides to build Phase 9** (native Wayfinding kiosk mode), it should be built entitlement-aware from the start, using the finished B5 design as the reference rather than retrofitting gating afterward:

- The `wayfinding` field should be treated as `null` = "no active kiosk content" — which will naturally cover *all* of "not configured," "module disabled," "tenant suspended," and "trial expired" identically, exactly like `asset`/`defaultPlaylist` already work. No separate error-handling branch needed for any of these — this is the same design property that made the tenant-suspension fix in §2 a zero-Flutter-change fix.
- Per B5's offline-lease design (bounded per-module lease persisted alongside cached state, with an evacuation exemption), Phase 9's local persistence layer (`lib/data/local/player_state_cache.dart`, `database.dart`'s drift/SQLite schema) will need an equivalent lease field once that contract is finalized on the web side. This is exactly the kind of change the player-update SOP exists for — expect a follow-up spec once B5 ships on `apps/player`, not before.
- Evacuation view, if built, must implement the same emergency-bypass exemption B5 defines for the web (evacuation content available regardless of module/lease state) — and should now also settle the open question from §2 above, since both land in the same place.

### 3.4 Recommendation

Two independent, non-blocking recommendations, neither of which is part of `platform_modules_and_tenants_foundation_plan.md`'s own scope:

1. Update `Lumina_player/roadmap.md`'s Phase 9 status note to reflect that its trigger condition has been met, so the next person reading that file doesn't rely on a now-stale "no reference exists" verdict.
2. When Phase 9 is scheduled, treat `apps/player`'s current Wayfinding implementation plus B5's entitlement design (once shipped) as the joint reference, not just the pre-entitlement web behavior — building it twice (once without gating, once retrofitted) would be wasted work.

---

## 4. Smaller drift already found, unrelated to entitlements

Worth knowing about independent of this plan, as evidence for why the player-update SOP matters: `PlayerState` is independently defined in **three** places today — `apps/api`'s inferred `PlayerService.getState()` return type, `apps/player/src/lib/api.ts`'s hand-written TypeScript interface, and `Lumina_player/lib/domain/models/player_state.dart`'s hand-written Dart class — none of them a single shared contract. They've already drifted: the Dart model has a `layout` field (`Layout.fromJson`) that the current API response doesn't send at all (harmless today, since Dart treats a missing JSON key the same as an explicit `null`, but worth cleaning up or explaining next time someone touches that model). Not urgent, not blocking, just flagged so it doesn't get mistaken for a new bug later.

---

## 5. Summary table

| Milestone | Flutter action needed now | Flutter action needed later |
|---|---|---|
| A1 (contract freeze) | None | None |
| B1 (persistence) | None | None |
| B2 (entitlement service) | None | None |
| B3 (Super Admin control plane + suspension) | None — verified compatible | None |
| B4 (dashboard capability layer) | None (dashboard-only) | None |
| B5 (Wayfinding player gating) | None — no Wayfinding exists to gate | A sync spec once B5 ships on `apps/player`, **only if/when** Phase 9 (native Wayfinding) is scheduled |
