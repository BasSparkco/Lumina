# Persistence Format Analysis: Layout vs. Theme vs. Designer2

**Author:** Architecture review · **Date:** 2026-08-26
**Scope:** Compare the on-disk/DB/wire JSON formats of the three designer implementations in this repo and recommend a single format to carry forward as `designer2` absorbs the legacy editors.

Sources inspected: `apps/api/prisma/schema.prisma` (Layout/Zone, Theme, DesignTemplate/DesignAsset models), `packages/types/src/theme.ts` (legacy Theme element schema), `packages/design-schema/src/*` (designer2's Zod contract), `apps/api/src/modules/player/player.service.ts` (server-side hydration for all three), `apps/player/src/components/{ThemeRenderer,ZoneRenderer,ZonePlayer,DesignRenderer}.tsx` (client rendering), and `new player.md` (Flutter integration plan).

---

## 1. Schema Definitions

### 1.1 Layout Designer (legacy) — relational, `Layout` + `Zone`

Layout has **no serialized JSON document at all** — it's pure relational rows. "Export" below is just what `GET /layouts/:id` assembles from the `Layout`/`Zone` tables (`apps/api/src/modules/layouts/dto/create-layout.dto.ts`, `schema.prisma:520-604`).

```json
{
  "id": "cl_layout_9f2a",
  "name": "Lobby Split-Screen",
  "zones": [
    {
      "id": "cl_zone_01",
      "name": "Main Media",
      "x": 0, "y": 0, "width": 70, "height": 100,
      "zIndex": 0,
      "rotation": 0,
      "zoneType": "MEDIA",
      "shape": "rectangle",
      "editable": true,
      "playlistId": "cl_playlist_44",
      "assetId": null,
      "audioPriority": true,
      "audioVolume": null,
      "cropZoom": null, "cropOffsetX": null, "cropOffsetY": null,
      "widgetConfig": null
    },
    {
      "id": "cl_zone_02",
      "name": "Prayer Sidebar",
      "x": 70, "y": 0, "width": 30, "height": 100,
      "zIndex": 1,
      "zoneType": "PRAYER",
      "shape": "rectangle",
      "editable": true,
      "widgetConfig": { "methodOverride": "UmmAlQura" }
    }
  ]
}
```

**Structural notes:** flat, single-frame (no timeline/scenes), percentage-based `x/y/width/height` (0–100), zones are the *only* node type (no nested groups/layers), 8 `zoneType`s, a zone plays either a `Playlist` **or** a single `Asset` **or** a live widget — never inline styled content. No `schemaVersion` field; no version history table; overwritten in place on every save (`updatedAt` only).

### 1.2 Themes Designer (legacy) — `Theme.palette` / `.typography` / `.elements` (JSON columns)

Rich, self-contained JSON blob validated by `ThemeSchema` (`packages/types/src/theme.ts:317+`). This is much closer to a real document format than Layout.

```json
{
  "id": "cl_theme_77",
  "name": "Clinic Waiting Room",
  "category": "CLINIC_WAITING",
  "aspectRatio": "16:9",
  "palette": {
    "primary": "#0B5FFF", "secondary": "#00B8A9",
    "background": "#0A0A0A", "surface": "#1A1A1A",
    "text": "#FFFFFF", "textMuted": "#A0A0A0", "accent": "#FFD166"
  },
  "typography": { "headingFont": "Poppins", "bodyFont": "Inter", "baseSizePx": 16, "scale": 1.25 },
  "elements": [
    {
      "id": "el_1", "kind": "TEXT",
      "x": 5, "y": 5, "width": 60, "height": 15, "zIndex": 2, "rotation": 0, "editable": true,
      "content": { "text": "Now Serving", "translations": { "ar": "الدور الحالي" } },
      "style": { "color": "palette.text", "fontFamily": "heading", "fontSizePx": 48, "textAlign": "left", "direction": "ltr" },
      "animation": { "entrance": { "preset": "fade-up", "durationMs": 600, "delayMs": 0, "easing": "ease-out" } }
    },
    {
      "id": "el_2", "kind": "WIDGET",
      "x": 65, "y": 0, "width": 35, "height": 100, "zIndex": 1,
      "content": { "widgetType": "PRAYER", "widgetConfig": { "method": "UmmAlQura" } },
      "style": { "backgroundColor": { "type": "linear", "angle": 90, "from": "palette.primary", "to": "palette.secondary" } }
    },
    {
      "id": "el_3", "kind": "BRUSH",
      "x": 0, "y": 0, "width": 100, "height": 100, "zIndex": 0,
      "content": { "points": [], "raster": { "dataUrl": "data:image/png;base64,iVBORw0K...", "width": 1920, "height": 1080 } },
      "style": {}
    }
  ]
}
```

**Structural notes:** single-frame (like Layout — no scenes/timeline), same 0–100 percentage canvas, but 9 element `kind`s (`TEXT/IMAGE/VIDEO/DOCUMENT/PLAYLIST/SHAPE/BRUSH/WIDGET/ICON`) each with a typed `content` + shared `style`/`animation`. Notably expressive: gradient fills, per-element shape clipping, non-destructive image adjustments (exposure/temperature/tint/duotone), locale `translations`, a full entrance/emphasis/exit/text-reveal animation model, and a **raster paint layer** (`BRUSH.content.raster.dataUrl`) — a base64 PNG embedded directly in the JSON. `ICON` similarly inlines raw SVG markup. No `schemaVersion`, no version history — same overwrite-in-place persistence as Layout.

### 1.3 Designer2 (new) — `DesignDocument` (Zod, `packages/design-schema`)

```json
{
  "schemaVersion": 1,
  "id": "design_a1b2c3",
  "name": "Retail Promo — Weekend Sale",
  "canvas": { "width": 1920, "height": 1080, "backgroundColor": "#000000" },
  "settings": { "defaultSceneDurationMs": 10000 },
  "variables": { "storeName": "Downtown Branch" },
  "scenes": [
    {
      "id": "scene_1", "name": "Scene 1", "durationMs": 8000,
      "background": { "type": "color", "color": "#111111" },
      "elements": [
        {
          "id": "el_1", "type": "text", "name": "Headline",
          "x": 100, "y": 80, "width": 800, "height": 120, "rotation": 0, "opacity": 1,
          "visible": true, "zIndex": 2, "editable": true,
          "selectable": true, "movable": true, "resizable": true, "deletable": true,
          "text": "Welcome to {{storeName}}",
          "fontFamily": "Inter", "fontSize": 64, "fontWeight": 700,
          "fill": "#FFFFFF", "textAlign": "left", "direction": "ltr",
          "dynamicBindings": [{ "property": "text", "variable": "storeName", "fallback": "our store" }],
          "animation": { "enter": { "preset": "fade-up", "durationMs": 600, "delayMs": 0 } }
        },
        {
          "id": "el_2", "type": "image", "name": "Hero",
          "x": 0, "y": 0, "width": 1920, "height": 1080, "zIndex": 0,
          "assetId": "asset_9f21", "fit": "cover",
          "adjustments": { "brightness": -10, "contrast": 5 }
        }
      ]
    }
  ]
}
```

**Structural notes:** explicit `schemaVersion` literal (migration convention reserved for breaks); **multi-scene timeline** (unique among the three — Layout/Theme are single-frame); pixel-based canvas (not %-based) sized to an actual output resolution; only 5 element `type`s today (`text/image/shape/video/qr` — narrower than Theme's 9, no widget/document/playlist/brush/icon); a first-class **templating layer** (`variables` + `dynamicBindings` + `DynamicFieldDefinition`) that neither legacy format has at all; strict `MediaReferenceSchema` — assets are referenced by `assetId` only, **no embedded base64 anywhere** in the schema (unlike Theme's brush raster/icon svg); a distinct `ResolvedDesignPayload` contract (`player-contract.ts`) for what the Player actually consumes post-substitution, versus the raw authoring document.

Persistence lifecycle is also categorically more mature: `DesignAsset.revision` gives optimistic concurrency (stale-write rejection), `DesignAssetVersion` snapshots on every manual save/restore, and `DesignDraft` gives crash-recovery autosave — none of which exist for `Layout`/`Theme` (both are last-write-wins with no history).

---

## 2. Comparative Matrix

| Criterion | Layout (legacy) | Theme (legacy) | Designer2 |
|---|---|---|---|
| **Expressiveness — layers/nodes** | Zones only, no groups | 9 element kinds, flat z-index list | 5 element types today, flat z-index list |
| **Expressiveness — timeline/scenes** | ❌ single frame | ❌ single frame | ✅ multi-scene, per-scene duration |
| **Expressiveness — dynamic apps** | Widget zones (6 fixed types: prayer/weather/currency/ticker/time/date) + `AssetType.APP` at playlist level | Same 6 widget types, richer per-widget config surface | ❌ none yet — no widget/live-data element type, no APP element |
| **Expressiveness — templating (fill-in-the-blanks)** | ❌ none | ❌ none | ✅ `variables` + `dynamicBindings` — designed for it |
| **Expressiveness — media handling** | assetId or playlistId ref only | assetId ref **or inline base64** (brush raster, icon svg) | assetId ref only, resolved server-side to signed/CDN URL — no inline payloads by construction |
| **Expressiveness — animation** | ❌ none | Rich: entrance/emphasis/exit/text-reveal, per-preset direction/easing | Enter/emphasis/exit presets only — no text-reveal, fewer presets |
| **Expressiveness — styling depth** | none (structural only) | Gradients, image adjustments (8 sliders + duotone), per-element shape clipping, locale text overrides | Flat fill/stroke, `ThemeImageAdjustments` reused for images only, no gradients, no per-element shape clip |
| **Rendering complexity (client)** | Simple: `ZoneRenderer`/`ZonePlayer` (118+336 lines), plain DOM/CSS | Moderate: `ThemeRenderer` (289 lines) + shared paint/filter helpers in `@lumina/ui` | Moderate: `DesignRenderer` (332 lines), plus Fabric.js object model in the *editor* (not the player) |
| **Parsing complexity** | Trivial — flat rows, no discriminated unions | Moderate — 9-way discriminated union, gradient/adjustment sub-schemas | Moderate — 5-way discriminated union, but fully typed end-to-end via Zod (single source of truth for API + client) |
| **Type safety / validation** | `class-validator` DTOs (API only); no shared schema with client | `zod` schema in `@lumina/types`, shared client/server | `zod` schema in dedicated `@lumina/design-schema` package, shared client/server/player, explicit `schemaVersion` |
| **Schema evolution story** | None — ad hoc nullable columns | None — ad hoc optional fields, comment-documented "legacy shape kept for back-compat" (e.g. `BRUSH.points`) | Explicit: `schemaVersion` literal + reserved `migrations/` convention |
| **Version history / concurrency** | None (overwrite in place) | None (overwrite in place) | `revision` optimistic concurrency + `DesignAssetVersion` snapshots + `DesignDraft` autosave |
| **Multi-platform (Web)** | Rendered by `apps/player` (React) | Rendered by `apps/player` (React) | Rendered by `apps/player` (React) — all three share one runtime already |
| **Multi-platform (Flutter)** | N/A — see note below | N/A — see note below | N/A — see note below |
| **Ease of migration to a unified format** | Low effort structurally (few fields) but **loses nothing salvageable** — its only unique concept (zone-plays-a-playlist, per-zone audio priority) has no designer2 equivalent yet | Highest effort — most fields with no designer2 counterpart (widgets, brush, icon, gradients, adjustments-on-any-element, text-reveal, translations) | N/A (target format) |

**Important reframe on the "Flutter" criterion:** per `new player.md`, the Flutter shell is explicitly **not** a second rendering engine. It embeds the existing `apps/player` web bundle in a platform WebView (WebView2/WKWebView/Android WebView/webkit2gtk) on every target — "the existing web player remains the single rendering engine ... on every platform." So none of the three JSON formats is parsed by Dart code today, and switching formats has **zero direct Flutter impact**. The only Flutter-relevant contract is the `LuminaDevice` JS⇄Dart bridge (pairing, kiosk lifecycle, device info), which is orthogonal to design-document shape. The one scenario where format choice *would* matter for Flutter is a future native (non-WebView) Dart renderer — and if that's ever built, `DesignDocument`'s fully-typed, no-inline-binary, versioned shape ports to Dart models far more cleanly than Theme's discriminated union with embedded base64 rasters/SVGs.

---

## 3. Architecture Recommendation

**Adopt `DesignDocument` (`@lumina/design-schema`) as the single unified format**, extended — not replaced — to absorb Theme's and Layout's unique capabilities. Rationale:

1. It's the only format with a **scene/timeline model**, which is a strict superset of "single frame" (a Layout or Theme becomes a one-scene `DesignDocument`), so nothing is lost going this direction, whereas going the other way (retrofitting scenes onto Zone/Theme) would mean redesigning both legacy formats from scratch anyway.
2. It's the only format with **first-class templating** (`variables`/`dynamicBindings`), which is exactly the mechanism `DesignTemplate → DesignAsset` cloning already depends on (designer.md §17) — Theme has no equivalent, so keeping Theme alive means maintaining a second, incompatible templating story indefinitely.
3. It's the only format with a **real persistence lifecycle** (optimistic concurrency, version history, autosave) — this is infrastructure, not just schema shape, and it's already wired through the API (`DesignsService`) and would otherwise need to be duplicated for Layout/Theme to reach parity.
4. It's the only format that forbids embedded binary payloads structurally (`MediaReferenceSchema`), which matters for document size, CDN cacheability, and (per Theme's own `ICON.svg` sanitization comment) reduces stored-XSS surface area.
5. `schemaVersion` + the reserved `migrations/` convention means this is the only one of the three actually built to be extended again later without another three-way fork.

