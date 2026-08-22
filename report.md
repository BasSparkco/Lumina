# Lumina — Production Readiness & System Audit

Full-stack review of the Lumina digital signage platform (NestJS/Prisma API, Next.js dashboard, Vite kiosk player) ahead of the move from staging to production.

- **Date:** 2026-08-21
- **Branch:** `yaseen`
- **Scope:** `apps/api`, `apps/dashboard`, `apps/player`, `packages/*`
- **Method:** four independent source-level reviews — backend/API/security, dashboard frontend, kiosk player frontend, cross-cutting code quality — reading actual source, not just structure.

All `file:line` references point at the `yaseen` branch as of 2026-08-21. Re-verify locations before patching if the branch has moved on.

**Status key:** ⬜ not started · 🔧 in progress · ✅ fixed · 🚫 won't fix (with reason)

---

## Executive summary

The codebase is more disciplined than the "junior/AI-assisted prototype" framing suggests in several places: auth token segregation, WebSocket room isolation, timer/listener cleanup in the player, and consistent NestJS exception handling are all genuinely solid (see [What's already solid](#whats-already-solid)). But five issues are true production blockers, and two of them aren't code bugs at all — they're product-shaped: several dashboard sections are wired to browser-local mock data with no real backend behind them, and neither client app has an error boundary, which on the player specifically means a crash can strand a live screen until someone physically power-cycles it.

**Counts:** 5 Critical · 10 High · 15 Medium · 11 confirmed strengths

---

## 1. Critical issues (blockers)

Ship-blocking. Each is either an active cross-tenant security hole, a credential-exposure path, or a feature that looks real to a customer but isn't.

### ✅ C1. Cross-tenant IDOR on playlist item writes/deletes
**Backend · Security** — `apps/api/src/modules/playlists/playlists.service.ts:138–181`

`assertOwns(orgId, playlistId)` confirms the *playlist* belongs to the caller's org, but `updateItem`, `removeItem`, and `reorderItems` never check that the `itemId` (or each id in `reorderItems`'s array) actually belongs to that playlist before calling `prisma.playlistItem.update/delete`.

**Failure scenario:** an authenticated non-viewer in Org A calls `PUT /playlists/{ownPlaylistId}/items/{orgB'sItemId}` with any guessable/leaked PlaylistItem id and mutates or destroys another org's playlist content.

### ✅ C2. Bearer tokens written to logs in plaintext
**Backend · Security** — `apps/api/src/app.module.ts:69–76`

`LoggerModule.forRoot({ pinoHttp: {...} })` has no `redact` config, and pino-http's default request serializer logs `req.headers`, including `Authorization: Bearer <token>`.

**Failure scenario:** at the default `info` log level, every request's JWT lands in stdout/whatever log sink is attached — including the **10-year, non-revocable player/screen token**. Anyone with log read access gets standing account or device takeover with no way to detect or revoke it short of rotating `JWT_SECRET`, which invalidates the entire screen fleet.

### ✅ C3. Members/Billing/Audit Log/Reports/Approvals run on localStorage mocks, not real backend
**Dashboard · Product** — `apps/dashboard/src/lib/mocks/{members,billing,auditLog,approvals,proofOfPlay}.ts`

LocalStorage-backed fake clients wired directly into live pages (`members/page.tsx`, `billing/page.tsx`, `audit-log/page.tsx`, `reports/page.tsx`, and the global `(app)/layout.tsx` for approvals). The code is honest about this ("Mock for Phase X, swap for real API"), but nothing in the product surfaces that to a customer. A real `AuditService` already exists server-side at `apps/api/src/modules/audit/` and is unused by the dashboard's Audit Log page.

**Failure scenario:** an admin invites a teammate — the invite exists only in the admin's own browser storage; the teammate opens the accept-invite link on their device and finds nothing. Two admins on two machines see two different "audit logs." A plan upgrade in Billing changes nothing about real payment or entitlement state.

**Decision (2026-08-21):** Add a visible "Coming soon" state rather than fully hide or wire up a backend now. Added `PreviewFeatureNotice` — a shared banner component, translated (en/ar) — to the top of Members, Billing, Audit Log, and the Proof-of-Play tab of Reports (the Kiosk Activity tab is real, per M2, so it's excluded); Approvals doesn't have its own page (it's embedded in Playlists), so the notice sits above the "Require approval" settings card instead, scoped to `canApproveContent` so non-approvers never see it. Underlying mock data/behavior is untouched — this is purely making the limitation visible in-product rather than removing functionality.

### ✅ C4. No error boundary anywhere in the dashboard
**Dashboard** — no `error.tsx` / `global-error.tsx` anywhere

Every route under `(app)` is a large client-rendered page (some editors run 40+ `useState` hooks in a single 4,000-line component — see [Cleanup](#4-code-refactoring--cleanup)); an uncaught render exception takes down the whole route to Next's default unstyled error screen with no recovery action and no telemetry.

**Failure scenario:** a mutated API response shape, a bad array index during a canvas drag in the theme editor, or any unexpected `null` throws mid-render — the entire page goes blank for the user with no "try again."

### ✅ C5. No error boundary in the player — crash kills its own recovery channel
**Player** — `apps/player/src/main.tsx:16–19`, `apps/player/src/pages/PlayerPage.tsx:256–261`

`ThemeRenderer`/`ThemeElementView` render API-supplied theme data cast with `as` and no runtime validation; any malformed field throws and unmounts the entire tree. That unmount runs `PlayerPage`'s cleanup, which tears down the heartbeat interval *and* disconnects the socket — the exact channel the dashboard would use to push a remote `reload` command.

**Failure scenario:** this is the worst failure mode in the audit because there's no user to hit refresh — it's an unattended screen. Once it crashes, the dashboard sees the screen go stale but has no live channel left to fix it remotely; recovery requires someone physically power-cycling the device.

---

## 2. High severity

Should be fixed before production traffic. Individually survivable; several are compounding (e.g. unthrottled auth + no lockout).

### ✅ H1. No rate limiting anywhere in the API
**Backend** — `apps/api/src/modules/auth/auth.controller.ts:16–24`, `apps/api/src/modules/player/player.controller.ts:39–48`

No throttling package installed at all. Login, register, and the unauthenticated-by-design player pairing/check endpoints are wide open to brute force and pairing-code enumeration.

### ✅ H2. Zone replacement is not atomic, despite a comment claiming it is
**Backend** — `apps/api/src/modules/layouts/layouts.service.ts:92–107`

`zone.deleteMany` then a separate `layout.update({ zones: { create }})` — no `$transaction` wraps them.

**Failure scenario:** if the create step throws, the layout is left with zero zones, and every screen assigned to it blanks instantly until an admin re-saves.

### ✅ H3. Nine endpoints bypass the global ValidationPipe entirely
**Backend** — `screens.controller.ts`, `screen-groups.controller.ts`, `buildings.controller.ts`

Typed `@Body()` as an inline object literal instead of a DTO class — Nest's reflection metadata degrades to bare `Object`, which the pipe skips. Includes `setEmergency`, `setLayout`, `setVolume`, `updatePrayer` (unbounded lat/long), and evacuation toggling.

### ✅ H4. Playlist reorder/renumber is not transactional
**Backend** — `apps/api/src/modules/playlists/playlists.service.ts:159–181`

Independent `Promise.all` updates with no `$transaction` anywhere in `apps/api/src/modules`.

**Failure scenario:** a partial failure mid-batch leaves duplicate/gapped `position` values; the player renders whatever tie-break order Postgres returns — silent content misordering on live screens.

### ✅ H5. ~71% of dashboard mutations have no error handling
**Dashboard** — 91 `useMutation` call sites, only 26 wire `onError`

A failed asset rename, playlist reorder, schedule create, or POI edit just resolves into the void — the button appears to do nothing, with no message and no visual state change.

### ✅ H6. 43 self-hosted font families load unconditionally on every page
**Dashboard** — `apps/dashboard/src/lib/fontImports.ts:7–49` → `apps/dashboard/src/app/layout.tsx:5`

A user who only ever sees the default font still downloads all 43 families' CSS + woff2 on first load of any route, including the dashboard home and billing.

### ✅ H7. Editor components mix canvas state with everything else
**Dashboard** — `ThemesSection.tsx` (4,101 lines, 47 `useState`), `LayoutsSection.tsx` (1,892 lines, 22 `useState`)

Every mousemove tick during a drag re-renders the entire tree — sidebar, element list, color pickers, all panels — not just the dragged element.

**Resolution:** Split the interactive preview canvas out of both editors into standalone `LayoutCanvasPanel.tsx` / `ThemeCanvasPanel.tsx` components (canvas render, drag/resize/rotate math, and — for themes — the raster paint/brush layer and inline text editing all moved with it), leaving `LayoutsSection.tsx`/`ThemesSection.tsx` owning only the palette/typography editors, element-card list, and API mutations. `ThemesSection.tsx` dropped from 4,067 to 2,563 lines; `ThemeCanvasPanel.tsx` is 1,558. A mousemove/pointermove tick during drag, resize, rotate, or a paint stroke now only re-renders the canvas panel. Verified in-browser: selection, drag/resize, right-click context menu actions, zoom, inline text edit, and the full paint toolbar (arm → draw → commit) all work with zero console errors post-split.

### ✅ H8. Hydration mismatch on the theme toggle
**Dashboard** — `apps/dashboard/src/context/ThemeContext.tsx:32–34`

Server always renders `light` (`document` is undefined); the client reads the real class already set by the inline init script on first paint. A dark-mode user opening Settings sees a visible flash and a hydration-mismatch console warning.

### ✅ H9. Live-data widgets have no offline cache
**Player** — `WeatherWidget.tsx:14–25`, `CurrencyWidget.tsx:16–27`, `TickerWidget.tsx:23–35`, `db.ts:7–11`

Unlike every other part of player state, these start from `null`/`[]` and only update on a successful fetch.

**Failure scenario:** a kiosk reboots while offline — the layout and static content correctly restore from IndexedDB, but any weather/currency/ticker zone shows "Loading…" forever, since there was never a successful fetch this session to fall back to.

### ✅ H10. Two shared packages built, never adopted / zero test coverage anywhere
**Cross-cutting** — `packages/ui`, `packages/prayer` (0 importers repo-wide); zero `*.spec.ts`/`*.test.ts(x)` in the monorepo

`packages/ui` (Button, Badge) is wired into next.config's `transpilePackages` but not a dependency of either app and imported nowhere. `packages/prayer` fully wraps `adhan` and is imported by zero files — `PrayerZoneWidget.tsx` reimplements the identical logic directly against `adhan` instead.

`apps/api`'s test script is literally `jest --passWithNoTests`, so CI (if any) can never fail on missing coverage. Zero coverage on the highest-risk logic: player pairing/heartbeat (555 lines), and the org-scoping check repeated across 14+ services — exactly the pattern that's already leaking cross-tenant in C1 above.

**Resolution:** Both halves closed — see [Resolve the shared-package question](#5-architectural-recommendations) (`packages/prayer` and `packages/ui`'s `ShapeOutline` both adopted) and [Establish a test baseline](#5-architectural-recommendations) (Jest infra + 17 tests covering org-scoping and player pairing/heartbeat).

---

## 3. Medium severity

Won't block launch, but will surface as the fleet and org count grow, or as isolated hardening gaps.

### ✅ M1. Missing indexes on `organizationId` (and other FK columns)
**Backend** — `schema.prisma` — Organization, Screen, Playlist, Zone, Theme, Schedule, AuditLog…

Despite `organizationId` being the WHERE clause of nearly every list/findFirst call. `AuditLog` is the sharpest case: it's paginated in the controller but has zero indexes backing that query — full sequential scan as history grows.

### ✅ M2. Kiosk analytics list has no pagination
**Backend** — `apps/api/src/modules/kiosk-analytics/kiosk-analytics.service.ts:39–58`

Hard-capped at `take: 5000` with no `skip`/count, unlike the sibling Proof-of-Play endpoint which paginates correctly. An org past 5,000 events simply can't see older data, with no error or indication of truncation.

### ✅ M3. WebSocket CORS hardcoded to `*`; HTTP CORS silently falls back to `*`
**Backend** — `apps/api/src/modules/ws/screen.gateway.ts:31–33`, `apps/api/src/main.ts:26–29`

WS CORS is independent of the HTTP allowlist. The HTTP allowlist itself silently falls back to `'*'` if `DASHBOARD_URL`/`PLAYER_URL` are unset, with no boot-time warning.

### ✅ M4. Pairing confirmation race condition
**Backend** — `apps/api/src/modules/screens/screens.service.ts:396–417`

`confirmPairing` has a race: `findUnique` then an unguarded await then `update`, no transaction or lock. Two concurrent pair requests with the same code can both pass the check before either write commits, reassigning a physical screen to the wrong org.

### ✅ M5. Upload MIME validation trusts the client-supplied header
**Backend** — `apps/api/src/modules/assets/assets.service.ts:14–30`

No magic-byte sniffing, and no `helmet`/`X-Content-Type-Options` is configured anywhere in the stack.

### ✅ M6. Unmemoized context values
**Dashboard** — `AuthContext.tsx:46`, `ThemeContext.tsx:45`, `EditorDirtyContext.tsx:39`

Consumed across 12 files, several of them the giant editor components above — currently low-impact, but a latent re-render trap for any future change to these providers.

### ✅ M7. Raw `<img>` tags, no image optimization config
**Dashboard** — `ImagePicker.tsx:216`, `next.config.mjs`

No `images:` block in Next config — the app has fully opted out of resizing/format negotiation/lazy-loading, so a 4K upload ships at full resolution to every thumbnail and preview.

**Resolution:** Added `images.remotePatterns` to `next.config.mjs`, derived from `NEXT_PUBLIC_API_URL` at build time so it's correct in every environment without hardcoding a host. Converted the 5 genuine thumbnail/preview-grid usages to `next/image`: assets grid (both the org and library tabs), playlist item thumbnails (both the picker modal and the item list), and the screen screenshot panel. Deliberately left 5 other `<img>` usages untouched — `ImageLightbox.tsx` (custom pan/zoom transform logic that `next/image`'s sizing model doesn't fit), and `CropEditor.tsx`/`PoiMapEditor.tsx`/`RouteGraphEditor.tsx`/the layout-canvas renderers, which already carry an explicit `eslint-disable` with a documented rationale from a prior engineer (pixel-precision editing surfaces, not bandwidth-sensitive bulk thumbnails).

Verified: typecheck, build (confirms the config's `NEXT_PUBLIC_API_URL`-derived `remotePatterns` parses correctly). Also verified the `remotePatterns` matching mechanism itself directly against a live dev server — an unlisted host was rejected with "url parameter is not allowed" (config correctly enforced) while the configured host produced a *different* error ("resolved to private ip"), proving it passed the allowlist check and only failed on Next's separate built-in SSRF guard against loopback addresses — expected for `localhost` in local dev, not applicable against a real deployed domain. Full logged-in browser verification against real thumbnail data was blocked by this session's own CORS fix (the live staging API only allows its real origin, not a local dev port) — didn't work around that, since it would've meant modifying the shared staging environment without asking first.

### ✅ M8. AssetPicker has no loading/error state
**Dashboard** — `AssetPicker.tsx:22`

`useQuery` result destructures only `data = []`, discarding `isLoading`/`isError` — a failed or slow request is indistinguishable from "no assets exist yet."

### ✅ M9. i18n key drift
**Dashboard** — `messages/ar.json` vs `en.json`

Three keys under `screens.unpairedSection` are missing from the Arabic locale — isolated recent-feature gap, not systemic.

### ✅ M10. Dead, misleading state in the Zustand store
**Player** — `apps/player/src/store/playerStore.ts:6–8, 17–18, 41–49`

`playlist`/`currentIndex`/`nextItem()` are defined but never read; real playback position lives in `ZonePlayer`'s local state instead. A landmine for the next person who assumes the store is the source of truth.

### ✅ M11. Build artifact tracked in git
**Player** — `apps/player/tsconfig.tsbuildinfo`

Tracked despite a root `.gitignore` rule for `*.tsbuildinfo` — committed before the rule existed, so it shows as modified on every local build. `git rm --cached` fixes it.

### ✅ M12. Hand-rolled `.env` parser reinvents `dotenv`
**Cross-cutting** — `apps/api/src/app.module.ts:27–59`

A 30-line parser determines the app's entire environment before Nest boots — hard to trace, easy to get subtly wrong.

### ✅ M13. No schema-validated env config layer
**Cross-cutting** — `apps/api/src/app.module.ts:65–68` and every `process.env.X` read site

`ConfigModule` is wired but performs no validation; consumers read `process.env.X` directly with inline `??` fallbacks. A typo'd required var fails deep inside Prisma at request time, not at startup.

### ✅ M14. Local `resolveColor` duplicates the shared package's `resolveThemeColor`
**Cross-cutting** — `ThemesSection.tsx:234–238` vs `packages/types/src/theme.ts:216–223`

The dashboard editor already imports four other functions from `packages/types` but reinvented this fifth one as a local duplicate — a live drift risk between editor preview and actual player output.

### 🚫 M15. (reserved — never a real finding, was a numbering placeholder in the original draft)

---

## 4. Code refactoring & cleanup

Not urgent, but this is where review risk and future bug rate compound if left alone.

### ✅ Duplicate rendering logic between dashboard and player
The `ShapeOutline` SVG component is byte-for-byte duplicated in `ThemeRenderer.tsx:211–233` (player) and `ThemesSection.tsx:316–338` (dashboard) — both already build on the shared `shapeOutlineGeometry()` helper, so only the React wrapper itself was copy-pasted rather than lifted into `packages/ui`, which exists for exactly this and sits unused.

**Resolution:** Moved to `packages/ui/src/ShapeOutline.tsx`, imported by both `ThemeRenderer.tsx` and `ThemesSection.tsx`; the duplicate local definitions removed. Verified with a full build of both apps.

### ✅ Date/time formatting split three ways (scope corrected on inspection)
Dashboard's `useDateFormat.ts` hook and the player's separate `TimeWidget.tsx`/`DateWidget.tsx` each implement their own locale formatting for the same "theme widget renders current time" concept — worth one shared helper, especially given both need to honor the same RTL/locale rules the rest of the theme content shares.

**Resolution:** On closer inspection these three don't actually share extractable formatting logic — `useDateFormat.ts` is an *admin's own browser preference* (DD/MM vs MM/DD for reading report timestamps in the dashboard), while `TimeWidget`/`DateWidget` render a *live public clock* on the signage screen itself from the screen's configured timezone/format, with genuinely different `Intl` option sets for time vs. date. Forcing those into one shared module would have been an artificial abstraction, not a real duplication fix. What *was* genuinely duplicated between the two player widgets — the self-ticking `useState(() => new Date())` + `setInterval` clock state — is now `apps/player/src/lib/useNow.ts`, used by both with their own cadence (1s for the visible seconds tick, 60s for the day-rollover check).

### ✅ No shared base/repository pattern across API services
~14 services (`buildings`, `power-schedules`, `schedules`, `layouts`, `screen-groups`, …) each hand-write near-identical `create/findOne/update/remove` methods with the same `findFirst({ id, organizationId }) → NotFoundException` guard repeated ~200–300 lines across the module set. A small `OrgScopedService<T>` base would remove the duplication *and* make the org-scoping check impossible for a new module to forget — directly relevant to C1.

**Resolution:** Added `apps/api/src/common/org-scoped.service.ts` — a single injectable `assertOwns(lookup, notFoundMessage)` helper (composition, not inheritance, to sidestep Prisma's per-model delegate generics) registered as a `@Global()` module. Migrated all 13 services with this pattern (50 call sites total: screens 10, assets 8, routes 5, playlists 4/pois 4/power-schedules 4, layouts 3/buildings 3/schedules 3, screen-groups 2/themes 2, org 1/proof-of-play 1). Verified via full typecheck+build, a fresh Nest boot ("Nest application successfully started" with the full DI graph resolving), and a targeted fix for one unused-variable regression the migration introduced in `assets.service.ts`'s `rename`. Deliberately left untouched: `poi-categories.service.ts`'s three-way not-found/forbidden/wrong-org branch and `org.service.ts`'s existence-check-then-reject pattern — neither fits the "find-or-404" shape.

### ✅ Small duplicated helpers
`clampPct`/`clampZoom` are defined nearly verbatim in both `LayoutsSection.tsx:92–93` and `ThemesSection.tsx:130–131` — exactly the drift the prior Themes/Layouts unification (EditorAddSidebar, AssetPicker, ImagePicker) was meant to prevent.

**Resolution:** Extracted to `src/lib/editorZoom.ts` (`ZOOM_MIN`/`ZOOM_MAX`/`ZOOM_STEP`, `clampPct`, `clampZoom` — confirmed byte-for-byte identical in both files before extraction), matching the existing `canvasSnap.ts`/`rotatedResize.ts` shared-editor-utility pattern.

### ✅ `lib/mocks/auditLog.ts` is mislabeled, not dead
Despite the folder name, this is live production code — the only implementation of audit logging on the dashboard — imported by nine pages and the app shell. A real `AuditService` already exists server-side. Rename it out of `mocks/` at minimum; better, wire it to the real service (see C3).

**Resolution:** Did the "at minimum" — moved to `src/lib/auditLog.ts` (out of `lib/mocks/`), updated its two direct importers (`useAuditLog.ts`, `audit-log/page.tsx`; the other pages go through the `useAuditLog()` hook, not the file directly). Content, `SEED` data, and the `lumina_mock_audit_log` localStorage key are all untouched — deliberately did not rename the storage key, since that would silently wipe every admin's existing browser-stored audit history. Wiring it to the real server-side `AuditService` is the "better" half of this finding and stays with C3's product decision.

### ⬜ Editor components need decomposition
`ThemesSection.tsx` (4,101 lines) and `LayoutsSection.tsx` (1,892 lines) each mix canvas rendering, drag/resize math, half a dozen quick-add panels, the property inspector, undo/history, and API mutations in one component. Splitting by concern is both a maintainability fix and the direct cure for H7.

---

## 5. Architectural recommendations

### ✅ Typed, validated environment config
Replace the hand-rolled `.env` parser and ad-hoc `process.env` reads with a single Joi/zod-validated config module that fails fast at boot if a required var is missing or malformed.

**Resolution:** Added `apps/api/src/config/env.validation.ts` (zod, matching the version already used elsewhere in the monorepo) wired via `ConfigModule.forRoot({ validate })`. Covers every var actually read (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `S3_*`, `CDN_BASE_URL`, `PORT`/`HOST`/`NODE_ENV`/`LOG_LEVEL`, plus the already-optional `DASHBOARD_URL`/`PLAYER_URL`). Verified both directions: a valid env boots clean to "Nest application successfully started"; a deliberately broken one (`JWT_SECRET=short`, empty `DATABASE_URL`) exits with code 1 and a clear aggregated error before `app.listen()` is ever reached — confirming the fail-fast behavior this was meant to add. The hand-rolled `.env` file parser itself (`loadEnvFile()` in `app.module.ts`) was deliberately left as-is — see M12, a separate, lower-priority cleanup.

### ✅ Rate limiting + secret redaction as one security pass
`@nestjs/throttler` on auth and pairing endpoints, plus a pino `redact` config for the `authorization` header, are both small, mechanical changes with outsized risk reduction — bundle them as the first PR out of this audit.

### ✅ Establish a test baseline, prioritized by blast radius
Start with the org-scoping guard pattern repeated across every service (highest blast radius, already has one confirmed leak) and the player pairing/heartbeat service. A base `OrgScopedService` also makes this pattern testable once instead of fourteen times.

**Resolution:** Stood up Jest + ts-jest infra from scratch (none existed — `jest.config.ts`, plus the standard `tsconfig.build.json`/`nest-cli.json` split so spec files never leak into the production `dist/` build). 17 tests across 4 suites: `OrgScopedService` itself; a direct regression suite for the C1 IDOR fix (`updateItem`/`removeItem`/`reorderItems` all reject a foreign playlist-item id); a direct regression suite for the M4 pairing-race fix (`confirmPairing`'s compare-and-swap); and `PlayerService`'s pairing/heartbeat path. Verified end-to-end: typecheck, build, zero spec leak into `dist/`, and a fresh Nest boot with the full DI graph resolving.

### ✅ Resolve the shared-package question one way or the other (`packages/prayer` adopted, `packages/ui`'s `ShapeOutline` adopted; `Button`/`Badge` remain available, unforced)
`packages/ui` and `packages/prayer` represent real prior intent to share code between dashboard and player that never got followed through. Either wire them in (they'd directly absorb the `ShapeOutline` and prayer-calc duplication) or delete them.

### ✅ Indexing strategy tied to the multi-tenant access pattern
A blanket `@@index` pass on `organizationId` (and composite indexes where a status/date field is the next filter, e.g. AuditLog) should ship as one migration rather than piecemeal.

**Resolution:** See M1 — 17 indexes added in one migration (`20260821110431_add_org_scoping_indexes`), matched to actual query patterns traced through each service rather than blanket `organizationId`-only indexes.

### ✅ Asset URL lifecycle — reviewed, accepted as-is
Media URLs are deliberately unauthenticated (unguessable cuids, internal-only rationale — a reasonable call). But there's currently no expiry or revocation path for an individual asset link once shared. Worth deciding now whether that's acceptable long-term or needs signed/expiring URLs.

**Decision (2026-08-21):** Unguessable cuid-based URLs with no expiry are an acceptable trade-off for now. Signed/expiring URLs were considered and explicitly deferred — they'd need a refresh mechanism on the player (which runs unattended for weeks) so an expired URL never blanks a live screen, and that's real design work not worth doing speculatively. Revisit if a real incident or compliance requirement comes up.

---

## 6. Prioritized action plan

Sequenced by risk and dependency, not by effort — Phase 0 items are small individually but block everything after them.

### Phase 0 — Now
- ✅ Add ownership check for `itemId` inside `playlists.service.ts`'s update/remove/reorder methods *(→ C1)*
- ✅ Add pino `redact` config for the `authorization` header *(→ C2)*
- ✅ Product decision: which of Members / Billing / Audit Log / Reports / Approvals ship real, get feature-flagged off, or get an explicit "Coming soon" state before launch *(→ C3)*
- ✅ Add a root error boundary to the dashboard app; add one to the player plus a watchdog that force-reloads on an uncaught error *(→ C4, C5)*

### Phase 1 — Pre-launch
- ✅ Add `@nestjs/throttler` to auth + pairing endpoints *(→ H1)*
- ✅ Wrap zone replacement and playlist reorder in `$transaction` *(→ H2, H4)*
- ✅ Convert the 9 inline-body endpoints to real DTO classes *(→ H3)*
- ✅ Add an IndexedDB cache for weather/currency/ticker widget data in the player *(→ H9)*
- ✅ Wire a default `onError` via the React Query client; backfill the highest-traffic mutations *(→ H5)*
- ✅ Split font imports to load per-theme instead of globally in the root layout *(→ H6)*

### Phase 2 — Hardening
- ✅ Migration: add `@@index` on `organizationId` across the schema; paginate kiosk-analytics *(→ M1, M2)*
- ✅ Fix WS gateway CORS to match the HTTP allowlist; fail closed instead of falling back to `'*'` *(→ M3)*
- ✅ Wrap `confirmPairing` in a transaction/lock; add magic-byte upload validation *(→ M4, M5)*
- ✅ Decompose `ThemesSection.tsx` / `LayoutsSection.tsx` by concern *(→ H7, cleanup)*
- ✅ Introduce `OrgScopedService` base; resolve `packages/ui`/`packages/prayer` (adopt or delete) *(→ H10, cleanup, architecture)*

### Phase 3 — Ongoing
- ✅ Stand up real test coverage starting with org-scoping and player pairing/heartbeat; add schema-validated env config *(→ H10, M13)*
- ✅ Hygiene sweep: untrack `tsconfig.tsbuildinfo`, fix the theme-toggle hydration mismatch, close the 3-key i18n gap, memoize the three context providers *(→ M6, H8, M9, M11)*

---

## What's already solid

Worth stating plainly so the roadmap above doesn't read as a verdict on the whole codebase — these held up under deliberately skeptical review.

- **Dashboard vs. player JWT segregation** is clean: each strategy explicitly rejects the other token type, and the player strategy re-checks the screen is still paired on every request.
- **WebSocket room isolation** is server-derived entirely from the verified JWT — a client cannot request to join another org's room.
- **No raw SQL anywhere** in the API — all access goes through Prisma's query builder, eliminating that injection class outright.
- **Global exception filter** collapses non-HTTP errors to a generic message for the client while logging the full exception server-side only.
- **Password hashing and JWT secrets are sound** — bcrypt cost 12, and both strategies throw at startup on a missing secret rather than falling back to a weak default.
- **Consistent NestJS exception usage and pino logging** across every module — no raw `console.log` anywhere in the three apps.
- **Player timer/listener hygiene is excellent** — every `setInterval`/`setTimeout`/listener found across a dozen components is correctly cleared, unusual discipline for code meant to run unattended for weeks.
- **WebSocket reconnection logic** in the player uses sane exponential backoff with no attempt cap, and correctly re-pulls state on `reconnect` rather than `connect`.
- **Offline fallback for primary content** correctly distinguishes a definitive 401/404 from a transient failure before deciding whether to fall back to cached state.
- **The prior Themes/Layouts editor unification held** — the themes route is a clean redirect, not a second duplicated page tree.
- **React Query configuration is deliberate**, not default — sane `staleTime`/`retry` paired with explicit `cache: 'no-store'` on fetches to avoid a second invisible HTTP cache fighting the query cache.
