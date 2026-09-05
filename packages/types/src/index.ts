export * from './screen';
export * from './asset';
export * from './playlist';
export * from './player';
export * from './player-manifest';
export * from './theme';
export * from './fonts';
export * from './wayfinding';
export * from './playlist-transitions';
export * from './modules';
export * from './wayfinding-ai';
export * from './room-booking';

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
export {
  PLAYLIST_TRANSITION_IDS,
  PlaylistTransitionIdSchema,
  DEFAULT_PLAYLIST_TRANSITION_ID,
  DEFAULT_PLAYLIST_TRANSITION_DURATION_MS,
  INHERIT_PLAYLIST_TRANSITION,
  PLAYLIST_TRANSITION_KEYFRAMES_CSS,
  PLAYLIST_TRANSITION_REGISTRY,
  PLAYLIST_TRANSITION_OPTIONS,
  resolvePlaylistTransition,
  resolveEffectiveTransitionId,
  resolveEffectiveTransition,
  buildIncomingTransitionStyle,
  buildOutgoingTransitionStyle,
} from './playlist-transitions';
export {
  MODULE_KEYS,
  ModuleKeySchema,
  MODULE_DEPENDENCIES,
  TENANT_MODULE_STATUSES,
  TenantModuleStatusSchema,
  ORGANIZATION_STATUSES,
  OrganizationStatusSchema,
} from './modules';
export {
  WAYFINDING_AI_LANGUAGES,
  WayfindingAiLanguageSchema,
  WAYFINDING_AI_MAX_INPUT_CHARS,
  WAYFINDING_AI_MAX_RECENT_TURNS,
  WAYFINDING_AI_MAX_ALTERNATIVES,
  WAYFINDING_AI_MAX_CANDIDATES,
  WAYFINDING_AI_MAX_MESSAGE_CHARS,
  ResolveWayfindingAiRequestSchema,
  WayfindingAiResolutionSchema,
  ProviderResolutionSchema,
  WAYFINDING_AI_USAGE_OUTCOMES,
  WayfindingAiUsageOutcomeSchema,
  UpdateWayfindingAiScreenConfigSchema,
  TestResolveWayfindingAiSchema,
} from './wayfinding-ai';
export {
  BOOKABLE_ROOM_STATUSES,
  BookableRoomStatusSchema,
  ROOM_PRIVACY_MODES,
  RoomPrivacyModeSchema,
  ROOM_CALENDAR_PROVIDER_KEYS,
  RoomCalendarProviderKeySchema,
  ROOM_RESERVATION_STATUSES,
  RoomReservationStatusSchema,
  ROOM_RESERVATION_ORIGINS,
  RoomReservationOriginSchema,
  QUICK_BOOKING_DURATIONS_MINUTES,
  MAX_QUICK_BOOKING_DURATIONS,
  MIN_ROOM_NAME_LENGTH,
  MAX_ROOM_NAME_LENGTH,
  MAX_AMENITIES,
  RoomSummarySchema,
  CreateRoomSchema,
  UpdateRoomSchema,
  ReservationSchema,
  CreateReservationSchema,
  UpdateReservationSchema,
  AvailabilitySchema,
  DisplayBindingSchema,
  UpdateDisplayBindingSchema,
  RoomBookingPlayerReservationSchema,
  RoomBookingPlayerPayloadSchema,
  BookNowRequestSchema,
  BookNowResponseSchema,
  IntegrationHealthSchema,
  ROOM_DISPLAY_STATE_KINDS,
} from './room-booking';
