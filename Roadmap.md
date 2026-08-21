# Roadmap — Lumina Signage

A phased plan from foundations to a scalable, multi-tenant signage platform. Each phase ends with
a usable increment. **Don't skip Phase 1's player work** — the player is the hardest, most
underestimated part of any signage product, so it's tackled early and deliberately.

> This file is the single roadmap for the project. It previously existed as five drifting
> documents (`Roadmap.md` + `Roadmap-Phase5-Backend.md` + `Roadmap-Phase5-Frontend.md` +
> `Roadmap-EditorFeatures.md` + `Roadmap-OptiSignsParity.md`); they've been merged here and
> deleted. Daily/granular progress notes still live in `status.md` (archive through Phase 4),
> `status-backend.md`, and `status-frontend.md` if you need that level of detail.

Legend: ☐ todo · ◐ in progress · ☑ done

---

## Phase 0 — Foundations (Weeks 1–2) ✅ COMPLETE

Goal: a clean monorepo and the skeleton everything else hangs on.

- ☑ Monorepo scaffold (Turborepo + pnpm): `dashboard`, `api`, `worker`, `player`, `packages/types`
- ☑ Shared tooling: TypeScript, ESLint, Prettier, commit hooks, Conventional Commits
- ☑ Docker Compose for local infra: Postgres (5434), Redis (6381), MinIO (9010/9011)
- ☑ NestJS API skeleton with health check, config module, logging (Pino)
- ☑ Next.js dashboard skeleton with RTL-ready layout + i18n scaffolding (next-intl en/ar)
- ☑ Prisma schema bootstrap + first migration (tenant isolation from day 1)
- ☑ CI pipeline: install → lint → typecheck → test → build (`.github/workflows/ci.yml`; verified
  green locally across all 4 apps — no test files exist yet, Jest passes with `--passWithNoTests`
  until real tests are written)

**Exit criteria:** `pnpm dev` boots all apps; CI is green.

---

## Phase 1 — MVP: one screen, one slideshow (Weeks 3–6) ✅ COMPLETE

Goal: a user can sign up, upload images, pair a screen, and see a timed slideshow play. The
single most important milestone — it proves the end-to-end loop.

**Backend / data**
- ☑ Auth: email/password, JWT, single organization per user
- ☑ Entities: `Organization`, `User`, `Screen`, `Asset`, `Playlist`, `PlaylistItem`
- ☑ Media upload → S3/MinIO; store metadata only in Postgres
- ☑ Worker: generate thumbnails on upload (sharp, BullMQ)
- ☑ Screen pairing flow (player shows code → user enters it in dashboard)

**Player (PWA)**
- ☑ Pairing screen + token storage
- ☑ Fetch assigned playlist; render timed image slideshow
- ☑ Offline cache (Service Worker + IndexedDB) — keep playing without network
- ☑ Heartbeat to API (online / last-seen / current item)
- ☑ Auto-recovery: reload on crash, resume on boot

**Dashboard**
- ☑ Asset library (upload, list, delete)
- ☑ Playlist builder (order items, set per-image duration)
- ☑ Screen list with online/offline status
- ☑ Assign a playlist to a screen

**Exit criteria:** Upload images → build a playlist → pair a real device (or kiosk browser) →
slideshow plays and survives a network drop.

---

## Phase 2 — Video, audio & real-time publishing (Weeks 7–10) 🔄 IN PROGRESS

Goal: rich media and instant updates.

- ☑ Video upload + transcoding/normalization pipeline (FFmpeg in worker, BullMQ)
- ☑ Video playback in player with preloading
- ☐ Background audio track layered under image playlists
- ☑ WebSocket gateway (NestJS) — push "publish" / "reload" to players instantly
- ☑ Redis pub/sub so WS scales across multiple API instances
- ☑ Player command channel: publish, reload, clear-cache, reboot
- ☑ Dashboard: live screen status via WS (no manual refresh)

**Exit criteria:** Change a playlist in the dashboard → screen updates within seconds, no manual
refresh; video and background audio play smoothly.

---

## Phase 3 — Layouts, themes, scheduling (Weeks 11–16) ✅ COMPLETE (themes editor since expanded, see below)

Goal: the features that make it a real product, not a slideshow.

**Layouts & zones**
- ☑ Layout model: split a screen into zones, each running its own playlist
- ☑ Player renders multi-zone layouts (e.g. main + sidebar + bottom ticker)

**Themes / templates**
- ☑ Theme model: pre-built, editable designs — canvas editor shipped (see "Editor UX upgrade"
  below for the shape/lock/layering/undo work that brought it to parity with the layouts editor)
- ☐ Starter themes: restaurant/café menu, retail promo, lobby, clinic
- ☐ Editable fields (e.g. menu prices) without touching the design
- ☐ Dynamic data fields bound to a feed/sheet (auto-update prices/values)

**Scheduling**
- ☑ Schedule model: dayparting + day-of-week + date ranges
- ☑ Resolver decides what each screen plays "right now" (API + player local)
- ☑ Local scheduler in player (works offline, transitions on time)
- ☑ Emergency override: instantly take over selected/all screens

**Exit criteria:** A café owner picks a menu theme, edits prices, sets a breakfast/lunch
schedule, adds a ticker zone, and publishes — all without design skills.

---

## Phase 4 — Faith module & live data connectors (Weeks 17–21) ✅ COMPLETE

Goal: the regional differentiators and the airport/API use cases.

**Prayer module**
- ☑ `packages/prayer`: prayer-time engine (adhan), per-screen location + method
- ☑ On-device computation in player (offline-capable)
- ☑ Athan audio playback at correct times
- ☑ Prayer-times widget/zone + next-prayer countdown
- ☑ RTL Arabic support across prayer widget and data widgets

**Data connectors (worker-polled, never called from the player)**
- ☑ Connector framework: poll → normalize → cache (Redis) → serve via API
- ☑ Weather connector (Open-Meteo — free, no API key)
- ☑ Currency connector (ECB daily XML — free)
- ☐ Flights connector (AeroAPI / AviationStack) — deferred, needs API key
- ☑ RSS/news ticker connector + scrolling TickerWidget
- ☑ Data widgets: WeatherWidget, CurrencyWidget, TickerWidget, PrayerZoneWidget
- ☑ Zone type routing in player (MEDIA/PRAYER/WEATHER/CURRENCY/TICKER)
- ☑ Dashboard: faith settings per screen + zone type selector in layout builder

**Exit criteria:** A mosque shows prayer times + athan offline; an airport screen shows live
flights, weather, and currency from cached feeds.

---

## Phase 5 — Multi-tenant teams, RBAC & operations (Weeks 22–27) ✅ COMPLETE (billing pending Stripe key)

Goal: ready for real customers and teams. Ran as two parallel tracks (API/worker/Prisma vs.
dashboard UI); both are done except billing, which is blocked on a Stripe test-mode secret key.

**Teams & RBAC**
- ☑ `OrgInvite` model + invite/accept endpoints (`POST /v1/org/invite`, `POST /v1/org/invite/accept`,
  `GET /v1/org/invites`); no email delivery wired up yet — dashboard shows/copies the invite link
- ☑ `PUT /v1/org/members/:id/role`, `DELETE /v1/org/members/:id` (blocks demoting/removing the
  last owner)
- ☑ Permission guard applied globally via `RolesGuard`; sensitive endpoints use explicit
  `@Roles(...)` (see `common/decorators/roles.decorator.ts` + `common/guards/roles.guard.ts`)
- ☑ Dashboard: Members page (list/invite/role/remove), accept-invite flow, role-aware nav
  (hides billing/member management from non-admins, read-only for viewers), client-side route
  guard (defense in depth — backend is the real enforcement)

**Content approval workflow**
- ☑ `ApprovalStatus` enum on `Playlist` (`DRAFT`/`PENDING`/`APPROVED`/`REJECTED`); editor-created
  playlists default to `DRAFT`
- ☑ Submit/approve/reject endpoints (OWNER/ADMIN gate approve/reject); assigning a playlist to a
  screen rejects anything not `APPROVED` — the actual publish gate
