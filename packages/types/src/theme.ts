import { z } from 'zod';

export const ThemeCategorySchema = z.enum([
  'RESTAURANT_MENU',
  'RETAIL_PROMO',
  'HOTEL_LOBBY',
  'CLINIC_WAITING',
  'MOSQUE',
  'GENERIC',
]);
export type ThemeCategory = z.infer<typeof ThemeCategorySchema>;

export const ThemeAspectRatioSchema = z.enum(['16:9', '9:16', '4:3', '1:1']);
export type ThemeAspectRatio = z.infer<typeof ThemeAspectRatioSchema>;

// Seven semantic color roles — not an arbitrary swatch list — so a whole theme can be
// recolored by editing this object once instead of every element's style.
export const ThemePaletteSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  background: z.string(),
  surface: z.string(),
  text: z.string(),
  textMuted: z.string(),
  accent: z.string(),
});
export type ThemePalette = z.infer<typeof ThemePaletteSchema>;

export const ThemeTypographySchema = z.object({
  headingFont: z.string().default('Inter'),
  bodyFont: z.string().default('Inter'),
  baseSizePx: z.number().positive().default(16),
  scale: z.number().positive().default(1.25),
});
export type ThemeTypography = z.infer<typeof ThemeTypographySchema>;

export const ThemeElementKindSchema = z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'PLAYLIST', 'SHAPE', 'BRUSH', 'WIDGET', 'ICON']);
export type ThemeElementKind = z.infer<typeof ThemeElementKindSchema>;

export const ThemeWidgetTypeSchema = z.enum(['PRAYER', 'WEATHER', 'CURRENCY', 'TICKER', 'TIME', 'DATE', 'QR']);
export type ThemeWidgetType = z.infer<typeof ThemeWidgetTypeSchema>;

export const ThemeElementShapeSchema = z.enum([
  'rectangle',
  'rounded',
  'circle',
  'triangle',
  'pentagon',
  'hexagon',
  'octagon',
  'star',
  'arrow',
]);
export type ThemeElementShape = z.infer<typeof ThemeElementShapeSchema>;

// A freehand stroke's recorded points, in the same 0–100 coordinate space as the element's own
// bounding box (not the canvas) — so the stroke scales/moves with the element like every other
// kind's content, instead of needing separate canvas-relative math at render time.
export const ThemeBrushPointSchema = z.object({ x: z.number(), y: z.number() });
export type ThemeBrushPoint = z.infer<typeof ThemeBrushPointSchema>;

