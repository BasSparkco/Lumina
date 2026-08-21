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

export const ThemeElementKindSchema = z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'PLAYLIST', 'SHAPE', 'BRUSH', 'WIDGET']);
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

// Style values for color fields accept either a literal CSS color or a "palette.<role>"
// reference, resolved at render time via resolveThemeColor().
export const ThemeElementStyleSchema = z.object({
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
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
}).default({});
export type ThemeElementStyle = z.infer<typeof ThemeElementStyleSchema>;

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
