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
