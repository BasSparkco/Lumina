Lumina Player is a native Android app that turns an Android TV / media-player
box into a digital signage screen. It pairs itself with a central dashboard
(the `apps/api` backend, the same one the existing web-based Lumina player
already uses in production), then plays whatever content an operator assigns
to it: image/video/audio slideshows, multi-zone layouts, live widgets (prayer
times, weather, currency, a scrolling news ticker), and time-based schedules —
all while working offline-first, recovering automatically from crashes or
reboots, and running unattended for long stretches on cheap, always-on
commercial signage hardware. In short: it's the "screen" half of a
fleet-managed digital signage product — the dashboard/backend decides what
should play and when, and this app is responsible for reliably showing it,
every time, without anyone standing in front of the TV.

- **Pairing** — a freshly installed screen shows a pairing code; once an
  operator confirms it on the dashboard, the screen stores a long-lived login
  token securely on-device and never needs to be paired again (survives
  reboots, crashes, and app updates).
- **Playback engine** — plays image, video, and audio content full-screen in
  order, downloads media ahead of time so nothing stalls waiting on the
  network, and picks up where it left off if the app restarts.
- **Multi-zone layouts** — a single screen can be split into several regions
  (e.g. a big video area plus a ticker strip along the bottom), each showing
  its own content independently.
- **Real-time updates** — the screen stays connected to the dashboard live, so
  changes (new content, an emergency alert, a forced reload) reach the screen
  within seconds instead of waiting for the next scheduled check-in. If the
  connection drops, it reconnects automatically without hammering the server.
- **Local scheduling ("dayparting")** — content can be scheduled to change by
  time of day, day of week, or date range, and the screen figures out what
  should be playing entirely on its own device — no internet connection
  required to keep dayparting working correctly.
- **Emergency takeover** — a dashboard-triggered emergency message instantly
  replaces everything else on screen, overriding the normal schedule.
- **Proof-of-play logging** — the screen keeps a local record of exactly what
  played and when, and reports it back to the dashboard in batches (useful for
  billing/compliance in real signage deployments).
- **Live widgets** — built-in prayer-time/athan countdown (calculated on-device,
  no internet needed), weather, currency exchange rates, and a scrolling
  RSS-style news ticker — each keeps showing its last-known data if the
  network drops, instead of going blank. Right-to-left languages (Arabic) are
  fully supported throughout.
- **Kiosk hardening** — the app takes over the entire screen (no status bar,
  no way to accidentally back out), relaunches itself automatically after a
  crash or a power cycle, detects when playback has silently frozen and
  force-restarts itself, and can be rebooted or restarted remotely from the
  dashboard.
- **Fleet-scale readiness** — evaluated switching the real-time connection to
  MQTT for very large fleets and deliberately decided against it for now (the
  current approach already solves the one real problem MQTT would address,
  and switching would add real infrastructure cost for no concrete benefit
  today). Revisit only if the backend hosting model changes to something that
  can't hold long-lived connections.

- **Starts itself automatically** — when the TV/box powers on, the app
  launches itself and goes straight back to playing content, with no manual
  steps and no need to re-pair.
- **Never falls asleep while running** — keeps the screen awake and disables
  the system screensaver while the app is active, so playback doesn't get
  interrupted by the device's own power-saving behavior.
- **Smart local storage cleanup** — downloaded media is cached locally so
  nothing needs re-downloading unnecessarily, but anything no longer used by
  any active or upcoming playlist gets automatically cleaned up, and total
  storage use is capped so the cache can never grow without bound.

---
		
1. **Screen burn-in protection** — *done.* Periodically nudges everything on
   screen by a pixel or two in a slow, invisible pattern, so a TV that shows
   the same layout 24/7 (a ticker bar, a logo corner) doesn't develop a
   permanent "ghost" image over months of use — the same trick phones use to
   protect an always-on lock screen.
2. **Remote screenshot / live preview** — *player side done* (needs a matching
   dashboard-side endpoint + UI to be useful end-to-end). Lets someone check
   what's actually showing on a specific screen from their desk — periodic
   automatic snapshots, plus an on-demand "refresh now" button — instead of
   having to physically walk up to the screen or dig through logs also with more controls on the TV side like unpair, rotate, aspect ratio etc....

3. **Crash & freeze reporting** — *player side done* (needs a matching
   dashboard-side endpoint + UI). Whenever the app crashes or has to
   force-restart itself after freezing, it now saves a note about what
   happened and reports it home the next time it's online, so a flaky screen
   shows up in a report instead of staying invisible until a customer
   complains.
4. **On-device diagnostics panel** — *done.* A hidden panel (opened with a
   specific button sequence, never visible during normal playback) shows a
   field technician the screen's ID, app version, last successful check-in
   time, storage usage, connection status, and more — all without needing a
   laptop or remote support call.
5. **Proper "no content yet" screen** — *done.* Replaces the old raw error
   message with a clean, branded "awaiting content assignment" screen for a
   freshly set-up screen or a schedule gap, so it looks intentional instead of
   like a broken app.

### Real feature gaps expected of a commercial signage product

6. **Scheduled TV power on/off** — *player side done* (needs a matching
   dashboard-side schedule field + admin UI). Lets the physical display (not
   just the Android box) be automatically turned off overnight and back on in
   the morning, saving power and extending the screen's lifespan — with a
   software (dim/black-screen) fallback for displays that don't support the
   hardware command.
. **Smooth transitions between slides** — *player side done* (needs a
   matching dashboard-side config field). Adds a configurable crossfade
   between images instead of an instant hard cut, matching what virtually
   every competing signage product already does. Video transitions are a
   harder follow-up, intentionally left for later.
9. **Shuffle / randomized playback order** — *player side done* (needs a
   matching dashboard-side toggle). An optional setting to play a playlist in
   a shuffled order (smartly, so the same item never repeats twice in a row)
   instead of always the exact same sequence — useful for rotating ad
   inventory or keeping content feeling fresh for repeat viewers.
10. **Remote volume control** — *player side done* (needs a matching
    dashboard-side control + optional schedule UI). Lets an operator mute or
    adjust a screen's volume from the dashboard, live or on a schedule,
    instead of needing someone physically present with a remote.

12. **Video-wall / multi-screen sync** — *evaluated, deferred by design, no
    code written.* Tiling multiple screens into one giant synchronized
    display is a real commercial signage format, but nothing about it should
    be built speculatively. The evaluation found two real prerequisites
    missing on both sides of the system (a shared clock across devices, and a
    way to group screens into a "wall" at all) and recommends treating any
    future work here as its own design decision, not a bolt-on feature —
    only worth picking up if a concrete multi-screen deployment is actually
    on the table.


13. **Accessibility pass on the app's own screens** — *done.* The signage
    *content* already handled right-to-left languages correctly; this pass
    made the app's own interface (pairing screen, diagnostics panel, error
    states) properly readable by screen readers and usable at larger text
    sizes too.

---

# Lumina Player Flutter App — Development Roadmap

## 0. Source of truth: what was actually inspected, and what it means for this roadmap

This roadmap is grounded entirely in the current repository, not assumptions. What was
read line-by-line before writing a single word of plan:

- **The web player** (`apps/player`, React 19 + Vite + Zustand): every component
  (`ZonePlayer`, `AppPlayer`, `ThemeRenderer`, `ZoneRenderer`, `DesignRenderer`, every
  widget, every Wayfinding component, `PlayerControlPanel`, `Splash`, `ErrorBoundary`),
  every lib module (`api.ts`, `socket.ts`, `db.ts`, `scheduler.ts`, `crashRecovery.ts`,
  `audioUnlock.ts`, `routing.ts`, `kioskAnalytics.ts`, `wayfindingLang.ts`, `tts.ts`,
  `useNow.ts`, `fontImports.ts`), both pages (`PairingPage`, `PlayerPage`), the service
  worker (`sw.ts`), the Vite/PWA config, `package.json`, `Dockerfile`, `nginx.conf`.
- **The backend contract it talks to** (`apps/api`): `PlayerController`/`PlayerService`
  (state hydration, pairing, heartbeat, proof-of-play, crash-report, screenshot,
  kiosk-analytics endpoints), `ScreensController`/`ScreensService` (every dashboard-side
  screen command), `ScreenGateway` (the Socket.IO command/event contract).
- **Shared packages** the player depends on: `@lumina/prayer` (wraps the `adhan` npm
  package for prayer-time/Qibla math), `@lumina/types` (theme/shape/crop/animation/font
  CSS-generation helpers), `@lumina/design-schema` (Designer2's resolved scene/element
  contract and WAAPI animation motion tables), `@lumina/ui` (`useTextReveal`).

**Critical framing before anything else**: `apps/player` is a browser-based PWA. It is
explicitly the **reference implementation / test harness** referred to in this task's
brief — it is what today proves out backend features and defines exact playback
behavior, but it is *not* the native Android kiosk app this document's opening sections
describe (auto-launch on boot, kiosk lock-task mode, HDMI-CEC power, a native crash
watchdog that can recover from a genuinely frozen process, etc. are all things a browser
tab fundamentally cannot do). The Flutter app being planned here has two jobs at once:

1. **Reproduce the web player's proven playback/content/widget/wayfinding behavior
   pixel-for-pixel and interaction-for-interaction** wherever the platform allows it —
   that behavior is real, tested-in-production, and must not be reinvented or
   simplified.
2. **Actually build the native-app requirements this document's top half describes**
   that the web player structurally cannot fulfil — most of which turn out, on
   inspection, to not exist in this repository at all yet (see §0.1). Flutter is the
   first codebase in this project where several of these are even possible.

### 0.1 Documentation-vs-reality audit (found by reading the code, not assumed)

The items below are marked "done" or "player side done" earlier in this document. Each
was checked against the actual `apps/player` source and the `apps/api` schema it talks
to. This audit is not a criticism of the web player — it did its job as a proving ground
— but the Flutter roadmap below builds against **what is verifiably true today**, not
against the label in the prose above.

| # | Item as documented | What the code actually shows | What Flutter must do |
|---|---|---|---|
| Real-time updates / heartbeat / reconnect | player side implemented | **Confirmed accurate.** `PlayerPage.tsx` heartbeats every 30s, refetches state every 60s, holds a Socket.IO connection with `command` events (`publish`, `reload`, `clear-cache`, `capture-screenshot`, `unpair`, `deleted`, `pause`/`resume`/`seek`/`setSpeed`), and reconnects via `sock.io.on('reconnect', …)`. | Reproduce this exact protocol (§10). |
| Local scheduling / dayparting | done | **Confirmed accurate.** `scheduler.ts`'s `resolveSchedule`/`msUntilNextTransition` run entirely client-side against `PlayerState.scheduleRules`; the backend (`SchedulesService`) is only a hint (`resolvedPlaylistId`). | Port the exact resolution algorithm (priority sort, midnight-crossing windows, date-range bounds) verbatim (§Phase 6). |
| Emergency takeover | done | **Confirmed accurate.** `Screen.emergencyActive` + `emergencyPlaylist` short-circuits every other render branch in `PlayerPage.tsx`, pushed instantly regardless of `autoPublish`. | Reproduce the exact priority order in §0.2 below. |
| Proof-of-play logging | done | **Confirmed accurate** on the backend (`/player/proof-of-play` batched-ingest endpoint exists, `IngestProofOfPlayDto`), but **no caller of it exists anywhere in `apps/player`** — the web player never actually buffers or flushes play events. This is a real gap in the reference implementation itself. | Flutter must build the buffering/flush logic from scratch against the *existing* endpoint contract — see §Phase 12. This is a case where Flutter should be **better** than the current web player, not just match it. |
| Live widgets (prayer/weather/currency/ticker) with offline last-known fallback | done | **Confirmed accurate**, with a specific, deliberate pattern worth preserving exactly: each widget seeds its state from IndexedDB (`cache.getWidgetData`) *before* attempting a live fetch, and uses `setData(prev => prev ?? cached)` so a fetch that resolves first never gets clobbered by a slower cache read. | Reproduce this exact "cache-first, live-wins-if-it-lands" pattern per widget (§Phase 8). |
| RTL support throughout | done | **Confirmed accurate** for widgets and Wayfinding (`dir="rtl"`, Arabic string tables, Arabic-aware fonts), but there is **no player-wide locale switch** — RTL is only wired per-widget/per-Wayfinding-kiosk, driven by each zone's own `lang` config field or a kiosk's own persisted toggle, not a single app language setting. | Match this exactly — RTL is a per-content-zone property, not a global app setting (§Phase 8, §Phase 9). |
| Screen burn-in protection | **done** | **Not found anywhere in `apps/player`.** No pixel-shift/dimming code exists in any component, the service worker, or CSS. | Must be built from scratch — this is a genuinely new Flutter feature, not a port (§Phase 13). |
| Remote screenshot / live preview | **player side done** | **Mostly confirmed**: `PlayerPage.tsx`'s `captureAndUploadScreenshot()` (via `html2canvas`) runs on the `capture-screenshot` socket command and POSTs to `/player/screenshot`; the backend stores it and serves `screenshotUrl`. "Periodic automatic snapshots" (not just on-demand) is **not implemented** — only the on-demand WS-triggered path exists. | Build both the on-demand path (direct port) and add the periodic automatic snapshot the doc promises but the web player never shipped (§Phase 14). The "more controls on the TV side like unpair, rotate, aspect ratio" already exist as dashboard-drivable fields (`orientation`, `aspectRatio`, the `unpair` WS command) — Flutter just needs to honor them, which §Phase 6/7 already covers. |
| Crash & freeze reporting | **player side done** | **Half-true, half-absent.** The *crash* half is real on the backend (`POST /player/crash-report`, `IngestCrashReportsDto` with `UNCAUGHT_EXCEPTION`/`WATCHDOG_RECOVERY` types, `ScreensService.crashReports()` for the dashboard to read them back) — but `apps/player`'s `crashRecovery.ts` only ever calls `window.location.reload()` after 5s; it **never calls the crash-report endpoint at all**, and there is **no freeze/watchdog detection** anywhere in the codebase (no heartbeat-vs-wall-clock check, no "is the render loop still alive" probe). `WATCHDOG_RECOVERY` is a backend enum value with zero producers. | Both halves must be built for real in Flutter: (a) actually POST to the existing `/player/crash-report` endpoint on every caught crash, buffered like proof-of-play; (b) build an actual freeze watchdog, which — critically — **cannot be done in Dart alone**, since a frozen Flutter isolate cannot detect its own freeze. This requires a small native Android supervisor (§Phase 13, §Phase 15). |
| On-device diagnostics panel | **done** | **Not what's described.** `PlayerControlPanel.tsx` exists (a gear-icon-triggered drawer), but it only exposes Auto-start/Sound toggles and Refresh/Unpair/Exit buttons — it shows **none** of "screen's ID, app version, last successful check-in time, storage usage, connection status." There is also no "hidden button sequence" gate — it's a plain always-visible gear icon. | Build the actual diagnostics panel described, gated behind a real hidden gesture, as new Flutter-only functionality (§Phase 14). |
| Proper "no content yet" screen | done | **Confirmed accurate.** `Splash` + `computeHasContent()` + the `hasContent` heartbeat field are all real and wired end-to-end. | Direct port (§Phase 6). |
| Scheduled TV power on/off | **player side done** | **Confirmed accurate for the software half only** (`resolvePower()`, `powerScheduleRules`, the black-screen `FullscreenContainer hideControls` fallback) — correct, since a browser tab structurally cannot issue a hardware display-power command at all. That capability gap is *exactly* why this needs a native app. | Port the software resolver verbatim; **add** the real hardware path (HDMI-CEC / vendor display-power intent) that only a native app can do, with the same software fallback when hardware control isn't available (§Phase 13). |
| Smooth transitions between slides (crossfade) | **player side done** | **Not implemented.** `Playlist.transitionStyle`/`transitionDurationMs` are real, hydrated fields on the backend (`PlayerService.hydratePlaylist`, currently only ever set to `'NONE'`/`0` since nothing populates them otherwise), but the client-side `Playlist` TypeScript interface in `api.ts` doesn't even declare these fields, and `ZonePlayer` performs a hard React-state swap with zero transition. | Flutter's playlist advance must actually read and honor `transitionStyle`/`transitionDurationMs` (crossfade at minimum) — the backend contract already supports it; the web player just never consumed it (§Phase 6). |
| Shuffle / randomized playback order | **player side done** | **Only half-true.** `Playlist.playbackOrder` (`SEQUENTIAL`/`SHUFFLE`) is a real hydrated backend field, but `ZonePlayer`'s own advance (`(index + 1) % length`) ignores it completely — real Fisher-Yates shuffle only exists inside `AppPlayer` for a YouTube-embed sub-playlist, a completely different code path. | Flutter must implement shuffle for the *main* playlist engine (with the same "shuffle once per mount, don't reshuffle every loop" and "never repeat the same item twice in a row" semantics the doc promises), not just for embedded app playlists (§Phase 6). |
| Remote volume control | **player side done** | **Confirmed accurate** for direct control (`Screen.volume` → group fallback → 100 default, applied to both `<video>` and the YouTube iframe player). The doc's "optional schedule UI" is **not implemented** — only `powerScheduleRules` exist; there is no `volumeScheduleRules` concept anywhere in the schema. | Port direct volume control exactly; volume *scheduling* is a genuinely new feature with no existing backend contract to reuse — flag it as needing a backend change too, not just a Flutter one (§Phase 6, §14 risk register). |
| Video-wall / multi-screen sync | evaluated, deferred, no code | **Confirmed accurate** — correctly out of scope here too. | Do not build. Revisit only per the same trigger condition already stated (§16). |
| Accessibility pass on the app's own screens | done | **Partial.** `PlayerControlPanel` has `aria-label`s on its icon buttons; `PairingPage` has none; there is no player-wide large-text or screen-reader-specific mode — only Wayfinding's own "accessibility mode" (1.35× touch-target/text scale) exists, scoped to the kiosk map UI alone. | Match Wayfinding's accessibility scaling pattern; add real semantics (Flutter `Semantics` widgets) to the pairing/settings/diagnostics screens, since those are exactly the screens the doc calls out (§Phase 14, §Phase 9). |