// The paint layer's raster bitmap — a single full-canvas PNG (base64 data URL) that the brush,
// eraser, fill bucket, and eyedropper all read/write pixel-by-pixel. `width`/`height` are the
// bitmap's own native pixel size (fixed per aspect ratio, see PAINT_LAYER_RESOLUTION in the
// dashboard's paintEngine), not related to the element's 0–100 box, which is always the full
// canvas (x:0 y:0 width:100 height:100) so the bitmap always covers the whole frame.
export const ThemeBrushRasterSchema = z.object({
  dataUrl: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ThemeBrushRaster = z.infer<typeof ThemeBrushRasterSchema>;

// A two-stop linear gradient fill — an alternative to a literal/palette-ref backgroundColor.
// `angle` is degrees, CSS gradient convention (0 = bottom-to-top, 90 = left-to-right). `from`/
// `to` accept the same literal-or-"palette.<role>" values as any other color field, resolved via
// resolveThemeColor() same as a solid backgroundColor.
export const ThemeGradientFillSchema = z.object({
  type: z.literal('linear'),
  angle: z.number().min(0).max(360).default(90),
  from: z.string(),
  to: z.string(),
});
export type ThemeGradientFill = z.infer<typeof ThemeGradientFillSchema>;

// Non-destructive image color grading — stored as adjustment values on the element's style
// (never baked into the asset's pixels, unlike AI background removal), so the original stays
// reusable elsewhere and every value can be dialed back to neutral (0) at any time. Sliders run
// -100..100 (0 = untouched) except `hue` (a full-circle rotation, -180..180) to match how far
// each one visibly pushes the image, not because the underlying math is on the same scale.
// Applied at render time via buildImageFilterCss/needsSvgFilter (below) — brightness/contrast/
// saturation/vibrance/hue map onto native CSS filter() functions; temperature/tint/duotone can't
// be, and need the SVG <feColorMatrix>/<feComponentTransfer> filter built by the shared
// ImageAdjustmentFilter component in @lumina/ui.
export const ThemeImageAdjustmentsSchema = z.object({
  exposure: z.number().min(-100).max(100).default(0),
  brightness: z.number().min(-100).max(100).default(0),
  contrast: z.number().min(-100).max(100).default(0),
  saturation: z.number().min(-100).max(100).default(0),
  // A gentler, approximated saturation boost — true vibrance selectively protects already-
  // saturated tones (skin, in particular), which isn't expressible with a CSS filter alone.
  vibrance: z.number().min(-100).max(100).default(0),
  // Warm (positive) <-> cool (negative) white-balance shift, and green (negative) <-> magenta
  // (positive) tint — both approximated via a channel-offset color matrix, not true color
  // temperature science (which needs a Kelvin-based per-pixel conversion).
  temperature: z.number().min(-100).max(100).default(0),
  tint: z.number().min(-100).max(100).default(0),
  hue: z.number().min(-180).max(180).default(0),
  // Maps the image's luminance onto a two-color gradient (shadows -> color1, highlights ->
  // color2) — null means off. Accepts the same literal-or-"palette.<role>" values as any other
  // color field.
  duotone: z.object({ color1: z.string(), color2: z.string() }).nullable().default(null),
  // Which quick preset (if any) produced the current values — 'custom' once the user tweaks a
  // slider after applying one, so the UI can un-highlight the preset without losing the values.
  preset: z.string().optional(),
});
export type ThemeImageAdjustments = z.infer<typeof ThemeImageAdjustmentsSchema>;

// A curated set of one-click starting points — each just a partial set of the adjustment fields
// above, merged onto the neutral defaults. Shared by the editor's preset picker and (for the
// "which thumbnail is active" check) whatever currently-applied values it's compared against.
export const IMAGE_ADJUSTMENT_PRESETS: Record<string, Partial<ThemeImageAdjustments>> = {
  vivid: { saturation: 30, vibrance: 25, contrast: 15 },
  blackAndWhite: { saturation: -100 },
  warm: { temperature: 30, tint: 5 },
  cool: { temperature: -30 },
  vintage: { saturation: -25, contrast: -10, temperature: 15, tint: 8 },
  fade: { contrast: -25, brightness: 10, saturation: -15 },
};

// Style values for color fields accept either a literal CSS color or a "palette.<role>"
// reference, resolved at render time via resolveThemeColor(). backgroundColor additionally
// accepts a two-stop gradient, resolved via resolveThemeFill().
export const ThemeElementStyleSchema = z.object({
  color: z.string().optional(),
  backgroundColor: z.union([z.string(), ThemeGradientFillSchema]).optional(),
  // 'heading'/'body' reference the theme's own typography; any other string is a literal font
  // family name chosen for this element specifically.
  fontFamily: z.string().optional(),
  fontSizePx: z.number().positive().optional(),
  fontWeight: z.union([z.number(), z.string()]).optional(),
  textAlign: z.enum(['left', 'center', 'right']).optional(),
  direction: z.enum(['ltr', 'rtl', 'auto']).optional(),
  borderRadius: z.number().min(0).optional(),
  opacity: z.number().min(0).max(1).optional(),
  objectFit: z.enum(['contain', 'cover', 'fill']).optional(),
  // Per-placement image/video framing (like cropping a profile picture into a frame) —
  // undefined means "show the whole asset" per objectFit above. Set together by the crop
  // editor: cropZoom 1–4 (1 = default cover-fit, no pan room); offsets are a % shift from
  // center. See mediaCropStyle below for how these three combine into a render style.
  cropZoom: z.number().min(1).max(4).optional(),
  cropOffsetX: z.number().optional(),
  cropOffsetY: z.number().optional(),
  // Clips the element's content to a shape within its (still rectangular) bounding box —
  // available on every element kind, not just SHAPE. Undefined renders as 'rectangle' (no clip)
  // — see shapeClipStyle below.
  shape: ThemeElementShapeSchema.optional(),
  // SHAPE-kind only: renders as a solid color-filled silhouette (default) or a stroked outline —
  // the latter for pure decoration (an emphasis ring, an arrow painted a color, no media/content
  // of its own). See shapeOutlineGeometry below for the outline path per shape.
  shapeFill: z.enum(['solid', 'outline']).optional(),
  strokeWidthPx: z.number().positive().optional(),
  // IMAGE-kind only (VIDEO doesn't support CSS filters consistently across platforms the same
  // way) — non-destructive color grading, see ThemeImageAdjustmentsSchema above.
  imageAdjustments: ThemeImageAdjustmentsSchema.optional(),
}).default({});
export type ThemeElementStyle = z.infer<typeof ThemeElementStyleSchema>;

export const ThemeAnimationEasingSchema = z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']);
export type ThemeAnimationEasing = z.infer<typeof ThemeAnimationEasingSchema>;

export const ThemeEntranceExitPresetSchema = z.enum(['none', 'fade', 'slide', 'zoom']);
export type ThemeEntranceExitPreset = z.infer<typeof ThemeEntranceExitPresetSchema>;

export const ThemeSlideDirectionSchema = z.enum(['up', 'down', 'left', 'right']);
export type ThemeSlideDirection = z.infer<typeof ThemeSlideDirectionSchema>;

export const ThemeEmphasisPresetSchema = z.enum(['none', 'pulse', 'shake']);
export type ThemeEmphasisPreset = z.infer<typeof ThemeEmphasisPresetSchema>;

export const ThemeTextRevealPresetSchema = z.enum(['none', 'typewriter', 'wordByWord']);
export type ThemeTextRevealPreset = z.infer<typeof ThemeTextRevealPresetSchema>;

// Per-element entrance/emphasis/exit + (TEXT-only) reveal animation. A sibling of `style` on the
// base element (not part of it) since this is playback *behavior* over time, not a visual
// property read once at render — see buildEntranceExitAnimationStyle/buildEmphasisAnimationStyle
// below for how entrance/emphasis become actual CSS `animation-*` values, and useTextReveal in
// @lumina/ui for the (JS-driven, not CSS-expressible) text reveal.
//
// `exit` is stored and editable today but has no live trigger in kiosk playback yet — a Theme's
// elements are all simultaneously visible for the whole screen dwell time, so there's currently
// no "this one element goes away while its siblings stay" moment to hang an exit animation off
// (unlike the editor's own "Preview" replay, which can simulate one). It's kept in the schema
// now rather than added later so themes authored today are forward-compatible with whatever
// future feature gives an element a real end-of-life moment (e.g. multi-page themes).
export const ThemeElementAnimationSchema = z.object({
  entrance: z.object({
    preset: ThemeEntranceExitPresetSchema.default('none'),
    direction: ThemeSlideDirectionSchema.default('up'),
    durationMs: z.number().positive().default(600),
    delayMs: z.number().min(0).default(0),
    easing: ThemeAnimationEasingSchema.default('ease-out'),
  }).optional(),
  emphasis: z.object({
    preset: ThemeEmphasisPresetSchema.default('none'),
    // How often the pulse/shake repeats — the emphasis motion itself is a fixed-shape keyframe
    // (see ELEMENT_ANIMATION_KEYFRAMES_CSS), not independently timed, so there's no separate
    // "how long does one pulse take" field to set.
    intervalMs: z.number().positive().default(4000),
  }).optional(),
  exit: z.object({
    preset: ThemeEntranceExitPresetSchema.default('none'),
    direction: ThemeSlideDirectionSchema.default('up'),
    durationMs: z.number().positive().default(600),
    easing: ThemeAnimationEasingSchema.default('ease-in'),
  }).optional(),
  // TEXT-kind only.
  textReveal: z.object({
    preset: ThemeTextRevealPresetSchema.default('none'),
    speedMsPerUnit: z.number().positive().default(60),
  }).optional(),
});
export type ThemeElementAnimation = z.infer<typeof ThemeElementAnimationSchema>;

const themeElementBase = {
  id: z.string(),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  width: z.number().min(0).max(100),
  height: z.number().min(0).max(100),
  zIndex: z.number().int().default(0),
  // Degrees, clockwise, about the element's own center — 0 for elements saved before rotation
  // existed, and for anything the editor never rotated.
  rotation: z.number().default(0),
  editable: z.boolean().default(false),
  label: z.string().optional(),
  style: ThemeElementStyleSchema,
  animation: ThemeElementAnimationSchema.optional(),
};

export const ThemeElementSchema = z.discriminatedUnion('kind', [
  z.object({
    ...themeElementBase,
    kind: z.literal('TEXT'),
    content: z.object({
      text: z.string(),
      // Optional locale overrides, e.g. { ar: "..." } — the RTL/faith-market differentiator.
      translations: z.record(z.string(), z.string()).optional(),
      // When set, the element sources its content AND all text styling (font/color/size/
      // background/ticker) from that TEXT-type Asset, ignoring `text`/`translations` — the same
      // "reuse the asset as-is" model IMAGE/VIDEO/DOCUMENT elements already use.
      assetId: z.string().nullable().optional(),
    }),
  }),
  z.object({
    ...themeElementBase,
    kind: z.literal('IMAGE'),
    content: z.object({ assetId: z.string().nullable() }),
  }),
  z.object({
    ...themeElementBase,
    kind: z.literal('VIDEO'),
    content: z.object({ assetId: z.string().nullable() }),
  }),
  z.object({
    ...themeElementBase,
    kind: z.literal('DOCUMENT'),
    // secondsPerPage: how long each page shows before cycling to the next — matches
    // PlaylistItem.durationSecs's default of 10 for the same "seconds per unit of content" idea.
    content: z.object({ assetId: z.string().nullable(), secondsPerPage: z.number().positive().default(10) }),
  }),
  z.object({
    ...themeElementBase,
    kind: z.literal('PLAYLIST'),
    content: z.object({ playlistId: z.string().nullable() }),
  }),
  z.object({
    ...themeElementBase,
    kind: z.literal('SHAPE'),
    content: z.object({}).default({}),
  }),
  z.object({
    ...themeElementBase,
    kind: z.literal('BRUSH'),
    // `points`: legacy per-stroke vector format (themes saved before the raster paint layer
    // existed) — kept read-only so old themes keep rendering, never written by new drawing.
    // `raster`: the current paint layer format — every BRUSH element the editor creates from now
    // on carries this instead, and there's normally at most one such element per theme (the
    // singleton paint layer every brush/eraser/fill/eyedropper action reads and writes).
    content: z.object({
      points: z.array(ThemeBrushPointSchema).default([]),
      raster: ThemeBrushRasterSchema.optional(),
    }),
  }),
  z.object({
    ...themeElementBase,
    kind: z.literal('WIDGET'),
    content: z.object({
      widgetType: ThemeWidgetTypeSchema,
      widgetConfig: z.record(z.string(), z.unknown()).default({}),
    }),
  }),
  z.object({
    ...themeElementBase,
    kind: z.literal('ICON'),
    // Self-contained, unlike every other media kind above — no assetId, no server-side
    // hydration. `svg` is the icon's own markup (sanitized server-side when fetched, see
    // assets.service.ts's importIcon), fetched once from Iconify at pick time and stored inline
    // so playback never depends on Iconify's availability. `iconId` (e.g. "mdi:home") is kept
    // only so the icon picker can be reopened to swap it. Recolored via style.color, same as a
    // TEXT element — the fetched SVG uses currentColor for its fill/stroke.
    content: z.object({ iconId: z.string(), svg: z.string() }),
  }),
]);
export type ThemeElement = z.infer<typeof ThemeElementSchema>;

export const ThemeSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: ThemeCategorySchema,
  aspectRatio: ThemeAspectRatioSchema.default('16:9'),
  organizationId: z.string().nullable(),
  palette: ThemePaletteSchema,
  typography: ThemeTypographySchema,
  elements: z.array(ThemeElementSchema),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Theme = z.infer<typeof ThemeSchema>;

// What the API accepts on create/update, and what seed presets are authored against —
// no id/organizationId/timestamps, those are assigned server-side.
export const ThemeInputSchema = ThemeSchema.omit({
  id: true,
  organizationId: true,
  createdAt: true,
  updatedAt: true,
});
export type ThemeInput = z.infer<typeof ThemeInputSchema>;

/**
 * Resolves a style color value that may reference a palette role (e.g. "palette.primary")
 * back to its literal color. Values that aren't palette references pass through unchanged.
 */
export function resolveThemeColor(value: string | undefined, palette: ThemePalette): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('palette.')) {
    const key = value.slice('palette.'.length) as keyof ThemePalette;
    return palette[key] ?? value;
  }
  return value;
}

