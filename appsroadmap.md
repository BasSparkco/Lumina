# Apps in Playlists — Roadmap

## Goal

Let a playlist mix your own assets (images/videos/etc.) with "apps" — embedded
content from external services, starting with YouTube. New apps should be
addable later **without shipping a new build of the player** (the "Android
app" — in reality the `apps/player` PWA that runs on the signage device).
Player code should only need to change once, when we build the generic
embed-rendering path in Phase 3. After that, adding a new app is a
backend/dashboard-only change.

## Current state (confirmed in code)

- `Playlist` → `PlaylistItem` (`apps/api/prisma/schema.prisma`) → each item
  points at one `Asset` (required FK). There's no type field on
  `PlaylistItem` itself — type lives on `Asset.type`
  (`IMAGE | VIDEO | AUDIO | TEXT | DOCUMENT`).
- `apps/player/src/components/ZonePlayer.tsx` iterates a playlist and
  switches rendering by `item.asset.type`. This is the single file that
  drives what the device actually displays, and the one place Phase 3 needs
  to touch.
- No embed/oEmbed/iframe/YouTube code exists anywhere in the repo today.
- `apps/player` is a Vite PWA (service worker + manifest, no Capacitor/native
  wrapper found) — "the Android app" is this PWA running in a
  browser/kiosk on the device, not a separate native codebase. One deploy of
  `apps/player` reaches every device.

## Key design decision: apps are just another Asset type

Rather than changing the `Playlist`/`PlaylistItem` schema, model an "app" as
`Asset.type = APP`, with `appProviderId`, `sourceUrl`, and an `appConfig`
Json blob instead of a `storageKey`. This mirrors how `TEXT` assets already
store content instead of a file. Consequence: playlist ordering, drag
reorder, duration, and mixing "just work" for free, since `PlaylistItem`
already treats every item generically.

## Known constraint to design around

Not every service allows plain `<iframe>` embedding. YouTube/Vimeo do.
Others (Instagram, TikTok, X/Twitter) require their own embed JS widget
rather than a bare iframe, and some sites block framing outright via
`X-Frame-Options`/CSP and can't be embedded at all. So "share anything from
any app" has a ceiling — the roadmap below builds one generic renderer that
covers iframe-embeddable providers, and treats widget-script providers as a
(still generic, but separate) renderer path. This gets called out again in
Phase 3.

## Phases

### Phase 0 — Provider registry pattern (backend)
Define a small internal registry: each supported app is `{ id, name, icon,
inputKind: 'url', renderKind: 'iframe' | 'script', resolver }`. This is the
thing future "add a new app" work touches — never the player.

### Phase 1 — Data model
Prisma migration:
- `AssetType` enum: add `APP`.
- `Asset`: add nullable `appProviderId String?`, `sourceUrl String?`,
  `appConfig Json?` (resolved oEmbed metadata: title, thumbnail, embed
  url/html, aspect ratio, native duration if any).
- No changes to `Playlist`/`PlaylistItem`.

### Phase 2 — Backend API
- `GET /apps/providers` — list registered providers, for the modal.
- `POST /apps/resolve` — given `providerId` + `sourceUrl`, validate the URL
  against that provider, resolve embed metadata (oEmbed call server-side),
  return a preview (title/thumbnail) without creating anything yet.
- `POST /assets/apps` — create the `Asset` (type `APP`) from a resolved
  provider + URL, so it can be added to a playlist like any other asset.

### Phase 3 — Player: the one-time update
Add a generic `AppEmbed` renderer to `ZonePlayer.tsx`'s type switch:
- `renderKind: 'iframe'` → sandboxed `<iframe>` from the resolved embed URL.
- `renderKind: 'script'` → generic widget-script mount point (covers
  Instagram/TikTok-style embeds) — same component family, loads the
  provider's widget script and mounts its markup.
- Generic advance-timer logic using `durationSecs` from the `PlaylistItem`
  (same as `IMAGE`/`TEXT` today), since iframes don't reliably expose an
  `onEnded` event the way `<video>` does.

This ships once. Every provider added afterward (Phase 5+) reuses one of
these two render paths — no further player deploys required, which is the
"update the Android app only once" requirement.

### Phase 4 — Dashboard UI
- In the playlist editor, add an **Apps** button directly above
  **+ Add Item**.
- Clicking it opens a modal listing all providers from the registry (grid,
  icon + name; YouTube enabled, others can be listed as "coming soon").
- Selecting a provider shows its input form (e.g. paste a YouTube URL),
  calls `/apps/resolve` for a live preview, then `/assets/apps` to create
  the asset and append it to the playlist — same list the regular
  "+ Add Item" asset picker appends to, so ordering/mixing is automatic.

### Phase 5 — First provider: YouTube
Implement the YouTube resolver using YouTube's oEmbed endpoint (no API key
needed for title/thumbnail/embed URL). `renderKind: 'iframe'`.

### Phase 6 — Add more providers (no player changes)
Each new app = one registry entry + one resolver function on the backend +
an icon/label in the dashboard modal. Candidates: Vimeo, SoundCloud, Spotify
(all iframe-embeddable). Instagram/TikTok would use the `script` render path
already built in Phase 3.

### Phase 7 (stretch) — Arbitrary URL fallback
A "Custom link" option in the Apps modal for providers not in the registry:
attempt generic oEmbed discovery, else fall back to bare iframe, and
clearly surface when a site refuses to be framed (can't be fixed client
side — it's the target site's own header).

## Open questions
- Do we need YouTube playback controls/autoplay behavior configurable per
  item, or just "loop the embed for `durationSecs` like an image"?
- Any content moderation/allowlist needed on which URLs staff can add?
- Sandboxed iframe permissions (`allow="autoplay"` etc.) — signage devices
  typically run muted/unattended, needs testing on the actual device.
