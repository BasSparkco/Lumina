import type { ResolvedDesignPayload } from '@lumina/design-schema';

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/v1';

// Carries the HTTP status so callers can tell "screen was deleted" (404 — a definitive,
// permanent answer) apart from a network hiccup or a transient server error (which should
// just keep playing on cached state, not wipe local credentials).
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('player_token');
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText })) as { message?: string };
    throw new ApiError(res.status, err.message ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export interface PairingInitResponse {
  pairingCode: string;
  screenId: string;
}

export type CheckResponse = { paired: false } | { paired: true; token: string };

export type TickerDirection = 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT' | 'TOP_TO_BOTTOM' | 'BOTTOM_TO_TOP';

export type PlaylistItemKind = 'ASSET' | 'THEME' | 'LAYOUT' | 'DESIGN';

export interface PlaylistItem {
  id: string;
  position: number;
  durationSecs: number;
  muted: boolean;
  playFullVideo: boolean;
  // Per-placement image/video framing (crop editor) — null means "show the whole asset" per
  // the render-side default (fill for images, contain for video/document). Only meaningful for
  // an ASSET-kind item.
  cropZoom: number | null;
  cropOffsetX: number | null;
  cropOffsetY: number | null;
  kind: PlaylistItemKind;
  // Exactly one of asset/theme/layout/design is set, matching `kind` — a playlist item can be a
  // plain asset (an APP-type asset included — see AppAsset below), a whole Theme, a whole
  // Layout, or a designer2 Design (fully resolved: variables substituted, assetIds → URLs).
  asset: {
    id: string;
    name: string;
    type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'DOCUMENT' | 'APP';
    mimeType: string;
    url: string | null;
    thumbnailUrl: string | null;
    // One image URL per page, DOCUMENT only — empty for every other type. durationSecs above
    // doubles as "seconds per page" for DOCUMENT items (see ZonePlayer).
    pageUrls: string[];
    textContent: string | null;
    textFontFamily: string | null;
    textColor: string | null;
    textSize: 'SMALL' | 'MEDIUM' | 'LARGE' | 'XLARGE' | null;
    textBackgroundColor: string | null;
    textTickerEnabled: boolean;
    textTickerDirection: TickerDirection;
    textTickerSpeed: number | null;
    textTickerCrossOffset: number | null;
    // APP-type assets only.
    appProviderId?: string | null;
    appConfig?: AppConfig | null;
  } | null;
  theme: HydratedTheme | null;
  layout: { id: string; name: string; zones: Zone[] } | null;
  design: ResolvedDesignPayload | null;
}

export interface Playlist {
  id: string;
  name: string;
  items: PlaylistItem[];
}

export interface ScheduleRule {
  id: string;
  priority: number;
  startTime: string | null;
  endTime: string | null;
  daysOfWeek: number[];
  startDate: string | null;
  endDate: string | null;
  playlistId: string;
  playlist: Playlist | null;
}

export interface PowerRule {
  id: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
}

export type ZoneType = 'MEDIA' | 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER' | 'TIME' | 'DATE' | 'QR';
export type ElementShape = 'rectangle' | 'rounded' | 'circle' | 'triangle' | 'pentagon' | 'hexagon' | 'octagon' | 'star' | 'arrow';

export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  // Degrees, clockwise, about the zone's own center.
  rotation: number;
  zoneType: ZoneType;
  shape: ElementShape;
  widgetConfig: Record<string, unknown> | null;
  // At most one of these is ever set (enforced server-side) — a MEDIA zone plays either a
  // playlist or a single asset, the latter arriving already wrapped as a one-item Playlist.
  playlist: Playlist | null;
  audioPriority: boolean;
  audioVolume: number | null;
}

export type StreamingType = 'ASSET' | 'PLAYLIST' | 'WAYFINDING';

// A YouTube video/playlist from an APP-type asset (Assets page "Apps" tab), playable either as a
// screen's ASSET-mode content or as a playlist item. Mirrors the two appConfig shapes
// AssetsService.createApp/createAppPlaylist store — this is the same JSON, just typed here for
// the player's own use.
export type AppConfig =
  | { kind: 'video'; title: string; thumbnailUrl: string | null; embedUrl: string; width: number | null; height: number | null }
  | { kind: 'playlist'; playbackOrder: 'SEQUENTIAL' | 'SHUFFLE'; items: { sourceUrl: string; title: string; thumbnailUrl: string | null; embedUrl: string }[] };
// The shape AppPlayer actually needs — satisfied by both a PlaylistItem's `asset` (when
// `type === 'APP'`) and (historically) a screen-level appAsset.
export interface AppAsset {
  id: string;
  name: string;
  appProviderId?: string | null;
  appConfig?: AppConfig | null;
}

export type ThemeElementKind = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'PLAYLIST' | 'SHAPE' | 'BRUSH' | 'WIDGET';
export interface ThemeBrushPoint { x: number; y: number; }

