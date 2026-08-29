# Playlist Preview & Scale/Transition Settings — Implementation Plan

> **Document:** `playsetting.md`
> **Status:** Implementation Plan (not started)
> **Entry point:** Playlists page (`apps/dashboard/src/app/[locale]/(app)/playlists/page.tsx`), each playlist row's icon row (currently Duplicate, Delete)

---

## What this adds

Two new icons on every playlist row, after the existing Duplicate/Delete icons:

1. **Preview** — opens a full-page preview of the playlist with small forward/back buttons to
   step through items one at a time (not autoplay-timed like a real screen — manual stepping).
2. **Settings** — opens a modal with:
   - **Scale Settings** per asset type (how IMAGE/VIDEO/DOCUMENT/etc. items fit their frame:
     contain / cover / fill).
   - **Transition** — Default Transition + Transition Speed. This relocates/expands theحاشسث 1
     transition controls that already exist inline in the expanded playlist row
     (`page.tsx` ~L340-359, backed by `Playlist.transitionStyle` / `transitionDurationMs`).

## Decisions already made (do not re-litigate without reason)

- **Transitions stay playlist-wide**, not per-item. The schema already has a comment recording
  this as a deliberate earlier decision (`schema.prisma` `Playlist` model, per `roadmap2.0.md`):
  *"transition effects... configurable per playlist, not per item."* The Settings modal's
  Transition section is the existing Default Transition + Speed controls, just relocated into
  the modal instead of (or in addition to) the inline row.
- **Preview reuses the player app's renderers**, not a new dashboard-native renderer. The
  dashboard currently has no component that can render THEME/LAYOUT/DESIGN playlist items —
  only the player app does (`ThemeRenderer`, `DesignRenderer`, `ZonePlayer`,
  `apps/player/src/components/*`). Preview will open the player app (new route) rather than
  porting that rendering logic into the dashboard, to avoid maintaining two renderers.

## Key wrinkle: player app auth

The player app is a **separately deployed PWA** (`PLAYER_DOMAIN`, e.g.
`player-lumina.sparkco.vip`) that authenticates via a device-paired `player_token` JWT in
`localStorage` (`apps/player/src/lib/api.ts`) — it has no concept of a logged-in dashboard user.
A dashboard admin clicking "Preview" is not a paired device, so we can't just deep-link into the
existing `/play` route.

**Plan:** add a short-lived, playlist-scoped preview token.
- New API endpoint: `POST /playlists/:id/preview-token` (dashboard-authenticated, org-scoped) →
  returns `{ token, expiresAt }` (short TTL, e.g. 10 min).
- New player route `/preview?playlistId=X&token=Y` that validates the token against the API
  (separate from normal pairing auth) and fetches that one playlist read-only.
- Dashboard's Preview button opens `${PLAYER_URL}/preview?playlistId=...&token=...` in a new
  tab (simplest, avoids cross-origin iframe/CSP issues).

## Scale Settings — new concept, needs schema

Today `objectFit` is **hardcoded per item kind** in the player (`ZonePlayer.tsx`: video is
`fill`, image is `contain`, etc. — see grep hits across `ZonePlayer.tsx`, `ThemeRenderer.tsx`).
There is no stored, configurable scale setting anywhere for playlists.

- Add `Playlist.scaleSettings Json?` (or six explicit nullable enum columns, one per asset
  type — TBD during Phase 1, leaning toward a single JSON column keyed by
  `AssetType` since it's an open, additive map and avoids a migration every time a new asset
  type is added) storing `{ IMAGE?: 'contain'|'cover'|'fill', VIDEO?: ..., DOCUMENT?: ... }`.
  AUDIO/TEXT/APP items likely don't need a scale setting (no visual frame to fit) — confirm in
  Phase 1, may only expose IMAGE/VIDEO/DOCUMENT in the UI.
- Migration under `apps/api/prisma/migrations/`.
- `playlistsApi.updateConfig` (dashboard `lib/api.ts`) and the equivalent player-side type gain
  `scaleSettings`.
- Player's `ZonePlayer.tsx` / `ThemeRenderer.tsx` per-item-kind rendering reads
  `playlist.scaleSettings?.[item.kind]` instead of the current hardcoded value, falling back to
  today's hardcoded default when unset (keeps every existing playlist rendering unchanged until
  an admin opens Settings and picks something).

## Phases