/**
 * Resolves a backgroundColor style value — a literal color, a palette reference, or a two-stop
 * gradient — to a CSS `background` value. Use this (not resolveThemeColor) wherever
 * ThemeElementStyle.backgroundColor is applied, since it's the only field that can hold a
 * gradient. Gradient stops are themselves resolved through resolveThemeColor so "palette.<role>"
 * works as a gradient stop too.
 */
export function resolveThemeFill(
  value: string | ThemeGradientFill | undefined,
  palette: ThemePalette,
): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return resolveThemeColor(value, palette);
  const from = resolveThemeColor(value.from, palette);
  const to = resolveThemeColor(value.to, palette);
  return `linear-gradient(${value.angle}deg, ${from}, ${to})`;
}

/**
 * Resolves a backgroundColor style value down to a single solid CSS color, for contexts that
 * can't render a gradient — an SVG stroke (shapeFill: 'outline'), for instance. A gradient value
 * falls back to its first stop.
 */
export function resolveThemeFillColor(
  value: string | ThemeGradientFill | undefined,
  palette: ThemePalette,
): string | undefined {
  if (!value) return undefined;
  return typeof value === 'string' ? resolveThemeColor(value, palette) : resolveThemeColor(value.from, palette);
}

/**
 * The subset of ThemeImageAdjustments expressible as native CSS filter() functions — brightness/
 * contrast/saturation/vibrance (approximated, see the schema comment)/hue all have a direct or
 * near-direct filter function; temperature/tint/duotone don't (see needsSvgFilter below).
 * `exposure` and `brightness` are deliberately two separate `brightness()` calls rather than one
 * combined value — CSS filter functions compose multiplicatively when chained, so this gives each
 * slider real independent effect without inventing a shared formula for two conceptually
 * different controls. Returns undefined (rather than a no-op "brightness(1)...") when every field
 * is at its neutral value, so callers can skip setting `filter` at all for an untouched element.
 */