The **hybrid** part: designer2's element union must grow to cover Theme's gap before Theme can be deleted (see checklist below) — this is additive to `element.schema.ts`'s `discriminatedUnion`, not a rewrite of the core document shape.

---

## 4. Feature Salvage Checklist

Ported to `designer2` before the corresponding legacy editor/table can be safely removed. Ordered roughly by how many existing themes/layouts would break without it.

### From Theme (highest-risk gap — most unique surface area)
- [ ] **Widget element type** — `WIDGET` (`PRAYER/WEATHER/CURRENCY/TICKER/TIME/DATE/QR` — note designer2's `qr` element is static-only, not the live QR widget) with a generic `widgetConfig` bag. No designer2 equivalent exists at all; every Theme using a live-data zone needs this before migration.
- [ ] **Document element type** — `DOCUMENT` (assetId + `secondsPerPage` paging).
- [ ] **Playlist-as-element** — `PLAYLIST` content (an element that rotates through a whole playlist in place), distinct from Layout's zone-level version of the same idea.
- [ ] **Brush/paint layer** — `BRUSH` raster (`dataUrl`/width/height) and the legacy vector `points` fallback. Needs a decision: keep as an embedded raster (breaks designer2's no-inline-binary rule) or migrate to an uploaded `Asset` referenced by `assetId`.
- [ ] **Icon element** — `ICON` (inline sanitized SVG + `iconId` for re-editing), or replace with an Iconify-backed `image`-like element that resolves through the asset pipeline instead of inlining SVG.
- [ ] **Gradient fills** — `ThemeGradientFillSchema` (2-stop linear) for `backgroundColor`, usable on any element, not just scene background.
- [ ] **Image adjustments on every element**, not just `image` — Theme allows `imageAdjustments` in the shared style bag; designer2 currently scopes `adjustments` to `ImageElementSchema` only.
- [ ] **Per-element shape clipping** — `ThemeElementShapeSchema` (rectangle/rounded/circle/triangle/pentagon/hexagon/octagon/star/arrow) applies to *any* element kind in Theme; designer2's `shape` element only supports a fixed `ShapeKindSchema` list and clipping isn't generalized to other types.
- [ ] **Text locale overrides** — `content.translations` (e.g. `{ ar: "..." }`) for RTL/multi-market text. Designer2's `dynamicBindings` could theoretically cover this but isn't the same mechanism today.
- [ ] **Emphasis / exit / text-reveal animations** — designer2's `ElementAnimationSchema` has `enter`/`emphasis`/`exit` (close parity) but no `textReveal` (typewriter/word-by-word) and fewer presets overall than `ThemeElementAnimationSchema`.
- [ ] **Palette/typography as theme-level tokens** — Theme's `palette.*`/`typography.*` indirection (elements reference `"palette.primary"` by role, recolor the whole theme in one edit) has no equivalent — designer2 elements store literal colors/fonts only.
- [ ] **`editable` per-element lock flag semantics** — present in both formats but double-check parity: Theme's default is `false` (locked unless explicitly unlocked), designer2's is `true`.

### From Layout (lower-risk — smaller, mostly-covered surface area)
- [ ] **Zone-plays-a-playlist** — a Layout zone can bind an entire `Playlist` (not just one asset); designer2 has no per-element playlist binding (see Theme's `PLAYLIST` kind above — same gap, one fix covers both).
- [ ] **Zone-plays-a-widget** — same gap as Theme's `WIDGET` element; one unified widget element type should cover both Layout zones and Theme/Designer2 elements.
- [ ] **Per-zone audio routing** — `audioPriority` (exclusive-audio zone, force-mutes siblings) and `audioVolume` (per-zone volume override). No concept of audio priority/volume exists on any designer2 element.
- [ ] **Zone-level crop** (`cropZoom`/`cropOffsetX`/`cropOffsetY` for a direct asset) — designer2's `ImageElementSchema`/`VideoElementSchema` already carry equivalent crop fields, so this is likely **already covered**; verify parity rather than treat as a gap.
- [ ] **Rotation** — already present on designer2's `BaseElementSchema`; covered.

### Cross-cutting (needed regardless of which legacy gaps get ported)
- [ ] A documented **migration function** per legacy format (`Layout → DesignDocument`, `Theme → DesignDocument`) living in `packages/design-schema`'s reserved `migrations/` convention, run once at read-time or via a backfill job — not a one-off script, since `PlaylistItem.kind` (`ASSET/THEME/LAYOUT/DESIGN`) means both old and new kinds will coexist in live playlists until every org's content is migrated.
- [ ] `player.service.ts`'s three separate hydration paths (`hydrateThemeElements`, `hydrateZones`, `hydrateDesign`) should collapse to one once the element union is unified — currently each has its own assetId-resolution logic that will drift if maintained in parallel.
