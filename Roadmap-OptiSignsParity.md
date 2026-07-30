# OptiSigns parity — editor widgets & free elements

> Working doc (started 2026-07-30). Basel pulled a feature list from the OptiSigns editor to
> compare against ours. This tracks closing the gaps, one item at a time to keep each change
> small and reviewable. Ordered easiest/most-reused-infra first, biggest lift last.

Legend: ☐ todo · ◐ in progress · ☑ done

---

## 0. Gap analysis (baseline, 2026-07-30)

Already have, roughly matching OptiSigns:
- Playlist widget (`PLAYLIST` element kind + `MEDIA` zone)
- Weather widget (`WEATHER`)
- Overlay image / overlay video (`IMAGE`/`VIDEO` elements with z-index layering)

Partial:
- Scrolling text — `TICKER` widget exists but is RSS-feed-only, no free-typed text, no vertical
  direction.
- Shapes — `SHAPE` element + `style.shape` exist but only as a clip-mask (rectangle / rounded /
  circle / triangle), not standalone complex polygons (star, hexagon, octagon, pentagon...).

Missing entirely:
- Time widget (placeable/styleable — only a global fullscreen clock overlay toggle exists today)
- Date widget
- Vertical scrolling direction
- QR code display
- Document display (PDF/PPT/DOC) — no asset type, no conversion pipeline, no viewer
- More free shapes (star, hexagon, octagon, pentagon, etc.)
- Brush tool (freeform drawing)

## 1. Time + Date widgets ☑ done (2026-07-30)

Mirrors the existing `WEATHER`/`PRAYER` `WIDGET`/zone pattern exactly — same plumbing, new
widget types, no new infra.

- ☑ `packages/types/src/theme.ts` — `ThemeWidgetTypeSchema` add `TIME`, `DATE`
- ☑ `apps/api/prisma/schema.prisma` — `ZoneType` enum add `TIME`, `DATE` + migration
  (`20260730124254_add_time_date_zone_types`)
- ☑ `apps/api/src/modules/layouts/dto/create-layout.dto.ts` — `ZONE_TYPES` add `TIME`, `DATE`
- ☑ `apps/dashboard/src/lib/api.ts` / `apps/player/src/lib/api.ts` — `ZoneType` (and the
  locally-duplicated `ThemeWidgetType` in each file — found two more copies of the same union
  besides the shared `@lumina/types` one) add `TIME`, `DATE`
- ☑ New player widgets: `TimeWidget.tsx` (live clock, 12h/24h, optional seconds, timezone
  override) and `DateWidget.tsx` (long/short format, language, timezone override)
- ☑ `LiveWidget.tsx` + `PlayerPage.tsx` `ZoneRenderer`/`zoneHasContent` — wired both new cases
- ☑ `WidgetConfigFields.tsx` — config panels for both (reusing `TimezoneSelect`)
- ☑ Themes editor (`WIDGET_TYPE_VALUES`) + Layouts editor (`ZONE_TYPE_VALUES`,
  `ZONE_TYPE_BADGE`) — added both to the type pickers
- ☑ i18n — `layouts.zoneTypes.{TIME,DATE}`, `themes.widgetTypes.{TIME,DATE}`, new
  `layouts.widget.*` keys for the format/timezone controls, en + ar
- ☑ Verify: `tsc --noEmit` clean across `@lumina/types`/`api`/`dashboard`/`player`; ESLint clean
  on every changed file. Full manual smoke test: created a layout with a TIME zone + a DATE zone
  in the dashboard, saved it (round-tripped through the API/Prisma correctly), assigned it to a
  paired test screen, and loaded the actual player app against live API state — it rendered a
  real live-updating clock and the correct current date. Also added a WIDGET-kind Time element
  in the Themes editor and saved successfully. All test data (layouts/theme/screen) and temporary
  dev server instances spun up for the test were cleaned up afterward.

## 2. Free-text scrolling ticker + vertical direction ☑ done (2026-07-30)

No schema changes — `TICKER`'s `widgetConfig` is already a free-form JSON blob (same reasoning
as step 1's note for step 3), so this was purely a config-shape + renderer + UI change.

- ☑ `TickerWidget.tsx` (player) — accepts `staticText` (one item per non-empty line) as an
  alternative to `feedUrl`, and a `direction: 'horizontal' | 'vertical'` prop. Vertical scrolls
  items upward (translateY) instead of the existing horizontal marquee (translateX); both loop
  by doubling the content. Static text takes priority if both are somehow set.
- ☑ `LiveWidget.tsx` + `PlayerPage.tsx` `ZoneRenderer`/`zoneHasContent` — pass through
  `staticText`/`direction`, and content-check now accepts either a feed URL or non-empty static
  text (previously RSS-only).
- ☑ `WidgetConfigFields.tsx` — TICKER config now has a "Content source" select (RSS feed / Free
  text) that swaps the RSS URL field for a textarea, plus a "Scroll direction" select
  (Horizontal/Vertical).
- ☑ i18n — new `layouts.widget.{tickerSource,tickerSourceRss,tickerSourceText,rssFeedUrl,
  tickerText,tickerTextPlaceholder,scrollDirection,directionHorizontal,directionVertical}` keys,
  en + ar. Also dropped the now-inaccurate "(RSS)" suffix from the `TICKER` zone/widget type
  label in both locales.
- ☑ Verify: `tsc --noEmit` clean across `dashboard`/`player`; ESLint clean on every changed file.
  Full manual smoke test via a headless-Chromium session: logged into the dashboard, built a
  layout from the "Main + Ticker" preset, switched the Ticker zone to Free text + Vertical with
  a 3-line (incl. Arabic) message, saved it, and confirmed the saved `widgetConfig` round-tripped
  exactly through the API. Loaded the real player app against a live-paired test screen and
  watched the vertical ticker actually scroll upward and loop; flipped the same zone to
  horizontal and confirmed the classic left-scrolling marquee with the "◆" separator still
  works, mixed-language text included. No console or network errors in either mode. All temp
  scripts, the test layout, and the paired-state on the reused seed screen were cleaned up
  afterward; no extra dev server left running.

## 3. QR code widget

- ☐ Add a small QR-gen dependency (e.g. `qrcode`)
- ☐ New `WIDGET` type: encodes a configurable URL/text, colors, size
- ☐ Config UI + i18n
- ☐ No backend/schema changes beyond the same `ThemeWidgetType`/`ZoneType` wiring as step 1

## 4. More free shapes (star, hexagon, octagon, pentagon...)

- ☐ Extend `ThemeElementShapeSchema` + `shapeClipStyle()` with new clip-path polygons
- ☐ Decide scope: complex shapes apply to `SHAPE`-kind elements only (a star-clipped video/image
  looks broken at the points) — simple shapes stay available everywhere as today
- ☐ Shape picker UI + player/preview parity, i18n

## 5. Brush tool (freeform drawing)

- ☐ New element kind storing freehand stroke path data (SVG path or point array) in JSON content
- ☐ Drawing-mode UI in the canvas editor (pointer capture → path recording, stroke color/width)
- ☐ Player-side SVG rendering
- ☐ No backend/storage changes beyond the JSON content shape

## 6. Document display (PDF/PPT/DOC)

Biggest lift — needs its own mini design pass when we get here (conversion approach, storage,
per-page timing).

- ☐ New `DOCUMENT` `AssetType` + upload acceptance
- ☐ Conversion pipeline (pages → images), likely a new worker job
- ☐ New element/widget kind + per-page timing in playlists
- ☐ Player-side rendering
- ☐ Prisma schema + migration, both editors, i18n
