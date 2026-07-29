# Editor features — Themes & Layouts parity + safety/UX upgrades

> Working doc for a batch of editor requests (2026-07-28). Both `/themes` and `/layouts` in the
> dashboard are canvas editors built on `react-rnd` with very similar (but drifted) mechanics.
> This file tracks bringing them to parity and adding: real shapes, a working `editable` lock,
> layering controls, a "click to select before you can edit" safety mode (default on) with a
> Settings toggle, hover-reveal bounding boxes, and fixing the video-thumbnail bug in the asset
> library.

Legend: ☐ todo · ◐ in progress · ☑ done

---

## 0. Investigation

- ☑ Root cause: `@ffprobe-installer` binary lost its executable bit in this environment
  (`0644` instead of `0755`) — `processVideo()` in `apps/worker/src/processors/media.processor.ts`
  ran transcode → thumbnail-extract → **upload thumbnail** → `ffprobe()` (for width/height/duration)
  → single DB update. ffprobe throwing `EACCES` meant the whole job threw *after* the thumbnail
  was already uploaded, so the asset landed in `ERROR` with `thumbnailKey` never persisted — the
  dashboard had nothing to show but the Film icon. Fixed with a defensive `chmod 755` on both the
  ffmpeg/ffprobe binaries at module load (self-heals regardless of how the binary lost its bit).
  Also added the missing `POST /assets/:id/reprocess` endpoint + a distinct `ERROR`-state UI
  (retry button) in the assets page, since there was previously no way to recover a failed asset
  short of re-uploading, and no visual difference between "processing" and "silently failed".

## 1. Shared schema/type changes

- ☑ `packages/types/src/theme.ts` — `ThemeElementShapeSchema` + `shape` on `ThemeElementStyleSchema`
  (optional, undefined = rectangle), plus a shared `shapeClipStyle()` helper used by both dashboard
  editors and the player so all three clip identically.
- ☑ `apps/api/prisma/schema.prisma` — `Zone.shape` (new `ZoneShape` enum) and
  `Zone.editable Boolean @default(true)`; migration `20260728140542_add_zone_shape_editable` applied.
- ☑ `ZoneDto`, `layouts.service.ts` `zoneCreateData`, `player.service.ts` zone hydration all pass
  `shape`/`editable` through.
- ☑ `apps/dashboard/src/lib/api.ts` and `apps/player/src/lib/api.ts` — added `shape`/`editable` to
  the duplicated local types (`ZoneInput`, `ThemeElementStyle`, player `Zone`).

## 2. Real shapes

- ☑ Layouts editor: shape `<select>` per zone card (rectangle/rounded/circle/ellipse/triangle),
  clipped via `shapeClipStyle` on the canvas fill, the zone-card, and the saved-layout thumbnail.
- ☑ Themes editor: same shape picker, available on every element kind (not just `SHAPE`) — was
  previously only a `borderRadius` number on `SHAPE`; `shape` now generalizes that. Applied in the
  canvas, and in `renderPreviewElements` (preset/own-theme thumbnail grids).
- ☑ Player: `PlayerPage.tsx` zone wrapper and `ThemeRenderer.tsx` element wrapper both apply
  `shapeClipStyle`.

## 3. Fix the `editable` toggle

- ☑ Confirmed `editable` was set by the Themes UI but read nowhere (not the editor, not the
  player). Now wired as a canvas **lock**: `editable: false` disables drag/resize/rotate (and
  hides the rotate handle) regardless of selection or the click-to-select setting, in both
  editors. A small lock badge shows on a locked zone/element in the canvas.
- ☑ Added the same `editable` checkbox + lock/unlock icon to Layouts zone cards (didn't exist
  before).

## 4. Layering controls

- ☑ Bring-to-front / bring-forward / send-backward / send-to-back buttons in both editors'
  element/zone cards, backed by a `reorderZIndex()` helper (re-stacks `zIndex`, front/back jump
  past every sibling, forward/backward swap with only the nearest neighbor).

## 5. Hover-reveal bounding box outline

- ☑ Both editors: the true rectangular bounding box no longer draws a border by default (which
  used to always render, even before shapes existed) — it only shows (dashed, or solid + glow
  when selected) on hover or while selected. Shape fill/clip is unaffected — it's a real element
  of the render, always visible; only the *extra* rectangular hit-box outline is hover-gated.

## 6. Click-to-select-before-edit safety mode

- ☑ `useRequireSelectToEdit` hook (localStorage-backed, mirrors `useFaithFeatures`), default `true`.
- ☑ Layouts editor now gates dragging/resizing/rotating behind selection exactly like Themes
  already did (previously zones were draggable/resizable immediately with no select step).
- ☑ Setting off → both editors fall back to immediate drag/resize/rotate on first touch (old
  Layouts behavior).
- ☑ `editable: false` always locks regardless of this setting.
- ☑ Settings page row ("Require a click to select before editing"), default on.

## 7. Themes/Layouts feature parity sweep

- ☑ Undo/redo ported into the Themes editor (previously Layouts-only) — same snapshot-based
  history mechanism, Ctrl+Z / Ctrl+Shift+Z, buttons in the footer.
- ☑ Both editors now expose: shape picker, editable lock, layering buttons, hover-outline,
  click-to-select gating, undo/redo.

### Known rough edges (acceptable trade-offs, not blocking)

- The Themes editor's `WidgetConfigFields` (TICKER's RSS feed URL text input) doesn't bracket
  keystrokes into a single undo step the way `ColorField`/number inputs do — typing a URL there
  can produce one history entry per keystroke. Low-traffic field (one text input, only visible
  for WIDGET+TICKER elements); not worth threading a separate onFocus/onBlur prop pair through
  for this pass.
- `ColorField`'s palette-role/"custom" `<select>` isn't individually undoable (only the raw color
  drag is bracketed) — an untracked select change gets silently absorbed into whatever the next
  real history commit captures.

## 8. i18n

- ☑ New keys added to both `apps/dashboard/messages/en.json` and `ar.json`: `layouts.shape`,
  `layouts.shapeTypes.*`, `layouts.editableHint`, `layouts.lockedHint`, `layouts.layer.*`,
  `themes.shape`, `themes.shapeTypes.*`, `themes.lockedHint`, `themes.layer.*`, `themes.undo`,
  `themes.redo`, `settings.requireSelectToEdit`, `settings.requireSelectToEditDesc`. Updated
  `themes.editableHint`/`themes.shapeHint` wording to reflect the new lock/shape behavior.

## 9. Verification

- ☑ `tsc --noEmit` clean for `dashboard`, `api`, `player`, `worker`.
- ☑ ESLint clean on every changed file except pre-existing violations already present before this
  work (verified via `git stash` diff — same errors exist on the pre-change file).
- ☑ Manual smoke test via the `run` skill (Playwright against the live dev stack, screenshots in
  scratchpad): circle-shaped zone + hover reveals the true rectangular bounding box outline;
  unchecking "Editable" on a zone blocks dragging (lock badge shows), re-checking it un-blocks
  dragging; the new Settings toggle renders and defaults on; Themes editor drag → Undo (position
  reverts) → Redo (position re-applies) all work; uploaded a real generated MP4 through the live
  API — asset went straight to `READY` with a real extracted-frame thumbnail rendering in
  `/assets` (previously would've shown only the Film icon). All test data cleaned up afterward.
