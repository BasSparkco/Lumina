const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/v1';

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
    throw new Error(err.message ?? res.statusText);
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
    type: 'IMAGE' | 'VIDEO' | 'AUDIO';
    mimeType: string;
    url: string;
    thumbnailUrl: string | null;
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

export type ZoneType = 'MEDIA' | 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER';

export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  zoneType: ZoneType;
  widgetConfig: Record<string, unknown> | null;
  playlist: Playlist | null;
}

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
}

interface ThemeElementBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
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
  timezone: string;
  latitude: number | null;
  longitude: number | null;
  prayerMethod: string;
  athanEnabled: boolean;
  emergencyActive: boolean;
  emergencyPlaylist: Playlist | null;
  layout: { id: string; name: string; zones: Zone[] } | null;
  theme: HydratedTheme | null;
  scheduleRules: ScheduleRule[];
  resolvedPlaylistId: string | null;
  defaultPlaylist: Playlist | null;
}

export const api = {
  init: () => request<PairingInitResponse>('/player/init', { method: 'POST' }),
  checkPairing: (screenId: string) => request<{ paired: false } | { paired: true; token: string }>(`/player/check?screenId=${screenId}`),
  getPlaylist: () => request<Playlist | null>('/player/playlist'),
  getState: () => request<PlayerState>('/player/state'),
  heartbeat: (currentAssetId: string | null) =>
    request('/player/heartbeat', { method: 'POST', body: JSON.stringify({ currentAssetId }) }),
  getWeather: (lat: number, lon: number) =>
    request<WeatherData | null>(`/feeds/weather?lat=${lat}&lon=${lon}`),
  getCurrency: (base = 'USD') =>
    request<CurrencyData | null>(`/feeds/currency?base=${base}`),
  getTicker: (url: string) =>
    request<TickerData | null>(`/feeds/ticker?url=${encodeURIComponent(url)}`),
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
