# Screen Display Settings — Android Player Implementation Guide

Audience: the Android player team. Purpose: implement the same rendering behavior the web
player (`apps/player`) already ships for `Screen.orientation` and the new `Screen.aspectRatio`,
so a given screen looks identical regardless of which player renders it.

Reference implementation (read this if anything below is ambiguous):
`apps/player/src/pages/PlayerPage.tsx` — functions `FullscreenContainer`, `letterboxSize`, and
the `ASPECT_RATIO_PARTS` constant, near the bottom of the file.

---

## 1. What changed

Two screen-level display settings, both configured by the org admin in the dashboard
(Screens page → a screen's card → **Settings** tab → **Display & Screen Settings**):

| Setting | Field | Values | Default | Status |
|---|---|---|---|---|
| Orientation & Rotation | `orientation` | `0 \| 90 \| 180 \| 270` | `0` | Already existed; web player already implements it |
| Aspect Ratio | `aspectRatio` | `"16:9" \| "9:16" \| "stretch"` | `"16:9"` | **New** — not yet consumed by any player |

`orientation` is how many degrees clockwise the physical panel is mounted relative to its
natural orientation (e.g. a landscape 16:9 panel rotated 90° to run portrait content).
`aspectRatio` is the *intended* content proportions for that mounting: `"16:9"` or `"9:16"`
letterbox/pillarbox content to preserve that shape if the real panel doesn't match it exactly,
while `"stretch"` forces content to fill the panel edge-to-edge with no bars, distortion
accepted. The dashboard auto-suggests `"9:16"` when orientation is 90°/270° and `"16:9"` when
it's 0°/180°, but the admin can always override to `"stretch"` (or the "wrong" ratio for the
orientation, if that's genuinely what they want) — **don't assume the pairing implied by the
auto-suggest; always render exactly what the field says.**

These are independent of each other and both independent of the physical device's native pixel
resolution/aspect ratio — do not infer one from another.

---

## 2. Where these values come from

Both fields are already flowing through the API today — no backend work needed on your end.

- `GET /player/state` (used for the initial load and every periodic refresh) returns them as
  top-level fields on the response body:

  ```json
  {
    "screenId": "...",
    "orientation": 90,
    "aspectRatio": "9:16",
    "streamingType": "PLAYLIST",
    "...": "..."
  }
  ```

- **Live updates**: whenever an admin changes either setting, the backend pushes a
  `{"type": "publish"}` message over the existing screen socket channel (same one you already
  use for reload/clear-cache/etc — see `ScreensService.setOrientation` /
  `ScreensService.setAspectRatio` in `apps/api/src/modules/screens/screens.service.ts`). On
  receipt, re-fetch `/player/state` and re-render — don't wait for your next polling interval,
  and don't require an app restart. The web player's handling of this is in `PlayerPage.tsx`
  around the `sock.on('command', ...)` block: a `publish` command just re-runs the same
  state-load-and-apply path used on startup.

- **Defaults / missing field**: every `Screen` row already has `aspectRatio` defaulted to
  `"16:9"` at the database level (migration `20260827063845_add_screen_aspect_ratio`), so a
  live `/player/state` response will always include it. The only case where it could be absent
  is a **locally cached** state object saved by an older build of your app before this field
  existed. Treat a missing/unrecognized `aspectRatio` the same as `"stretch"` (i.e. fall back to
  today's full-bleed-fill behavior) rather than crashing or defaulting to a hard letterbox — an
  unexpected letterbox on an old cached screen is a worse failure mode than an unexpected
  stretch, since stretch is what every device has always rendered until now.

---

## 3. Rendering algorithm

This runs in two independent stages, applied to the **entire render surface** (not per zone, per
theme element, or per media item — the two stages here are display-level, applied once at the
top of the render tree, exactly the way `FullscreenContainer` wraps *everything* the web player
renders: playlists, themes, layouts, wayfinding views, splash/status screens, all of it).

Everything that currently renders "fill 100% of my parent" (a layout zone positioned by
percentage, a theme element, an image with `object-fit`, a video) needs **no changes** — it
already fills whatever box it's given. You only need to change what box that top-level surface
*is*.

### Stage 1 — Orientation (rotate the whole surface)

This part likely already works if you're rendering into a full-screen view and just haven't
wired the `orientation` field in yet. The rule:

1. Take the device's real screen size: `deviceW × deviceH`.
2. If `orientation` is 90 or 270 ("sideways"), the box you render into — *before* rotation —
   needs its width/height swapped relative to the device: `boxW = deviceH`, `boxH = deviceW`.
   Otherwise (0 or 180): `boxW = deviceW`, `boxH = deviceH`.
3. Center that `boxW × boxH` box on the device screen and rotate it `orientation` degrees
   clockwise about its own center.

Net effect: at 90°/270°, a landscape panel's box is pre-swapped to portrait dimensions, then the
rotation lays it back out to exactly fill the real (landscape) device bounds with no gaps or
overflow. Everything in stage 2 below happens **inside** this already-rotated `boxW × boxH`
box, working entirely in the box's own (pre-rotation) coordinate space — it does not need to
know rotation happened at all.

Reference: `FullscreenContainer`'s outer two `<div>`s in `PlayerPage.tsx` (the CSS
`transform: rotate(...)` on a box whose width/height are conditionally swapped by
`sideways = orientation === 90 || orientation === 270`).

### Stage 2 — Aspect ratio (letterbox / pillarbox / stretch, inside the box from Stage 1)

Given the Stage-1 box (`boxW × boxH`, already accounting for orientation) and `aspectRatio`:

- **`"stretch"`** (or missing/unrecognized): the content area is the full `boxW × boxH`. No
  further work — this is what every player has always done.

- **`"16:9"` or `"9:16"`**: compute the *largest* box of that exact ratio that fits inside
  `boxW × boxH` without exceeding it in either dimension (i.e. `contain`-style fit, same idea as
  `object-fit: contain` but applied to an entire content area, not a single image/video), then
  center it. Fill the leftover space (letterbox bars above/below, or pillarbox bars left/right)
  with solid black — matching the rest of the player's background, so bars are invisible against
  it rather than looking like a visible seam.

  Exact formula, given target ratio `W:H` (16:9 or 9:16) and the Stage-1 box `boxW × boxH`:

  ```
  contentW = min(boxW, boxH * W / H)
  contentH = min(boxH, boxW * H / W)
  ```

  Then center that `contentW × contentH` rect inside `boxW × boxH`. This is the same min-based
  "fit the largest same-ratio box that fits" computation the web player does with a single CSS
  `min()` expression per axis (`letterboxSize()` in `PlayerPage.tsx`) — the formula is
  unit-agnostic, so it translates directly to `Canvas`/`View` layout math, or to Compose
  `Modifier.aspectRatio()` combined with a bounding constraint, whichever your rendering stack
  uses.

  **Everything your app currently renders — layout zones, theme elements, playlists, wayfinding
  views, splash screens — needs to end up inside this `contentW × contentH` rect**, not the full
  `boxW × boxH` box. Any full-screen overlay chrome that isn't "screen content" (e.g. a
  volume/mute indicator, a debug/status overlay, if you have anything analogous to the web
  player's `PlayerControlPanel`/`SoundLockedIndicator`) should stay anchored to the full
  `boxW × boxH` box instead, so it's always reachable in a fixed corner of the physical screen
  rather than potentially sitting inside a black bar. See how `ClockOverlay`, `SoundLockedIndicator`, and
  `PlayerControlPanel` are siblings of the letterboxed content div in `FullscreenContainer`,
  not children of it.

---

## 4. Testing checklist

1. Pair (or use an already-paired) test screen against the dev/test API.
2. In the dashboard: Screens page → the screen's card → **Settings** tab → **Display & Screen
   Settings** → change the **Orientation & Rotation** dropdown. Confirm your player rotates
   within a few seconds (via the socket `publish` push — no manual refresh or app restart
   should be needed).
3. Same panel → change **Aspect Ratio** through all three values (`16:9`, `9:16`,
   `Stretch to Fit`) while a real playlist/layout/theme is actively playing. Confirm:
   - `Stretch to Fit` fills the whole screen exactly as today (no regression).
   - `16:9`/`9:16` show correct letterbox/pillarbox bars sized per the formula above, and the
     bars are solid black with no visible seam or flicker.
4. Cross-check a few orientation × aspect-ratio combinations together (e.g. `90°` + `9:16`
   should end up with **no visible bars** on a native-16:9 panel, since a 16:9 panel rotated 90°
   already produces a 9:16-shaped box — bars should only appear when the selected ratio doesn't
   match what the rotated device box naturally is).
5. Kill and relaunch the app with the *last-cached* state from before you shipped this to confirm
   the missing-`aspectRatio` fallback behaves as "stretch," not a crash or unexpected letterbox.

---

## 5. Open items for you to decide on your platform

- Whether the letterbox bars can be animated (crossfade) on a live aspect-ratio change while
  content is playing, or a hard cut is acceptable — the web player does a hard cut (React
  re-render), no transition.
- Where exactly your "full `boxW × boxH` box" chrome (status/debug overlays, if any) should
  anchor — pick a corner that's realistic to reach on all four orientations.

Ping the platform team (dashboard/API) if the data contract in §2 doesn't match what you're
actually seeing from `/player/state` — that would be a bug on our side, not something to work
around on yours.