export function buildImageFilterCss(adjustments: ThemeImageAdjustments | undefined): string | undefined {
  if (!adjustments) return undefined;
  const parts: string[] = [];
  if (adjustments.exposure) parts.push(`brightness(${1 + adjustments.exposure / 100})`);
  if (adjustments.brightness) parts.push(`brightness(${1 + adjustments.brightness / 200})`);
  if (adjustments.contrast) parts.push(`contrast(${1 + adjustments.contrast / 100})`);
  if (adjustments.saturation) parts.push(`saturate(${Math.max(0, 1 + adjustments.saturation / 100)})`);
  if (adjustments.vibrance) parts.push(`saturate(${Math.max(0, 1 + adjustments.vibrance / 200)})`);
  if (adjustments.hue) parts.push(`hue-rotate(${adjustments.hue}deg)`);
  return parts.length ? parts.join(' ') : undefined;
}

/** Whether this element needs the SVG-filter half of image adjustments (see the
 * ImageAdjustmentFilter component in @lumina/ui) — temperature/tint/duotone all require an
 * <feColorMatrix>/<feComponentTransfer> the plain CSS `filter` functions above can't express. */
export function needsSvgImageFilter(adjustments: ThemeImageAdjustments | undefined): boolean {
  if (!adjustments) return false;
  return !!adjustments.temperature || !!adjustments.tint || !!adjustments.duotone;
}

