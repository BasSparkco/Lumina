import Cookies from 'js-cookie';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1';
const TOKEN_KEY = 'lumina_token';

export function getToken() { return Cookies.get(TOKEN_KEY) ?? null; }
export function setToken(t: string) { Cookies.set(TOKEN_KEY, t, { expires: 7, sameSite: 'lax' }); }
export function clearToken() { Cookies.remove(TOKEN_KEY); }

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    // The API returns an ETag but no Cache-Control header on GET responses, which leaves
    // the browser's HTTP cache behavior up to per-browser heuristics instead of an explicit
    // rule — react-query already owns caching for this app, so never let a second, invisible
    // cache layer serve a stale response underneath it.
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });
  // Only auto-redirect when a previously-valid session got rejected (token expired/revoked).
  // Without the `token` check, this also fires for a plain wrong-password attempt on the
  // login endpoint itself (also a 401), forcing a hard navigation mid-attempt and wiping
  // whatever the login form was showing (error message, entered email, etc.).
  if (token && res.status === 401) { clearToken(); if (typeof window !== 'undefined') window.location.replace('/en/login'); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(body.message ?? res.statusText);
  }
  // NestJS's default status for DELETE routes is 200, not 204, and these controllers don't
  // override it — so a successful delete comes back as `200` with a genuinely empty body,
  // not just `204`. `res.json()` throws "Unexpected end of JSON input" on an empty body,
  // which was silently rejecting the mutation's promise and skipping `onSuccess` entirely
  // (no cache update, no audit log entry) even though the delete had already succeeded.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ── Auth ────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (email: string, password: string) =>
    req<{ token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (orgName: string, email: string, password: string, name: string) =>
    req<{ token: string; user: User }>('/auth/register', { method: 'POST', body: JSON.stringify({ orgName, email, password, name }) }),
  me: () => req<User>('/auth/me'),
};

