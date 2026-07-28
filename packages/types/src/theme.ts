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

export const ThemeElementKindSchema = z.enum(['TEXT', 'IMAGE', 'VIDEO', 'PLAYLIST', 'SHAPE', 'WIDGET']);
export type ThemeElementKind = z.infer<typeof ThemeElementKindSchema>;

export const ThemeWidgetTypeSchema = z.enum(['PRAYER', 'WEATHER', 'CURRENCY', 'TICKER']);
export type ThemeWidgetType = z.infer<typeof ThemeWidgetTypeSchema>;

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