None of this changes what Flutter must build — every single item above is still a
hard requirement per this task's rules ("do not remove existing requirements," "every
feature in `aboutlumina-player.md` must be accounted for"). What it changes is **the
starting point**: for the confirmed-accurate items, "port the web behavior" is the
correct instruction and there's an existing, working reference to copy. For the
not-actually-implemented items, "port the web behavior" is meaningless — those need to
be *designed*, using the (often already-real) backend contract as the anchor, and
implemented for the first time in Flutter.

### 0.2 The state-resolution priority order (the single most important algorithm to port exactly)

`PlayerPage.tsx`'s render branches encode a strict precedence order that every other
phase of this roadmap depends on getting right. In order, highest priority first:

1. **`!poweredOn`** (outside the display's power-on window) → bare black screen, no
   controls, no clock, no Splash text — this beats literally everything else, including
   an active emergency.
2. **`state.stopped`** (dashboard-paused) → `Splash` "Playback paused" — beats an active
   emergency, but not the power window above.
3. **`emergencyActive && emergencyPlaylist`** → fullscreen single-zone `ZonePlayer` of
   the emergency content.
4. **`emergencyActive && wayfinding`** (no explicit emergency playlist chosen on a
   wayfinding screen) → `WayfindingEvacuationView`.
5. **`wayfinding`** (normal, non-emergency) → `WayfindingKioskMap` if touch-capable,
   else `WayfindingDirectoryBoard`.
6. **Normal playlist mode** → schedule-resolved (or `ASSET`-mode single-asset, or
   default) `Playlist` rendered through `ZonePlayer`, or `Splash` "No content scheduled
   right now" if nothing resolves.

This exact order — and exactly these conditions — must be the first thing implemented
and unit-tested in the Flutter state machine (§Phase 4), because every visual/behavioral
phase after it assumes this resolution is already correct.

---

## 1. Complete feature inventory

Every requirement from the top of this document, plus every additional behavior found by
reading `apps/player`, grouped by area. Each line has a Phase reference — this is the
checklist that Definition of Done (§15) is measured against.

**A. Identity & pairing** — pairing-code display and 3s polling (Phase 2); long-lived
token storage that survives reboot/crash/update (Phase 2); unpair (dashboard- or
device-initiated) and forget (screen deleted) flows, each with different local-state
implications (Phase 2, Phase 12).

**B. Playback engine** — image, video, audio-capable video, TEXT (static and ticker),
DOCUMENT (paged, page-duration timer), APP (YouTube video/playlist embed with real
`onStateChange`-driven end-detection, shuffle, and error handling), full-video vs.
custom-clip-length playback, single-item infinite loop vs. multi-item advance, resume
from restart, pre-fetching the next video's bytes ahead of a transition, decoder-session
release on every item change (Phase 4, Phase 5, Phase 6, Phase 10).

**C. Multi-zone layouts** — percentage-based absolute positioning, z-index, rotation,
non-rectangular clip shapes (rounded/circle/triangle/pentagon/hexagon/octagon/star/
arrow), per-zone independent playback, single "audio priority" zone silencing every
other zone's audio, per-zone volume override (Phase 5, Phase 7).

**D. Rich content formats — Themes** — 9 element kinds (TEXT/IMAGE/VIDEO/DOCUMENT/
PLAYLIST/SHAPE/BRUSH/WIDGET/ICON), theme palette/typography resolution, gradient fills,
shape outline vs. solid fill, non-destructive image adjustments (exposure, brightness,
contrast, saturation, vibrance, temperature, tint, hue, duotone, presets), per-element
entrance/emphasis/exit animations, typewriter/word-by-word text reveal, brush raster
paint layers, self-contained inline-SVG icon elements, nested PLAYLIST elements, TEXT
elements that reuse a TEXT-asset's own styling (Phase 7).

**E. Rich content formats — Designer2 scenes** — resolved scene/element payloads with
already-substituted variables and already-resolved asset URLs, WAAPI-equivalent
enter/emphasis animations (composited, not overwriting a static rotation), video
elements with trim start/end offsets and in-clip looping, 6 shape primitives including a
literal corner-to-corner line, server-rendered QR data URIs, scene-to-scene dwell timers
with next-scene media pre-warming, JS-measured contain-fit scaling (Phase 7).

**F. Live widgets** — Prayer (adhan-based daily times + Qibla, next-prayer countdown,
athan audio trigger within a 30s window, once-per-day-per-prayer dedupe), Weather,
Currency (multi-pair table), Ticker (RSS-backed or free-text, horizontal or vertical,
LTR/RTL-aware direction and speed), Time, Date, QR — every widget cache-first from local
storage with live-fetch-wins-if-faster semantics, every widget RTL/Arabic-font-aware
(Phase 8).

**G. Wayfinding** — non-touch auto-rotating directory board grouped by POI category;
touch kiosk map with pinch/pan/zoom, double-tap-to-zoom, tap-to-select POI pins, a
"you are here" pulsing marker, on-screen full-directory search+filter panel with a
docked QWERTY keyboard (no reliance on OS virtual keyboards); on-device Dijkstra routing
with accessible (no-stairs) and evacuation (no-elevator) route variants, per-floor route
polyline rendering across floor-tab switches, turn-by-turn text directions, QR
hand-off-to-phone, text-to-speech readout; a dedicated fire/evacuation full-screen view
routing to the nearest "Exit"-categorized POI, spoken automatically on entry; idle/attract
loop falling back to a Playlist or Theme after 90s of no touch; per-kiosk persisted
language (EN/AR) and larger-touch-target accessibility mode; kiosk analytics
(session-start/search/POI-view) batched to the backend (Phase 9).

**H. Scheduling** — day-of-week + time-of-day + date-range rules with priority
ordering and midnight-crossing window support, resolved fully client-side/offline,
re-evaluated on a self-scheduling timer that fires exactly at the next minute boundary
(not a fixed poll interval); separate, simpler power-on/off window rules (OR'd, no
priority) resolved the same way (Phase 6).

**I. Emergency takeover** — instant (bypasses `autoPublish`), overrides schedule but
is itself overridden by `stopped`/power-off, wayfinding-aware fallback to the
evacuation view (Phase 6, §0.2).

**J. Real-time updates & remote control** — Socket.IO connection with JWT auth,
automatic reconnect with capped backoff, `publish`/`reload`/`clear-cache`/
`capture-screenshot`/`unpair`/`deleted` commands, Custom Player remote control
(`pause`/`resume`/`seek`/`setSpeed`) scoped only to `ASSET`-mode top-level playback,
~1×/second playback-progress reporting back to the dashboard while controllable (Phase
10).

**K. Kiosk hardening** — fullscreen with no chrome, auto-start-or-tap-to-start gate,
sticky-audio-unlock-on-first-interaction with a "tap for sound" indicator until
unlocked, orientation (0/90/180/270°) and aspect-ratio (16:9/9:16/stretch)
letterboxing/pillarboxing independent of the device's real panel shape, optional clock
overlay, global crash watchdog (window errors + unhandled rejections) plus a React
error boundary, both funneling into a guarded single-reload-per-crash-storm recovery
(Phase 6, Phase 13, Phase 15).

**L. Fleet management surface** — on-demand + (new) periodic screenshot capture and
upload, crash/watchdog-recovery report buffering and flush, proof-of-play buffering and
flush (new, built against an existing but previously-unused endpoint) (Phase 12, Phase
14).

**M. Offline resilience & storage** — full player state and current playlist persisted
locally and restored on cold boot before any network call succeeds; per-widget
last-known-good data cached independently; video bytes fully cached (not just
declaratively attempted — the web player's own history here contains a real, instructive
bug fixed in `sw.ts`, see Phase 3.2) so a loop or replay never re-hits the network;
capped, LRU-evicted media storage; wayfinding floor-plan/POI-icon images eagerly
pre-fetched for every floor, not just the one on screen (Phase 3, Phase 4, Phase 11).

**N. Accessibility & internationalization** — RTL layout and Arabic typography wherever
Arabic content/config appears; Wayfinding's dedicated accessibility mode; ~45
self-hosted font families (Latin + Arabic script) bundled at build time, no runtime CDN
dependency (Phase 8, Phase 9, Phase 14).

**O. New native-only requirements** (no existing implementation to port; see §0.1) —
screen burn-in pixel-shift protection; a real on-device diagnostics panel behind a
genuine hidden gesture; a real crash-report flush to the existing backend endpoint; a
genuine freeze watchdog (native-Android-required); real hardware display power control
with software fallback; playlist crossfade transitions actually consumed at render time;
main-playlist shuffle with no-immediate-repeat semantics; kiosk lock-task/screen-pinning,
boot-on-launch, and process-supervision (Phase 13, Phase 14, Phase 15).

---

## 2. Recommended Flutter architecture

### 2.1 Target platforms

The opening section of this document is explicit: this is "a native Android app that
turns an Android TV / media-player box into a digital signage screen." That is the v1
target — **Android (phone/tablet/TV form factors, API 24+ for broad signage-box
compatibility, with Android TV/`leanback` support declared)**. Flutter's cross-platform
nature is not being used to also ship iOS/web/desktop storefront builds for v1; those
would be speculative scope the task's own rules ("don't add features beyond what the
task requires") argue against. However, the app should still be built with Flutter's
standard platform-abstraction discipline (a `platform/` layer behind interfaces — see
§2.3) specifically so that a future desktop Linux build (some signage boxes are ARM
Linux, not Android) is a platform-layer swap, not a rewrite, should that ever become a
real requirement — this is architecture hygiene, not scope creep, since it costs nothing
extra to write the video/storage/lifecycle code behind an interface from day one.

### 2.2 State management: Riverpod

**Decision: Riverpod (with code generation via `riverpod_generator`), not Bloc, not
plain Provider, not GetX.**

Why, against the actual shape of the web app's state:

- The web app's state is small and already decomposed into independent stores:
  `playerStore` (pairing identity — screenId/token/pendingPairingCode), `deviceSettingsStore`
  (per-device kiosk preferences — autoStart/muted), and ad-hoc `useState`/`useRef` local
  component state everywhere else (`PlayerPage`'s `state`/`activePlaylist`/`poweredOn`,
  `ZonePlayer`'s `index`/`item`/`pageIndex`). Riverpod's independent, composable
  `Notifier`/`AsyncNotifier` providers map onto this almost 1:1 — one provider per
  Zustand store, one provider (or a small provider family) per component-local piece of
  derived state (schedule resolution, power resolution) — without forcing a single
  monolithic app-wide state tree the way a naive Bloc/Redux port would.
- Riverpod's `ref.listen`/`StreamProvider` model is a clean fit for the two genuinely
  "live" sources this app has: the Socket.IO command stream and the local scheduling
  timer (`msUntilNextTransition`'s self-rescheduling `setTimeout` becomes a Riverpod
  provider that reschedules itself the same way).
- Testability: every phase below has unit-test requirements against pure functions
  (`resolveSchedule`, `resolvePower`, `computeRoute`, `resolveThemeColor`-equivalents).
  Riverpod's `ProviderContainer` overrides make it straightforward to unit-test
  controllers in isolation without spinning up widgets, which matters given how much of
  this app's correctness is timing/precedence logic (§0.2), not UI.

### 2.3 Layered module structure

```
lib/
├── main.dart                         # entrypoint, DI wiring, crash-watchdog install
├── app.dart                          # MaterialApp/router shell, theme
├── core/
│   ├── config/                       # env (API base URL, WS URL), build flavors
│   ├── logging/                      # structured logger, ties into crash reporting
│   ├── errors/                       # typed exceptions (ApiError equivalent), crash watchdog
│   └── router/                       # go_router: Pairing → Player routes
├── data/
│   ├── api/                          # Dio client, DTOs mirroring api.ts's types exactly
│   ├── socket/                       # socket_io_client wrapper mirroring socket.ts
│   ├── local/                        # drift/sqflite schema: state, playlist, widgetCache,
│   │                                 #   config, proof-of-play queue, crash-report queue,
│   │                                 #   media-cache index
│   └── repositories/                 # PlayerRepository, PairingRepository, etc. — the
│                                      #   only layer allowed to know about api/ vs local/
├── domain/
│   ├── models/                       # PlayerState, Playlist, PlaylistItem, Zone,
│   │                                 #   HydratedTheme, WayfindingDirectory, etc. — pure
│   │                                 #   Dart classes mirroring apps/player/src/lib/api.ts
│   │                                 #   field-for-field
│   └── logic/                        # PURE functions: resolveSchedule, resolvePower,
│                                      #   msUntilNextTransition, computeRoute,
│                                      #   findNearestNode, buildDirectionSteps — ported
│                                      #   verbatim from scheduler.ts/routing.ts, unit
│                                      #   tested against the same cases
├── features/
│   ├── pairing/                      # PairingPage equivalent
│   ├── player/
│   │   ├── controller/               # the state-resolution machine from §0.2
│   │   ├── zone_player/              # ZonePlayer/AppPlayer port
│   │   ├── zone_renderer/            # ZoneRenderer/LiveWidget dispatch port
│   │   ├── theme_renderer/           # ThemeRenderer port
│   │   ├── design_renderer/          # DesignRenderer port
│   │   └── widgets/                  # PrayerZoneWidget, WeatherWidget, CurrencyWidget,
│   │                                 #   TickerWidget, TimeWidget, DateWidget,
│   │                                 #   QrCodeWidget, TextAssetTicker ports
│   ├── wayfinding/                   # DirectoryBoard, KioskMap, DirectoryPanel,
│   │                                 #   EvacuationView ports + routing logic
│   ├── control_panel/                # settings drawer (autoStart/mute/refresh/unpair/exit)
│   ├── diagnostics/                  # NEW: real diagnostics panel (§0.1)
│   └── kiosk/                        # NEW: burn-in shifter, power scheduler w/ hardware
│                                      #   hook, freeze watchdog glue, boot receiver glue
├── platform/                         # abstraction interfaces + Android implementations:
│   ├── media_engine/                 # VideoEngine interface — video_player impl
│   ├── power/                        # DisplayPowerController interface — HDMI-CEC /
│   │                                 #   vendor-intent impl, software fallback impl
│   ├── kiosk_mode/                   # lock-task, immersive UI, boot-launch
│   ├── watchdog/                     # native supervisor channel
│   ├── storage/                      # cache directory, disk-usage stats
│   └── audio_unlock/                 # first-interaction detection (trivial on native —
│                                      #   see §Phase 6, this whole concept is largely a
│                                      #   browser-only problem)
└── android/                          # Kotlin: boot receiver, watchdog service,
                                       #   HDMI-CEC/display-power channel, lock-task glue
```

This mirrors the web app's real module boundaries (`lib/` = pure logic and API/socket/db
plumbing, `components/` = rendering, `pages/` = top-level screens, `store/` = identity/
settings) while adding the `platform/` and `android/` layers the web app has no
equivalent of, because a browser sandbox made those problems either impossible or moot.

### 2.4 Data flow parity table

| Web concept | Flutter equivalent |
|---|---|
| `usePlayerStore` (Zustand, `localStorage`-backed) | `PairingController` (Riverpod `Notifier`), backed by `flutter_secure_storage` (a long-lived bearer token deserves secure storage, not plain `SharedPreferences` — see §11) |
| `useDeviceSettingsStore` | `DeviceSettingsController` (Riverpod `Notifier`), backed by `SharedPreferences` |
| `PlayerPage`'s local `useState`/`useRef` state machine | `PlayerStateController` (Riverpod `AsyncNotifier<PlayerViewState>`) implementing §0.2's exact precedence |
| `cache` (idb wrapper) | `LocalStore` repository over `drift` tables: `state`, `playlist`, `config`, `widget_cache`, plus new `proof_of_play_queue`, `crash_report_queue`, `media_cache_index` tables |
| `connectSocket`/`getSocket` | `SocketService` wrapping `socket_io_client`, exposed as a `StreamProvider<PlayerCommand>` |
| Service Worker `media-cache` (Cache Storage + Range-slicing) | `MediaDownloadManager`: proactively downloads full files to app storage, `video_player` always plays a local `file://` path once cached, HTTP Range semantics become moot since Flutter never streams a remote URL directly for anything already downloaded |
| `ZonePlayerHandle` (`pause`/`resume`/`seek`/`setSpeed` via `useImperativeHandle`) | A `ZonePlayerController` exposing the same four methods, driven by the Custom-Player socket commands the same way |

---

## 3. Media engine evaluation and decision

### 3.1 Candidates considered against this app's actual requirements

The web player's actual video needs, read directly from `ZonePlayer.tsx`/`sw.ts`, are
narrower than a general "video player" brief:

- Direct progressive MP4/WebM files served by `apps/api`'s `MediaController` (no HLS/DASH
  anywhere in this codebase — signage content is operator-uploaded files, not live
  streams).
