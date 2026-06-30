const BASE = import.meta.env['VITE_API_URL'] ?? 'http://localhost:4000/v1';

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