/**
 * CSS clip for a shape within its (still rectangular) bounding box — shared by the dashboard
 * editors and the player renderer so all three clip content identically. 'circle' uses
 * border-radius: 50%, which already renders as an ellipse on a non-square box (width != height),
 * so there's no separate 'ellipse' option — resizing a circle is how you get one.
 */
export function shapeClipStyle(shape: ThemeElementShape | undefined): { borderRadius?: string; clipPath?: string } {
  switch (shape) {
    case 'rounded': return { borderRadius: '12%' };
    case 'circle': return { borderRadius: '50%' };
    case 'triangle': return { clipPath: 'polygon(50% 0%, 0% 100%, 100% 100%)' };
    case 'pentagon': return { clipPath: 'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)' };
    case 'hexagon': return { clipPath: 'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)' };
    case 'octagon': return { clipPath: 'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)' };
    case 'star': return { clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' };
    case 'arrow': return { clipPath: 'polygon(0% 35%, 55% 35%, 55% 15%, 100% 50%, 55% 85%, 55% 65%, 0% 65%)' };
    case 'rectangle':
    default: return {};
  }
}

/**
 * Render style for a per-placement image/video crop (see ThemeElementStyle.cropZoom above,
 * mirrored by PlaylistItem/Zone's own cropZoom/cropOffsetX/cropOffsetY columns) — shared by
 * the dashboard editors and the player renderer. Unset (no cropZoom) means "show the whole
 * asset" and defers entirely to the caller's own default objectFit (fill for images, contain
 * for video/document) — this only kicks in once a user has actually used the crop tool.
 */
export function mediaCropStyle(crop?: {
  cropZoom?: number | null;
  cropOffsetX?: number | null;
  cropOffsetY?: number | null;
}): { objectFit?: 'cover'; transform?: string } {
  if (!crop?.cropZoom) return {};
  const x = crop.cropOffsetX ?? 0;
  const y = crop.cropOffsetY ?? 0;
  return { objectFit: 'cover', transform: `translate(${x}%, ${y}%) scale(${crop.cropZoom})` };
}

// Point lists for the non-rectangular, non-circular shapes above, in the same 0–100 coordinate
// space as their clip-path polygons — reused to draw a true stroked *outline* of each shape
// (a solid fill + clip-path can't produce a clean ring for an arbitrary polygon: a plain CSS
// `border` on a clipped box only follows the box's rectangular edge, not the clipped silhouette).
// Rectangle/rounded/circle don't need an entry — those get a native SVG <rect>/<ellipse> stroke
// instead, see shapeOutlineGeometry.
const SHAPE_OUTLINE_POINTS: Partial<Record<ThemeElementShape, Array<[number, number]>>> = {
  triangle: [[50, 0], [0, 100], [100, 100]],
  pentagon: [[50, 0], [100, 38], [82, 100], [18, 100], [0, 38]],
  hexagon: [[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]],
  octagon: [[30, 0], [70, 0], [100, 30], [100, 70], [70, 100], [30, 100], [0, 70], [0, 30]],
  star: [[50, 0], [61, 35], [98, 35], [68, 57], [79, 91], [50, 70], [21, 91], [32, 57], [2, 35], [39, 35]],
  arrow: [[0, 35], [55, 35], [55, 15], [100, 50], [55, 85], [55, 65], [0, 65]],
};

export type ShapeOutlineGeometry =
  | { kind: 'rect'; rx: number }
  | { kind: 'ellipse' }
  | { kind: 'polygon'; points: string };

/**
 * SVG `points` attribute for a BRUSH element's recorded stroke — shared by the Themes editor
 * canvas and the player renderer so the freehand line renders identically in both.
 */
export function brushPolylinePoints(points: ThemeBrushPoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

/**
 * Geometry for rendering `shapeFill: 'outline'` as an SVG stroke (viewBox="0 0 100 100",
 * preserveAspectRatio="none" to match how the clip-path shapes above stretch on non-square
 * boxes). Consumed by the dashboard editors and the player renderer, which each own the actual
 * <svg> JSX (kept out of this framework-agnostic package).
 */
export function shapeOutlineGeometry(shape: ThemeElementShape | undefined): ShapeOutlineGeometry {
  if (shape === 'circle') return { kind: 'ellipse' };
  if (shape && SHAPE_OUTLINE_POINTS[shape]) {
    return { kind: 'polygon', points: SHAPE_OUTLINE_POINTS[shape]!.map(([x, y]) => `${x},${y}`).join(' ') };
  }
  return { kind: 'rect', rx: shape === 'rounded' ? 12 : 0 };
}

// How far a slide entrance/exit travels, in px — fixed rather than configurable, matching the
// "presets, not a full timeline editor" scope of this feature.
const SLIDE_DISTANCE_PX = 40;

/**
 * The fixed `@keyframes` every entrance/exit/emphasis preset animates through — a single,
 * app-wide `<style>` block (see ElementAnimationStyles in @lumina/ui), not one generated per
 * element, since none of these need per-instance parameters (the per-element variation is all in
 * *which* keyframe + duration/delay/easing get applied, via buildEntranceAnimationStyle etc.
 * below). Slide keyframes both move and fade for a more polished look than a pure translate;
 * emphasis keyframes are a fixed-shape pulse/shake occupying the first ~15% of their own duration
 * so "animation-duration" can double as "repeat interval" under `iteration-count: infinite`.
 */
export const ELEMENT_ANIMATION_KEYFRAMES_CSS = `
@keyframes lumina-entrance-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes lumina-entrance-zoom { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }
@keyframes lumina-entrance-slide-up { from { opacity: 0; transform: translateY(${SLIDE_DISTANCE_PX}px); } to { opacity: 1; transform: translateY(0); } }
@keyframes lumina-entrance-slide-down { from { opacity: 0; transform: translateY(-${SLIDE_DISTANCE_PX}px); } to { opacity: 1; transform: translateY(0); } }
@keyframes lumina-entrance-slide-left { from { opacity: 0; transform: translateX(${SLIDE_DISTANCE_PX}px); } to { opacity: 1; transform: translateX(0); } }
@keyframes lumina-entrance-slide-right { from { opacity: 0; transform: translateX(-${SLIDE_DISTANCE_PX}px); } to { opacity: 1; transform: translateX(0); } }
@keyframes lumina-exit-fade { from { opacity: 1; } to { opacity: 0; } }
@keyframes lumina-exit-zoom { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.85); } }
@keyframes lumina-exit-slide-up { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-${SLIDE_DISTANCE_PX}px); } }
@keyframes lumina-exit-slide-down { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(${SLIDE_DISTANCE_PX}px); } }
@keyframes lumina-exit-slide-left { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(-${SLIDE_DISTANCE_PX}px); } }
@keyframes lumina-exit-slide-right { from { opacity: 1; transform: translateX(0); } to { opacity: 0; transform: translateX(${SLIDE_DISTANCE_PX}px); } }
@keyframes lumina-emphasis-pulse { 0% { transform: scale(1); } 8% { transform: scale(1.06); } 16% { transform: scale(1); } 100% { transform: scale(1); } }
@keyframes lumina-emphasis-shake { 0% { transform: translateX(0); } 2% { transform: translateX(-5px); } 4% { transform: translateX(5px); } 6% { transform: translateX(-5px); } 8% { transform: translateX(5px); } 10% { transform: translateX(0); } 100% { transform: translateX(0); } }
`;

/** CSS `animation-*` values for an element's entrance — undefined when there's nothing to
 * animate (preset 'none' or unset), so callers can skip touching `animation` at all. */
export function buildEntranceAnimationStyle(
  entrance: NonNullable<ThemeElementAnimation['entrance']> | undefined,
): Record<string, string> | undefined {
  if (!entrance || entrance.preset === 'none') return undefined;
  const name = entrance.preset === 'slide' ? `lumina-entrance-slide-${entrance.direction}` : `lumina-entrance-${entrance.preset}`;
  return {
    animationName: name,
    animationDuration: `${entrance.durationMs}ms`,
    animationDelay: `${entrance.delayMs}ms`,
    animationTimingFunction: entrance.easing,
    animationFillMode: 'both',
  };
}

/** CSS `animation-*` values for an element's exit — see the schema comment on
 * ThemeElementAnimationSchema.exit for why nothing in playback triggers this yet. */
export function buildExitAnimationStyle(
  exit: NonNullable<ThemeElementAnimation['exit']> | undefined,
): Record<string, string> | undefined {
  if (!exit || exit.preset === 'none') return undefined;
  const name = exit.preset === 'slide' ? `lumina-exit-slide-${exit.direction}` : `lumina-exit-${exit.preset}`;
  return {
    animationName: name,
    animationDuration: `${exit.durationMs}ms`,
    animationTimingFunction: exit.easing,
    animationFillMode: 'both',
  };
}

/** CSS `animation-*` values for an element's looping emphasis (pulse/shake). */
export function buildEmphasisAnimationStyle(
  emphasis: NonNullable<ThemeElementAnimation['emphasis']> | undefined,
): Record<string, string> | undefined {
  if (!emphasis || emphasis.preset === 'none') return undefined;
  return {
    animationName: `lumina-emphasis-${emphasis.preset}`,
    animationDuration: `${emphasis.intervalMs}ms`,
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite',
  };
}

const ANIMATION_STYLE_DEFAULTS: Record<string, string> = {
  animationName: 'none', animationDuration: '0s', animationDelay: '0s',
  animationTimingFunction: 'ease', animationIterationCount: '1', animationFillMode: 'none',
};

/**
 * Combines two or more of the buildXAnimationStyle results above into one `style` object playing
 * all of them at once — entrance and emphasis are independent CSS `animation`s that can run
 * simultaneously (e.g. an element fades in, then keeps pulsing), which the `animation-*`
 * longhand properties express as a comma-separated list, positionally paired with
 * `animation-name`'s own list. Each defined style contributes its own values; a style missing a
 * given longhand (e.g. emphasis has no `animation-delay`) falls back to that property's CSS
 * initial value so the lists stay the same length. Returns undefined if nothing was passed.
 */
export function combineAnimationStyles(
  ...styles: (Record<string, string> | undefined)[]
): Record<string, string> | undefined {
  const defined = styles.filter((s): s is Record<string, string> => !!s);
  if (defined.length === 0) return undefined;
  if (defined.length === 1) return defined[0];
  const result: Record<string, string> = {};
  for (const key of Object.keys(ANIMATION_STYLE_DEFAULTS)) {
    result[key] = defined.map((s) => s[key] ?? ANIMATION_STYLE_DEFAULTS[key]).join(', ');
  }
  return result;
}
