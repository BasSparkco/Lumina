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

export interface PlaylistItem {
  id: string;
  position: number;
  durationSecs: number;
  muted: boolean;
  playFullVideo: boolean;
  asset: {
    id: string;
    name: string;
    type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'TEXT';
    mimeType: string;
    url: string | null;
    thumbnailUrl: string | null;
    textContent: string | null;
    textFontFamily: string | null;
    textColor: string | null;
    textSize: 'SMALL' | 'MEDIUM' | 'LARGE' | 'XLARGE' | null;
    textBackgroundColor: string | null;
  };
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

export type ZoneType = 'MEDIA' | 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER';
export type ElementShape = 'rectangle' | 'rounded' | 'circle' | 'triangle';

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

export type StreamingType = 'ASSET' | 'PLAYLIST' | 'LAYOUT' | 'THEME';

export type ThemeElementKind = 'TEXT' | 'IMAGE' | 'VIDEO' | 'PLAYLIST' | 'SHAPE' | 'WIDGET';

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

export interface ThemeElementStyle {
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSizePx?: number;
  fontWeight?: number | string;
  textAlign?: 'left' | 'center' | 'right';
  direction?: 'ltr' | 'rtl' | 'auto';
  borderRadius?: number;
  opacity?: number;
  objectFit?: 'contain' | 'cover' | 'fill';
  shape?: ElementShape;
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
}

// Content shapes as hydrated by the API — assetId/playlistId refs are resolved to a usable
// url/playlist alongside the raw id (mirrors how layout zones get their playlist hydrated).
export type HydratedThemeElement =
  | (ThemeElementBase & { kind: 'TEXT'; content: { text: string; translations?: Record<string, string> } })
  | (ThemeElementBase & { kind: 'IMAGE'; content: { assetId: string | null; url: string | null } })
  | (ThemeElementBase & { kind: 'VIDEO'; content: { assetId: string | null; url: string | null } })
  | (ThemeElementBase & { kind: 'PLAYLIST'; content: { playlistId: string | null; playlist: Playlist | null } })
  | (ThemeElementBase & { kind: 'SHAPE'; content: Record<string, never> })
  | (ThemeElementBase & { kind: 'WIDGET'; content: { widgetType: 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER'; widgetConfig: Record<string, unknown> } });

export interface HydratedTheme {
  id: string;
  name: string;
  category: string;
  aspectRatio: string;
  palette: ThemePalette;
  typography: ThemeTypography;
  elements: HydratedThemeElement[];
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
  emergencyActive: boolean;
  emergencyPlaylist: Playlist | null;
  // Screen-level ASSET streaming mode's single asset, already wrapped as a one-item Playlist —
  // only non-null when streamingType is 'ASSET'.
  asset: Playlist | null;
  layout: { id: string; name: string; zones: Zone[] } | null;
  theme: HydratedTheme | null;
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