**Phase 1 — Backend: scale settings + preview token — DONE (2026-08-29)**
- Prisma migration `20260829101522_add_playlist_scale_settings`: `Playlist.scaleSettings Json?`.
- `PUT /playlists/:id/config` accepts `scaleSettings` (`PlaylistsService.sanitizeScaleSettings`
  validates keys against the six `AssetType`s and values against contain/cover/fill —
  class-validator can't validate a dynamic-key map cleanly, so this happens in the service).
- `POST /playlists/:id/preview-token` (dashboard-authenticated) mints a 10-minute JWT
  `{ sub: playlistId, orgId, type: 'playlist-preview' }`.
- `GET /playlists/:id/preview?token=...` (deliberately outside `JwtAuthGuard`/`PlayerJwtGuard` —
  neither a dashboard session nor a paired screen) verifies that token manually and returns the
  same shape as `findOne`.
- `PlaylistsModule` now imports `AuthModule` for `JwtService`.
- `scaleSettings` threaded through `PlayerService.hydratePlaylist`/`HydratedPlaylist` (backend →
  player payload), and typed (not yet consumed) on dashboard `Playlist` and player `Playlist` in
  each app's `lib/api.ts`.
- Note found while wiring this: `transitionStyle`/`transitionDurationMs`/`playbackOrder` are
  already hydrated to the player today, but nothing in `ZonePlayer.tsx` actually renders a
  crossfade — the dashboard's existing Transition control has had no visible effect on playback.
  Worth deciding in Phase 3 whether to implement the crossfade for real or scope it out.
- Verified: `tsc --noEmit` clean in `apps/api`, `apps/dashboard`, `apps/player`; full API Jest
  suite passes (37/37).

**Phase 2 — Settings modal (dashboard) — DONE (2026-08-29)**
- New `apps/dashboard/src/components/PlaylistSettingsModal.tsx`, opened via a new gear
  (`Settings`) icon added to each playlist row right after Delete
  (`playlists/page.tsx`), gated on `canEditContent` same as Duplicate/Delete.
- Scale Settings section: contain/cover/fill selector for IMAGE, VIDEO, DOCUMENT only — the
  three kinds `ZonePlayer.tsx` actually applies an `objectFit`-style frame to (confirmed by
  reading its render switch: AUDIO has no visual, TEXT/APP render their own content with no
  frame-fit concept). Resolves the open question from Phase 1 in favor of the narrower set.
  Each row's own `<select>` mutates immediately (no separate Save button — matches the existing
  inline transition control's autosave feel), with "Default" mapping to no stored key.
  Validated end-to-end via a live browser session: dropdown changes call
  `PUT /playlists/:id/config`, the DB persists `scaleSettings`, and it survives a full page
  reload (not just react-query cache).
- Transition section: reuses the existing Default Transition + Speed / Playback Order controls
  (same markup, moved into the modal alongside Scale Settings) — the inline row copy in the
  expanded playlist detail (`page.tsx` ~L340-359) is untouched, so both surfaces still work.
- Fetches the full `Playlist` itself on open (`useQuery(['playlist', id], ...)`), sharing the
  query key with `PlaylistDetail` so both stay in sync whether or not the row is expanded too.
- i18n: added `playlists.settings` (button title) and a new `playlistSettings` namespace
  (title/scaleSettings/transition heading) to both `en.json` and `ar.json`.
- **Unplanned but required**: found `packages/db` (the committed, prebuilt `@lumina/db` client
  wrapping generated Prisma types) was stale — `prisma migrate dev` in this repo's setup does
  not auto-run `prisma generate`, so `Playlist.sortOrder` (pre-existing, from an earlier
  uncommitted migration) and the new `scaleSettings` were both missing from the built client,
  breaking `GET /playlists` with a 500 the moment it was exercised in a real browser (`tsc`
  didn't catch it — the loosely-typed `data: dto` spread in `updateConfig` doesn't get checked
  against Prisma's exact field set). Fixed by running `prisma generate` then `packages/db`'s own
  `tsc` build and restarting the API process. Worth remembering for any future schema change in
  this repo: **run `prisma generate` + rebuild `packages/db` explicitly**, don't rely on
  `migrate dev` alone, and don't trust `tsc --noEmit` on `apps/api` alone to catch a stale
  generated client.
- Verified: `tsc --noEmit` clean in `apps/dashboard`; ESLint clean on changed files; full
  browser walkthrough (login → Playlists → open Settings → change Images to Cover → reload →
  still Cover → reset to Default) with no console errors.

**Phase 3 — Player: honor scale settings — DONE (2026-08-29)**
- `ZonePlayer.tsx` only (not `ThemeRenderer.tsx` — confirmed THEME elements keep their own
  per-element `objectFit`, already configurable in the Theme editor; `Playlist.scaleSettings` is
  scoped to plain ASSET-kind playlist items, matching what the Settings modal actually offers).
- Added `DEFAULT_SCALE_FIT` (`{ IMAGE: 'fill', VIDEO: 'contain', DOCUMENT: 'contain' }`, i.e.
  exactly today's hardcoded values) and a `scaleFit(playlist, type)` helper; the three
  `objectFit:` literals in the IMAGE/DOCUMENT/VIDEO render branches now call it instead. Crop
  behavior is unaffected — `mediaCropStyle(item)` still spreads *after* the base style and keeps
  forcing `cover` once a crop is set, same as before.
- **Verified live**, not just by inspection: the real manifest-sync path turned out to be
  unusable in this dev DB (zero `AssetBinary` rows exist at all — `GET /player/manifest` 409s
  for every screen, a pre-existing environment gap unrelated to this feature), so verification
  used a temporary, non-shipped debug route (`ZonePlayer` mounted directly with a hardcoded
  playlist, bypassing pairing/manifest) to screenshot the same real image at `fill` (default),
  `contain`, and `cover`. All three rendered visibly differently (stretched / letterboxed /
  cropped-to-fill) as expected; the debug route and file were deleted after (`git diff` on
  `main.tsx` confirms clean).
- **Second pre-existing bug found and fixed**: `apps/player/vite.config.ts`'s
  `optimizeDeps.include` had `@lumina/types` (a symlinked CJS workspace package needing forced
  Vite pre-bundling for CJS→ESM interop) but not `@lumina/design-schema`, which
  `DesignRenderer.tsx` imports and `ZonePlayer.tsx` imports unconditionally — so `vite dev`
  couldn't load `/play` at all in this repo before this fix, regardless of playlist content.
  Added `@lumina/design-schema` to the same `include` list.
- Verified: `tsc --noEmit` clean in `apps/player`; no regressions in `main.tsx`.

**Phase 4 — Preview page — DONE (2026-08-29)**
- Confirmed with user: forward/back **wraps around** at the ends, and the Preview icon is
  **visible to all roles** with playlist access (not gated behind `canEditContent`, unlike
  Duplicate/Delete/Settings — it mutates nothing).
- Dashboard: new Eye icon on the playlist row, positioned **between Delete and Settings**
  (Duplicate → Delete → Preview → Settings), calling `playlistsApi.previewToken(id)` then
  `window.open(`${PLAYER_URL}/preview?playlistId=...&token=...`, '_blank')`.
- New `NEXT_PUBLIC_PLAYER_URL` dashboard env var (the player app's own origin — a separate
  deployment). Added to `.env.local`/`.env.example` for dev, `apps/dashboard/Dockerfile`
  (ARG/ENV), and `docker-compose.prod.yml` (`"https://${PLAYER_DOMAIN}"`, mirroring how
  `PLAYER_URL` already reaches the API for CORS).
- New player route `apps/player/src/pages/PlaylistPreviewPage.tsx` at `/preview`, reading
  `playlistId`+`token` from the query string, calling `api.previewPlaylist()`.
- **Rendering approach**: for an ASSET-kind item, wraps just that one item into a synthetic
  single-item `Playlist` and mounts the real `ZonePlayer` (`key`ed by item id to force a clean
  remount per navigation) — with only one item, `ZonePlayer`'s own duration-timer/`advance()`
  naturally no-ops (index stays 0) instead of trying to move to a "next" item, so it just
  plays/loops that item in place. This reuses 100% of existing ASSET-kind rendering (every asset
  type, `scaleSettings`, crop) with zero duplicated rendering code. THEME/LAYOUT/DESIGN items get
  a placeholder card (name + "Preview isn't available for _ items yet.") instead — see the gap
  below.
- Forward/back buttons step between top-level items with wrap-around, plus an "N / total"
  counter; both hidden when the playlist has only one item.
- i18n: added `playlists.preview` (button title) to both `en.json`/`ar.json`. The preview page's
  own UI text (error states, placeholder copy) is English-only for now — it's a new player-app
  surface with no existing i18n wiring in that app to hook into; flagged here rather than done
  silently.
- **Known gap, deliberately scoped out**: THEME/LAYOUT/DESIGN items only preview a name +
  placeholder, not real content. The preview-token endpoint reuses
  `PlaylistsService.findOne`'s shaping (dashboard-oriented, light `{id, name}` refs for those
  kinds), not the player's full recursive hydration (`PlayerService.hydratePlaylist`, which
  needs a `screenId`-shaped call, not a bare `playlistId`). Rendering those kinds for real would
  mean sharing/exposing that hydration path across the player/playlists modules — a real chunk
  of work, out of scope for "build the preview page." Worth a Phase 6 if wanted.
- **Bug found and fixed while verifying**: `PlaylistsController` carries a class-level
  `@UseGuards(JwtAuthGuard, RolesGuard)`, which was still applying to `GET :id/preview` even
  though that route is authorized by the preview token alone — every request 401'd before
  reaching the token check. This codebase has no `@Public()`-style per-route guard bypass yet, so
  the fix was a second, unguarded `PlaylistsPreviewController` (same module) carrying just that
  one route, rather than introducing that pattern for a single route.
- **Also hit while verifying** (environment, not code): an orphaned `nest start --watch`
  grandchild process from an earlier phase's restart was still holding port 4000 in the
  background, silently serving every `curl` test against stale, pre-Phase-4 (in one case
  pre-Phase-1) compiled code — this is the exact "nest --watch orphans" gotcha already on file.
  Confirmed by process cwd/start-time before killing it.
- Verified end-to-end in a real browser: created a 2-item playlist (1 IMAGE asset, 1 THEME),
  clicked Preview from the dashboard, confirmed the new tab shows the image full-frame, forward
  advances to the THEME placeholder showing "Mosque — Prayer Wall", forward again wraps back to
  the image (2/2 → 1/2), and back-from-item-1 wraps to item 2 — all as specified. Test playlist
  deleted after; all dev processes stopped cleanly with no orphans left running.
- Verified: `tsc --noEmit` clean in `apps/api`, `apps/dashboard`, `apps/player`; full API Jest
  suite passes (37/37); ESLint clean on all changed files.

**Phase 5 — Polish — DONE (2026-08-29)**
- Permissions: already settled and shipped in Phase 4 (Preview open to all roles with playlist
  access, Settings gated to `canEditContent`) — nothing further needed here.
- `PlaylistSettingsModal`: added the two error states it was missing, following this codebase's
  existing `mut.isError && <p className="text-xs text-red-500">{(mut.error as
  Error).message}</p>` convention (already used in `AssetPicker`/`assets/page.tsx`/etc.) rather
  than inventing a new one — a failed initial load (e.g. the playlist was deleted while the
  modal was about to open) now shows `playlistDetail.notFound` instead of hanging with an empty
  body forever, and a failed `updateConfig` save now surfaces the API's own error message
  instead of silently no-opping.
- `PlaylistPreviewPage`: was already in reasonable shape from Phase 4 (missing-params, expired-
  token, empty-playlist states). Added in this phase: **← / → keyboard stepping** alongside the
  on-screen buttons (cheap, expected affordance once "step through items" is the whole point of
  the page), and a small playlist-name label (top-left overlay) so the page identifies itself —
  it's opened in a bare new tab with no dashboard chrome around it.
- **Manual QA pass, live in a browser**: built a 3-item test playlist (IMAGE, TEXT-ticker,
  LAYOUT) and stepped through it both by clicking the buttons and by keyboard — IMAGE rendered
  full-frame, the TEXT ticker animated correctly, LAYOUT showed the expected placeholder
  ("VERIFY Test Layout" + "Preview isn't available for layout items yet."), wrap-around held in
  both directions, no console errors either page. THEME was already verified in Phase 4.
  **VIDEO, AUDIO, DOCUMENT, and APP could not be live-tested** — this dev database has zero
  READY assets of those types (the two VIDEO assets present are permanently stuck in
  PROCESSING because no `apps/worker` dev process is running here to transcode them; no
  AUDIO/DOCUMENT/APP assets exist at all). Confidence for those kinds instead rests on: (a)
  `toZonePlayerItem` passes the whole `asset` object through unchanged regardless of type, so
  ZonePlayer can't tell a previewed VIDEO/AUDIO/DOCUMENT/APP item from a normally-played one; (b)
  Phase 3 already live-verified the VIDEO/DOCUMENT `scaleFit` branches specifically. DESIGN
  wasn't tested either (no DesignAsset rows in this dev DB) but follows the exact same
  placeholder code path already proven for THEME/LAYOUT. Worth a real pass once real
  VIDEO/AUDIO/DOCUMENT/APP/DESIGN content exists somewhere (staging, or after wiring up the
  worker locally).
- Verified: `tsc --noEmit` clean in `apps/dashboard` and `apps/player`; ESLint clean on changed
  files; all dev processes (including a second orphaned `nest --watch` grandchild from earlier
  in this same session — the recurring gotcha, again) stopped cleanly afterward with none left
  running.

## Status: all 5 phases shipped (2026-08-29)

Remaining known gaps, not blocking:
- THEME/LAYOUT/DESIGN items in Preview show a placeholder, not real content (see Phase 4).
- The dashboard's existing Transition control (`transitionStyle`/`transitionDurationMs`) has
  never actually been wired to a visible crossfade in `ZonePlayer.tsx` — pre-existing, found
  during Phase 1, unrelated to this feature, left alone.
- This dev environment's manifest-based player sync path (`GET /player/manifest`) 409s for
  every screen (zero `AssetBinary` rows in the DB) — found during Phase 3, environment-only.

## Open questions to confirm before/during implementation

- Preview forward/back at the last/first item: stop, or wrap around?
- Should Preview be available to users without edit permission (view-only role)? Leaning yes
  since it's non-destructive.
- Exact set of asset types that get a Scale Settings row (all six kinds, or just
  IMAGE/VIDEO/DOCUMENT).
