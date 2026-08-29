export * from './screen';
export * from './asset';
export * from './playlist';
export * from './player';
export * from './player-manifest';
export * from './theme';
export * from './fonts';
export * from './wayfinding';

// Explicit re-exports of runtime values (schemas, functions) alongside the `export *`
// above: `export *` compiles to a dynamic re-export loop that bundlers' CJS/ESM interop
// (cjs-module-lexer) can't statically see through, so consumers that only need types are
// fine, but anything importing an actual value from this barrel (e.g. Vite apps) needs a
// statically analyzable named export.
export {
  ScreenStatusSchema,
  ScreenSchema,
  PairingCodeResponseSchema,
} from './screen';
export {
  AssetTypeSchema,
  AssetStatusSchema,
  AssetCategorySchema,
  AssetSchema,
} from './asset';
export { PlaylistItemSchema, PlaylistSchema } from './playlist';
export { PlayerCommandSchema, HeartbeatPayloadSchema } from './player';
export {
  ThemeCategorySchema,
  ThemeAspectRatioSchema,
  ThemePaletteSchema,
  ThemeTypographySchema,
  ThemeElementKindSchema,
  ThemeWidgetTypeSchema,
  ThemeElementShapeSchema,
  ThemeElementStyleSchema,
  ThemeElementSchema,
  ThemeSchema,
  ThemeInputSchema,
  resolveThemeColor,
  shapeClipStyle,
} from './theme';
export { FONT_LIBRARY, FONT_IDS, DEFAULT_FONT_ID, fontStack } from './fonts';
export { POI_CATEGORY_PRESETS } from './wayfinding';