export interface ThemePalette {
  primary: string;
  secondary: string;
  background: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
}

export interface ThemeTypography {
  headingFont: string;
  bodyFont: string;
  baseSizePx: number;
  scale: number;
}

export interface ThemeGradientFill {
  type: 'linear';
  angle: number;
  from: string;
  to: string;
}

export interface ThemeImageAdjustments {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  vibrance: number;
  temperature: number;
  tint: number;
  hue: number;
  duotone: { color1: string; color2: string } | null;
  preset?: string;
}

export interface ThemeElementStyle {
  color?: string;
  backgroundColor?: string | ThemeGradientFill;
  fontFamily?: string;
  fontSizePx?: number;
  fontWeight?: number | string;
  textAlign?: 'left' | 'center' | 'right';
  direction?: 'ltr' | 'rtl' | 'auto';
  borderRadius?: number;
  opacity?: number;
  objectFit?: 'contain' | 'cover' | 'fill';
  // Per-placement image/video framing (crop editor) — see mediaCropStyle in @lumina/types.
  cropZoom?: number;
  cropOffsetX?: number;
  cropOffsetY?: number;
  shape?: ElementShape;
  // SHAPE-kind only: a solid color-filled silhouette (default) or a stroked outline — the latter
  // for pure decoration (an emphasis ring, an arrow painted a color), no media/content of its own.
  shapeFill?: 'solid' | 'outline';
  strokeWidthPx?: number;
  // IMAGE-kind only: non-destructive color grading — see buildImageFilterCss in @lumina/types.
  imageAdjustments?: ThemeImageAdjustments;
}

export type ThemeAnimationEasing = 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out';
export type ThemeEntranceExitPreset = 'none' | 'fade' | 'slide' | 'zoom';
export type ThemeSlideDirection = 'up' | 'down' | 'left' | 'right';
export type ThemeEmphasisPreset = 'none' | 'pulse' | 'shake';
export type ThemeTextRevealPreset = 'none' | 'typewriter' | 'wordByWord';
export interface ThemeElementAnimation {
  entrance?: { preset: ThemeEntranceExitPreset; direction: ThemeSlideDirection; durationMs: number; delayMs: number; easing: ThemeAnimationEasing };
  emphasis?: { preset: ThemeEmphasisPreset; intervalMs: number };
  exit?: { preset: ThemeEntranceExitPreset; direction: ThemeSlideDirection; durationMs: number; easing: ThemeAnimationEasing };
  textReveal?: { preset: ThemeTextRevealPreset; speedMsPerUnit: number };
}

interface ThemeElementBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  // Degrees, clockwise, about the element's own center — defaults to 0 (unrotated) for
  // elements saved before this field existed.
  rotation?: number;
  editable: boolean;
  label?: string;
  style: ThemeElementStyle;
  animation?: ThemeElementAnimation;
}