- Byte-range support matters only because of how the *web* serves cached video (206
  Partial Content) — a native app that fully downloads a file before playback has no
  Range-request concern at all; this is a web-specific problem that Flutter's
  download-then-play model sidesteps entirely rather than needing to solve.
- Hardware decoder contention is real and explicitly documented in the web code
  (`releaseVideoDecoder`'s comment: "embedded/TV WebViews... commonly support only 1-2
  concurrent hardware video decoders"). This is an **Android TV / low-end box** concern
  that must carry over directly — a Flutter video engine must expose an explicit
  "release this player's decoder now" call, not rely on garbage collection.
- Playback rate control (Custom Player `setSpeed`) and precise seek are required.
- No DRM anywhere in this codebase (fully out of scope, see §11 security review, which
  should confirm this stays true).
- A second, entirely separate "engine" is the YouTube IFrame Player (`AppPlayer.tsx`) —
  Android has no first-party embeddable YouTube IFrame equivalent in Flutter; this needs
  its own decision (§3.3).

| Option | Verdict |
|---|---|
| `video_player` (Flutter first-party, ExoPlayer/Media3 on Android) | **Recommended.** Actively maintained by the Flutter team, uses Media3 under the hood on Android (the same engine family the web comment implicitly assumes when talking about "hardware decode sessions"), exposes `VideoPlayerController.dispose()` as the direct equivalent of `releaseVideoDecoder`, supports `setPlaybackSpeed`, precise `seekTo`, and plays local file paths natively (the model this app needs once media is pre-downloaded). |
| `media_kit` (libmpv-backed) | Considered and rejected for the primary Android/TV target: it's excellent for desktop/cross-platform parity and broader codec support, but adds a heavier native dependency (libmpv) for a use case (plain MP4/WebM files) that doesn't need it, and its Android backend is comparatively less battle-tested on the low-end Android-TV-box hardware this product explicitly targets. Keep it in reserve as the desktop-platform implementation *if* the Linux-box future scenario in §2.1 is ever pursued — the `platform/media_engine/` interface exists precisely so this swap wouldn't require touching feature code. |
| `better_player` / `chewie` (community wrappers around `video_player`) | Rejected: both are UI-chrome wrappers (built-in controls, fullscreen buttons) this app has no use for — every control surface here is custom-built to match the web player's exact look, and neither actively-maintained option adds engine capability this app needs beyond what `video_player` already provides directly. |
| Native platform channel straight to ExoPlayer/Media3 | Rejected for v1: strictly more implementation and maintenance cost than `video_player` for zero capability gain at this app's actual requirements (no adaptive streaming, no DRM, no custom renderer needs). Revisit only if a specific `video_player` limitation blocks a real requirement during Phase 4/5 implementation. |

### 3.2 The lesson from `sw.ts` that must inform the download manager

The web player's service worker has a documented, real, previously-shipped bug: a naive
`CacheFirst` strategy for video silently never cached anything, because every `<video>`
request carries a `Range` header and Workbox's cacheable-response check only stores
plain 200s — so every single playback (including every loop of the same clip) re-hit
the network before the fix. The fix was to always populate the cache with **one full,
Range-header-free fetch**, then synthesize whatever byte range was actually requested
out of that single cached copy.

This is directly relevant to Flutter's `MediaDownloadManager` even though the mechanism
is different: **always download the complete file before considering an asset
"cached,"** verify the download completed (size/checksum, not just "a response came
back"), and only then point `video_player` at the local file. A design that streams
partial/resumable downloads and marks an asset available before it's fully
present risks reproducing the same class of bug in a new form (a partially-downloaded
file that appears "cached" but stutters or fails mid-playback). Treat "downloaded" as a
boolean set only on full-file completion, exactly as the fixed `sw.ts` treats "cached."

### 3.3 YouTube/APP-type asset playback

`AppPlayer.tsx` is a second, fully independent playback engine (YouTube IFrame Player
API), used for the `APP`-type asset kind. Flutter has no first-party equivalent of an
embeddable, JS-API-controllable YouTube player. Candidates:

- **`youtube_player_iframe`** (community package wrapping a WebView-hosted YouTube
  IFrame Player, exposing the same `play`/`pause`/`seekTo`/`setPlaybackRate`/
  `onStateChange`/`onError` surface `AppPlayer.tsx` already uses) — **recommended**,
  since it is the closest possible parity: same underlying IFrame API, same event model,
  same error-code table (`101`/`150` = embedding disabled, etc. — port
  `YT_ERROR_MESSAGES` verbatim), same shuffle-once-per-mount semantics for `playlist`-kind
  `AppConfig`.
- A native ExoPlayer-based YouTube extraction approach was considered and rejected: it
  would violate YouTube's ToS in the same way an unofficial extractor always does, and
  the existing web implementation deliberately uses the sanctioned IFrame API — Flutter
  should not regress on this.

---

## Phase 0 — Requirements & existing-system deep dive

**Goal**: every engineer (or agent) starting implementation has read, and can point to
exact line numbers in, every source file this roadmap cites — no phase after this one
should require re-deriving "how does X actually behave" from scratch.

**Why this phase exists**: §0.1 above already found nine cases where this document's own
prose diverges from the code. Skipping this phase risks building against the prose
instead of the (sometimes different, sometimes simply *absent*) reality.

**Tasks**:
- Read `apps/player/src` in full (every file listed in §0's inventory).
- Read `apps/api/src/modules/player`, `apps/api/src/modules/screens`,
  `apps/api/src/modules/ws` in full.
- Read `packages/types/src/theme.ts`, `packages/design-schema/src`,
  `packages/prayer/src`, `packages/ui/src` in full.
- Produce (or reuse — this document already is one) a written feature inventory and
  documentation-accuracy audit before writing any Dart code.
- Stand up a local `apps/api` + Postgres instance and pair the existing web player
  against it, so the Flutter team has a live, working reference to compare behavior
  against during every later phase (not just this document's static description).

**Acceptance criteria**: a new engineer can answer, from memory or a one-line file
lookup, "what happens when the dashboard sets `emergencyActive=true` on a screen whose
`streamingType` is `WAYFINDING` but which has no `emergencyPlaylist`?" (answer:
`WayfindingEvacuationView` — §0.2 item 4) without re-reading `PlayerPage.tsx`.

---

## Phase 1 — Flutter project foundation

**Goal**: a buildable, lintable, CI-checked Flutter project shell with no player
functionality yet, but every later phase's plumbing (env config, DI, logging, routing,
local DB) already in place.

**Tasks / subtasks**:
- `flutter create` with package name `com.lumina.player` (or the org's real reverse-DNS,
  to be confirmed with the user before publishing — do not guess a production package
  ID), Android-only platform initially (`flutter create --platforms android`), min SDK
  24, target/compile SDK matching the latest stable at implementation time, Android TV
  (`leanback`) `<uses-feature>` declared but not required (so the app also installs on
  handheld signage tablets, matching the doc's "Android TV / media-player box").
- Set up `analysis_options.yaml` with `flutter_lints` (or stricter — match the
  strictness the repo's `eslint.config.mjs` already enforces on the TypeScript side, e.g.
  no-implicit-any equivalents).
- Introduce build flavors / `--dart-define` environment config mirroring `.env.example`'s
  `VITE_API_URL` and `vite.config.ts`'s `VITE_WS_URL`: `API_BASE_URL`, `WS_URL`, at
  minimum `dev`/`staging`/`prod` flavors. Do not hardcode `http://localhost:4000/v1`
  anywhere outside a dev-flavor default.
- Wire dependency injection (Riverpod's `ProviderScope` at the app root is sufficient —
  no separate DI framework needed).
- Structured logging (`logging` package or a thin custom wrapper) with a sink that later
  phases (Phase 12/13) can redirect into the crash-report queue.
- `go_router` with two routes to start: `/` (blank placeholder) and `/play` (blank
  placeholder) — mirrors `main.tsx`'s `createBrowserRouter`.
- CI: `flutter analyze`, `flutter test`, `flutter build apk --flavor <x>` as check gates
  (see §12 CI/CD for the full pipeline).

**Files/modules created**: `lib/main.dart`, `lib/app.dart`, `lib/core/config/*`,
`lib/core/router/*`, `analysis_options.yaml`, `android/app/build.gradle` flavor blocks.

**Dependencies introduced**: `flutter_riverpod`, `riverpod_annotation` +
`riverpod_generator` (dev), `go_router`, `logging`.

**Tests**: a smoke test that the app builds and boots to the placeholder route per
flavor.

**Acceptance criteria**: `flutter build apk --flavor prod` succeeds in CI; switching
`--dart-define`s changes the configured API URL verifiably (a test asserts
`Config.apiBaseUrl` per flavor).

**Must verify before moving on**: the org's real Android package ID and app-signing
plan are confirmed with the user (§12) — do not let a placeholder ID silently become the
shipped one.

---

## Phase 2 — Pairing & identity

**Web reference**: `PairingPage.tsx`, `playerStore.ts`, `PlayerController.init`/`check`
(`apps/api`), `ScreensService.confirmPairing`.

**Current web behavior** (port exactly): on mount, if already paired
(`token && screenId`) skip straight to `/play`. Otherwise call `POST /player/init`
(rate-limited 20/min/IP — this is a *backend* limit the client doesn't need to
self-throttle against, just handle a 429 gracefully), display the returned pairing code
large and centered, and poll `GET /player/check?screenId=` every 3s (rate-limited
100/min) until `{ paired: true, token }` comes back, then store the token and navigate.
A screen that gets unpaired while paired (`unpair` socket command) keeps its `screenId`
and resumes polling on the *same* screen entity with a *freshly issued* pairing code
handed over the socket (not a new `/player/init` call) — this preserves the screen's
name/history/settings in the dashboard. A screen that gets fully deleted (`deleted`
socket command) drops both `token` and `screenId` and must go through `/player/init`
fresh next time, since there is no old screen row left to resume into.

**Flutter approach**:
- `PairingController` (Riverpod `AsyncNotifier`) implementing the same
  init-or-resume-or-poll state machine.
- Token storage: **`flutter_secure_storage`**, not `SharedPreferences` — a 10-year-lived
  bearer JWT (`AuthService`/`ScreensService.confirmPairing` signs with `expiresIn: '10y'`)
  is exactly the kind of long-lived credential that belongs in the Android Keystore-backed
  secure storage, not plaintext prefs. `screenId` and `pendingPairingCode` can stay in
  plain `SharedPreferences` (non-sensitive). This is a deliberate, justified improvement
  over the web player's `localStorage`-for-everything approach (localStorage has no
  native equivalent to Keystore-backed secure storage — Flutter should not reproduce
  that specific weakness just for parity; see §11).
- Networking: `dio` `POST`/`GET` calls to `/player/init` and `/player/check`, same retry
  behavior as `PairingPage.tsx`'s `catch { setError(...); setTimeout(start, 5000); }` on
  a failed `init`.
- UI: a fullscreen dark screen, large centered pairing code, matches the web layout
  closely enough to be recognizable to an operator reading a screenshot from either
  platform side-by-side, but rebuilt as native Flutter widgets (`Text`, `Container`), not
  a pixel-for-pixel CSS port.

**Files/modules**: `lib/features/pairing/pairing_controller.dart`,
`lib/features/pairing/pairing_page.dart`, `lib/data/repositories/pairing_repository.dart`.

**Tests**: unit test the controller's state machine (init → poll → paired transition;
resume-with-pendingPairingCode path; init-failure retry loop) with a mocked repository.
Widget test: pairing code renders, "Waiting for pairing…" hint shows, error text shows on
a forced repository failure.

**Acceptance criteria**: a fresh install shows a pairing code within one API round-trip;
confirming pairing on the dashboard moves the device to the player route within one 3s
poll cycle; killing and relaunching the app after pairing skips straight to the player
route with no re-pairing; an `unpair` command received while on the player route routes
back to pairing with the *same* screen's fresh code, verified by asserting `screenId` is
unchanged across the transition.

**Potential problems**: Android's Doze/battery-optimization can throttle a backgrounded
app's polling — not a concern for a kiosk app that's always foreground, but must be
explicitly disabled/exempted for this app's process (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`)
so pairing polling and the later heartbeat/socket connection are never silently
throttled — this belongs in Phase 13's kiosk-hardening manifest work but must be flagged
here since it directly affects this phase's reliability.

---

## Phase 3 — Local persistence & the media cache

**Web reference**: `db.ts` (IndexedDB via `idb`), `sw.ts` (Service Worker Cache Storage
+ Range-slicing).

**Flutter approach**:
- **Structured local DB**: `drift` (SQLite) over `sqflite`/`Hive`, because this app's
  local data is genuinely relational-ish (a media-cache index needs to answer "which
  files are referenced by the current playlist/schedule so I don't evict them,"
  proof-of-play/crash-report queues need ordered, atomically-drainable rows) — a plain
  key-value store (mirroring `idb`'s `playlist`/`state`/`config`/`widgetCache` stores
  literally) would work for the direct ports but not for the *new* requirements (§0.1 O).
  Tables: `player_state` (single row, current `PlayerState` JSON), `playlist_cache`
  (single row, current resolved `Playlist` JSON — kept for parity even though the richer
  `player_state` row now supersedes most of its purpose, matching `db.ts`'s own
  "legacy" comment on `getPlaylist`), `config` (key/value), `widget_cache` (key/value,
  one row per widget instance — mirrors `cache.getWidgetData`/`saveWidgetData` exactly),
  `proof_of_play_queue`, `crash_report_queue` (both append-only, drained-in-batches — new,
  see Phase 12/13), `media_cache_index` (url, local path, byte size, last-used-at,
  referenced-by-playlist-ids — new, see below).
- **Media download manager**: `dio` for the actual downloads (supports progress
  callbacks and cancellation), files written to
  `getApplicationSupportDirectory()`/a dedicated `media_cache/` subfolder (not the public
  Downloads dir — this is private app data), one row per URL in `media_cache_index`.
  Every time a playlist is (re-)hydrated, diff its asset URLs against the index: anything
  new gets queued for background download (§Phase 4's "download ahead of time so nothing
  stalls" requirement); anything in the index but no longer referenced by *any* current
  or near-future (schedule-rule) playlist becomes eligible for eviction.
- **Eviction policy**: LRU by `last_used_at`, capped by a configurable total-bytes budget
  (a new setting — the web player's Cache Storage had Workbox's `maxEntries`/
  `maxAgeSeconds` as a rough proxy for this; a native app storing real files needs an
  explicit, operator-visible cap, matching this document's own "total storage use is
  capped so the cache can never grow without bound" requirement). Never evict a file
  referenced by the *currently playing* playlist, regardless of age/size pressure.
- Pre-fetch behavior: port `ZonePlayer.tsx`'s "warm the cache for the next video ahead of
  time" behavior directly — before an item change, kick off (or confirm already-queued)
  the download of the *next* item's asset, so a transition into a video never waits on a
  cold download.

**Files/modules**: `lib/data/local/database.dart` (drift schema),
`lib/data/local/media_download_manager.dart`,
`lib/data/repositories/local_store.dart`.

**Tests**: unit tests for the eviction policy (given a set of cached files with
last-used timestamps and a byte cap, assert the correct subset survives, and that a
file referenced by the active playlist is never evicted even if it's the oldest);
integration test that a playlist hydration triggers exactly the expected new downloads
and no redundant re-downloads of already-cached files.

**Acceptance criteria**: killing network mid-playback and restarting the app still
plays the last-known playlist/state from local storage before any network call
succeeds (direct parity with `loadState()`'s catch-and-fall-back-to-cache path);
storage usage never exceeds the configured cap in a soak test that cycles through more
distinct media than the cap allows.

**Potential problems**: Android scoped storage changes across API levels affect where
app-private files can live and how they survive app updates/reinstalls — confirm the
chosen directory (`getApplicationSupportDirectory`) is stable across app updates (it
should be, being app-private, non-cache storage) but is correctly cleared on uninstall
(expected) and is *not* wiped by "Clear Cache" in Android system settings if it's meant
to survive that (park this as an explicit product decision to confirm — the web
player's own `clear-cache` command *deliberately* wipes everything, so a
system-level "Clear Cache" wiping the media cache is arguably correct parity, but a
system-level "Clear Data" wiping the pairing token is a much bigger deal and should be
verified not to happen from an accidental settings tap).

---

## Phase 4 — Player state machine (core)

**Web reference**: `PlayerPage.tsx` in full, `scheduler.ts`.

**Goal**: implement §0.2's exact precedence order as a testable, headless state
machine, before any rendering exists.

**Tasks**:
- `PlayerStateController` (Riverpod `AsyncNotifier<PlayerViewState>`), where
  `PlayerViewState` is a sealed/union type mirroring the six branches of §0.2 exactly
  (`PoweredOff`, `Stopped`, `Emergency(playlist)`, `Evacuation(directory)`,
  `Wayfinding(directory)`, `Playing(playlist)`, `NoContent`).
- Port `resolveSchedule`, `resolvePower`, `msUntilNextTransition` from `scheduler.ts`
  verbatim (same midnight-crossing logic, same priority-sort, same "recompute exactly
  at the next minute boundary" self-scheduling behavior — do not approximate with a
  fixed poll interval, since the web implementation deliberately avoids that for
  responsiveness).
- Port `computeHasContent` (the "awaiting content" badge logic) verbatim, including its
  deliberate exclusion of `poweredOn`/`stopped` from the "has content" computation.
- Heartbeat (30s) and full-state-refresh (60s) timers, each independently resetting the
  schedule-resolution timer on a fresh fetch, exactly matching `PlayerPage.tsx`'s
  `heartbeatRef`/`refreshRef`/`scheduleTimerRef` triad.
- `handleRevoked` equivalent: on a `404`/`401` from `getState()`, clear local cache and
  identity and route back to pairing — this is the *same* recovery path as receiving a
  `deleted` socket command, and should share one code path in Flutter just as it
  conceptually does in the web version.

**Files/modules**: `lib/features/player/controller/player_state_controller.dart`,
`lib/domain/logic/scheduler.dart`, `lib/domain/logic/scheduler_test.dart`.

**Dependencies**: none new beyond Phase 1/2's.

**Tests**: this phase is almost entirely unit-testable without any widget/rendering
code, and should be tested that way first:
- Table-driven tests for `resolveSchedule` covering: no rules (→ null), a single
  midnight-crossing rule (22:00–06:00) evaluated at 23:00, 02:00, and 12:00, two
  overlapping rules resolved by priority, a date-range-bounded rule outside its range.
- `resolvePower` with zero rules (→ always on), a midnight-crossing power window, two
  non-overlapping windows.
- `msUntilNextTransition` returns a value that lands exactly on the next minute
  boundary, clamped to a 1000ms minimum.
- The full precedence order (§0.2) as an integration-style test: construct a
  `PlayerState` fixture with every combination of `poweredOn`/`stopped`/
  `emergencyActive`/`wayfinding` set, assert the resulting `PlayerViewState` variant
  matches the documented priority exactly for all 2⁴ combinations (this is the single
  most valuable test in the whole project, since a regression here silently breaks
  emergency/power-off guarantees that are safety-relevant, not just cosmetic).

**Acceptance criteria**: the precedence matrix test above passes for all 16
combinations; a manual test against the live `apps/api` reproduces every branch by
toggling the corresponding dashboard controls and observing the correct Flutter state
transition within one heartbeat/socket-push cycle.

**Must verify before moving to Phase 5**: this phase's state machine is complete and
tested *before* writing a single pixel of rendering code — Phase 5 assumes
`PlayerViewState` is already correct and just needs to be drawn.

---

## Phase 5 — Player rendering shell & fullscreen/orientation/aspect-ratio

**Web reference**: `PlayerPage.tsx`'s `FullscreenContainer`, `ClockOverlay`,
`SoundLockedIndicator`, `startButtonStyle` gate, `Splash.tsx`.

**Current web behavior to port exactly**:
- Auto-start-off gate: a full-bleed "Tap to start" button that both starts playback and
  doubles as the audio-unlock gesture, shown only when the device setting `autoStart` is
  false, evaluated once at mount (changing the setting mid-session doesn't retroactively
  un-start an already-playing session).
- Orientation (0/90/180/270°): rotates the *entire* rendered content around the
  viewport's own center, computed so the rotated box always exactly fills the true
  (unrotated) screen at every angle — port `FullscreenContainer`'s
  translate-then-rotate-about-center math exactly (Flutter: `Transform.rotate` with the
  content pre-sized to the swapped dimensions for 90°/270°, centered via a `Stack` +
  `Center`/`Positioned`, matching the CSS `translate(-50%,-50%) rotate()` composition
  order).
- Aspect ratio (16:9 / 9:16 / stretch) letterboxing/pillarboxing independent of the
  device's real panel aspect ratio: port `letterboxSize`'s `min(availW, availH * w/h)`
  math exactly (Flutter: `AspectRatio` widget won't do this alone since it needs to
  *shrink to fit* rather than *fill*, matching CSS `min()` — implement via
  `LayoutBuilder` computing the same width/height formula directly).
- Optional clock overlay, top-right, 1s-ticking, timezone-aware (`Intl`/`intl`
  package's timezone-aware formatting, or `timezone` package for named-zone
  correctness matching JS `Intl.DateTimeFormat`'s `timeZone` option).
- "Tap anywhere for sound" indicator, shown only while `!isAudioUnlocked()`, disappears
  permanently once any interaction anywhere unlocks audio.

**Flutter-specific note on audio unlock**: `audioUnlock.ts`'s entire mechanism exists
*only* because browsers refuse unmuted autoplay without a prior user gesture. **Android
has no equivalent restriction** — a native app can start unmuted video/audio playback
immediately with no gesture requirement. This means the "tap for sound" indicator and
the sticky-unlock-listener mechanism are **not needed for correctness** in Flutter; they
exist in the web player to work around a browser-specific limitation this platform
doesn't have. Recommendation: **do not port this mechanism** — implement direct,
immediate unmuted playback per each item's `muted`/`forceMuted` flags, and treat this as
a deliberate, documented platform-driven simplification (not a missed requirement) in
the parity matrix (§Section 7). If a future signage OS/WebView-hosted deployment target
ever reintroduces this restriction, the flag/logic can be resurrected from this section.

**Files/modules**: `lib/features/player/player_page.dart`,
`lib/features/player/widgets/fullscreen_container.dart`,
`lib/features/player/widgets/clock_overlay.dart`, `lib/features/player/widgets/splash.dart`.

**Tests**: widget tests for the letterbox math (given a set of viewport
size/aspect-ratio/orientation combinations, assert the rendered content box's computed
size matches `letterboxSize`'s formula); golden-image tests comparing a few fixed
orientation/aspect-ratio combinations against expected renders.

**Acceptance criteria**: setting orientation to 90°/270° and aspect ratio to 9:16 from
the dashboard produces a correctly rotated, correctly letterboxed render on a real
16:9-panel Android TV box, verified visually against the web player rendering the same
screen's state side-by-side.

---

## Phase 6 — Core playlist/media playback engine

**Web reference**: `ZonePlayer.tsx` in full (this is the single most important file in
the entire web player to port faithfully).

**Tasks — port exactly**:
- Item-kind dispatch: `ASSET` (further split by `asset.type`: IMAGE/VIDEO/TEXT/
  DOCUMENT/APP), `THEME`, `LAYOUT`, `DESIGN` — same dispatch table as `ZonePlayer.tsx`'s
  final JSX, becomes a Flutter `switch` over the same enum driving which sub-widget
  renders.
- Advance timing rules, exactly as coded (not simplified):
  - THEME/LAYOUT items, and IMAGE/TEXT/APP-type ASSET items: plain `durationSecs` dwell
    timer.
  - VIDEO with `playFullVideo=false`: `durationSecs` dwell timer (same as above) *or*
    the video's natural end, whichever comes first.
  - VIDEO with `playFullVideo=true`: advance only on natural end (`onEnded`), no timer
    at all.
  - DOCUMENT: an internal page-cycle timer (`durationSecs` = seconds-per-page) that
    hands off to the *playlist's* advance only once every page has been shown, looping
    its own pages forever if it's the playlist's only item (mirrors the "nowhere to
    advance to" edge case in `ZonePlayer.tsx` exactly).
  - Single-item playlists loop the one item forever (`loop=true` on video, page-cycle
    for DOCUMENT) rather than "advancing" back to index 0, avoiding a visible
    re-render/flash.
- **Shuffle** (new — §0.1): when `playbackOrder === 'SHUFFLE'`, shuffle the item order
  once when the playlist is (re-)hydrated (Fisher-Yates, port the exact algorithm from
  `AppPlayer.tsx`'s `shuffled()` for consistency), *and* add the "never repeat the same
  item twice in a row" guarantee this document's prose promises but the existing
  `AppPlayer.tsx` implementation does not actually provide (its comment admits "simplest
  interpretation... not re-shuffled every loop back to the start" — Flutter's version
  should specifically check that reshuffling on loop-back never places the same item at
  both the last and first position of consecutive cycles, since a naive one-shot shuffle
  can otherwise produce a visible "same item twice in a row" glitch exactly at the loop
  boundary, which the current implementation doesn't guard against).
- **Crossfade transitions** (new — §0.1): read `transitionStyle`/`transitionDurationMs`
  from the hydrated playlist; implement at minimum a crossfade (`AnimatedSwitcher` or a
  manually-driven `AnimationController` cross-dissolving outgoing/incoming item widgets)
  for image-to-image and image-to-video transitions honoring `transitionDurationMs`
  exactly; `transitionStyle: 'NONE'` (or any playlist predating this field) must render
  as the current hard-cut behavior with zero regression. Explicitly scope
  video-to-video crossfade as harder (needs two concurrent decoder sessions, directly in
  tension with the "TV WebViews cap concurrent decoders at 1-2" constraint this document
  itself documents) and treat it the same way the pre-existing item 8 already frames it:
  a deliberate, called-out follow-up, not a v1 blocker — but the image-involving cases
  should ship in v1 since they carry none of that decoder-contention risk.
- Decoder release: every item change must explicitly dispose the outgoing
  `VideoPlayerController` (mirrors `releaseVideoDecoder`'s `pause()` +
  `removeAttribute('src')` + `load()` sequence and its documented rationale about
  TV-hardware decoder budgets) — do not rely on Dart GC/finalizers; the web player's own
  bug history (the pre-fix `sw.ts` state, and the comment about muted videos never being
  explicitly released before this fix) is a direct warning that "let it get cleaned up
  eventually" causes real black-frame bugs on this exact class of hardware.
- Next-video pre-fetch: before an item transition, ensure the *next* item's video asset
  is already downloaded (this is Phase 3's `MediaDownloadManager`, invoked from here) —
  functionally the same intent as `ZonePlayer.tsx`'s `fetch()`-only pre-warm, but
  Flutter's version should be a real completed download rather than a fire-and-forget
  cache-warm, since Flutter is not relying on a browser HTTP cache as the implicit
  backing store.
- `ZonePlayerController` exposing `pause`/`resume`/`seek`/`setSpeed`, wired to the
  Custom Player socket commands exactly as `ZonePlayerHandle` is, gated the same way on
  a `controllable` flag that is only ever true for the single top-level `ASSET`-mode
  instance (never zone-nested, never PLAYLIST/emergency playback) — port this scoping
  restriction exactly, it is deliberate per the web code's own comment.
- ~1×/second playback-progress reporting while `controllable` and a video is mounted,
  forwarded to the socket exactly as `onPlaybackProgress`/`handlePlaybackProgress` do.
- Per-item crop (`cropZoom`/`cropOffsetX`/`cropOffsetY`) — port `mediaCropStyle`'s
  transform math (a CSS `transform: scale() translate()` composition in
  `packages/types/src/theme.ts`) into an equivalent Flutter `Transform` on the
  image/video widget.

**Files/modules**: `lib/features/player/zone_player/zone_player.dart`,
`lib/features/player/zone_player/zone_player_controller.dart`,
`lib/features/player/zone_player/app_player.dart` (YouTube embed, Phase 3.3),
`lib/domain/logic/playlist_advance.dart` (pure advance-timing logic, unit-testable
without any widget tree, mirroring `scheduler.dart`'s separation).

**Tests**: this phase again benefits from separating pure timing/ordering logic (unit
tested extensively) from the widget tree (tested via widget tests + manual device
verification for actual video playback, which `flutter test` cannot meaningfully
exercise). Unit tests: every advance-timing branch above, individually, with a fake
clock; shuffle's no-immediate-repeat guarantee across many simulated loop boundaries
(a property-based/repeated-random test, not a single fixed-seed assertion). Widget
tests: item-kind dispatch renders the correct sub-widget for each kind/asset-type
combination given a fixture playlist. Manual device tests: actual crossfade timing and
visual quality on real Android TV hardware; actual decoder-release behavior verified by
playing a long sequence of many videos back-to-back on a low-end box without a black
frame appearing (this is exactly the failure mode the web comment describes — reproduce
the *test*, not just the fix).

**Acceptance criteria**: a playlist identical to one already tested against the web
player produces the same visual sequence, same per-item durations, and no
audible/visible glitches across at least 3 full loops on real Android TV hardware, with
`transitionStyle`/`playbackOrder` now actually honored where the web player silently
ignores them.

---

## Phase 7 — Zones, Themes, and Designer2 scenes

**Web reference**: `ZoneRenderer.tsx`, `ThemeRenderer.tsx`, `DesignRenderer.tsx`,
`packages/types/src/theme.ts`, `packages/design-schema/src`.

This is the largest single rendering-fidelity phase in the project — themes alone
support 9 distinct element kinds with independent animation, shape, and image-adjustment
systems. Recommend treating each element kind as its own sub-task with its own
acceptance criteria rather than one monolithic "port ThemeRenderer" task.

**7.1 — Layout zones** (`ZoneRenderer.tsx`): percentage-positioned, z-indexed,
rotated, non-rectangular-clipped regions, each independently running a nested
`ZonePlayer` or a live widget. Port `shapeClipStyle`'s per-shape clip-path geometry
(rounded/circle/triangle/pentagon/hexagon/octagon/star/arrow) as Flutter `ClipPath`s
with equivalent `Path` geometry — this needs its own geometry-correctness test per
shape (a golden image per shape at a few different aspect ratios), since a CSS
`clip-path: polygon(...)` and a Flutter `Path` are authored independently and can
silently diverge at non-square aspect ratios. Port the single-audio-priority-zone
silencing rule exactly (`forceMuted = priorityZone !== null && priorityZone.id !== zone.id`).

**7.2 — Theme rendering** (`ThemeRenderer.tsx`): for each of the 9 element kinds,
build a dedicated Flutter widget:
- **TEXT**: RTL-aware (`Directionality`), typewriter/word-by-word reveal (port
  `useTextReveal`'s character/word-splitting and per-unit timer exactly, including its
  RTL-safe regex-based word-splitting that preserves whitespace), asset-backed TEXT
  reuse (an element with `assetId` set reuses that TEXT asset's own styling wholesale,
  same as the web's `content.textContent != null` branch).
- **IMAGE/VIDEO/DOCUMENT**: straightforward asset rendering; DOCUMENT gets its own
  internal page-cycle timer exactly like `DocumentPager`, looping forever (a theme
  element has no "next item" the way a playlist item does).
- **PLAYLIST**: nests a full `ZonePlayer` recursively — verify Flutter's version
  respects the same `MAX_PLAYLIST_ITEM_DEPTH` cycle-bounding the backend enforces (a
  theme with a PLAYLIST element pointing at a playlist containing a THEME item pointing
  back at itself must not infinite-loop or stack-overflow the renderer; the backend caps
  hydration depth at 2, so a well-behaved client should also treat unexpectedly-deep
  nesting defensively, e.g. a render-depth counter that renders `ThemePlaceholder`
  instead of recursing past a sane bound).
- **SHAPE**: solid-fill vs. outline-stroke rendering, port `shapeOutlineGeometry`'s
  per-shape stroke-path construction.
- **BRUSH**: prefer the raster (`dataUrl`) path when present (the current editor always
  produces one) — decode the base64 PNG/data-URL directly as a Flutter `Image.memory`;
  only fall back to reconstructing a vector polyline from `points` for themes saved
  before the raster layer existed (port `brushPolylinePoints`'s point-to-path
  conversion for that legacy path).
- **WIDGET**: dispatches into Phase 8's live-widget implementations.
- **ICON**: renders pre-sanitized inline SVG markup — Flutter has no built-in SVG
  renderer; use `flutter_svg` to render the stored markup string directly (the web
  version trusts this markup as "sanitized at pick time," and Flutter should treat it
  with the same trust level — this is operator-authored content already validated at
  creation, not third-party/user-supplied HTML).
- **Image adjustments** (exposure/brightness/contrast/saturation/vibrance/temperature/
  tint/hue/duotone/presets): this is the highest-fidelity-risk sub-task in the whole
  roadmap. The web implementation splits adjustments across plain CSS `filter` functions
  (brightness/contrast/saturate/hue-rotate map directly) and an SVG `<filter>` for the
  ones CSS can't express (temperature/tint/duotone — anything needing a custom color
  matrix or a luminance remap). Flutter has no direct CSS-filter equivalent; recommend:
  simple adjustments (brightness/contrast/saturation/hue) via `ColorFilter.matrix` (a
  5×4 color matrix can express all four in combination); duotone and
  temperature/tint via a **Flutter fragment shader** (`FragmentProgram`/`.frag` file,
  Impeller-compatible) replicating the SVG filter's actual math — port
  `buildImageFilterCss`/`needsSvgImageFilter`'s exact per-adjustment formulas, not just
  their visual intent, since operators will have themes authored and previewed in the
  web Designer that must look the same on the Flutter player. **Recommend an early
  spike** (before committing this to a sprint estimate) building one duotone example in
  both a Flutter `ColorFilter.matrix` approach and a fragment-shader approach, comparing
  pixel output against the web's SVG-filter rendering of the same input, since this is
  the single item in this entire roadmap most likely to need real R&D time rather than
  straightforward porting.
- **Entrance/emphasis animations**: port the "two nested widgets, not one property"
  composition the web code explicitly calls out (`ThemeRenderer.tsx`'s comment: a
  transform-based entrance/emphasis animation must not overwrite a static rotation) —
  Flutter equivalent: an outer `AnimatedBuilder`/`AnimationController`-driven
  `Transform.translate`/`Transform.scale` for entrance/emphasis, wrapping an inner,
  separately-and-statically `Transform.rotate`d child, exactly mirroring the two-`div`
  structure.

**7.3 — Designer2 scene rendering** (`DesignRenderer.tsx`): resolved
scenes/elements already carry substituted variables and resolved URLs (no client-side
resolution needed — port this "dumb renderer" model exactly, don't re-implement
variable substitution in Flutter). Port: scene dwell-timer with next-scene media
pre-warming; WAAPI-equivalent enter/emphasis animations (`element.animate(...)` with
specific keyframe/easing tables in `ANIMATION_MOTION`/`EASING_FUNCTIONS`) via Flutter
`AnimationController`s driving the same translate/scale/opacity keyframe pairs and the
same named easing curves (map `EASING_FUNCTIONS`'s named curves to Flutter `Curves`
equivalents or custom `Curve` subclasses where there's no direct match); video elements'
trim start/end offsets and in-clip looping (port the `loadedmetadata`/`timeupdate`
listener logic exactly — seek to `startOffsetMs` on load, loop back to it or pause at
`endOffsetMs`); the 6 shape primitives including the literal corner-to-corner `line`
(not a horizontal divider — this is explicitly called out in the web comment as a
common mistake to avoid); server-rendered QR data URIs (already base64 images by the
time they reach the player — just decode and render, no QR generation needed
client-side, unlike the live QR *widget* in Phase 8 which does generate client-side).
Port the JS-measured `ResizeObserver`-based contain-fit scale computation as a Flutter
`LayoutBuilder`.

**Files/modules**: `lib/features/player/zone_renderer/zone_renderer.dart`,
`lib/features/player/theme_renderer/theme_renderer.dart` +
`theme_element_view.dart` (one file per element kind or a well-organized switch),
`lib/features/player/theme_renderer/image_adjustments.dart` (+ `.frag` shader assets),
`lib/features/player/design_renderer/design_renderer.dart`.

**Dependencies**: `flutter_svg` (ICON elements), Flutter's built-in
`dart:ui.FragmentProgram` (image adjustments — no external package needed on
recent Flutter/Impeller).

**Tests**: golden-image tests per theme element kind (at minimum one fixture per kind,
including edge cases: TEXT with no assetId vs. asset-backed TEXT, SHAPE outline vs.
solid, BRUSH raster vs. legacy vector); a dedicated golden-image comparison suite for
image adjustments compared pixel-region-by-pixel-region (not exact-match, given
GPU/shader floating-point variance) against reference outputs generated by rendering
the same theme in the web player and screenshotting it; unit tests for the Designer2
animation keyframe/easing mapping table (every `EASING_FUNCTIONS` name has a
corresponding Flutter curve, no silent fallback-to-default for a name that should have
mapped).

**Acceptance criteria**: a theme authored and previewed in the dashboard's Theme
editor, when assigned to a screen, renders recognizably identically (same layout,
same animations firing at the same relative times, same colors within reasonable
GPU/shader tolerance) on the Flutter player and the web player shown side-by-side; a
Designer2 Design likewise, including correct video-trim behavior.

---

## Phase 8 — Live widgets

**Web reference**: `PrayerZoneWidget.tsx`, `WeatherWidget.tsx`, `CurrencyWidget.tsx`,
`TickerWidget.tsx`, `TimeWidget.tsx`, `DateWidget.tsx`, `QrCodeWidget.tsx`,
`LiveWidget.tsx`, `TextAssetTicker.tsx`, `packages/prayer/src/index.ts`.

**Tasks — port exactly, per widget**:
- **Prayer**: use a Dart prayer-times package equivalent to the `adhan` npm package —
  **`adhan_dart`** is the closest direct port (same calculation-method table:
  MuslimWorldLeague/Egyptian/Karachi/UmmAlQura/Dubai/MoonsightingCommittee/
  NorthAmerica/Kuwait/Qatar/Singapore/Tehran/Turkey). Verify its `fajr`/`sunrise`/
  `dhuhr`/`asr`/`maghrib`/`isha` outputs match the JS `adhan` package's outputs for the
  same lat/long/date/method to within a few seconds (both libraries implement the same
  published astronomical formulas, but must be verified, not assumed, since they are
  independently-maintained ports) — **this verification is a required task, not
  optional**, since a signage screen displaying an athan time that's meaningfully wrong
  is a real trust/product problem for a Muslim-audience customer. Port the next-prayer
  countdown, the 30-second athan-trigger window with once-per-day-per-prayer dedupe
  (`athanFiredRef`), the midnight rebuild-and-clear-dedupe-cache tick, and the Arabic/
  English name tables and RTL layout exactly.
- **Weather/Currency/Ticker**: port the cache-first-then-live-fetch pattern exactly
  (§0.1 table — seed from local storage, `prev ?? cached` / `prev.length ? prev :
  cached` semantics so a fast live fetch never gets clobbered by a slow cache read),
  same refresh intervals (10m/1h/5m respectively), same RTL string tables and units
  formatting (KWD/BHD at 4 decimal places, everything else at 2, for Currency).
- **Ticker**: port both scroll directions (horizontal LTR/RTL, vertical) and their
  distinct "sign" logic exactly (`AXIS`/`SIGN` tables), the seamless-loop-via-
  duplicated-content-and-modulo-reset technique (port as a Flutter
  `AnimationController` driving a `Transform.translate` on a widget containing the
  content twice, resetting position by exactly half the measured extent — this is a
  from-scratch reimplementation since Flutter has no `requestAnimationFrame` +
  manual-transform equivalent to literally copy, but the *algorithm* — accumulate
  position by `speed * dt`, wrap at half the doubled content's measured size — ports
  directly), and the edge gradient-fade overlay.
- **TextAssetTicker**: same algorithm as Ticker but with a directional entry animation
  (starts fully off-screen on the entry edge) rather than an immediate loop, and a
  configurable cross-axis position (`crossPosition`) pinning the perpendicular axis —
  port both axes' distinct transform composition exactly.
- **Time/Date**: `useNow`'s two different tick cadences (1s for Time so seconds visibly
  move, 60s for Date since only day-rollover matters) — implement as two differently-
  configured `Timer.periodic`-backed Riverpod `StreamProvider`s, not one shared clock,
  to avoid over-rebuilding the Date widget every second for no visible benefit. Use the
  `timezone`/`intl` packages for `Intl.DateTimeFormat`-equivalent timezone-aware,
  locale-aware (`ar`/`en-US`) formatting matching the exact `toLocaleTimeString`/
  `toLocaleDateString` option combinations used (`hour12`, `showSeconds`,
  `format: 'short' | 'long'`).
- **QR**: generate the QR code client-side (matching the widget's own live-generation,
  as distinct from Designer2's server-pre-rendered QR elements) via a Dart QR package
  (e.g. `qr_flutter`), matching the web's SVG-based scalable rendering (render to a
  `CustomPainter`/vector widget, not a fixed-resolution raster, so it scales cleanly
  with the zone's box exactly as the web's `width="100%" height="100%"`-patched SVG
  does).
- **`ZoneRenderer`/`LiveWidget`'s "no content configured" fallbacks**: port
  `zoneHasContent`'s per-widget-type "is there actually anything to show" logic
  verbatim — this feeds directly into Phase 4's `computeHasContent`/heartbeat
  `hasContent` flag, so getting this wrong silently breaks the "awaiting content" badge
  for widget-only screens.

**Files/modules**: `lib/features/player/widgets/prayer_widget.dart`,
`weather_widget.dart`, `currency_widget.dart`, `ticker_widget.dart`, `time_widget.dart`,
`date_widget.dart`, `qr_widget.dart`, `text_asset_ticker.dart`,
`lib/domain/logic/zone_has_content.dart`.

**Dependencies**: `adhan_dart` (verify actively maintained/accurate before committing —
if it's stale, evaluate porting the astronomical formulas directly rather than trusting
an unmaintained dependency for a religiously/culturally sensitive calculation), a QR
generation package (`qr_flutter`), `timezone` + `intl`.

**Tests**: unit tests comparing `adhan_dart`'s output against known-correct reference
times (published prayer-time tables for a few fixed lat/long/date/method combinations,
not just cross-checked against the JS library, since both could theoretically share a
bug) for at least 3 cities across different latitudes/methods; unit tests for the
cache-first widget pattern (assert a slow-resolving live fetch never overwrites a
faster live fetch's result, and that a cached value only ever fills an otherwise-empty
state); widget tests for RTL layout mirroring on every widget when `lang: 'ar'`.

**Acceptance criteria**: a Prayer zone configured with the same lat/long/method as a
reference web-player screen shows the same five prayer times to the minute and fires
its athan within the same 30-second window; every widget renders correctly
RTL-mirrored with Arabic content and falls back to its last-known-good cached data
after a simulated network loss and app restart.

---

## Phase 9 — Wayfinding

**Web reference**: `WayfindingDirectoryBoard.tsx`, `WayfindingKioskMap.tsx`,
`WayfindingDirectoryPanel.tsx`, `WayfindingEvacuationView.tsx`, `routing.ts`,
`wayfindingLang.ts`, `tts.ts`, `kioskAnalytics.ts`.

This is the second-largest rendering-fidelity phase, and the one with the most
genuinely novel *interaction* work (gesture handling), not just visual porting.

**9.1 — Non-touch directory board**: auto-rotating floor pages (12s dwell), grouped by
POI category, "you are here" badge on the kiosk's own floor, lucide-icon-equivalent
category icons (Flutter: bundle the specific icon set actually used, e.g.
`lucide_icons` Flutter port or a curated SVG icon set matching the same names used in
`icon` fields, so operator-configured category icons resolve identically) — a
straightforward, low-risk direct port.

**9.2 — Touch kiosk map (the highest-complexity single component in this entire app)**:
port the full custom pointer-gesture system from `WayfindingKioskMap.tsx` — this was
deliberately hand-built on raw pointer events rather than a gesture library, and
Flutter should use its native equivalent (`GestureDetector`/`Listener` with
`onPointerDown`/`onPointerMove`/`onPointerUp`, or `InteractiveViewer` for the base
pan/zoom if its API can be made to match exactly — evaluate both, since
`InteractiveViewer` is the more "correct" idiomatic Flutter tool but must be checked
against every specific behavior below before assuming it's a drop-in replacement):
- Single-finger pan, two-finger pinch-to-zoom with correct anchor-point math (zoom
  around the pinch midpoint, not the viewport center) — port `rescaleAround`'s
  translate-then-scale formula exactly.
- Scale clamped to `[1, 4]`, pan clamped with 80px of "overpan slack" past the strict
  edge so the map doesn't feel glued shut — port `clampTransform` exactly, including
  the slack constant.
- Tap-vs-drag disambiguation (a real tap is `<10px` of movement and `<400ms` duration —
  port `TAP_MOVE_THRESHOLD_PX`/`TAP_MAX_DURATION_MS` as named constants, not
  re-derived guesses) hit-testing against POI pins by their rendered position, not a
  separate hit-test data structure.
- Double-tap-to-zoom as the mouse/non-pinch-capable alternative to pinch, with the same
  `300ms` window and toggle-between-1x-and-2.2x behavior.
- A pulsing "you are here" marker (port the `lumina-here-pulse` keyframe as a Flutter
  `AnimationController` looping scale+opacity).
- Floor-tab switching that resets pan/zoom *except* when a route is currently open
  (where switching floors is how a visitor follows a cross-floor route along) — port
  this exact conditional-reset logic, including the "skip the next reset" flag used
  when a directory-panel pick both changes floor and selects a POI in one action.
- The idle/attract-loop timer (90s of no touch → fallback Playlist/Theme, any touch
  anywhere resets it) using the *capture phase* equivalent (Flutter: an outer
  `Listener`/`GestureDetector` with `behavior: HitTestBehavior.translucent` positioned
  to see every descendant's pointer-down before it's consumed) so it fires regardless of
  which nested widget actually handles the tap.
- Accessibility mode (1.35× scale on touch targets/text) and persisted EN/AR language
  toggle, both saved to local prefs exactly matching the web's `localStorage` keys'
  *intent* (new Flutter-side keys, obviously, but same persistence semantics — survive
  restart, per-device not per-session).
- Route rendering: an SVG-polyline-equivalent (`CustomPainter` drawing a `Path` through
  the same percentage-coordinate points) clipped to the current floor's visible portion
  of a cross-floor route, with the kiosk's exact pin and the POI's exact pin as
  the true start/end (not the nearest graph node, which is only used for the underlying
  Dijkstra search) — port `floorRoutePoints`'s exact "first/last leg on this floor"
  logic.
- Text-to-speech readout: Flutter equivalent is `flutter_tts`, mapped to the same
  `en-US`/`ar-SA` locale selection; port the `onDone`-fires-regardless-of-outcome
  contract (finished, cancelled, or errored) so the "currently speaking" toggle state
  never gets stuck.
- QR hand-off-to-phone: encode the same turn-by-turn text payload into a QR code
  (reuses Phase 8's QR widget/package).
- Kiosk analytics: port the debounced-search-logging (1.2s settle time) and
  session-start/POI-view event firing exactly, batched to the same
  `/player/wayfinding-events` endpoint.

**9.3 — Full directory search panel**: alphabetical + category-filtered + live-search
POI list across every floor (not just the current one), plus a **docked on-screen
QWERTY keyboard** — port this keyboard verbatim rather than relying on Android's own
on-screen keyboard, for the same reason the web version gives: kiosk hardware may have
an absent/unreliable system IME, and a purpose-built docked keyboard is a deliberate,
tested design choice, not a stopgap. (Flutter note: Android *does* generally have a more
reliable system keyboard than an embedded WebView on unknown kiosk hardware — this is
worth a product conversation, flagged in §14, about whether the docked keyboard is still
necessary on native Android or was purely working around a WebView-specific limitation;
default recommendation pending that conversation is to **port it anyway** for exact
behavioral parity and because kiosk lock-task mode can itself suppress the system IME
in ways that make a self-contained keyboard the safer default.)

**9.4 — Evacuation view**: full-screen red alert view, routes to the nearest
"Exit"-categorized POI avoiding elevators, auto-speaks directions on entry (not
opt-in, unlike the normal directions panel) — port exactly, including the
same-floor-first exit-selection preference and the graceful "no exit found" fallback
text.

**9.5 — Routing engine** (`routing.ts`): port `findNearestNode`, `computeRoute`
(plain Dijkstra, no heap, correctly noted in the web comment as fine for a
"few hundred nodes" building graph), and `buildDirectionSteps`'s turn-by-turn text
generation (floor-change instructions only, since the graph has no heading data to
derive "turn left/right" from — port this exact, deliberate limitation, don't attempt to
add left/right turns Flutter has no more data to compute correctly than the web does)
as pure, unit-tested Dart functions with zero Flutter/widget dependency — this is
exactly the kind of logic Phase 2's architecture principle (pure `domain/logic/`
functions) exists for.

**Files/modules**: `lib/features/wayfinding/directory_board.dart`,
`kiosk_map.dart` (+ a dedicated `kiosk_map_gesture_controller.dart` isolating the
pointer-math from rendering, given its complexity), `directory_panel.dart`,
`evacuation_view.dart`, `lib/domain/logic/routing.dart`, `lib/domain/logic/wayfinding_lang.dart`.

**Dependencies**: `flutter_tts`, an icon set matching `lucide-react`'s names (evaluate
`lucide_icons` Flutter package for exact name parity, since `widgetConfig`/category
`icon` fields are stored as lucide icon-name strings and must resolve the same way).

**Tests**: `routing.dart`'s Dijkstra/nearest-node/direction-steps functions get the
same table-driven unit-test treatment as `scheduler.dart` (fixed graphs with known
shortest paths, accessible/evacuation edge-exclusion cases, disconnected-graph
no-route case); gesture-math unit tests for `clampTransform`/`rescaleAround` given
fixed inputs; a dedicated, patient manual test pass on a real touchscreen device for
the full pinch/pan/tap/double-tap gesture set, since this category of interaction bug
is very hard to catch in an automated test and very easy to introduce during a
"port to `InteractiveViewer`" refactor.

**Acceptance criteria**: a touch device correctly pinch-zooms, pans, and selects POIs
matching the web player's feel (validated by side-by-side manual comparison, not just
"it technically zooms"); a computed route between two known POIs matches the web
player's route (same nodes, same floor-change count) for at least 3 test cases spanning
single-floor and multi-floor routes; the evacuation view auto-speaks and renders
within one render frame of `emergencyActive` flipping true.

---

## Phase 10 — Networking, real-time updates, and Custom Player remote control

**Web reference**: `api.ts`, `socket.ts`, `screen.gateway.ts` (backend), `PlayerPage.tsx`'s
socket-command handler.

**Tasks**:
- `ApiClient` (Dio) mirroring `api.ts`'s `request<T>` wrapper: Bearer-token injection
  from Phase 2's secure storage, JSON body/response handling, an `ApiError` type
  carrying HTTP status (so `404`/`401` can be distinguished from a transient network
  error exactly as `ApiError`/`err.status` is used throughout `PlayerPage.tsx`). Every
  endpoint from `api.ts`'s `api` object gets a matching Dio call: `init`, `checkPairing`,
  `getPlaylist` (legacy, keep for compatibility), `getState`, `heartbeat`,
  `logWayfindingEvents`, `getWeather`, `getCurrency`, `getTicker`, `uploadScreenshot`
  (multipart), plus the **new** calls the web player never made but the backend already
  supports: `ingestProofOfPlay` (`POST /player/proof-of-play`) and `ingestCrashReports`
  (`POST /player/crash-report`) — see Phase 12/13.
- `SocketService` wrapping **`socket_io_client`** (the Dart/Flutter package — this
  must be a real Socket.IO client, not a plain `web_socket_channel` raw WebSocket,
  since the NestJS backend's `ScreenGateway` speaks the Socket.IO protocol
  specifically, including its own handshake/room/ack semantics — a raw WebSocket
  client cannot interoperate with it). Port: JWT-in-`auth` handshake, `reconnection:
  true` with `reconnectionDelay: 2000`/`reconnectionDelayMax: 30_000` exactly, the
  `command` event handler dispatching every `PlayerCommand` variant
  (`publish`/`reload`/`clear-cache`/`capture-screenshot`/`unpair`/`deleted`/
  `pause`/`resume`/`seek`/`setSpeed`), and the `sock.io.on('reconnect', …)`
  distinct-from-first-connect re-fetch trigger.
- Custom Player remote control: wire `pause`/`resume`/`seek`/`setSpeed` commands to
  Phase 6's `ZonePlayerController`, gated on `controllable` exactly as the web version
  gates it (only the single top-level `ASSET`-mode instance).
- `clear-cache` command: port the *full* hard-reset behavior, not just "clear app DB" —
  the web version's fix (clearing IndexedDB *and* every Cache Storage entry *and*
  unregistering the service worker, specifically because a plain local-DB clear left a
  device stuck on stale bundled JS/CSS) has a direct Flutter analogue: clear the local
  `drift` DB *and* the entire `media_cache/` directory *and* force-check for an app
  update if using an in-app update mechanism (§12) — the underlying lesson ("a partial
  cache-clear can leave a device silently stuck on stale state forever, with no
  operator-visible symptom until someone notices") applies just as much to a native
  app's own update/cache story as it did to the web bundle.

**Files/modules**: `lib/data/api/api_client.dart`, `lib/data/api/player_api.dart`,
`lib/data/socket/socket_service.dart`, `lib/domain/models/player_command.dart`.

**Tests**: unit tests for `ApiClient`'s error-status handling (a mocked 401/404/5xx
each produce the correct typed error); a socket-service test using a fake/mock
Socket.IO server (or an integration test against a real local `apps/api` instance)
verifying every command variant dispatches to the correct handler and that reconnect
after a forced disconnect re-triggers a state refresh exactly once.

**Acceptance criteria**: every dashboard-side screen action (Publish, Reload, Clear
Cache, Capture Screenshot, Unpair, Delete, Pause/Resume/Seek/Set Speed on a
Custom-Player-eligible screen) produces the correct, immediate, verifiable effect on
the Flutter player when triggered from a live `apps/api`+dashboard instance, matching
the web player's behavior for the same actions on the same screen.

---

## Phase 11 — Subtitles & tracks

**Finding**: neither `aboutlumina-player.md`'s requirements nor the `apps/player`
source contain any subtitle/closed-caption or multi-audio-track/multi-video-track
selection feature. `VIDEO`-type assets are single-file, single-audio-track, no
alternate-language-track concept anywhere in the schema (`PlaylistItem.asset` has no
`subtitleUrl`/`audioTracks`/`videoTracks` field; `hydratePlaylist` never resolves any
such thing). This entire phase, as templated, **does not apply to this product** — do
not build subtitle/track-selection UI speculatively (per this task's own rule: don't
design for hypothetical requirements). If subtitle support is ever requested, it is a
new product feature requiring its own schema/dashboard work first, not something this
Flutter port is silently missing. Recorded here explicitly so this gap reads as a
verified finding, not an oversight.

---

## Phase 12 — Proof-of-play logging (build, don't just port)

**Web reference**: `apps/api`'s `POST /player/proof-of-play` + `IngestProofOfPlayDto`
(exists and works); **no caller exists in `apps/player`** (§0.1).

**Goal**: build the buffering/flush client the backend has always been ready for.

**Tasks**:
- On every playlist-item transition (Phase 6's advance logic), append a proof-of-play
  event (asset/item id, start time, duration actually played, screen id) to the
  `proof_of_play_queue` `drift` table.
- A periodic flush (e.g. every 60s, or opportunistically alongside the existing
  heartbeat cycle) batches queued rows to `POST /player/proof-of-play` and deletes them
  from the local queue only on a confirmed `2xx` response — never delete-then-send,
  since a crash between those two steps would silently lose the event, which defeats
  the entire point of proof-of-play for billing/compliance.
- Cap the local queue's retry window sensibly (e.g. drop events older than N days if
  they've never successfully flushed, with a logged warning) so a screen offline for
  weeks doesn't grow this table unboundedly — mirror the same "capped, not unbounded"
  philosophy the storage-cache requirement (Phase 3) already establishes for media.

**Files/modules**: `lib/features/player/proof_of_play/proof_of_play_recorder.dart`,
new `drift` table + DAO.

**Tests**: unit test that a transition always enqueues exactly one event with correct
timing fields; integration test that a flush cycle against a mocked backend correctly
batches and only clears on success, and correctly retains/retries on a simulated
network failure mid-flush.

**Acceptance criteria**: playing a known sequence of items for a known duration, then
inspecting the dashboard's proof-of-play data (once a dashboard UI for it exists —
flag if it doesn't yet, since this is a case where Flutter may be ahead of the
dashboard, mirroring how Screenshot/Custom-Player features shipped player-side ahead
of their dashboard UI per this document's own earlier sections) shows exactly that
sequence with correct timestamps.

---

## Phase 13 — Kiosk hardening & native Android integration

This phase is the heart of "why build a native app at all" — everything here is either
impossible or fundamentally compromised inside a browser tab.

**13.1 — Boot auto-launch**: an Android `BOOT_COMPLETED` `BroadcastReceiver`
(native Kotlin) that launches the app's main activity immediately on device boot, no
manual steps, no re-pairing — directly fulfilling "Starts itself automatically." Needs
the `RECEIVE_BOOT_COMPLETED` permission and, on many signage-box Android builds, being
set as the device's default launcher (`HOME` intent category) is the more reliable
mechanism than relying on `BOOT_COMPLETED` alone on heavily-customized OEM Android TV
builds — evaluate both per target hardware and document the chosen approach (this is a
genuine device-fragmentation risk, see §14).

**13.2 — Screen-awake / no-screensaver**: `WakelockPlus` (or a native `FLAG_KEEP_SCREEN_ON`
window flag) held for the app's entire foreground lifetime, plus disabling the system
screensaver/daydream where the device allows it programmatically — directly fulfilling
"Never falls asleep while running."

**13.3 — Kiosk lock-down**: Android Lock Task Mode (`startLockTask()`), ideally with the
app set as Device Owner (via a provisioning flow appropriate for fleet-managed
hardware — QR-code or NFC provisioning at first boot is the standard MDM-less pattern)
so the device genuinely cannot be backed out of, no status bar, no accidental exit —
directly fulfilling "no way to accidentally back out." Document that Device Owner
provisioning has real fleet-deployment/logistics implications (must happen at
first-boot before any Google account is added to the device) and should be planned as
part of the hardware-provisioning process, not something the app alone controls.

**13.4 — Freeze watchdog (native-required)**: as established in §0.1, a frozen Dart
isolate cannot detect its own freeze. Architecture: a small native Android
**foreground service** (or `WorkManager` periodic job, though a foreground service is
more reliable for sub-minute intervals) that expects the Flutter side to write a
"heartbeat" timestamp (via a `MethodChannel`/shared file/`SharedPreferences`) at a
regular interval (e.g. every 10s, tied to the same heartbeat cycle Phase 4 already
runs). If the native watchdog observes no heartbeat update for longer than a threshold
(e.g. 45–60s), it force-stops and relaunches the app's process
(`ActivityManager`/`AlarmManager`-scheduled restart), and — critically — writes a
`WATCHDOG_RECOVERY` crash-report row to local storage *before* forcing the restart, so
the relaunched app's first action is flushing that report to the already-existing
`/player/crash-report` endpoint (finally giving that enum value an actual producer,
per §0.1). This directly fulfills "detects when playback has silently frozen and
force-restarts itself."

**13.5 — Remote reboot/restart**: extend the existing Custom-Player-style socket
command set with a screen-restart command (backend: a new `ScreenGateway`
`PlayerCommand` variant, e.g. `{ type: 'restart-app' }`, plus a corresponding
`ScreensService`/`ScreensController` dashboard-facing endpoint — this is a small,
additive backend change following the exact same pattern `capture-screenshot`/
`pause`/`resume` already establish) — directly fulfilling "can be rebooted or
restarted remotely from the dashboard." Flag this explicitly in §14 as a **required
backend change**, not purely a Flutter task, since no such command exists in
`screen.gateway.ts` today.

**13.6 — Hardware display power control**: extend Phase 6's power-schedule resolver
(already ported in Phase 4) with a real hardware path behind a
`DisplayPowerController` interface: attempt HDMI-CEC (`HdmiControlManager`, where the
device's Android build exposes it — this is inconsistently available across
consumer/signage Android TV boxes and is **not** part of the standard public SDK
surface on many devices) or a vendor-specific display-power broadcast `Intent` (common
on commercial signage boxes, which often ship OEM system apps expecting exactly this
kind of external trigger — must be researched per actual target hardware SKU, since
there is no universal API here), falling back to the existing software
dim/black-screen behavior (ported directly from `PlayerPage.tsx`'s `!poweredOn` branch)
whenever hardware control isn't available or fails. This directly fulfills item 6's
"software (dim/black-screen) fallback for displays that don't support the hardware
command."

**13.7 — Screen burn-in protection (new — §0.1)**: a low-amplitude, slow-period pixel
offset applied to the entire rendered content (e.g. a few pixels of drift on a
multi-minute cycle, imperceptible during normal viewing) — implement as a `Transform.translate`
wrapping the top-level render (Phase 5's `FullscreenContainer` equivalent) driven by a
slow, small-amplitude oscillation (e.g. a Lissajous or simple sine-based drift pattern
on both axes, matching the doc's own framing — "the same trick phones use to protect an
always-on lock screen"). Must be verified to never visibly clip content at the
letterboxed edges (i.e. the drift amplitude must stay within whatever margin the
letterbox/pillarbox already leaves, or the render surface must be very slightly
oversized to accommodate it without ever showing a black gap at the edge).

**Files/modules**: `android/app/src/main/kotlin/.../BootReceiver.kt`,
`WatchdogService.kt`, `DisplayPowerChannel.kt`, `LockTaskManager.kt`,
`lib/platform/kiosk_mode/*`, `lib/platform/power/*`, `lib/platform/watchdog/*`,
`lib/features/kiosk/burn_in_shifter.dart`.

**Dependencies**: `wakelock_plus`, `device_info_plus` (to branch hardware-power logic
per device/OEM), a `MethodChannel`-based custom native integration for
watchdog/display-power/lock-task (these are inherently bespoke — no off-the-shelf
package covers HDMI-CEC-with-vendor-fallback or a custom process-supervision
watchdog).

**Tests**: instrumented Android tests for the boot receiver (launch verification),
the watchdog service (simulate a frozen heartbeat and assert a forced relaunch occurs
within the threshold, and that a `WATCHDOG_RECOVERY` row is queued before the
relaunch), and lock-task entry/exit; a soak test leaving a device running for 24h+
verifying: no screensaver ever engages, no accidental exit is possible, and the
burn-in shift never produces a visible edge artifact.

**Acceptance criteria**: a device power-cycled from cold boot returns to active
playback with zero manual steps; a deliberately force-killed (`adb shell am
force-stop`) app process is relaunched by the watchdog within the configured
threshold and a corresponding crash report appears in the dashboard's crash-reports
list; a screen scheduled off overnight actually powers the physical display off (on
hardware where a control path was found) and back on in the morning, or falls back
cleanly to a black screen where it wasn't.

**Must verify before calling this phase done**: the specific target hardware SKU(s)
this product will actually ship on have been identified and their HDMI-CEC/vendor
display-power capability has been empirically tested — this cannot be fully verified
in the abstract, since "Android TV box" covers wildly different OEM firmware
capabilities (§14 risk register).

---

## Phase 14 — Diagnostics, screenshot, and crash reporting (the fleet-management surface)

**14.1 — Real diagnostics panel (new — §0.1)**: gated behind a genuine hidden
gesture (e.g. a specific multi-tap-corner-sequence or long-press pattern on a
non-interactive area, never visible/discoverable during normal playback — this is a
deliberate design requirement, not a minor detail, since the doc is explicit that it
must be "never visible during normal playback"). Shows: screen ID, app version/build
number (`package_info_plus`), last successful check-in time (from Phase 4's heartbeat
state), storage usage (Phase 3's `media_cache_index` total bytes + device free space via
`device_info_plus`/platform channel), connection status (socket connected/disconnected,
last successful API call), and reuses the existing `PlayerControlPanel`-equivalent
controls (autoStart/mute toggles, refresh, unpair, exit) alongside the new read-only
diagnostic fields.

**14.2 — Screenshot capture**: port the on-demand `capture-screenshot` socket-command
path (Phase 10) — Flutter equivalent of `html2canvas`-over-the-DOM is capturing the
actual rendered `Widget` tree via `RenderRepaintBoundary.toImage()`, encoding to JPEG,
and POSTing to the existing `/player/screenshot` multipart endpoint exactly as
`api.uploadScreenshot` does. **Add** the periodic automatic snapshot the doc promises
but the web player never shipped (§0.1): a configurable interval (new setting,
reasonable default e.g. every 5–15 minutes) triggering the same capture-and-upload
path without waiting for a dashboard command.

**14.3 — Crash & watchdog-recovery reporting**: build the buffering/flush client
against the *existing* `/player/crash-report` endpoint, exactly mirroring Phase 12's
proof-of-play queue pattern (append-on-crash, periodic batched flush, delete-only-on-
confirmed-success). Two producers feed this queue: (a) a global Flutter error handler
(`FlutterError.onError` + `PlatformDispatcher.instance.onError` — the Dart/Flutter
equivalents of the web's `window.addEventListener('error'/'unhandledrejection')`)
recording `UNCAUGHT_EXCEPTION` events with a summary + stack trace, capped at the
backend's `500`-char summary / whatever stack-trace length limit `IngestCrashReportsDto`
enforces; (b) Phase 13.4's native watchdog recording `WATCHDOG_RECOVERY` events. Port
`ErrorBoundary.tsx`'s philosophy exactly: the on-screen fallback for a caught render
error is a bare black screen, *not* an error message — this is a public-facing display,
not an admin surface — self-healing via the same guarded single-reload(restart)-per-
crash-storm pattern `scheduleReload`'s `reloadScheduled` flag implements (Flutter:
an app-level "already recovering" guard so a storm of rapid-fire errors doesn't trigger
overlapping recovery attempts).

**Files/modules**: `lib/features/diagnostics/diagnostics_panel.dart`,
`lib/features/diagnostics/hidden_gesture_detector.dart`,
`lib/features/player/screenshot/screenshot_service.dart`,
`lib/features/kiosk/crash_reporter.dart` (+ `drift` queue table, shared pattern with
Phase 12's proof-of-play queue — consider a shared generic "batched event queue" DAO
both features build on, since the append/flush/delete-on-success shape is identical).

**Dependencies**: `package_info_plus`, `device_info_plus`.

**Tests**: unit tests for the crash-report queue's flush-only-on-success semantics
(same test shape as Phase 12); a widget test that the hidden-gesture detector does
*not* trigger on any normal playback interaction (a deliberately adversarial test —
simulate rapid taps in the diagnostics-panel corner during normal video/theme
playback and assert the panel never opens accidentally); a forced-crash test
(throw inside a widget build) asserting the black-screen fallback renders and exactly
one recovery action is scheduled even if multiple errors fire within the guard window.

**Acceptance criteria**: triggering the hidden gesture opens the diagnostics panel
showing accurate live values for every listed field, verified against known ground
truth (actual screen ID, actual app-version string, actual free storage); a forced
crash produces exactly one crash-report row that successfully flushes to the
dashboard's existing crash-reports list on next connectivity; a periodic screenshot
appears in the dashboard without any manual trigger.

---

## Phase 15 — Testing strategy

### Unit tests
- `domain/logic/*`: `scheduler.dart` (§Phase 4), `routing.dart` (§Phase 9),
  `playlist_advance.dart` (§Phase 6), `zone_has_content.dart` (§Phase 8) — these are
  pure-function suites with no Flutter dependency and should have the highest coverage
  of anything in the project, mirroring how much of the web player's actual behavioral
  complexity lives in equivalently pure TypeScript functions.
- Controller tests (Riverpod `ProviderContainer` overrides): `PairingController`,
  `PlayerStateController`'s full precedence-matrix test (§Phase 4), `ZonePlayerController`'s
  imperative command handling, queue-flush controllers (proof-of-play, crash-report).
- Model (de)serialization tests: every `domain/models/*` class round-trips against
  real fixture JSON captured from a live `apps/api` `/player/state` response, so schema
  drift between backend and Flutter is caught at the model layer, not discovered at
  runtime.

### Widget tests
- Item-kind dispatch (`ZonePlayer` renders the right sub-widget per kind/type).
- Every theme-element-kind rendering (§Phase 7) via golden-image comparisons.
- Every live widget's normal + "no content configured" + RTL states (§Phase 8).
- `FullscreenContainer`'s letterbox/orientation math across a matrix of viewport
  sizes/aspect ratios/orientations (§Phase 5).
- Diagnostics panel's hidden-gesture non-triggering guarantee (§Phase 14).

### Integration tests
- Full pairing flow against a real local `apps/api` instance.
- Play → schedule transition → emergency override → power-off → recovery sequence,
  asserting the exact precedence order from §0.2 holds against live backend state
  changes, not just the unit-tested pure function.
- Socket command round-trip: every `PlayerCommand` variant triggered from the real
  dashboard (or a script hitting `ScreensController` directly) produces the correct
  observable Flutter-side effect.
- Offline-resilience: kill network mid-session, verify cached-state fallback; kill and
  relaunch the app process, verify state/media survive from local storage.
- Wayfinding routing end-to-end: a real building/floor/POI/route-graph fixture,
  verify computed routes and evacuation routing against known-correct paths.

### Device testing
Real hardware, not just an emulator, is required for: video decoder-contention/
black-frame regression testing (emulators do not reproduce the low-end hardware
decoder-budget constraint this whole product design is built around); touch-gesture
feel on the wayfinding kiosk map; the entire Phase 13 native-integration surface
(boot-launch, lock-task, watchdog force-relaunch, wake-lock/screensaver suppression,
HDMI-CEC/display-power, burn-in shift) — none of this is meaningfully testable on an
emulator. At minimum, test across: one low-end/older Android-TV-box SKU (representing
the "cheap, always-on commercial signage hardware" the doc explicitly targets), one
higher-end Android tablet (representing a touch wayfinding kiosk), and whatever OEM
signage-box hardware is actually planned for initial deployment — do not sign off
performance/decoder-contention acceptance criteria against emulator results alone.

---

## 4. Web ↔ Flutter feature parity matrix

Legend: **Direct** = port web behavior exactly. **Adapted** = same intent, different
mechanism because the platform differs. **New** = doesn't exist in the web player;
build fresh per this document's own top-half requirements. **N/A** = doesn't apply to
this product (verified absent from both the doc and the code).

| Feature | Web player | Flutter player | Relationship | Phase |
|---|---|---|---|---|
| Pairing code + polling | ✅ | ✅ | Direct | 2 |
| Long-lived token storage | `localStorage` | Android Keystore (`flutter_secure_storage`) | Adapted (deliberate hardening, §11) | 2 |
| Unpair / forget flows | ✅ | ✅ | Direct | 2 |
| State precedence order (§0.2) | ✅ | ✅ | Direct | 4 |
| Local schedule/power resolution | ✅ | ✅ | Direct | 4, 6 |
| Emergency takeover | ✅ | ✅ | Direct | 4 |
| Image/Video/Text/Document/APP playback | ✅ | ✅ | Direct | 6 |
| Video byte-range caching via Cache Storage | Workaround for a browser-specific 206 problem | Full-file download-then-play | Adapted — Flutter's model has no equivalent problem to solve | 3 |
| Decoder release on item change | `releaseVideoDecoder` | `VideoPlayerController.dispose()` | Direct intent, adapted API | 6 |
| Crossfade transitions | ❌ (field plumbed, unused) | ✅ | New (backend contract already exists) | 6 |
| Playlist shuffle | ❌ (main engine ignores it) | ✅ | New (backend contract already exists) | 6 |
| Custom Player remote control | ✅ | ✅ | Direct | 6, 10 |
| Layout zones, shapes, audio priority | ✅ | ✅ | Direct | 7 |
| Theme rendering (9 element kinds) | ✅ | ✅ | Direct (image adjustments: adapted mechanism, §7) | 7 |
| Designer2 scene rendering | ✅ | ✅ | Direct | 7 |
| Live widgets (Prayer/Weather/Currency/Ticker/Time/Date/QR) | ✅ | ✅ | Direct | 8 |
| Cache-first widget data | ✅ | ✅ | Direct | 8 |
| Wayfinding (board, kiosk map, routing, evacuation) | ✅ | ✅ | Direct | 9 |
| Real-time socket commands | ✅ | ✅ | Direct | 10 |
| Subtitles / multi-track selection | N/A | N/A | N/A — not a real product requirement | 11 |
| Proof-of-play logging | Backend only, unused | ✅ | New | 12 |
| Audio-unlock-on-gesture | ✅ (browser workaround) | Not needed | N/A on native — immediate unmuted autoplay is simply legal on Android | 5 |
| Boot auto-launch | N/A (browser tab) | ✅ | New | 13 |
| Kiosk lock-task / no accidental exit | Partial (fullscreen CSS only) | ✅ (real OS-level lock) | New | 13 |
| Freeze watchdog + force-restart | ❌ | ✅ (native-required) | New | 13 |
| Hardware display power control | ❌ (impossible from a browser) | ✅ (where hardware allows) | New | 13 |
| Screen burn-in protection | ❌ | ✅ | New | 13 |
| Remote reboot/restart command | ❌ | ✅ | New — **also requires a small backend change** | 13 |
| On-demand screenshot | ✅ | ✅ | Direct | 14 |
| Periodic automatic screenshot | ❌ (doc promise, unbuilt) | ✅ | New | 14 |
| Crash-report flush to backend | ❌ (endpoint unused) | ✅ | New | 14 |
| Real diagnostics panel | ❌ (simplified settings drawer only) | ✅ | New | 14 |
| Accessibility (RTL, Wayfinding a11y mode, ARIA-equivalent semantics) | Partial | ✅ (extended to pairing/diagnostics screens) | Direct + extended | 8, 9, 14 |
| Video-wall / multi-screen sync | Deferred, no code | Deferred, no code | N/A (correctly out of scope) | — |
| Volume scheduling (as distinct from direct volume control) | ❌ (no schema support) | ❌ (flagged, not built) | N/A pending a backend schema decision | §14 risk register |

---

## 5. Proposed Flutter project structure

Already laid out in full in §2.3 above (this section intentionally does not repeat it —
see §2.3 for the complete `lib/` tree, and the note there on why each top-level
directory exists and what it owns).

---

## 6. Dependency plan

| Package | Purpose | Why needed | Alternatives considered | Platform support | Required? |
|---|---|---|---|---|---|
| `flutter_riverpod` + `riverpod_generator` | State management (§2.2) | Matches the web app's decomposed-store shape; strong testability | Bloc, plain Provider, GetX — all rejected, see §2.2 | All | Required |
| `go_router` | Routing (Pairing ↔ Player) | Direct equivalent of `react-router-dom`'s two-route setup | Navigator 2.0 raw | All | Required |
| `dio` | REST networking | Interceptors for auth header injection, multipart upload support (screenshot), progress callbacks (media download) | `http` package — rejected, lacks interceptors/multipart ergonomics `api.ts`'s equivalent needs | All | Required |
| `socket_io_client` | Real-time command channel | Backend speaks Socket.IO specifically, not raw WebSocket (§Phase 10) | none — this is a hard protocol requirement, not a preference | All | Required |
| `drift` (+ `sqlite3_flutter_libs`) | Local structured storage | Needs relational-ish queries (media-cache eviction, queue draining) beyond a plain key-value store | `sqflite` raw, `Hive`, `ObjectBox` — `drift` chosen for type-safe queries and easier testing of the eviction/queue logic | Android (+ others if ever needed) | Required |
| `video_player` | Video playback engine (§3.1) | First-party, ExoPlayer/Media3-backed, explicit disposal for decoder release | `media_kit`, `better_player`, native channel — see §3.1 for full evaluation | Android (primary); reserve `media_kit` for a future desktop platform layer | Required |
| `youtube_player_iframe` | APP-type (YouTube) asset playback (§3.3) | Closest parity to the web's IFrame Player API — same events/error codes | Native extraction — rejected, ToS concern | Android (WebView-hosted) | Required |
| `flutter_secure_storage` | Pairing token storage (§Phase 2) | Keystore-backed, deliberate hardening over the web's `localStorage` | Plain `shared_preferences` — rejected for this specific value, see §11 | Android | Required |
| `shared_preferences` | Non-sensitive local settings (autoStart, mute, wayfinding lang/a11y) | Direct equivalent of the web's `localStorage` for non-sensitive values | — | All | Required |
| `flutter_svg` | Theme ICON element rendering (§Phase 7) | Renders pre-sanitized inline SVG markup stored per-element | Custom SVG-subset parser — unnecessary reinvention | All | Required |
| `qr_flutter` | Live QR widget generation (§Phase 8) | Matches web's client-side QR generation for the live widget (distinct from Designer2's server-pre-rendered QR) | `barcode_widget` | All | Required |
| `flutter_tts` | Wayfinding directions readout (§Phase 9) | Direct equivalent of `window.speechSynthesis` | — | Android | Required (Wayfinding only) |
| `timezone` + `intl` | Timezone/locale-aware date/time formatting | Matches `Intl.DateTimeFormat`'s `timeZone`/locale option behavior across widgets/clock overlay | — | All | Required |
| `adhan_dart` | Prayer-time/Qibla calculation (§Phase 8) | Closest Dart port of the `adhan` npm package's calculation methods | Hand-port the astronomical formulas — fallback only if this package proves inaccurate/unmaintained (must be verified, §Phase 8) | All | Required, pending accuracy verification |
| `wakelock_plus` | Keep-screen-on (§Phase 13) | Direct equivalent of preventing browser/OS sleep | Raw `FLAG_KEEP_SCREEN_ON` via platform channel | Android | Required |
| `package_info_plus`, `device_info_plus` | Diagnostics panel fields (§Phase 14) | App version, device/storage facts | Platform channel hand-rolled | Android | Required |
| `lucide_icons` (or equivalent) | Wayfinding category icon resolution (§Phase 9) | Must resolve the same icon-name strings the dashboard's icon picker already stores | Custom bundled SVG set keyed by the same names | All | Required |
| A custom native Kotlin module (no package name — bespoke) | Boot receiver, watchdog service, HDMI-CEC/vendor display-power, lock-task glue (§Phase 13) | No existing package covers process-supervision watchdog or vendor-specific display power | — | Android only | Required, hand-built |
| `media_kit` | Reserved, not adopted for v1 | Only relevant if a future desktop-Linux signage-box platform is pursued | — | — | Optional / deferred |

---

## 7. Performance roadmap

| Area | Benchmark | Measured how |
|---|---|---|
| Cold start to first frame of content | TBD — measure the current web player's boot-to-first-frame time on the same reference hardware first, then set a Flutter target at parity or better, since a native app should not be slower to reach first frame than a browser tab loading a PWA | Instrumented timestamp from process start to first successful paint of real content, on the specific target Android-TV-box SKU |
| Playlist item transition latency (image↔image, image↔video) | TBD — target imperceptible (<1 frame at 60fps ideally, definitely <100ms) for a hard cut; crossfade duration is operator-configured and should complete exactly on `transitionDurationMs`, not drift | Frame-timing capture during an automated transition-cycling test |
| Video decoder-contention regression | Zero black-frame occurrences across a long back-to-back video playlist on the lowest-spec target hardware SKU | Long-duration soak test (§Phase 15 device testing), manually reviewed recording |
| Memory over long sessions | No unbounded growth over a 24h+ soak (a slow leak that eventually OOM-kills the process on unattended signage hardware is a severe, hard-to-diagnose-remotely failure mode) | `dumpsys meminfo` sampled periodically during a soak test |
| Storage cache size | Never exceeds the configured cap (§Phase 3) even under continuous new-content churn | Automated eviction-policy test + manual soak verification |
| Theme/Designer2 animation frame rate | No visible jank (target 60fps, or the panel's native refresh rate) during entrance/emphasis animations and ticker/brush scrolling | Flutter DevTools frame-rendering timeline during a representative theme playback |
| Wayfinding gesture responsiveness | Pan/pinch tracks the finger with no perceptible lag (target: no more than 1-frame input latency) | Manual device testing + DevTools input-to-frame latency capture |
| Watchdog force-restart time | From a simulated freeze to the app fully back to active playback, target well under 2 minutes end-to-end | Instrumented native-side timestamp logging around the force-relaunch |

Every "TBD" above must be converted to a concrete number **after** measuring the
existing web player on the actual target hardware during Phase 0/1 — do not invent
target numbers without that baseline, since "as fast as the thing operators already
trust" is the only benchmark this product genuinely needs to hit for v1.

---

## 8. Security review

- **Authentication**: the pairing JWT is a `10y`-expiry bearer token with no
  server-side revocation beyond the explicit `unpair`/`delete` socket-driven flows
  (confirmed in `screens.service.ts`: "its player JWT has no expiry-side revocation").
  Flutter's job is to store it more safely than the web player structurally can
  (§Phase 2 — Keystore-backed secure storage instead of `localStorage`), not to change
  this token model, which is a backend design decision outside this roadmap's scope.
- **Transport**: confirm both the REST base URL and the Socket.IO URL are configured
  to `https`/`wss` in every non-dev flavor (§Phase 1) — a signage box on an
  untrusted/shared network sending its bearer token over plaintext HTTP would be a real
  regression versus a correctly-deployed web player behind TLS.
- **Media URLs**: confirmed no signed-URL-expiry handling exists in the current schema
  (`storage.publicUrl` — plain public URLs, no token/expiry query params observed in
  the inspected code) — Flutter doesn't need to build expiry-refresh logic that the
  backend doesn't issue in the first place; verify this assumption stays true rather
  than building unneeded complexity.
- **Locally cached media**: stored in app-private storage (§Phase 3), inaccessible to
  other apps on a non-rooted device by Android's own sandboxing — no additional
  encryption-at-rest is warranted for signage content that is, by definition, meant to
  be publicly displayed.
- **Logging**: confirm no bearer tokens or full API payloads are ever written to
  logcat/crash-report summaries in plaintext (the existing backend's own `IngestCrashReportsDto`
  caps `summary` at 500 chars specifically as a payload-size guard, but Flutter's crash
  reporter (§Phase 14) must also independently ensure it never logs the Authorization
  header or full response bodies into a crash summary/stack trace it then uploads).
- **DRM**: confirmed absent from the entire codebase — not a requirement, don't build
  it.
- **Kiosk provisioning (§Phase 13.3)**: Device Owner provisioning is itself a
  security-sensitive operation (it grants the app extensive device-management
  authority) — this must be scoped and documented as part of the fleet-provisioning
  process, with the user's explicit sign-off before any production device is
  provisioned this way, since it's a materially different trust model from "just an
  app with normal permissions."

---

## 9. CI/CD & release plan

Mirror the existing monorepo's discipline (per `apps/player`'s own `package.json`
scripts and `Dockerfile`/`nginx.conf` build-and-deploy pattern) rather than inventing
an unrelated pipeline:

- **Checks on every PR**: `flutter analyze` (equivalent of `eslint`), `flutter test`
  (equivalent of the existing test scripts other apps in this monorepo already run in
  CI), `flutter build apk --flavor dev` as a build-validation gate (equivalent of
  `tsc -b && vite build`).
- **Versioning**: semantic app version + monotonically increasing `versionCode`,
  surfaced in the new diagnostics panel (§Phase 14) exactly as the web player's own
  build/deploy story would want a `git describe`-style build identifier — confirm with
  the user what versioning scheme the rest of this monorepo already uses for released
  artifacts and match it rather than inventing a separate scheme.
- **Signing**: production APK/AAB signing keys must be established and stored per the
  user's actual release-infrastructure preference (Play Store internal
  track/managed distribution for fleet devices vs. direct APK sideloading via MDM —
  this is a real open decision requiring the user's input, not something to guess; ask
  before assuming a distribution channel).
- **Environment config**: `--dart-define`-based flavors (§Phase 1) for
  dev/staging/prod API URLs, mirroring the existing `VITE_API_URL`/`VITE_WS_URL`
  build-time-baked-in pattern (`Dockerfile`'s `ARG VITE_API_URL`/`ENV VITE_API_URL`) —
  do not build a runtime-configurable API URL unless the fleet-provisioning story
  specifically requires per-device backend targeting (e.g. multi-tenant on-prem
  deployments), which should be confirmed with the user rather than assumed.
- **Release process**: staged rollout (a small pilot fleet of real signage hardware
  before a wider push) is strongly recommended given how much of this app's
  correctness (Phase 13's native integration especially) is only verifiable on real
  hardware — mirror the caution the existing backend's own "compare-and-swap" pairing
  fix and "never trust a single write without re-checking" patterns already model for
  this codebase's engineering culture.

---

## 10. Milestones

**M1 — Foundation & pairing** (Phases 0–2): app builds, pairs against a real
`apps/api` instance, persists identity across restart. *Acceptance*: a fresh device
pairs and reaches an empty "player" screen with no crashes.

**M2 — Core playback parity** (Phases 3–6): the state-precedence machine, media
caching, and the full `ZonePlayer` engine (including the two new-but-backend-ready
features: crossfade and shuffle) are complete. *Acceptance*: a playlist of images,
videos, text, and documents plays correctly, offline-resilient, on real Android TV
hardware, matching the web player's sequencing.

**M3 — Rich content parity** (Phases 7–8): Themes, Designer2 scenes, layouts/zones,
and every live widget render correctly, including RTL and image adjustments.
*Acceptance*: a screen assigned a Theme or Designer2 Design authored in the existing
dashboard renders recognizably identically to the web player showing the same
assignment.

**M4 — Wayfinding parity** (Phase 9): full kiosk map, directory, routing,
evacuation, and non-touch board. *Acceptance*: gesture feel, routing correctness, and
evacuation behavior verified on real touch hardware against the web player.

**M5 — Networking & fleet surface** (Phases 10, 12, 14): real-time commands,
proof-of-play, screenshot (on-demand + periodic), crash reporting. *Acceptance*: every
dashboard-side remote action works; proof-of-play and crash-report data appears in the
backend for the first time from any player client.

**M6 — Native kiosk hardening** (Phase 13): boot-launch, lock-task, watchdog, display
power, burn-in protection. *Acceptance*: a device left running unattended for 72h+
recovers from a forced crash, never sleeps, never shows an accidental exit path, and
correctly honors its power schedule.

**M7 — Hardening, performance, and production readiness** (Phases 11 (verified N/A),
15, §7–9): full test suite green, performance benchmarks measured and met against
real hardware, security review complete, CI/CD and signing finalized. *Acceptance*:
Definition of Done (§12 below) fully satisfied.

---

## 11. Risk register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Android-TV-box hardware fragmentation (HDMI-CEC availability, OEM launcher/boot quirks, decoder-count limits vary wildly by SKU) | High | High | Identify actual target SKU(s) before Phase 13 begins (§Phase 13's own "must verify" note); build the software fallback path first and treat hardware control as progressive enhancement, never a hard dependency |
| Freeze-watchdog false positives (a legitimately slow but not-actually-frozen operation, e.g. a very large media download, gets force-killed) | Medium | Medium | Tune the heartbeat-miss threshold generously (§Phase 13.4's 45–60s example) and make heartbeat updates independent of any single slow operation (i.e. the heartbeat write itself must never block on network/disk I/O) |
| Image-adjustment fidelity gap between CSS/SVG filters and Flutter shaders (duotone/temperature/tint) | Medium | Medium | Dedicated early spike before estimating Phase 7 (§Phase 7.2); accept a documented, narrow visual-tolerance threshold rather than chasing pixel-exact parity indefinitely |
| `adhan_dart` (or any chosen prayer-time package) diverges from the JS `adhan` package's output | Low–Medium | High (religiously/culturally sensitive if wrong) | Mandatory cross-verification task against published reference tables, not just against the JS library (§Phase 8) |
| Video decoder contention regressions reintroduced during Flutter implementation (the exact bug class the web player's own code comments warn about) | Medium | High | Explicit, named acceptance test (§Phase 6, §Phase 15) reproducing the "many videos back-to-back on low-end hardware" scenario, not just trusting `dispose()` to be sufficient by inspection |
| Backend gaps this roadmap surfaces (remote restart command, volume-schedule schema) block a Phase 13/§0.1 feature | Medium | Medium | Flagged explicitly at the point they're needed (§Phase 13.5, parity matrix footnote); scope and prioritize the small backend additions alongside Flutter work rather than discovering them late |
| Device Owner/kiosk provisioning logistics (must happen at first boot, before any Google account) complicate fleet rollout | Medium | Medium | Treat as a fleet-operations planning task in parallel with Phase 13 development, not an afterthought after the app is "done" |
| `socket_io_client` Dart package version drift vs. the backend's Socket.IO server version causing handshake incompatibility | Low | High (breaks all real-time features at once) | Pin and test against the exact Socket.IO protocol version `apps/api` runs; add an integration test (§Phase 15) that would immediately catch a handshake regression |
| Scope creep into subtitle/track-selection or other generic "video player" features not actually required by this product | Low | Low | §Phase 11 explicitly documents this as N/A; re-confirm against `aboutlumina-player.md` before adding anything not traceable to a line in §1's inventory |

---

## 12. Definition of Done

The Flutter Lumina Player is not complete until **all** of the following hold:

- Every item in §1's complete feature inventory has a shipped, tested Flutter
  implementation — including every item in category **O** (the genuinely new
  native-only requirements), not just the items that had a web reference to copy.
- The §0.2 state-precedence order is implemented exactly and covered by the 16-case
  matrix test (§Phase 4).
- The §4 parity matrix's "Direct" rows have been manually verified side-by-side
  against the live web player for at least one representative real screen
  configuration per row category (playback, layouts, themes, designer2, widgets,
  wayfinding).
- The §4 parity matrix's "New" rows have been verified against real hardware, not
  just unit tests — this specifically includes the freeze watchdog, hardware display
  power (or its documented fallback), burn-in shifting, and boot auto-launch, none of
  which an emulator can meaningfully validate.
- §Phase 15's full test suite (unit, widget, integration) passes in CI, plus the
  documented device-testing pass has been completed on the actual target hardware
  SKU(s).
- §7's performance benchmarks have been measured (not left as TBD) against real
  hardware and meet or beat the equivalent web-player baseline.
- §8's security review items are all confirmed, and the Device Owner
  provisioning decision has explicit user sign-off.
- §9's CI/CD pipeline is green, signing/versioning is finalized with the user's
  actual release-infrastructure decisions (not a placeholder), and at least one
  staged pilot-fleet deployment has run without a Sev-1 regression.
- Every backend-side gap this roadmap identifies as required (remote-restart command,
  §Phase 13.5) has either shipped or been explicitly deferred with the user's
  sign-off, not silently dropped.
- This document itself has been re-read end-to-end against the shipped app and every
  "done" claim in it is, unlike several claims audited in §0.1, actually true.

---

## 13. Final recommended implementation order

1. **Phase 0** (read everything) → **Phase 1** (project shell) → **Phase 2**
   (pairing) — strictly sequential, each is a hard prerequisite for the next.
2. **Phase 4** (state machine, pure logic) should be built and fully unit-tested
   **before** Phase 5/6/7's rendering work begins, even though it's numbered after
   Phase 3 — the state machine has no rendering dependency and de-risks every visual
   phase that follows by nailing the precedence/timing logic first, exactly as this
   document's own Phase 4 write-up insists.
3. **Phase 3** (local persistence/media cache) can be built **in parallel** with Phase
   4 — they're independent until Phase 6 needs both.
4. **Phase 5** (fullscreen shell) and **Phase 6** (core playback engine) come next,
   in that order — Phase 6's item rendering needs Phase 5's container to actually be
   visible on screen, but Phase 6 is the far larger and more critical piece of work.
5. **Phase 7** (Themes/Designer2/Zones) and **Phase 8** (live widgets) can proceed
   **in parallel** once Phase 6 is stable — they share almost no code and touch
   different rendering surfaces, though both depend on Phase 6's `ZonePlayer`
   existing (Theme's PLAYLIST element and Zone's MEDIA type both nest it).
6. **Phase 9** (Wayfinding) is the largest independent unit of work in the whole
   project and can start as soon as Phase 6/8 stabilize (it depends on Phase 8's QR
   widget and shares Phase 6's `ZonePlayer` only for its attract-loop fallback) — 
   given its size and self-contained nature, this is the best candidate for a
   dedicated engineer/workstream running in parallel with Phase 7.
7. **Phase 10** (networking/real-time) should actually be built incrementally
   *alongside* Phases 2–9, not deferred to the end — every phase from Pairing onward
   needs a working `ApiClient`, and Custom Player remote control (part of Phase 10)
   can only be meaningfully tested once Phase 6 exists. Treat "Phase 10" as
   describing a capability that grows continuously, not a single block of calendar
   time that starts after Phase 9.
8. **Phase 12** (proof-of-play) and the crash-reporting half of **Phase 14** should
   start as soon as Phase 6 (for proof-of-play's transition hook) and Phase 1 (for
   crash reporting's global error handler) exist respectively — both are small,
   self-contained, and low-risk to build early rather than late.
9. **Phase 13** (native kiosk hardening) is the phase most dependent on
   hardware-specific research (§Phase 13's "must verify" note) — **start the hardware
   research and target-SKU decision immediately**, in parallel with Phase 0, even
   though the implementation work itself logically comes later, because that research
   has the longest lead time and the most external dependencies (procuring test
   hardware, evaluating OEM capabilities) of anything in this roadmap.
10. **Do not implement** subtitle/track-selection UI (Phase 11) or video-wall sync —
    both are confirmed non-requirements; resist any temptation to add them
    speculatively "since we're building a media player anyway."
11. **Parity testing** (§4's matrix) should begin the moment each individual
    phase's "Direct" rows are implemented, not batched to the end — the whole value
    of having a live, working web-player reference is continuous side-by-side
    comparison, not a single final regression pass.
12. **Performance testing** (§7) begins in earnest once Phase 6 is stable (video
    decoder-contention is the single highest-risk performance item and must be
    caught early, not discovered during final hardening) and continues through every
    subsequent phase as a standing check, not a one-time gate at the end.
13. **Production hardening** (§8 security, §9 CI/CD, staged pilot rollout) begins
    once M6 (§10) is reached, and should overlap with M7's final test-suite/
    benchmark work rather than waiting for it to fully complete first — signing/
    provisioning/fleet-logistics decisions (§9, §13's Device Owner note) have their
    own lead time with the user and should be raised well before they become
    blocking.
14. Architectural decisions that **must** happen before any other code is written:
    state-management choice (§2.2 — settled here as Riverpod, but confirm with the
    user before treating it as final if they have an existing organizational
    preference), media-engine choice (§3.1 — settled as `video_player`), local-DB
    choice (§Phase 3 — settled as `drift`). Revisiting any of these after Phase 6 is
    substantially built would be expensive; they are deliberately front-loaded into
    this section precisely so they're decided once, early, and not re-litigated
    mid-project.

---

## 14. Maintaining `status.md`

Whichever AI session (or developer) implements this roadmap must maintain a separate
file, **`status.md`**, at the repository root, alongside this document. Its purpose is
to be the single, always-current explanation of **how the running system actually fits
together** — pairing, real-time connectivity, media/state loading, scheduling,
playback, and every other subsystem this roadmap covers — described as it exists *right
now* in the code, not as a restatement of this roadmap's plan.

**Rules for `status.md`**:

- **Only touch it after finishing a step or a phase** — not mid-task, not after every
  file edit. It should read like a settled snapshot of working behavior, not a live
  scratchpad of in-progress work. Finish the unit of work first (a task, a phase, a
  milestone from §10), verify it, then update the file to reflect the new reality.
- **Describe how things connect, end to end**, in plain language a new engineer (or a
  future AI session with no memory of this conversation) could read cold and
  understand: how a device pairs and what it stores; how the real-time socket
  connection is established, authenticated, and recovers from a drop; how state/
  playlists/media are fetched, cached, and resolved into what's actually on screen;
  how scheduling, emergency takeover, and power windows interact; how playback
  advances through a playlist; how the native kiosk/watchdog/power-control pieces fit
  around the Flutter app; and so on for every subsystem that exists so far.
- **Reflect what's actually implemented, not what's planned.** If a phase from this
  roadmap hasn't been built yet, `status.md` should either omit it entirely or say so
  explicitly — never describe planned-but-unbuilt behavior as if it already works.
  This document (`aboutlumina-player.md`) is the plan; `status.md` is the truth about
  the current state of the code, and the two must never be allowed to drift into
  contradicting each other silently.
- **Update it, don't rewrite it from scratch, each time** — treat it the same way this
  roadmap treats existing requirements: extend and correct, don't discard prior
  sections that are still accurate just because new ones are being added.
- The first version of `status.md` should be created once Phase 1 (project
  foundation) is complete, even if it only describes the project shell at that point
  — starting it early means it grows accurately alongside the app instead of being
  reconstructed from memory at the end.