// ── Screens ─────────────────────────────────────────────────────────────────
export const screensApi = {
  list: () => req<Screen[]>('/screens'),
  create: (name: string) => req<Screen>('/screens', { method: 'POST', body: JSON.stringify({ name }) }),
  remove: (id: string) => req<void>(`/screens/${id}`, { method: 'DELETE' }),
  rename: (id: string, name: string) => req<Screen>(`/screens/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  pair: (code: string) => req<Screen>('/screens/pair', { method: 'POST', body: JSON.stringify({ code }) }),
  setContent: (id: string, data: { contentType: ScreenContentType | null; assetId?: string | null; playlistId?: string | null; themeId?: string | null }) =>
    req<Screen>(`/screens/${id}/content`, { method: 'PUT', body: JSON.stringify(data) }),
  publish: (id: string) => req<{ ok: boolean }>(`/screens/${id}/publish`, { method: 'POST' }),
  reload: (id: string) => req<{ ok: boolean }>(`/screens/${id}/reload`, { method: 'POST' }),
  setLayout: (id: string, layoutId: string | null) =>
    req<Screen>(`/screens/${id}/layout`, { method: 'PUT', body: JSON.stringify({ layoutId }) }),
  setEmergency: (id: string, active: boolean, playlistId?: string) =>
    req<Screen>(`/screens/${id}/emergency`, { method: 'PUT', body: JSON.stringify({ active, playlistId }) }),
  updatePrayer: (id: string, data: { latitude?: number; longitude?: number; prayerMethod?: string; athanEnabled?: boolean; timezone?: string; timezoneEnabled?: boolean }) =>
    req<Screen>(`/screens/${id}/prayer`, { method: 'PUT', body: JSON.stringify(data) }),
};

// ── Assets ──────────────────────────────────────────────────────────────────
export const assetsApi = {
  list: () => req<Asset[]>('/assets'),
  upload: async (file: File, onProgress?: (pct: number) => void): Promise<Asset> => {
    const token = getToken();
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/assets/upload`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e: ProgressEvent) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => { if (xhr.status < 300) resolve(JSON.parse(xhr.responseText) as Asset); else reject(new Error(xhr.responseText)); };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(form);
    });
  },
  get: (id: string) => req<Asset>(`/assets/${id}`),
  rename: (id: string, name: string) => req<Asset>(`/assets/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  remove: (id: string) => req<void>(`/assets/${id}`, { method: 'DELETE' }),
  library: (params?: { category?: AssetCategory; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return req<Asset[]>(`/assets/library${suffix}`);
  },
  useFromLibrary: (id: string) => req<Asset>(`/assets/library/${id}/use`, { method: 'POST' }),
};

// ── Playlists ────────────────────────────────────────────────────────────────
export const playlistsApi = {
  list: () => req<PlaylistSummary[]>('/playlists'),
  create: (name: string) => req<PlaylistSummary>('/playlists', { method: 'POST', body: JSON.stringify({ name }) }),
  get: (id: string) => req<Playlist>(`/playlists/${id}`),
  rename: (id: string, name: string) => req<PlaylistSummary>(`/playlists/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  remove: (id: string) => req<void>(`/playlists/${id}`, { method: 'DELETE' }),
  addItem: (id: string, assetId: string, durationSecs: number, muted?: boolean, playFullVideo?: boolean) =>
    req<PlaylistItem>(`/playlists/${id}/items`, { method: 'POST', body: JSON.stringify({ assetId, durationSecs, muted, playFullVideo }) }),
  updateItem: (id: string, itemId: string, durationSecs: number, muted?: boolean, playFullVideo?: boolean) =>
    req<PlaylistItem>(`/playlists/${id}/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ durationSecs, muted, playFullVideo }) }),
  removeItem: (id: string, itemId: string) => req<void>(`/playlists/${id}/items/${itemId}`, { method: 'DELETE' }),
  reorder: (id: string, ids: string[]) => req<void>(`/playlists/${id}/reorder`, { method: 'PUT', body: JSON.stringify({ ids }) }),
};

// ── Layouts ─────────────────────────────────────────────────────────────────
export const layoutsApi = {
  list: () => req<Layout[]>('/layouts'),
  create: (name: string, zones: ZoneInput[]) =>
    req<Layout>('/layouts', { method: 'POST', body: JSON.stringify({ name, zones }) }),
  update: (id: string, name: string, zones: ZoneInput[]) =>
    req<Layout>(`/layouts/${id}`, { method: 'PUT', body: JSON.stringify({ name, zones }) }),
  remove: (id: string) => req<void>(`/layouts/${id}`, { method: 'DELETE' }),
};

// ── Themes ──────────────────────────────────────────────────────────────────
export const themesApi = {
  list: () => req<Theme[]>('/themes'),
  get: (id: string) => req<Theme>(`/themes/${id}`),
  create: (input: ThemeInput) => req<Theme>('/themes', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: ThemeInput) => req<Theme>(`/themes/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  duplicate: (id: string) => req<Theme>(`/themes/${id}/duplicate`, { method: 'POST' }),
  remove: (id: string) => req<void>(`/themes/${id}`, { method: 'DELETE' }),
};

// ── Schedules ────────────────────────────────────────────────────────────────
export const schedulesApi = {
  list: (screenId?: string) =>
    req<ScheduleEntry[]>(`/schedules${screenId ? `?screenId=${screenId}` : ''}`),
  create: (data: CreateScheduleInput) =>
    req<ScheduleEntry>('/schedules', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: CreateScheduleInput) =>
    req<ScheduleEntry>(`/schedules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: string) => req<void>(`/schedules/${id}`, { method: 'DELETE' }),
};

// ── Types ───────────────────────────────────────────────────────────────────
export type ZoneType = 'MEDIA' | 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER';
export type UserRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
export interface User { id: string; email: string; name: string; role: UserRole; orgId: string; }
export interface ZoneInput { name: string; x: number; y: number; width: number; height: number; zIndex?: number; zoneType?: ZoneType; widgetConfig?: Record<string, unknown>; playlistId?: string; }
export interface ZoneRecord extends ZoneInput { id: string; playlist: { id: string; name: string } | null; }
export interface Layout { id: string; name: string; zones: ZoneRecord[]; _count?: { screens: number }; }
export interface CreateScheduleInput {
  name: string; screenId: string; playlistId: string; priority?: number;
  startTime?: string; endTime?: string; daysOfWeek?: number[];
  startDate?: string; endDate?: string;
}
export interface ScheduleEntry extends CreateScheduleInput {
  id: string; createdAt: string; playlist: { id: string; name: string }; screen: { id: string; name: string };
}
export type ScreenContentType = 'VIDEO' | 'IMAGE' | 'PLAYLIST' | 'THEME';
export interface Screen {
  id: string; name: string; status: 'ONLINE' | 'OFFLINE'; lastSeenAt: string | null;
  paired: boolean;
  contentType: ScreenContentType | null;
  assetId: string | null;
  playlistId: string | null; playlist?: { id: string; name: string } | null;
  layoutId: string | null; themeId: string | null; emergencyActive: boolean;
  latitude: number | null; longitude: number | null;
  prayerMethod: string; athanEnabled: boolean; timezone: string; timezoneEnabled: boolean;
}
export type AssetCategory = 'BACKGROUND' | 'ICON' | 'ILLUSTRATION' | 'STOCK_PHOTO' | 'LOGO' | 'VIDEO_LOOP' | 'AUDIO_JINGLE' | 'GENERIC';
export interface Asset {
  id: string; name: string; type: 'IMAGE' | 'VIDEO' | 'AUDIO'; mimeType: string;
  sizeBytes: number; status: string; url: string | null; thumbnailUrl: string | null;
  downloadUrl: string | null; category: AssetCategory; tags: string[];
  width: number | null; height: number | null; durationSecs: number | null; createdAt: string;
}
export interface PlaylistItem {
  id: string; position: number; durationSecs: number; muted: boolean; playFullVideo: boolean;
  asset: Asset;
}
export interface PlaylistSummary { id: string; name: string; _count: { items: number }; updatedAt: string; }
export interface Playlist extends PlaylistSummary { items: PlaylistItem[]; }

// ── Themes ──────────────────────────────────────────────────────────────────
export type ThemeCategory = 'RESTAURANT_MENU' | 'RETAIL_PROMO' | 'HOTEL_LOBBY' | 'CLINIC_WAITING' | 'MOSQUE' | 'GENERIC';
export type ThemeElementKind = 'TEXT' | 'IMAGE' | 'VIDEO' | 'PLAYLIST' | 'SHAPE' | 'WIDGET';
export type ThemeWidgetType = 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER';

export interface ThemePalette {
  primary: string; secondary: string; background: string; surface: string;
  text: string; textMuted: string; accent: string;
}
export interface ThemeTypography { headingFont: string; bodyFont: string; baseSizePx: number; scale: number; }

export interface ThemeElementStyle {
  color?: string; backgroundColor?: string; fontFamily?: string;
  fontSizePx?: number; fontWeight?: number | string; textAlign?: 'left' | 'center' | 'right';
  direction?: 'ltr' | 'rtl' | 'auto'; borderRadius?: number; opacity?: number;
  objectFit?: 'contain' | 'cover' | 'fill';
}
interface ThemeElementBase {
  id: string; x: number; y: number; width: number; height: number; zIndex: number;
  editable: boolean; label?: string; style: ThemeElementStyle;
}
export type ThemeElement =
  | (ThemeElementBase & { kind: 'TEXT'; content: { text: string; translations?: Record<string, string> } })
  | (ThemeElementBase & { kind: 'IMAGE'; content: { assetId: string | null } })
  | (ThemeElementBase & { kind: 'VIDEO'; content: { assetId: string | null } })
  | (ThemeElementBase & { kind: 'PLAYLIST'; content: { playlistId: string | null } })
  | (ThemeElementBase & { kind: 'SHAPE'; content: Record<string, never> })
  | (ThemeElementBase & { kind: 'WIDGET'; content: { widgetType: ThemeWidgetType; widgetConfig: Record<string, unknown> } });

export interface ThemeInput {
  name: string; category: ThemeCategory; aspectRatio?: string;
  palette: ThemePalette; typography: ThemeTypography; elements: ThemeElement[];
}
export interface Theme extends Omit<ThemeInput, 'aspectRatio'> {
  id: string; organizationId: string | null; aspectRatio: string; createdAt: string; updatedAt: string;
  _count?: { screens: number };
}