// Content shapes as hydrated by the API — assetId/playlistId refs are resolved to a usable
// url/playlist alongside the raw id (mirrors how layout zones get their playlist hydrated).
export type HydratedThemeElement =
  | (ThemeElementBase & { kind: 'TEXT'; content: {
      text: string; translations?: Record<string, string>; assetId?: string | null;
      // Present only when assetId resolved to a TEXT asset — the asset's own presentation,
      // reused as-is (mirrors PlaylistItem['asset'] below).
      textContent?: string | null; textFontFamily?: string | null; textColor?: string | null;
      textSize?: string | null; textBackgroundColor?: string | null;
      textTickerEnabled?: boolean; textTickerDirection?: TickerDirection; textTickerSpeed?: number | null;
      textTickerCrossOffset?: number | null;
    } })
  | (ThemeElementBase & { kind: 'IMAGE'; content: { assetId: string | null; url: string | null } })
  | (ThemeElementBase & { kind: 'VIDEO'; content: { assetId: string | null; url: string | null } })
  | (ThemeElementBase & { kind: 'DOCUMENT'; content: { assetId: string | null; pageUrls: string[]; secondsPerPage: number } })
  | (ThemeElementBase & { kind: 'PLAYLIST'; content: { playlistId: string | null; playlist: Playlist | null } })
  | (ThemeElementBase & { kind: 'SHAPE'; content: Record<string, never> })
  | (ThemeElementBase & { kind: 'BRUSH'; content: { points: ThemeBrushPoint[]; raster?: { dataUrl: string; width: number; height: number } } })
  | (ThemeElementBase & { kind: 'WIDGET'; content: { widgetType: 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER' | 'TIME' | 'DATE'; widgetConfig: Record<string, unknown> } })
  | (ThemeElementBase & { kind: 'ICON'; content: { iconId: string; svg: string } });

export interface HydratedTheme {
  id: string;
  name: string;
  category: string;
  aspectRatio: string;
  palette: ThemePalette;
  typography: ThemeTypography;
  elements: HydratedThemeElement[];
}

export interface WayfindingPoiCategory {
  id: string;
  label: string;
  labelAr: string | null;
  icon: string;
  color: string;
}

export interface WayfindingPoi {
  id: string;
  name: string;
  nameAr: string | null;
  x: number;
  y: number;
  description: string | null;
  descriptionAr: string | null;
  status: 'OPEN' | 'CLOSED' | 'RELOCATED';
  floorId: string;
  floorLabel: string;
  category: WayfindingPoiCategory;
  iconUrl: string | null;
}

export type RouteEdgeType = 'WALK' | 'ELEVATOR' | 'ESCALATOR' | 'STAIRS';
export interface WayfindingRouteNode { id: string; floorId: string; x: number; y: number; label: string | null; }
export interface WayfindingRouteEdge { id: string; fromNodeId: string; toNodeId: string; type: RouteEdgeType; weight: number; }

export interface WayfindingDirectory {
  kiosk: { floorId: string; x: number; y: number };
  building: { id: string; name: string };
  floors: { id: string; level: number; label: string; floorPlanUrl: string | null }[];
  pois: WayfindingPoi[];
  // Route graph (Phase 7.3) — the whole building's nodes/edges, enough for the player to compute
  // a shortest path to any POI on any floor entirely on-device, offline-capable.
  routeNodes: WayfindingRouteNode[];
  routeEdges: WayfindingRouteEdge[];
  // Idle/attract-loop content (Phase 7.2) — at most one is ever non-null.
  attractPlaylist: Playlist | null;
  attractTheme: HydratedTheme | null;
}

export interface PlayerState {
  screenId: string;
  streamingType: StreamingType;
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  prayerMethod: string;
  athanEnabled: boolean;
  stopped: boolean;
  showClock: boolean;
  orientation: 0 | 90 | 180 | 270;
  aspectRatio: '16:9' | '9:16' | 'stretch';
  emergencyActive: boolean;
  emergencyPlaylist: Playlist | null;
  // Screen-level ASSET streaming mode's single asset, already wrapped as a one-item Playlist —
  // only non-null when streamingType is 'ASSET'.
  asset: Playlist | null;
  wayfinding: WayfindingDirectory | null;
  scheduleRules: ScheduleRule[];
  resolvedPlaylistId: string | null;
  defaultPlaylist: Playlist | null;
  poweredOn: boolean;
  powerScheduleRules: PowerRule[];
  volume: number;
}

export const api = {
  init: () => request<PairingInitResponse>('/player/init', { method: 'POST' }),
  checkPairing: (screenId: string) => request<{ paired: false } | { paired: true; token: string }>(`/player/check?screenId=${screenId}`),
  getPlaylist: () => request<Playlist | null>('/player/playlist'),
  getState: () => request<PlayerState>('/player/state'),
  heartbeat: (currentAssetId: string | null, hasContent?: boolean) =>
    request('/player/heartbeat', { method: 'POST', body: JSON.stringify({ currentAssetId, hasContent }) }),
  // Kiosk analytics (7.4) — see apps/player/src/lib/kioskAnalytics.ts for the fire-and-forget
  // wrapper callers actually use.
  logWayfindingEvents: (events: { type: 'SESSION_START' | 'SEARCH' | 'POI_VIEW'; query?: string; poiId?: string; poiName?: string }[]) =>
    request('/player/wayfinding-events', { method: 'POST', body: JSON.stringify({ events }) }),
  getWeather: (lat: number, lon: number) =>
    request<WeatherData | null>(`/feeds/weather?lat=${lat}&lon=${lon}`),
  getCurrency: (base = 'USD') =>
    request<CurrencyData | null>(`/feeds/currency?base=${base}`),
  getTicker: (url: string) =>
    request<TickerData | null>(`/feeds/ticker?url=${encodeURIComponent(url)}`),
  // Raw fetch, not the shared `request()` helper — that always sends
  // `Content-Type: application/json`, which would stomp the multipart boundary the browser
  // needs to set itself for a FormData body.
  uploadScreenshot: async (blob: Blob): Promise<void> => {
    const token = localStorage.getItem('player_token');
    const form = new FormData();
    form.append('file', blob, 'screenshot.jpg');
    const res = await fetch(`${BASE}/player/screenshot`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    if (!res.ok) throw new Error(`Screenshot upload failed: ${res.status}`);
  },
};

export interface WeatherData {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windKmh: number;
  weatherCode: number;
  condition: string;
  icon: string;
  fetchedAt: string;
}

export interface CurrencyData {
  base: string;
  rates: Record<string, number>;
  fetchedAt: string;
}

export interface TickerItem {
  title: string;
  link: string;
}

export interface TickerData {
  url: string;
  items: TickerItem[];
  fetchedAt: string;
}
