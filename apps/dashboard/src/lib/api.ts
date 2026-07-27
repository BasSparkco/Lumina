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

// ── Org settings ────────────────────────────────────────────────────────────
export const orgApi = {
  getSettings: () => req<{ autoPublish: boolean }>('/org/settings'),
  updateSettings: (autoPublish: boolean) =>
    req<{ autoPublish: boolean }>('/org/settings', { method: 'PUT', body: JSON.stringify({ autoPublish }) }),
};

// ── Screens ─────────────────────────────────────────────────────────────────
export const screensApi = {
  list: () => req<Screen[]>('/screens'),
  create: (name: string) => req<Screen>('/screens', { method: 'POST', body: JSON.stringify({ name }) }),
  remove: (id: string) => req<void>(`/screens/${id}`, { method: 'DELETE' }),
  unpair: (id: string) => req<Screen>(`/screens/${id}/unpair`, { method: 'POST' }),
  rename: (id: string, name: string) => req<Screen>(`/screens/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  pair: (code: string) => req<Screen>('/screens/pair', { method: 'POST', body: JSON.stringify({ code }) }),
  assign: (id: string, playlistId: string | null) =>
    req<Screen>(`/screens/${id}/assign`, { method: 'POST', body: JSON.stringify({ playlistId }) }),
  publish: (id: string) => req<{ ok: boolean }>(`/screens/${id}/publish`, { method: 'POST' }),
  reload: (id: string) => req<{ ok: boolean }>(`/screens/${id}/reload`, { method: 'POST' }),
  setLayout: (id: string, layoutId: string | null) =>
    req<Screen>(`/screens/${id}/layout`, { method: 'PUT', body: JSON.stringify({ layoutId }) }),
  setStreamingType: (id: string, streamingType: StreamingType) =>
    req<Screen>(`/screens/${id}/streaming-type`, { method: 'PUT', body: JSON.stringify({ streamingType }) }),
  setAsset: (id: string, assetId: string | null) =>
    req<Screen>(`/screens/${id}/asset`, { method: 'PUT', body: JSON.stringify({ assetId }) }),
  setEmergency: (id: string, active: boolean, playlistId?: string) =>
    req<Screen>(`/screens/${id}/emergency`, { method: 'PUT', body: JSON.stringify({ active, playlistId }) }),
  setStopped: (id: string, stopped: boolean) =>
    req<Screen>(`/screens/${id}/stop`, { method: 'PUT', body: JSON.stringify({ stopped }) }),
  setVolume: (id: string, volume: number | null) =>
    req<Screen>(`/screens/${id}/volume`, { method: 'PUT', body: JSON.stringify({ volume }) }),
  updatePrayer: (id: string, data: { latitude?: number; longitude?: number; prayerMethod?: string; athanEnabled?: boolean; timezone?: string }) =>
    req<Screen>(`/screens/${id}/prayer`, { method: 'PUT', body: JSON.stringify(data) }),
  captureScreenshot: (id: string) => req<{ ok: boolean }>(`/screens/${id}/capture-screenshot`, { method: 'POST' }),
  crashReports: (id: string) => req<CrashReport[]>(`/screens/${id}/crash-reports`),
  fleetStatus: () => req<FleetStatus>('/screens/fleet-status'),
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
  setAudioEnabled: (id: string, audioEnabled: boolean) =>
    req<Asset>(`/assets/${id}/audio`, { method: 'PUT', body: JSON.stringify({ audioEnabled }) }),
  remove: (id: string) => req<void>(`/assets/${id}`, { method: 'DELETE' }),
  createText: (name: string, content: string, style: TextStyle) =>
    req<Asset>('/assets/text', { method: 'POST', body: JSON.stringify({ name, content, ...style }) }),
  updateText: (id: string, dto: { name?: string; content?: string } & Partial<TextStyle>) =>
    req<Asset>(`/assets/${id}/text`, { method: 'PUT', body: JSON.stringify(dto) }),
};

// ── Playlists ────────────────────────────────────────────────────────────────
export const playlistsApi = {
  list: () => req<PlaylistSummary[]>('/playlists'),
  create: (name: string) => req<PlaylistSummary>('/playlists', { method: 'POST', body: JSON.stringify({ name }) }),
  get: (id: string) => req<Playlist>(`/playlists/${id}`),
  rename: (id: string, name: string) => req<PlaylistSummary>(`/playlists/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  remove: (id: string) => req<void>(`/playlists/${id}`, { method: 'DELETE' }),
  addItem: (id: string, assetId: string, durationSecs: number, muted?: boolean) =>
    req<PlaylistItem>(`/playlists/${id}/items`, { method: 'POST', body: JSON.stringify({ assetId, durationSecs, muted }) }),
  updateItem: (id: string, itemId: string, durationSecs: number, muted?: boolean) =>
    req<PlaylistItem>(`/playlists/${id}/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ durationSecs, muted }) }),
  removeItem: (id: string, itemId: string) => req<void>(`/playlists/${id}/items/${itemId}`, { method: 'DELETE' }),
  reorder: (id: string, ids: string[]) => req<void>(`/playlists/${id}/reorder`, { method: 'PUT', body: JSON.stringify({ ids }) }),
  updateConfig: (id: string, config: { transitionStyle?: TransitionStyle; transitionDurationMs?: number; playbackOrder?: PlaybackOrder }) =>
    req<Playlist>(`/playlists/${id}/config`, { method: 'PUT', body: JSON.stringify(config) }),
};

// ── Layouts ─────────────────────────────────────────────────────────────────
// The API's ValidationPipe runs with forbidNonWhitelisted: true — any client-only field (like
// ZoneInput._localId, used purely for stable React keys while editing) 400s the save unless
// stripped first.
function stripLocalId(zones: ZoneInput[]) {
  return zones.map(({ _localId: _unused, ...z }) => z);
}

export const layoutsApi = {
  list: () => req<Layout[]>('/layouts'),
  create: (name: string, zones: ZoneInput[]) =>
    req<Layout>('/layouts', { method: 'POST', body: JSON.stringify({ name, zones: stripLocalId(zones) }) }),
  update: (id: string, name: string, zones: ZoneInput[]) =>
    req<Layout>(`/layouts/${id}`, { method: 'PUT', body: JSON.stringify({ name, zones: stripLocalId(zones) }) }),
  remove: (id: string) => req<void>(`/layouts/${id}`, { method: 'DELETE' }),
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

// ── Power schedules ──────────────────────────────────────────────────────────
export const powerSchedulesApi = {
  list: (target: { screenId?: string; groupId?: string }) => {
    const params = new URLSearchParams();
    if (target.screenId) params.set('screenId', target.screenId);
    if (target.groupId) params.set('groupId', target.groupId);
    const qs = params.toString();
    return req<PowerScheduleEntry[]>(`/power-schedules${qs ? `?${qs}` : ''}`);
  },
  create: (data: CreatePowerScheduleInput) =>
    req<PowerScheduleEntry>('/power-schedules', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: CreatePowerScheduleInput) =>
    req<PowerScheduleEntry>(`/power-schedules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: string) => req<void>(`/power-schedules/${id}`, { method: 'DELETE' }),
  previewNow: (screenId: string) =>
    req<{ poweredOn: boolean }>(`/power-schedules/preview?screenId=${screenId}`),
};

// Real backend-side screen groups (/screen-groups) — distinct from lib/mocks/screenGroups.ts,
// which the Screens page still uses for its own group chips/assignment pending its own
// migration off localStorage. This client only needs a target list + the ability to create one
// for the power-schedule picker below; it doesn't touch screen-to-group assignment.
export const realScreenGroupsApi = {
  list: () => req<{ id: string; name: string; volume: number | null }[]>('/screen-groups'),
  create: (name: string) => req<{ id: string; name: string; volume: number | null }>('/screen-groups', { method: 'POST', body: JSON.stringify({ name }) }),
  setVolume: (id: string, volume: number | null) =>
    req<{ id: string; name: string; volume: number | null }>(`/screen-groups/${id}/volume`, { method: 'PUT', body: JSON.stringify({ volume }) }),
};

// ── Types ───────────────────────────────────────────────────────────────────
export type ZoneType = 'MEDIA' | 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER';
export type UserRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
export type StreamingType = 'ASSET' | 'PLAYLIST' | 'LAYOUT';
export interface User { id: string; email: string; name: string; role: UserRole; orgId: string; }
export interface ZoneInput {
  name: string; x: number; y: number; width: number; height: number; zIndex?: number; zoneType?: ZoneType;
  widgetConfig?: Record<string, unknown>;
  // Mutually exclusive — a MEDIA zone plays either a playlist or a single asset, never both.
  playlistId?: string; assetId?: string;
  audioPriority?: boolean; audioVolume?: number | null;
  // Dashboard-only, client-generated, stripped before every network call — see layouts/page.tsx.
  // Not sent to (or returned by) the API, so it's optional and absent from ZoneRecord.
  _localId?: string;
}
export interface ZoneRecord extends ZoneInput { id: string; playlist: { id: string; name: string } | null; asset: { id: string; name: string } | null; }
export interface Layout { id: string; name: string; zones: ZoneRecord[]; _count?: { screens: number }; }
export interface CreateScheduleInput {
  name: string; screenId: string; playlistId: string; priority?: number;
  startTime?: string; endTime?: string; daysOfWeek?: number[];
  startDate?: string; endDate?: string;
}
export interface ScheduleEntry extends CreateScheduleInput {
  id: string; createdAt: string; playlist: { id: string; name: string }; screen: { id: string; name: string };
}
export interface CreatePowerScheduleInput {
  screenId?: string; groupId?: string; daysOfWeek?: number[]; startTime: string; endTime: string;
}
export interface PowerScheduleEntry extends CreatePowerScheduleInput {
  id: string; createdAt: string;
  screen: { id: string; name: string } | null; group: { id: string; name: string } | null;
}
export interface Screen {
  id: string; name: string; status: 'ONLINE' | 'OFFLINE'; lastSeenAt: string | null;
  paired: boolean; streamingType: StreamingType;
  assetId: string | null; playlistId: string | null; playlist?: { id: string; name: string } | null;
  layoutId: string | null; emergencyActive: boolean; stopped: boolean;
  latitude: number | null; longitude: number | null;
  prayerMethod: string; athanEnabled: boolean; timezone: string;
  screenshotUrl: string | null; screenshotUpdatedAt: string | null;
  hasContent: boolean; volume: number | null;
}
export interface CrashReport {
  id: string; type: 'UNCAUGHT_EXCEPTION' | 'WATCHDOG_RECOVERY'; summary: string;
  stackTrace: string | null; occurredAt: string;
}
export interface FleetStatus {
  total: number; online: number; offline: number;
  screens: { id: string; crashCount7d: number }[];
}
export type TextFontFamily = 'SANS' | 'SERIF' | 'MONOSPACE' | 'ROUNDED' | 'CONDENSED' | 'IMPACT' | 'HANDWRITTEN';
export type TextSize = 'SMALL' | 'MEDIUM' | 'LARGE' | 'XLARGE';
export interface TextStyle { textFontFamily: TextFontFamily; textColor: string; textSize: TextSize; textBackgroundColor?: string; }
export interface Asset {
  id: string; name: string; type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'TEXT'; mimeType: string;
  sizeBytes: number; status: string; url: string | null; thumbnailUrl: string | null;
  downloadUrl: string | null; textContent: string | null;
  textFontFamily: TextFontFamily | null; textColor: string | null; textSize: TextSize | null;
  textBackgroundColor: string | null;
  hasAudioTrack: boolean; audioEnabled: boolean;
  width: number | null; height: number | null; durationSecs: number | null; createdAt: string;
}
export interface PlaylistItem {
  id: string; position: number; durationSecs: number; muted: boolean;
  asset: Asset;
}
export type TransitionStyle = 'NONE' | 'CROSSFADE';
export type PlaybackOrder = 'SEQUENTIAL' | 'SHUFFLE';
export interface PlaylistSummary { id: string; name: string; _count: { items: number }; updatedAt: string; }
export interface Playlist extends PlaylistSummary {
  items: PlaylistItem[];
  transitionStyle: TransitionStyle; transitionDurationMs: number; playbackOrder: PlaybackOrder;
}