- ☑ Dashboard: "Submit for review" action, admin "Pending approvals" view, status badges

**Audit log**
- ☑ `AuditLog` model + global `AuditInterceptor` (logs every mutating request; failures to write
  are swallowed so a broken audit write never fails the real request)
- ☑ `GET /v1/org/audit-log` (paginated, OWNER/ADMIN only) + dashboard filterable table

**Screen groups & tags**
- ☑ `ScreenGroup` model + `Screen.groupId` (one group per screen, matches the "bulk publish by
  location" exit criteria — not many-to-many tags)
- ☑ CRUD endpoints + `PUT /v1/screens/:id/group` + bulk publish endpoint
- ☑ Dashboard: create/edit groups, filter screen list, "Publish to group" bulk action

**Proof-of-play logging**
- ☑ `ProofOfPlayLog` model + batched ingest endpoint (`POST /v1/player/proof-of-play`, screen-token
  auth, up to 500 events/call)
- ☑ Paginated query + CSV export endpoints
- ☑ Dashboard: Reports page (table + date/screen filters), export button, simple charts

**Fleet monitoring**
- ☑ `GET /v1/screens/fleet-status` (counts + per-screen status/lastSeenAt/alerts)
- ☑ Worker cron (`FleetMonitorService`, every minute) flags no-heartbeat-for-3+min as OFFLINE,
  writes `ScreenAlert`, auto-resolves on recovery
- ☑ Dashboard: fleet overview page (uptime %, last-seen, alerts), alert badges/toasts

**Billing/subscriptions**
- ☐ Stripe integration (checkout session, webhook handler), `Subscription` model
  (plan/status/screenLimit/currentPeriodEnd), enforce `screenLimit` on pairing
- ☐ `GET /v1/org/billing` + checkout endpoint; dashboard billing page (plan/usage/upgrade) and
  screen-limit-reached messaging
- **Blocked:** needs a Stripe test-mode secret key before this can start.

**Exit criteria:** A team with mixed roles manages dozens of screens across locations with
approvals, billing, and proof-of-play, entirely through the dashboard, with every mutating action
enforced server-side and audited.

---

## Phase 6 — Scale, hardening & growth (ongoing)

- ☑ Designer/canvas (drag-and-drop template editor) — shipped as the themes/layouts canvas editor
  (Phase 3), since brought to parity across both editors — see "Editor UX upgrade" below
- ☐ MQTT transport for the player fleet (replace/augment WS at scale)
- ☐ Native Android player (wrap PWA in WebView; auto-start on boot)
- ☐ Smart-display targets (Samsung Tizen / LG webOS) as demand appears
- ☐ White-label / reseller mode (branding per reseller, sub-accounts)
- ☐ Interactivity: touch kiosks, QR codes (QR display element tracked under OptiSigns parity below)
- ☐ Audience analytics (dwell time, optional camera-based counts) — privacy-reviewed
- ☐ Mobile admin app
- ☐ Security & compliance: SSO, GDPR tooling, penetration test, SOC 2 path
- ☐ Observability: Prometheus/Grafana dashboards, alerting, SLOs

---

## Phase 7 — Wayfinding signage (new content type, planned)

Goal: a genuinely new signage kind — interactive directory/wayfinding kiosks (malls, hospitals,
campuses, office towers, airports) — sitting alongside today's passive slideshow/theme signage.
Everything shipped so far assumes a screen plays *at* a passive viewer; wayfinding is the first
content type where a viewer touches the screen and asks it a question ("where is X, and how do I
get there"). That's a different interaction model, not just a new zone/widget type, so it's scoped
as its own phase rather than squeezed into the OptiSigns-parity widget batches.

Reuse-first: floor plans are just `Asset` (IMAGE), POI pins reuse the percentage-based x/y
placement already proven by `Zone`/`ThemeElement`, kiosk styling reuses `Theme` palette/typography,
"store closed" pushes reuse the existing publish/WS pipeline, and fire-evacuation mode reuses the
existing per-screen `emergencyActive` override. The genuinely new pieces are: touch input in the
player, a POI/floor data model, and a route-finding engine.

### 7.1 — Data model & static directory (non-interactive first)

Ship the data model and a **non-touch** rotating directory board first — it's useful on its own
(cheap non-touch panels are common in malls) and de-risks the content model before touch/routing
complexity.

- ☑ `Building` model (org-scoped: name, address, floor order) (2026-08-15) — `floor order` is
  just `Floor.level` sorted, no separate field needed
- ☑ `Floor` model (belongs to `Building`; level number/label, floor-plan `Asset` reference — reuses
  `Asset` IMAGE type, no new storage pipeline needed) (2026-08-15)
- ☑ `PoiCategory` model (icon, color, i18n label — store/restroom/elevator/stairs/exit/food/ATM/etc.)
  (2026-08-15) — 12 system presets seeded with `organizationId: null` (same pattern as
  `THEME_PRESETS`), curated in `packages/types/src/wayfinding.ts` (`POI_CATEGORY_PRESETS`,
  lucide-react icon names); orgs can add their own custom categories alongside the presets but
  can't edit/delete the system rows
- ☑ `Poi` (point of interest) model: name (i18n), categoryId, floorId, x/y (%, same convention as
  `Zone.x/y`), icon/logo `Asset`, description, status (`OPEN`/`CLOSED`/`RELOCATED`), external ref
  id (for syncing against a mall/CMMS tenant system later) (2026-08-15) — i18n done as explicit
  `nameAr`/`descriptionAr` columns (nullable, falls back to the base field), not a Json blob, so
  the alphabetical-listing exit criteria in 7.2 can sort/filter directly in SQL
- ☑ `KioskLocation`: screenId + floorId + x/y — the "you are here" pin binding a physical screen to
  a coordinate, mirrors how `Screen.themeId`/`layoutId` bind a screen to content today (2026-08-15)
  — its own table (not columns on `Screen`) since it also carries x/y placement; `ScreensService`
  got `setKioskLocation`/`clearKioskLocation` mirroring `setLayout`/`setTheme`'s shape exactly,
  deliberately not touching `streamingType` so flipping types and back doesn't lose the binding
- ☑ New `StreamingType` value `WAYFINDING` (alongside `ASSET`/`PLAYLIST`/`LAYOUT`/`THEME`)
  (2026-08-15) — also had to widen `SetStreamingTypeDto`'s `@IsIn` allowlist and the dashboard/
  player's standalone `StreamingType` unions in `lib/api.ts`, same multi-spot pattern as the past
  shape-enum work; caught the DTO gap via a live PUT that 400'd until fixed
- ☑ IA decision: Wayfinding management (Buildings/Floors/POI Categories/POIs) gets its own
  top-level sidebar entry, the same as Layouts — it's a genuinely separate content type, not a
  sub-page of something else. The one thing that *doesn't* live there is the per-screen kiosk
  binding (which floor a screen sits on + its "you are here" pin) — that stays on the Screens
  page next to the existing streaming-type picker, same as how asset/playlist/layout/theme
  pickers are already inline there rather than requiring a trip to another section (2026-08-16)
- ☑ Dashboard: Buildings/Floors admin (upload floor plan, order floors), POI table CRUD + CSV bulk
  import (common ask — malls already maintain a tenant spreadsheet) — **backend done** in an
  earlier session: full CRUD API for buildings/floors/POI categories/POIs under a new
  `WayfindingModule` (`apps/api/src/modules/wayfinding/`), plus `POST /floors/:floorId/pois/import`
  accepting dashboard-parsed CSV rows matched against category *label* (case-insensitive, not id —
  friendlier for a spreadsheet a mall already maintains), failing the whole batch with a 1-based
  row number on the first unresolved category rather than silently dropping rows. **Dashboard UI
  shipped (2026-08-16)**: new `/wayfinding` sidebar section (`apps/dashboard/src/app/[locale]/
  (app)/wayfinding/`) with a Buildings → Floors → Categories/POIs drill-down, floor-plan upload via
  `ImagePicker`, POI Categories (system presets read-only + org custom), POI table, and CSV import.
- ☑ Dashboard: POI pin-drop editor overlaid on the floor plan image — same percentage-canvas
  mechanics as the Layouts/Themes editors (`react-rnd`), just placing pins instead of zones
  (2026-08-16) — shipped as a shared `PoiMapEditor` component
  (`apps/dashboard/src/components/PoiMapEditor.tsx`), reused for both POI placement in the
  Wayfinding section and the kiosk "you are here" pin on the Screens page
- ☑ Screens page: per-screen kiosk binding — a `WAYFINDING` streaming-type option alongside
  Asset/Playlist/Layout/Theme, with an inline floor picker + `PoiMapEditor` to place/move the
  "you are here" pin, calling the existing `setKioskLocation`/`clearKioskLocation` endpoints
  (2026-08-16) — building this surfaced a real bug in the *existing* `ScreensService.list()`
  (used by `GET /screens`, what the dashboard's Screens page actually reads): it never included
  the `kioskLocation` relation, only `findOne` did, so the picker looked like it forgot the saved
  floor/pin on every list refresh even though the row was intact in the DB. Fixed by adding the
  same include `findOne` already had. Full flow browser-tested end to end (build → set kiosk
  floor/pin → reload → still there).
- ☑ Player: static/non-touch directory mode — rotates through POIs by category/floor on a timer,
  no interaction (works today's offline-cache/publish pipeline unchanged) (2026-08-17) —
  `PlayerService.getState` now includes `screen.kioskLocation.floor.building.floors.pois` and
  returns a `wayfinding` field (building + ordered floors + all of the building's POIs grouped by
  floor/category) whenever `streamingType === 'WAYFINDING'`, following the exact null-gating
  convention `theme`/`layout` already use; new `apps/player/src/components/
  WayfindingDirectoryBoard.tsx` renders it as a full-screen dark board that cycles one floor at a
  time (12s dwell, self-contained `setInterval` — same pattern as `ThemeRenderer`'s
  `DocumentPager`), grouping that floor's POIs by category with a "You are here" badge on the
  kiosk's own floor and CLOSED/RELOCATED status tags; category icons render via `lucide-react`
  (newly added to the player's deps — `PoiCategory.icon` already stored lucide component names for
  this). `resolvePlaylist`/`computeHasContent` both got a `wayfinding` branch alongside their
  existing `theme`/`layout` ones so schedule-resolution and the awaiting-content heartbeat badge
  stay honest for kiosk screens. Verified two ways: a throwaway Prisma script exercising the exact
  nested include against the dev DB (floors/POIs/categories came back correctly shaped, cleaned up
  after itself), and a real browser render (player dev server + Playwright route-mocking
  `/player/state`) confirming the grouping, status tags, "you are here" badge, and floor-rotation
  dots all look right with no console errors.

**Exit criteria:** An admin uploads a mall's floor plans, bulk-imports its tenant list with
categories, and a non-touch screen at the entrance cycles through the directory. **Met** — data
model, admin dashboard UI, kiosk floor/pin binding, and the player's directory-board renderer are
all done and tested end to end.

### 7.2 — Interactive touch kiosk

- ☑ Player: touch input support — first interactive surface in the player (everything else is
  passive); pan/zoom on the floor plan, tap a POI for a detail card (2026-08-20) — new
  `apps/player/src/components/WayfindingKioskMap.tsx`, pointer-events-based (not raw touch
  events) so a mouse works too for dev/testing; pinch-to-zoom and single-finger pan share one
  gesture state machine keyed off `pointersRef`'s active-pointer count, tap-vs-drag disambiguated
  by movement threshold + duration rather than relying on native `click` (which pointer capture
  on the container would otherwise swallow) — POI hits resolved via
  `document.elementFromPoint(...).closest('[data-poi-id]')` at tap time instead of manual
  transform-matrix math. `PlayerService.getState` now includes each floor's `floorPlanUrl` (was
  missing — 7.1 only needed the grouped list, not the image) and each `Poi`'s `x`/`y`. `PlayerPage`
  picks this over the existing passive `WayfindingDirectoryBoard` via a runtime
  `navigator.maxTouchPoints`/`ontouchstart` check — no new per-screen config, a non-touch panel
  automatically keeps the 7.1 rotating board. Verified via player dev server + Playwright
  route-mocking `/player/state` (same method 7.1 used): pin placement accuracy across two POIs
  and the kiosk's own "you are here" marker, tap-to-open and tap-backdrop-to-close on both an
  open and a closed/status-tagged POI, floor switching (including a floor with no uploaded plan
  falling back to an empty-state box rather than breaking), double-tap-to-zoom, and the
  reset-view button all confirmed against screenshots, no console errors.
- ☑ Player: "you are here" marker rendered from `KioskLocation` (2026-08-20) — shipped together
  with the map above (a pulsing pin at `kiosk.x`/`kiosk.y` on the kiosk's own floor); folded in
  rather than tracked separately since the map view is the thing it's rendered on top of
- ☑ Player: on-screen directory — alphabetical list + category filter + search (on-screen keyboard)
  (2026-08-20) — new `apps/player/src/components/WayfindingDirectoryPanel.tsx`, opened via a
  "Directory" button added to `WayfindingKioskMap`'s header. Searches/lists across every floor in
  the building, not just the one currently shown — a visitor looking a store up usually doesn't
  know which floor it's on — so picking a result has to be able to switch floors under the
  existing detail-card flow. That collided with `WayfindingKioskMap`'s existing
  floor-change effect (which resets `selectedPoi`/pan-zoom whenever `floorId` changes, correct
  for the floor-tab case but wrong for a directory pick that wants to land on a specific POI);
  fixed with a `skipNextFloorResetRef` the directory-pick path sets right before changing floors
  so that one reset is skipped. Category filter is single-select toggle chips built from the
  unique categories present in `directory.pois` (no separate category-list endpoint needed). The
  on-screen keyboard is a docked QWERTY (letters + space + backspace), built new rather than
  relying on any OS/browser virtual keyboard — kiosk hardware is assumed touch-only with no
  physical keyboard and OS soft-keyboards are unreliable/absent on kiosk-mode browsers. `tsc
  --noEmit` and ESLint clean. Verified via a throwaway Playwright script against the player dev
  server (same route-mocking-`/player/state` method 7.1/7.2 used so far): alphabetical list with
  category chips and status tags render correctly, live search-as-you-type filtering via the
  on-screen keyboard, and — the trickiest path — picking a result on a *different* floor than the
  one currently shown correctly switches the floor tab and opens that POI's detail card in the
  same action, confirmed by screenshot.
- ☑ Player: idle/attract-loop mode (2026-08-20) — after 90s with no touch anywhere in the kiosk UI
  (map, directory panel, keyboard, detail card — one capture-phase pointerdown listener on the
  whole component, not just the pan/zoom viewport), `WayfindingKioskMap` swaps in a fullscreen
  overlay showing whichever attract content is configured, with a "Tap to browse the directory"
  hint; any tap anywhere dismisses it back to the normal kiosk view and restarts the idle clock.
  No timer is armed at all if neither attract field is set, so a kiosk with nothing configured
  just stays on the map. Reused the existing `ZonePlayer`/`ThemeRenderer` components directly
  (a playlist or theme is rendered exactly like it would be anywhere else in the player) rather
  than inventing new rendering — `WayfindingKioskMap` now takes the full `PlayerState` (was just
  `directory`) so `ThemeRenderer` has what it needs for widget zones, and forwards
  `onAssetChange` through to whichever content is playing so attract-loop playback shows up in
  the heartbeat/proof-of-play stream like any other content.
- ☑ Dashboard: attract-loop content picker per kiosk (2026-08-20) — new `KioskAttractContentPanel`
  in `apps/dashboard/src/app/[locale]/(app)/screens/page.tsx`, rendered next to
  `KioskLocationPanel` once a kiosk floor/pin is actually set (the backend rejects attract
  content before that, so the picker doesn't show until there's something to attach it to). Two
  tab buttons switch which dropdown is showing (`Playlist` / `Theme`, plain local view state —
  switching tabs to look around doesn't itself clear anything); picking an option is what fires
  the mutation. No shared "pick a playlist" component existed anywhere in the dashboard (every
  other screen inlines its own `<select>` bound to the same `playlists`/`themes` queries), so this
  matches that established pattern rather than introducing a new abstraction for one caller.
  Backend: `KioskLocation.attractPlaylistId`/`attractThemeId` (migration
  `20260820144527_add_kiosk_attract_content`), `ScreensService.setKioskAttractPlaylist`/
  `setKioskAttractTheme` each clear the other field, mirroring `assignPlaylist` clearing
  `layoutId` — same "only one live at a time" convention used everywhere else a screen's content
  type is chosen. `PlayerService.getState` hydrates whichever is set into
  `wayfinding.attractPlaylist`/`attractTheme`. `tsc --noEmit` and ESLint clean across
  `api`/`dashboard`/`player` (one pre-existing lint error in `screens/page.tsx`'s unused type
  imports and two pre-existing `PlayerPage.tsx` promise-handling errors confirmed via `git stash`
  to predate this session, left alone). Verified via a throwaway Playwright script against the
  player dev server (temporarily shortening the idle constant to make the wait practical, reverted
  after): idle timeout correctly triggers the attract overlay for both a playlist-image and a
  theme-with-widgets case, and a tap correctly wakes it back to the kiosk map — confirmed by
  screenshot for all three states. Dashboard picker itself verified via `tsc`/lint only, not
  browser-driven (no lumina API dev server was reachable in this session to click through it live).
- ☑ Offline resilience: floor plans + POI data cached like today's playlist/theme cache, kiosk
  stays usable through a network drop (2026-08-20) — audited first: `PlayerState` (including
  `wayfinding`) already round-trips through the player's IndexedDB cache for free (`cache.ts`'s
  `saveState`/`getState` store the whole blob generically, no field allowlist). The actual gap was
  images: floor plans and POI icons are plain `<img src>` tags, and the kiosk map/directory board
  only ever render the *current* floor, so every other floor's plan (and most POI icons) would
  stay unfetched — and thus uncached by the service worker — until a visitor happened to browse
  there while still online. Fixed with `prefetchWayfindingImages()` in `PlayerPage.tsx`, called
  from `applyState` (so it re-runs on every fresh state — initial load, publish push, reconnect,
  periodic refresh, not just first mount): fires an out-of-band `new Image().src = url` for every
  floor's `floorPlanUrl` and every POI's `iconUrl` up front, which is enough to get them into both
  the browser's HTTP cache and the service worker's `media-cache` runtime-caching rule the same
  way a real `<img>` render would — no new caching mechanism, just triggering the existing one
  earlier. Also closed a real, separate gap the audit surfaced: `vite.config.ts`'s Workbox
  `CacheFirst` regex only matched common raster extensions (jpg/png/gif/webp) and would've silently
  never cached an SVG floor plan — added `svg` to the pattern. `tsc --noEmit` and ESLint clean.
  Verified via a throwaway Playwright script asserting on actual network requests (not just
  visual/screenshot): with 3 floors and a POI icon in a mocked `/player/state`, only floor 1 is
  ever rendered as an `<img>`, but all 3 floor plans *and* the POI icon showed up as real browser
  requests within 2s of load — confirming floors 2/3 and the icon were prefetched, not just the
  one actually on screen.

**Exit criteria:** A visitor walks up to a paired touch kiosk, searches or browses for a store, and
sees it highlighted on the map with a "you are here" reference point — all without network access.
**Met** — touch pan/zoom/tap, the on-screen directory (search + category filter + on-screen
keyboard), idle/attract-loop mode with a dashboard content picker, and prefetch-driven offline
resilience for floor plans/POI icons are all done and tested.

### 7.3 — Route finding & multi-floor navigation ✅ COMPLETE (2026-08-20)

- ☑ `RouteNode`/`RouteEdge` graph model (2026-08-20) — mirrors `Poi`'s x/y-percentage-on-`Floor`
  convention exactly; `RouteEdgeType` enum (`WALK`/`ELEVATOR`/`ESCALATOR`/`STAIRS`, migration
  `20260820170320_add_route_graph`) typed per edge rather than per node, since the same node (an
  elevator lobby) can have both a WALK edge to a neighboring node and an ELEVATOR edge to the
  floor above. Every edge is treated as bidirectional by the routing engine — no separate
  "reverse" row. Backend: new `apps/api/src/modules/wayfinding/routes.{service,controller}.ts`
  (`RoutesService`/`RoutesController`, registered in `WayfindingModule` alongside
  Buildings/PoiCategories/Pois), CRUD for nodes (`POST/PUT/DELETE .../route-nodes`) and edges
  (`POST/PUT/DELETE .../route-edges`), plus `GET /buildings/:buildingId/route-graph` returning the
  whole building's nodes+edges in one call — used by both the dashboard editor (which needs every
  floor's nodes to offer as the far end of a cross-floor edge) and, via `PlayerService.getState`,
  by the player. Cross-floor edge creation validates both endpoint nodes belong to the *same*
  building (not just the same org) so a stray id can't wire two unrelated buildings' graphs
  together.
- ☑ Dashboard: route graph editor (2026-08-20) — new `RouteGraphEditor` component
  (`apps/dashboard/src/components/RouteGraphEditor.tsx`), same percentage-canvas/`react-rnd`
  mechanics as `PoiMapEditor` but for a multi-node graph instead of one pin: three explicit modes
  (Select / Add node / Connect nodes, icon toggle group) rather than overloading a single click,
  since "click empty canvas" and "click a node" need to mean different things depending on intent.
  Connect mode arms on the first node click and completes on the second, auto-computing a default
  WALK weight from the two nodes' on-canvas distance (editable after). Edges render as an SVG
  overlay with a wide invisible hit-line so a thin edge stays easy to click. Wired into a new
  `RouteGraphSection`/`NodeInspector`/`EdgeInspector` set in `wayfinding/page.tsx`, rendered below
  the existing POI/floor-plan grid on `FloorDetail`. Cross-floor connections are a separate
  "Cross-floor connections" panel on the node inspector (pick another floor, pick a node on it,
  pick ELEVATOR/ESCALATOR/STAIRS, set weight) rather than trying to draw an off-canvas line — the
  graph is per-building (`GET .../route-graph`), so the panel can offer every other floor's nodes
  without a page navigation. Nodes with a cross-floor edge get an amber ring badge so they're
  visually distinct from plain same-floor nodes. i18n (en/ar) under a new `wayfinding.routeGraph`
  namespace. `tsc --noEmit` and ESLint clean across `api`/`dashboard`. Live-smoke-tested end to end
  against the real dev stack (Playwright driving a real headless Chromium against the dashboard +
  API + dev Postgres, not mocked): created a test building/two floors, added three nodes in Add
  Node mode, connected them in Connect mode (screenshotted mid-connect and post-connect), edited an
  edge's type/weight via the inspector, added a real node on the second floor, and created a
  cross-floor ELEVATOR edge from the node inspector — confirmed by screenshot at each step,
  including the amber cross-floor badge appearing on the source node. All test data (building,
  floors, nodes, edges) deleted afterward; verified via a direct Prisma query that `RouteNode`/
  `RouteEdge` counts are back to 0.
- ☑ Routing engine: shortest-path, computed on-device in the player (2026-08-20) — new
  `apps/player/src/lib/routing.ts`: plain O(n²) Dijkstra (no heap — a building's route graph is at
  most a few hundred nodes, nowhere near needing one), run entirely client-side so kiosk routing
  keeps working offline, same philosophy as the local schedule resolver. `findNearestNode()`
  snaps an arbitrary point (the kiosk's own "you are here" pin, or a selected POI's pin — neither
  is itself a graph node) to the closest `RouteNode` on that point's floor before searching.
  `PlayerService.getState` hydrates the whole building's `routeNodes`/`routeEdges` into the
  `wayfinding` payload (edges fetched separately from the floors→pois nested include, since an
  edge can connect nodes on two different floors and so doesn't fit that per-floor tree).
- ☑ Accessible-route mode (2026-08-20) — `computeRoute(..., accessible)` filters `STAIRS` edges out
  of the graph before searching when accessible mode is on, exactly the "weight/exclude stairs"
  spec from this section's own goal line; a wheelchair-icon toggle in the directions panel flips it
  and recomputes live (the whole search re-runs client-side, fast enough at this graph size to not
  need debouncing).
- ☑ Player: draw the computed path + step-by-step text list (2026-08-20) — `WayfindingKioskMap`
  gained a "Directions" button on a POI's detail card (shown whenever a route exists between the
  kiosk and that POI); tapping it swaps the card for a directions panel with a numbered step list
  from `routing.ts`'s `buildDirectionSteps()`. Steps are necessarily approximate turn-by-turn — the
  graph carries distance/time and edge type, not headings, so "turn left" isn't derivable — but
  every floor change *is* precise ("Take the elevator to Level 1"), which is the part a visitor
  actually needs help with. The path itself draws as a green SVG polyline over whichever floor is
  currently on screen (`floorRoutePoints`, `viewBox="0 0 100 100"` so it shares the same
  percentage-coordinate space as POI pins), anchored to the kiosk's exact "you are here" position
  and the POI's exact pin at the start/end of the route rather than stopping short at the nearest
  graph node. Switching floor tabs while the panel is open re-draws just that floor's segment,
  letting a visitor follow the route floor by floor — which surfaced (and this fixed) a real
  pre-existing bug: the header/floor-tabs sat *underneath* the detail-card backdrop the whole time
  (an absolutely-positioned `backdrop` with `z-index: auto` paints above static in-flow content
  regardless of DOM order), so floor tabs had been unclickable any time a POI card was open since
  7.2 shipped — fixed with an explicit `zIndex: 2` on the header. Also fixed a layout collision the
  new wheelchair-toggle button exposed: it and the card's existing close (X) button both tried to
  occupy the same top-right corner, rendering as one overlapping icon — moved the toggle to its own
  absolutely-positioned slot rather than a flex `marginInlineStart: auto` that assumed it had that
  corner to itself.
- ☑ QR handoff (2026-08-20) — reuses the existing `QrCodeWidget` component and `qrcode` package
  directly, per this section's own "no new mechanism" note: the directions panel's "Continue on
  your phone" button renders `QrCodeWidget` with `value` set to the destination name plus the full
  numbered step list as plain text (no route-viewing web page exists to link to, so the QR payload
  is the directions themselves — readable by any phone's camera/QR app without needing a Lumina
  page to load).
  `tsc --noEmit` and ESLint clean across `api`/`dashboard`/`player`. Live-smoke-tested end to end
  with a scripted Playwright session against the player dev server (same route-mocked-`/player/state`
  method 7.1/7.2 used): a 2-floor building with a kiosk on floor 1 and a POI on floor 2 connected
  via an ELEVATOR edge — tapped the POI, opened Directions (confirmed the 3-step list: "Head
  straight…", "Take the elevator to Level 1.", "Continue to \<POI\>."), toggled accessible mode
  (confirmed the icon-collision fix), switched back to the floor-1 tab with the panel still open
  (confirmed the path segment redrew from the kiosk's pin to the elevator node, and that the fix
  actually restored floor-tab clickability), and opened the QR panel (confirmed a real, correctly
  rendered scannable code). Zero console/page errors across the whole run.

**Exit criteria:** A visitor picks a destination on a different floor; the kiosk draws a route
(including which elevator to use) and offers a QR code to continue on their phone. **Met** — the
route graph data model, dashboard editor, on-device Dijkstra routing engine with accessible mode,
path-drawing + step-by-step directions, and QR handoff are all done and tested end to end.

### 7.4 — Ops, accessibility & analytics ✅ COMPLETE (2026-08-20)

- ☑ Live POI status pushes (closed/relocated) over the existing WS publish pipeline (2026-08-20) —
  `PoisService.create`/`update`/`remove`/`import` now push a bare `{ type: 'publish' }` command
  (same payload-free "go re-fetch" signal playlist/layout publish already uses) to every screen
  whose `KioskLocation` sits on a floor in the affected POI's building, resolved via a
  `pushToKiosksInBuilding(buildingId)` helper; `WayfindingModule` gained `WsModule` as an import so
  `PoisService` can inject `ScreenGateway` directly, the same pattern `ScreensService`/
  `ScreenGroupsService` already use. Deliberately unconditional — not gated behind
  `ScreensService`'s `pushIfAutoPublish`/org `autoPublish` setting — since POI status is live
  directory data a facilities manager expects to land in seconds, not a draft staged behind a
  Publish button.
- ☑ Fire/evacuation mode (2026-08-20) — reuses `Screen.emergencyActive` exactly as scoped, no
  parallel override system. Two parts: (1) `ScreensService.setEmergency` now pushes unconditionally
  (`gateway.sendToScreen` directly) instead of going through the autoPublish-gated
  `pushIfAutoPublish` every other screen-setting change uses — a safety toggle can't sit waiting on
  an org's publish preference, and this was true (and arguably a latent gap) even for the
  general-purpose emergency override this phase didn't otherwise touch. (2) New
  `BuildingsService.setEvacuation(orgId, buildingId, active)` (`PUT /buildings/:id/evacuation`) fans
  that same per-screen call out to every kiosk pinned in the building in one call — `WayfindingModule`
  gained `ScreensModule` as an import for this. On the player, `PlayerPage.tsx` now checks
  `state.emergencyActive && state.wayfinding` (with no `emergencyPlaylist` set) ahead of the normal
  wayfinding branch and renders a new `WayfindingEvacuationView.tsx`: routes from the kiosk's "you
  are here" pin to the nearest POI whose category is labeled "Exit" (the same system preset every
  building already has from 7.1), explicitly excluding `ELEVATOR` edges — `routing.ts`'s
  `computeRoute` traded its boolean `accessible` param for a `{ accessible?, avoidElevators? }`
  options object so evacuation mode could add its own exclusion the same way 7.3's wheelchair mode
  excludes `STAIRS`. Draws the path + numbered steps in a full-screen red banner and auto-reads the
  directions aloud on entry (see TTS below) rather than waiting for a tap, since an evacuation
  screen is meant to be reacted to instantly. Dashboard: a `BuildingOpsPanel` above the floor list
  on the Wayfinding building view shows a live "N kiosks in evacuation mode" badge (derived from the
  screens list's `emergencyActive`, not a separate tracked flag) with a confirm-gated
  trigger/clear button — deliberately not routed through the existing "confirm before delete"
  opt-out setting, since a safety-critical action should always confirm regardless of that
  preference.
- ☑ Text-to-speech route readout + larger-touch-target accessibility mode (2026-08-20) — new
  `apps/player/src/lib/tts.ts` wraps the plain browser `SpeechSynthesisUtterance` API (no new
  dependency, same "kiosk hardware is a browser" assumption the on-screen keyboard already makes);
  a speaker-icon button next to the existing wheelchair-accessible toggle in `WayfindingKioskMap`'s
  directions panel reads `buildDirectionSteps()`'s output aloud, tracked via the utterance's own
  `onend`/`onerror` callbacks rather than polling so the button's state can't drift out of sync with
  actual playback. Accessibility mode is a persisted (`localStorage`) header toggle that scales up
  touch-critical chrome — the Directory button, floor tabs, POI pins and the "you are here" marker,
  the wheelchair/TTS/close buttons' surrounding hit area, and step-list text — by a flat 1.35×
  factor rather than rewriting every style as a function; verified visually (larger pins/buttons
  render correctly in both languages, see screenshots from the language-toggle test below).
- ☑ Multi-language directory switching (2026-08-20) — the player had no i18n library at all (unlike
  the dashboard's next-intl setup) and the wayfinding data's `nameAr`/`descriptionAr`/`labelAr`
  fields went completely unread until now. New `apps/player/src/lib/wayfindingLang.ts`: a small
  inline EN/AR string dictionary (the player only needs a handful of fixed UI strings, not a full
  framework) plus `pickName`/`pickDescription`/`pickCategoryLabel` helpers that fall back to the
  base field when no Arabic value is set. A persisted EN/AR toggle button in `WayfindingKioskMap`'s
  header flips `dir="rtl"`/`"ltr"` on the container and is threaded into `WayfindingDirectoryPanel`
  and the evacuation view; the passive `WayfindingDirectoryBoard` (no touch, so no toggle of its
  own) reads whatever language was last persisted rather than carrying a second disconnected
  language state. `routing.ts`'s `buildDirectionSteps()` gained a `lang` parameter with its own
  localized sentence templates so turn-by-turn text (and therefore the TTS readout) comes out in
  the selected language. **Known accepted trade-off:** the on-screen keyboard
  (`WayfindingDirectoryPanel`) is still Latin/QWERTY-only — a visitor can search a Store's Arabic
  name once it's on screen, but can't type Arabic into the search box via the on-screen keyboard;
  a full Arabic keyboard layout was out of scope for this pass. Verified live via Playwright against
  the player dev server (route-mocked `/player/state`, same method prior wayfinding phases used):
  language toggle flips the whole kiosk to RTL Arabic with correctly localized chrome and
  bilingual POI data, confirmed by screenshot in both languages and combined with accessibility
  mode.
- ☑ Kiosk analytics: popular searches/destinations, session counts (2026-08-20) — extends the
  proof-of-play ingest/query shape rather than a new analytics system: new `KioskEvent` model
  (migration `20260820191956_add_kiosk_events`, type `SESSION_START`/`SEARCH`/`POI_VIEW`, with
  `poiName` denormalized since POIs churn far more than screens do) and a new
  `KioskAnalyticsModule` mirroring `ProofOfPlayModule` file-for-file — `KioskAnalyticsService.ingest`
  wired into `PlayerController`'s existing screen-authenticated (`PlayerJwtGuard`) surface as
  `POST /player/wayfinding-events`, `.list` exposed as an admin-authenticated `GET /kiosk-events`.
  Player side: new `apps/player/src/lib/kioskAnalytics.ts` fires a single-event POST per occurrence
  (fire-and-forget, errors swallowed) rather than building a buffered-flush pipeline like proof-of-
  play's — kiosk interactions are low-frequency enough not to need one. `WayfindingKioskMap` logs
  one `SESSION_START` per mount and a `POI_VIEW` on every POI selection (pin tap or directory pick);
  `WayfindingDirectoryPanel` logs a debounced `SEARCH` (1.2s after typing settles, not per
  keystroke). Dashboard: the Reports page gained a "Kiosk activity" tab (only shown when the org has
  any `WAYFINDING` screens) alongside the existing Proof-of-play tab, same filter/chart/CSV-export
  pattern, aggregating top searches and top destinations client-side from the raw event list.
  Verified end to end against the real dev stack: created a building/floor/kiosk, exercised POI
  create+status-update (confirming the push-to-kiosks path executed without error), confirmed
  `GET /kiosk-events` (admin-authenticated) succeeds and `POST /player/wayfinding-events` correctly
  401s without a player token, then cleaned up all test data — verified via a direct Prisma count
  that no building/screen/group/event rows were left behind.
- ☑ `ScreenGroup`-based building/floor grouping for bulk operations (2026-08-20) — reuses the
  existing generic `ScreenGroup` model/CRUD/bulk-publish-volume endpoints as-is rather than a
  building-aware grouping concept: new `BuildingsService.syncScreenGroup(orgId, buildingId)`
  (`POST /buildings/:id/sync-screen-group`) creates-or-reuses a `ScreenGroup` named
  `"{building name} kiosks"` and syncs its membership to exactly this building's currently
  kiosk-bound screens. `Screen.groupId` is a single scalar FK (one group per screen), so syncing
  reassigns membership outright — an explicit, idempotent "sync" action, not a silent side effect.
  Dashboard: a "Sync kiosk screen group" button in the same `BuildingOpsPanel` as the evacuation
  toggle, with a success toast naming the group and its screen count; the synced group then shows
  up on the existing Screen Groups page with its bulk publish/volume controls unchanged. Verified
  live against the dev stack in the same backend test as the kiosk-analytics item above: synced a
  test building, confirmed a `ScreenGroup` named `"Verify74 Mall kiosks"` was created containing
  exactly the one test kiosk screen, then cleaned it up.

`tsc --noEmit` and lint clean across `api`/`dashboard`/`player` for every file this section touched
(the dashboard's `eslint` config currently fails to load for unrelated, pre-existing reasons —
confirmed via `git stash` to predate this session — so the dashboard changes were verified by
`tsc` only, consistent with how this gap has been handled in prior sessions).

**Exit criteria:** A facilities manager marks a tenant "temporarily relocated" from the dashboard
and every kiosk reflects it within seconds; in a drill, evacuation mode overrides all kiosks in the
building instantly. **Met** — POI status pushes are unconditional (not gated by autoPublish) and
resolve every kiosk in the affected building; evacuation mode flips every kiosk in a building via
one call and was verified live to toggle `Screen.emergencyActive` on and back off correctly, with
the player rendering a real evacuation-route view (routing to the nearest Exit POI, elevators
excluded) confirmed by screenshot.

### Later / stretch (post-Phase 7)

- ☐ Outdoor/campus wayfinding — GPS-based, multi-building routing between outdoor and indoor graphs
- ☐ Mobile companion hand-off — continue navigation on a visitor's phone past the QR handoff (live
  blue-dot if GPS/BLE beacons are available)
- ☐ BLE beacon / indoor-positioning integration for blue-dot accuracy indoors
- ☐ Sponsored directory placements / ad slots in the attract loop (mall revenue model)
- ☐ Live wait-time or occupancy integration per POI (e.g. restaurant wait, gate status)
- ☐ Voice-directed navigation
- ☐ 3D/isometric map rendering option

---

## Editor feature work (2026-07 batch)

### Editor UX upgrade — Themes/Layouts parity ✅ COMPLETE (2026-07-28)

Both `/themes` and `/layouts` in the dashboard are canvas editors built on `react-rnd` that had
drifted apart in mechanics; this batch brought them to parity and fixed a video-thumbnail bug.

- ☑ Root cause + fix: `@ffprobe-installer` binary losing its executable bit caused video assets to
  land in `ERROR` with no thumbnail and no way to recover; added a defensive `chmod 755` at module
  load, a `POST /assets/:id/reprocess` endpoint, and a distinct `ERROR`-state UI with retry button
- ☑ Real shapes: shared `ThemeElementShapeSchema` + `shapeClipStyle()` helper (rectangle / rounded
  / circle / ellipse / triangle), applied identically across both editors' canvases, zone/element
  cards, thumbnails, and the player renderer
- ☑ `editable` lock wired end-to-end: `editable: false` disables drag/resize/rotate and hides the
  rotate handle regardless of selection, with a lock badge in the canvas; added the same toggle to
  Layouts zone cards (previously Themes-only and not actually read anywhere)
- ☑ Layering controls: bring-to-front / forward / backward / send-to-back in both editors' cards,
  backed by a shared `reorderZIndex()` helper
- ☑ Hover-reveal bounding box: the rectangular hit-box outline only shows on hover/selection now
  (shape fill/clip itself is unaffected — always rendered)
- ☑ Click-to-select-before-edit safety mode: `useRequireSelectToEdit` hook (localStorage, default
  on), gates drag/resize/rotate behind selection in both editors, Settings page toggle,
  `editable: false` always locks regardless of the setting
- ☑ Undo/redo ported into the Themes editor (previously Layouts-only); both editors now have
  identical shape/lock/layering/hover/click-to-select/undo-redo behavior
- ☑ i18n (en/ar) for all of the above; `tsc --noEmit` and ESLint clean; manually smoke-tested live
- Known accepted trade-offs: the Themes ticker RSS-URL text field and the color-role `<select>`
  aren't individually undo-bracketed (low-traffic fields, not worth extra plumbing this pass)

### OptiSigns parity — editor widgets & free elements ✅ COMPLETE (started 2026-07-30, finished 2026-08-02)

Basel pulled a feature list from the OptiSigns editor to compare against ours; closing the gaps
one item at a time, easiest/most-reused-infra first, biggest lift last.

Already at parity: playlist widget, weather widget, overlay image/video with z-index layering.

- ☑ Time + Date widgets (2026-07-30) — mirrors the existing widget/zone pattern (`TIME`/`DATE`
  added to `ThemeWidgetType`/`ZoneType`, new `TimeWidget`/`DateWidget` player components,
  config panels reusing `TimezoneSelect`, i18n); live-smoke-tested end to end
- ☑ Free-text scrolling ticker + vertical direction (2026-07-30) — `TickerWidget` accepts
  `staticText` as an alternative to `feedUrl` and a horizontal/vertical `direction`; config UI
  adds content-source and scroll-direction selects; smoke-tested including Arabic text
- ☑ QR code widget ☑ done (2026-07-30) — mirrored the Time/Date widget pattern exactly:
  `ThemeWidgetTypeSchema`/`ZoneType` (+migration `20260730190000_add_qr_zone_type`)/DTO/dashboard
  &player `ZoneType`/`ThemeWidgetType` unions all got `QR` added; new `apps/player/src/components/
  QrCodeWidget.tsx` (renders via the `qrcode` package as an inline SVG scaled to the zone, config:
  `value`, `color`, `background`, `sizePercent`) wired into both `LiveWidget.tsx` (theme WIDGET
  elements) and `PlayerPage.tsx`'s `zoneHasContent`/`ZoneRenderer` (layout zones); `WidgetConfigFields.tsx`
  gained a QR panel (content text field + two color pickers + size number, rose-themed to match
  the other widget panels); both editors' `EditorAddSidebar` got a new "Interactive" group for it.
  Along the way, found and fixed a stale-running-process bug unrelated to the feature itself: the
  API's `nest start --watch` dev server had an orphaned child process (`dist/src/main`, PID
  survived a parent restart) holding port 4000 with a Prisma client built before this session's
  `@lumina/db` rebuild, causing every save to 400 until it was killed and restarted fresh.
  Verified end-to-end: added a QR zone via the sidebar in the dashboard, configured a URL, saved
  the layout, published it to a freshly-paired test screen, and confirmed the player rendered a
  real, correctly-formed scannable QR code. Also confirmed the same widget config panel renders
  correctly for a theme WIDGET element. All test screens/layouts/assets cleaned up afterward
  (including recovering from an accidental delete of a seeded test screen, restored via the
  idempotent `db:seed` script) — verified via `tsc --noEmit` clean across
  `@lumina/types`/`dashboard`/`player`/`api`.
- ☑ More free shapes: pentagon, hexagon, octagon, star (2026-07-30) — extended
  `ThemeElementShapeSchema` (`packages/types/src/theme.ts`) and its shared `shapeClipStyle()` with
  CSS `clip-path: polygon(...)` values for the four new shapes; mirrored the same four values
  everywhere the existing rectangle/rounded/circle/triangle set was duplicated: the Prisma
  `ZoneShape` enum (+ migration `20260730200000_add_polygon_zone_shapes`, `ALTER TYPE ... ADD
  VALUE`), the `ZONE_SHAPES` allowlist in `create-layout.dto.ts`, the standalone `ElementShape`
  union types in both `apps/dashboard/src/lib/api.ts` and `apps/player/src/lib/api.ts`, the
  `ELEMENT_SHAPES`/`ZONE_SHAPES` picker arrays in both editors, and `shapeTypes` i18n labels
  (en/ar) in both the Themes and Layouts message namespaces. Scope decision: applied uniformly to
  every element/zone kind, same as the existing triangle — restricting to `SHAPE`-kind only would
  need per-kind branching in the picker for marginal benefit, and a triangle-clipped video already
  has the same "looks odd at the points" trade-off today. Rebuilt `@lumina/db`'s generated Prisma
  client and its `tsc` output after the migration (this repo keeps a second, hand-built `dist/`
  ahead of the raw Prisma-generated types — both needed a rebuild before `api`'s typecheck picked
  up the new enum values). Verified via `tsc --noEmit` clean across
  `@lumina/types`/`api`/`dashboard`/`player` and ESLint clean on every touched file (pre-existing
  lint debt elsewhere in the dashboard/player/api was left alone as out of scope). Not yet
  live-smoke-tested end to end: logged into the dashboard, opened the Mosque starter theme in the
  Themes editor, cycled its shape element through all four new options plus the existing ones, and
  confirmed via screenshot each one clips correctly (star, pentagon, hexagon, octagon all render
  as sharp, correctly-proportioned polygons on the 16:9 canvas — the hexagon/octagon look
  noticeably elongated on that wide aspect ratio, which is expected and matches the pre-existing
  circle→ellipse behavior on non-square boxes, not a bug). No data left behind: "Customize & edit"
  on a starter template only stages an in-memory copy client-side and persists nothing until
  "Save theme" is clicked, which this session never did — verified via the API that still only the
  4 seeded starter themes exist afterward.
- ☑ Decorative shapes for pure looks — arrow shape + solid/outline fill (2026-07-30) — correction
  of the item above: Basel's actual ask was MS-Paint-style decoration (drop an arrow, paint it a
  color; drop an outline circle for emphasis), not more clip-mask options for media-bearing
  zones/elements. Scoped to the Themes editor's existing `SHAPE` element kind only (`Zone`s hold
  content, so they're not a fit for a no-content decorative element) — added an `arrow` shape
  (clip-path polygon, same mechanism as the previous batch, also mirrored into `ZoneShape` +
  migration `20260730210000_add_arrow_zone_shape` for consistency, since it was effectively free)
  and a new `style.shapeFill: 'solid' | 'outline'` + `strokeWidthPx` pair on
  `ThemeElementStyleSchema`. Solid mode is the existing color-block behavior unchanged. Outline
  mode renders via a new shared `shapeOutlineGeometry()` helper (`packages/types/src/theme.ts`)
  consumed as inline SVG (`<rect>`/`<ellipse>`/`<polygon>` with `fill="none" stroke=...`) in the
  player's `ThemeRenderer` and both Themes-editor canvas render paths — deliberately *not* done
  with plain CSS `border` + `clip-path`, since a border on a clipped box only follows the box's
  rectangular edge, not an arbitrary polygon, and produces a broken-looking ring for anything past
  rectangle/circle. Inspector gained a "Fill style" select plus a color field that relabels itself
  (Background color ↔ Outline color) and swaps Corner radius for Stroke width depending on mode.
  `tsc --noEmit` clean across `@lumina/types`/`api`/`dashboard`/`player`; ESLint clean on every
  touched file. Live-smoke-tested end to end in the same Mosque theme: a solid red arrow, an
  outline red arrow, an outline red circle (the emphasis-ring example), and an outline red star —
  all four screenshotted and confirmed correct, including the default (no shape set) rectangle
  outline. No data left behind, verified the same way as the item above (4 seeded themes, no more).
  Follow-up same day: Basel pointed out the add flow itself was clunky — drop a default-rectangle
  shape, then scroll down to the element cards to actually set shape/fill/color. Extended
  `EditorAddSidebarItem` (`apps/dashboard/src/components/EditorAddSidebar.tsx`) with an optional
  `panel` render slot — an item with one expands inline (accordion-style, one open at a time)
  instead of firing immediately, receiving a `close()` callback its own confirm action calls when
  done — and gave the Shape sidebar entry a `ShapeQuickAddPanel` (shape grid + solid/outline
  toggle + palette-swatch/custom-color row + "Add shape" button) so all three are picked *before*
  the element exists, landing on canvas already configured. `addElementOfKind` gained an optional
  style-overrides param to carry the picks through. `EditorAddSidebarItem.onClick` had to become
  optional to allow `panel`-only items (Layouts' usage of the same shared component, all
  onClick-only, is unaffected). `tsc --noEmit` and ESLint clean; live-smoke-tested — expanding the
  panel adds nothing by itself, picking star + outline + a custom blue and clicking "Add shape"
  drops a correctly-configured element on canvas and auto-closes the drawer, confirmed by
  screenshot. No data left behind (same verification as above).
- ☑ Brush tool (freeform drawing) (2026-08-01) — new `BRUSH` element kind, Themes editor only
  (same reasoning as the decorative-shapes work: layout zones hold content, so they're not a fit).
  Content is `{ points: {x,y}[] }` in the element's own 0–100 bounding-box space (like the shape
  outline points already do), rendered as an SVG `<polyline>` — `brushPolylinePoints()` (shared
  helper, `packages/types/src/theme.ts`) reused identically by the Themes editor canvas, its
  thumbnail cards, and the player's `ThemeRenderer`. Reused existing style fields
  (`backgroundColor` as stroke color, `strokeWidthPx`, `opacity`) rather than adding new ones.
  Drawing mode: the sidebar's "Brush" item arms a canvas-covering pointer-capture overlay
  (`brushArmed`/`brushDraft` state in `themes/page.tsx`) with a live-preview polyline and a
  cancel-able hint banner; releasing the drag computes the stroke's bounding box (with padding),
  normalizes the recorded points into it, and creates the element. Inspector panel gained a
  "Redraw" button (`brushRedrawId`) that re-arms drawing mode targeting the existing element in
  place instead of creating a new one. No Prisma migration — `Theme.elements` is already a `Json`
  column and the zod `ThemeInputSchema` (shared, API-side authoritative) picked up the new variant
  automatically. `tsc --noEmit` clean across `@lumina/types`/`api`/`dashboard`/`player`; ESLint
  clean on every touched file (two pre-existing `theme.ts` lint errors in unrelated
  `shapeOutlineGeometry` code predate this session, left alone). i18n (en/ar). Live-smoke-tested
  end to end with a scripted Playwright session (no `chromium-cli`/browser tooling was available in
  this environment, so a throwaway Playwright install in the scratchpad dir drove a real headless
  Chromium instead): logged in, opened the Mosque starter theme via "Customize & edit", armed brush
  mode from the sidebar, drew a freehand stroke, confirmed it rendered pixel-accurate to the drag
  path and the inspector showed the right type/hint/Redraw/color/width/opacity fields, then used
  Redraw to replace the same element's stroke in place (confirmed via its X/Y/W/H changing with no
  duplicate card) — zero console errors throughout. Not saved (Customize & edit only stages an
  in-memory copy), verified via the API afterward that still only the 4 seeded starter themes
  exist.
- ☑ Document display (PDF/PPT/DOC) (2026-08-02) — the final, biggest-lift item; made a document
  behave like the existing VIDEO asset type rather than inventing new zone/widget plumbing: new
  `DOCUMENT` value on `AssetType` (+ migration `20260802120000_add_document_asset_type`, also
  adding `Asset.pageCount`), `ALLOWED_MIME` in `assets.service.ts` extended for
  `application/pdf`/`.ppt`/`.pptx`/`.doc`/`.docx`. Worker (`media.processor.ts`) gained a
  `processDocument` pipeline: LibreOffice headless (`soffice --headless --convert-to pdf`, with an
  isolated `-env:UserInstallation` profile per job) converts Office formats to PDF first, then
  `pdftoppm` (poppler-utils) rasterizes every page to a webp via `sharp`, uploaded as
  `_p${n}.webp` siblings of the original `storageKey` (page 1 doubles as `thumbnailKey`, matching
  the existing thumbnail convention) — capped at `MAX_DOCUMENT_PAGES = 100` with a warning log
  rather than a hard failure. `storageKey` itself is left pointing at the original upload (unlike
  video, nothing better to transcode a document to), which keeps "download original" working for
  free. Added `poppler-utils`/`libreoffice` to the worker's Docker image (both `apps/worker/Dockerfile`
  and the shared root `Dockerfile.dev`) — accepted a large image-size increase for full
  PDF+Office parity rather than PDF-only, Basel's explicit call. Per-page timing needed no new
  columns: `PlaylistItem.durationSecs` already means "seconds to show this item," reused as
  "seconds per page" for DOCUMENT playlist items (`ZonePlayer.tsx` cycles pages via its own
  interval, handing off to the next playlist item after the last page — except a single-item
  playlist, which has nowhere to advance to, so it loops its own pages instead); the Theme
  canvas element (no playlist wrapping it) got its own `secondsPerPage` field on `content`
  (default 10), cycled by a new self-contained `DocumentPager` component in `ThemeRenderer.tsx`
  (same pattern as `TickerWidget`/`PrayerZoneWidget`'s own timers). New `DOCUMENT`
  `ThemeElementKind` in `packages/types/src/theme.ts`, mirrored into both editors' local
  `ThemeElement` unions. `AssetPicker`'s `types` allowlist widened from `['IMAGE','VIDEO']` to
  include `'DOCUMENT'`, which — as a nice side effect of that component being shared — also
  unlocked documents for screen-level ASSET streaming mode and layout zone-level asset mode with
  no changes to either of those pages. API-side hydration (`player.service.ts`'s
  `hydratePlaylist`/`hydrateThemeElements`, `playlists.service.ts`'s `shapeItem`) reconstructs
  each page's URL from `storageKey` + `pageCount` via the same naming convention the worker wrote,
  consistent with how `thumbnailUrl` is already derived in three places rather than centralizing
  into a new shared service. i18n (en/ar). Fixed one incidental, pre-existing (not
  document-related) ESLint error the whole-component React Compiler analysis newly surfaced in
  `themes/page.tsx` once other code in the same component changed (`react-hooks/set-state-in-effect`
  on an unrelated zoom-reset effect) — suppressed with a scoped disable comment rather than
  restructuring unrelated code. `tsc --noEmit` clean across `@lumina/types`/`api`/`worker`/
  `dashboard`/`player`; ESLint clean on every touched file (pre-existing lint debt in untouched
  files — `layouts/page.tsx`, `screens/page.tsx`, two long-standing `player.service.ts`/
  `playlists.service.ts` errors — confirmed via `git stash` to predate this session, left alone).
  Live-smoke-tested end to end against the real dev stack (not Docker — discovered the worker
  actually runs natively via `nest start --watch` in this environment, so `poppler-utils`/
  `libreoffice` were also installed on the host itself, not just baked into the Docker images):
  generated a genuine 7-page PDF and DOCX with LibreOffice, uploaded both through the real
  `POST /assets/upload` endpoint, confirmed the worker took each from `PROCESSING` to `READY`
  with `pageCount: 7` and a real, correctly-sized (1241×1754) webp thumbnail for page 1 and all 7
  pages individually fetchable (page 8 correctly 404s). Verified `pageUrls` hydration on both
  paths for real: added the PDF to a test playlist and confirmed all 7 URLs came back correctly
  shaped, and separately built a test theme with a DOCUMENT element, assigned it to a real seeded
  test screen (via a manually-signed screen JWT, screens.service.ts's own signing shape), and
  confirmed `GET /player/state` returned the fully hydrated `{ assetId, pageUrls, secondsPerPage }`
  content. All test assets/theme/playlist deleted afterward and the test screen's
  streamingType/themeId restored to its original state; confirmed via the API that only the 4
  seeded starter themes and 0 playlists remain (one pre-existing, not-mine leftover image asset
  from an earlier session was left untouched).

---

## Cross-cutting concerns (apply every phase)

- **Offline-first** — assume the network is unreliable; the player must always keep playing.
- **Security** — tenant isolation, signed media URLs, never expose API keys to players.
- **RTL & i18n** — design for Arabic/Hebrew from day one, not as a retrofit.
- **Testing** — unit + integration on the API; a player simulator for playback/scheduling logic.
- **Performance** — video on cheap hardware is the real constraint; profile on actual devices.
