import Cookies from 'js-cookie';
import type { DesignDocument } from '@lumina/design-schema';
import type { ModuleKey, OrganizationStatus, TenantModuleStatus, TenantCapabilities } from '@lumina/types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1';
// playsetting.md Phase 4 — the player PWA's own origin (a separate deployment, see
// PLAYER_DOMAIN in .env.prod.example), used only to open the Preview link.
export const PLAYER_URL = process.env.NEXT_PUBLIC_PLAYER_URL ?? 'http://localhost:5000';
const TOKEN_KEY = 'lumina_token';
const LOCALES = ['en', 'ar'];

export function getToken() { return Cookies.get(TOKEN_KEY) ?? null; }
export function setToken(t: string) { Cookies.set(TOKEN_KEY, t, { expires: 7, sameSite: 'lax' }); }
export function clearToken() { Cookies.remove(TOKEN_KEY); }

// Hard navigations to /login (401 handling, logout) happen outside React, so the locale has
// to be read off the URL rather than from next-intl — falls back to the default locale for any
// path that isn't already locale-prefixed.
export function loginPath() {
  if (typeof window === 'undefined') return '/en/login';
  const seg = window.location.pathname.split('/')[1] ?? '';
  return `/${LOCALES.includes(seg) ? seg : 'en'}/login`;
}

// designer.md Phase 10 — plain `Error` alone loses the HTTP status, which the designer2 autosave/
// manual-save flow needs to distinguish a 409 revision conflict from any other failure (network
// error, validation error) without resorting to matching on message text. Purely additive: every
// existing `catch`/`.message` read elsewhere in the app keeps working unchanged.
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

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
  if (token && res.status === 401) { clearToken(); if (typeof window !== 'undefined') window.location.replace(loginPath()); }
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    // res.statusText is always '' on HTTP/2 responses (no reason-phrase), so it can't be
    // trusted as a non-empty fallback — always fall through to the status code.
    throw new ApiError(body.message || res.statusText || `Request failed (${res.status})`, res.status);
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
  // `name` — designer.md Phase 8, seeds the `{{business.name}}` dynamic variable in designer2.
  getSettings: () => req<{ autoPublish: boolean; name: string }>('/org/settings'),
  updateSettings: (autoPublish: boolean) =>
    req<{ autoPublish: boolean }>('/org/settings', { method: 'PUT', body: JSON.stringify({ autoPublish }) }),
  // Super Admin only — every tenant, not just the caller's own (see OrgController.listAll).
  listAllOrganizations: () => req<{ id: string; name: string; slug: string }[]>('/org/all'),
  // Always the caller's own organization — the server resolves this from the JWT, never from
  // a client-supplied id. See docs/adr/platform-modules-and-entitlements.md.
  getCapabilities: () => req<TenantCapabilities>('/org/capabilities'),
};

// ── Platform tenants (Super Admin control plane) ─────────────────────────────
export interface TenantModuleAssignment {
  key: ModuleKey;
  status: TenantModuleStatus;
  expiresAt: string | null;
}
export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  createdAt: string;
  modules: TenantModuleAssignment[];
}
export interface TenantDetail {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  createdAt: string;
  capabilities: TenantCapabilities;
}
export interface OwnerInviteResult {
  email: string;
  token: string;
  expiresAt: string;
}
export interface CreateTenantInput {
  name: string;
  slug: string;
  ownerEmail: string;
  modules: { key: ModuleKey; status: TenantModuleStatus; expiresAt?: string }[];
}
export interface CreateTenantResult {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  ownerInvite: OwnerInviteResult;
}

export const platformTenantsApi = {
  list: () => req<TenantSummary[]>('/admin/tenants'),
  detail: (tenantId: string) => req<TenantDetail>(`/admin/tenants/${tenantId}`),
  create: (input: CreateTenantInput) => req<CreateTenantResult>('/admin/tenants', { method: 'POST', body: JSON.stringify(input) }),
  updateStatus: (tenantId: string, status: OrganizationStatus) =>
    req<{ id: string; status: OrganizationStatus }>(`/admin/tenants/${tenantId}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  setModules: (tenantId: string, assignments: { key: ModuleKey; status: TenantModuleStatus; expiresAt?: string }[]) =>
    req<TenantCapabilities>(`/admin/tenants/${tenantId}/modules`, { method: 'PUT', body: JSON.stringify({ assignments }) }),
  reissueOwnerInvite: (tenantId: string, email: string) =>
    req<OwnerInviteResult>(`/admin/tenants/${tenantId}/owner-invite`, { method: 'POST', body: JSON.stringify({ email }) }),
};

// ── Screens ─────────────────────────────────────────────────────────────────
export const screensApi = {
  list: () => req<Screen[]>('/screens'),
  create: (name: string) => req<Screen>('/screens', { method: 'POST', body: JSON.stringify({ name }) }),
  remove: (id: string) => req<void>(`/screens/${id}`, { method: 'DELETE' }),
  unpair: (id: string) => req<Screen>(`/screens/${id}/unpair`, { method: 'POST' }),
  rename: (id: string, name: string) => req<Screen>(`/screens/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  reorder: (ids: string[]) => req<void>('/screens/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
  pair: (code: string) => req<Screen>('/screens/pair', { method: 'POST', body: JSON.stringify({ code }) }),
  assign: (id: string, playlistId: string | null) =>
    req<Screen>(`/screens/${id}/assign`, { method: 'POST', body: JSON.stringify({ playlistId }) }),
  publish: (id: string) => req<{ ok: boolean }>(`/screens/${id}/publish`, { method: 'POST' }),
  reload: (id: string) => req<{ ok: boolean }>(`/screens/${id}/reload`, { method: 'POST' }),
  clearCache: (id: string) => req<{ ok: boolean }>(`/screens/${id}/clear-cache`, { method: 'POST' }),
  setStreamingType: (id: string, streamingType: StreamingType) =>
    req<Screen>(`/screens/${id}/streaming-type`, { method: 'PUT', body: JSON.stringify({ streamingType }) }),
  setAsset: (id: string, assetId: string | null) =>
    req<Screen>(`/screens/${id}/asset`, { method: 'PUT', body: JSON.stringify({ assetId }) }),
  // Custom Player (appsroadmap.md Phase 9/11) — remote control of whatever video is currently
  // playing on the screen. Fire-and-forget over the socket, same shape as publish/reload above.
  pause: (id: string) => req<{ ok: boolean }>(`/screens/${id}/pause`, { method: 'POST' }),
  resume: (id: string) => req<{ ok: boolean }>(`/screens/${id}/resume`, { method: 'POST' }),
  seek: (id: string, toSeconds: number) =>
    req<{ ok: boolean }>(`/screens/${id}/seek`, { method: 'POST', body: JSON.stringify({ toSeconds }) }),
  setSpeed: (id: string, rate: number) =>
    req<{ ok: boolean }>(`/screens/${id}/speed`, { method: 'POST', body: JSON.stringify({ rate }) }),
  setEmergency: (id: string, active: boolean, playlistId?: string) =>
    req<Screen>(`/screens/${id}/emergency`, { method: 'PUT', body: JSON.stringify({ active, playlistId }) }),
  setStopped: (id: string, stopped: boolean) =>
    req<Screen>(`/screens/${id}/stop`, { method: 'PUT', body: JSON.stringify({ stopped }) }),
  setVolume: (id: string, volume: number | null) =>
    req<Screen>(`/screens/${id}/volume`, { method: 'PUT', body: JSON.stringify({ volume }) }),
  setShowClock: (id: string, showClock: boolean) =>
    req<Screen>(`/screens/${id}/show-clock`, { method: 'PUT', body: JSON.stringify({ showClock }) }),
  setOrientation: (id: string, orientation: 0 | 90 | 180 | 270) =>
    req<Screen>(`/screens/${id}/orientation`, { method: 'PUT', body: JSON.stringify({ orientation }) }),
  setAspectRatio: (id: string, aspectRatio: '16:9' | '9:16' | 'stretch') =>
    req<Screen>(`/screens/${id}/aspect-ratio`, { method: 'PUT', body: JSON.stringify({ aspectRatio }) }),
  updatePrayer: (id: string, data: { latitude?: number; longitude?: number; prayerMethod?: string; athanEnabled?: boolean; timezone?: string; timezoneEnabled?: boolean }) =>
    req<Screen>(`/screens/${id}/prayer`, { method: 'PUT', body: JSON.stringify(data) }),
  captureScreenshot: (id: string) => req<{ ok: boolean }>(`/screens/${id}/capture-screenshot`, { method: 'POST' }),
  crashReports: (id: string) => req<CrashReport[]>(`/screens/${id}/crash-reports`),
  fleetStatus: () => req<FleetStatus>('/screens/fleet-status'),
  setKioskLocation: (id: string, floorId: string, x: number, y: number) =>
    req<Screen>(`/screens/${id}/kiosk-location`, { method: 'PUT', body: JSON.stringify({ floorId, x, y }) }),
  clearKioskLocation: (id: string) => req<{ ok: boolean }>(`/screens/${id}/kiosk-location`, { method: 'DELETE' }),
  setKioskAttractPlaylist: (id: string, playlistId: string | null) =>
    req<Screen>(`/screens/${id}/kiosk-attract-playlist`, { method: 'PUT', body: JSON.stringify({ playlistId }) }),
  setKioskAttractTheme: (id: string, themeId: string | null) =>
    req<Screen>(`/screens/${id}/kiosk-attract-theme`, { method: 'PUT', body: JSON.stringify({ themeId }) }),
};

// ── Wayfinding ──────────────────────────────────────────────────────────────
export const wayfindingApi = {
  listBuildings: () => req<Building[]>('/buildings'),
  createBuilding: (name: string, address?: string) =>
    req<Building>('/buildings', { method: 'POST', body: JSON.stringify({ name, address }) }),
  updateBuilding: (id: string, name: string, address?: string) =>
    req<Building>(`/buildings/${id}`, { method: 'PUT', body: JSON.stringify({ name, address }) }),
  removeBuilding: (id: string) => req<void>(`/buildings/${id}`, { method: 'DELETE' }),
  setEvacuation: (id: string, active: boolean) =>
    req<{ ok: boolean; screenCount: number }>(`/buildings/${id}/evacuation`, { method: 'PUT', body: JSON.stringify({ active }) }),
  syncScreenGroup: (id: string) =>
    req<{ id: string; name: string; _count: { screens: number } }>(`/buildings/${id}/sync-screen-group`, { method: 'POST' }),

  createFloor: (buildingId: string, level: number, label: string, floorPlanAssetId?: string | null) =>
    req<Floor>(`/buildings/${buildingId}/floors`, { method: 'POST', body: JSON.stringify({ level, label, floorPlanAssetId }) }),
  updateFloor: (id: string, level: number, label: string, floorPlanAssetId?: string | null) =>
    req<Floor>(`/floors/${id}`, { method: 'PUT', body: JSON.stringify({ level, label, floorPlanAssetId }) }),
  removeFloor: (id: string) => req<void>(`/floors/${id}`, { method: 'DELETE' }),

  listPoiCategories: () => req<PoiCategory[]>('/poi-categories'),
  createPoiCategory: (label: string, icon: string, color: string, labelAr?: string) =>
    req<PoiCategory>('/poi-categories', { method: 'POST', body: JSON.stringify({ label, icon, color, labelAr }) }),
  updatePoiCategory: (id: string, label: string, icon: string, color: string, labelAr?: string) =>
    req<PoiCategory>(`/poi-categories/${id}`, { method: 'PUT', body: JSON.stringify({ label, icon, color, labelAr }) }),
  removePoiCategory: (id: string) => req<void>(`/poi-categories/${id}`, { method: 'DELETE' }),

  listPois: (floorId: string) => req<Poi[]>(`/floors/${floorId}/pois`),
  createPoi: (floorId: string, dto: PoiInput) =>
    req<Poi>(`/floors/${floorId}/pois`, { method: 'POST', body: JSON.stringify(dto) }),
  updatePoi: (id: string, dto: PoiInput) =>
    req<Poi>(`/pois/${id}`, { method: 'PUT', body: JSON.stringify(dto) }),
  removePoi: (id: string) => req<void>(`/pois/${id}`, { method: 'DELETE' }),
  importPois: (floorId: string, rows: PoiImportRow[]) =>
    req<{ imported: number }>(`/floors/${floorId}/pois/import`, { method: 'POST', body: JSON.stringify({ rows }) }),

  getRouteGraph: (buildingId: string) => req<RouteGraph>(`/buildings/${buildingId}/route-graph`),
  createRouteNode: (floorId: string, dto: RouteNodeInput) =>
    req<RouteNode>(`/floors/${floorId}/route-nodes`, { method: 'POST', body: JSON.stringify(dto) }),
  updateRouteNode: (id: string, dto: RouteNodeInput) =>
    req<RouteNode>(`/route-nodes/${id}`, { method: 'PUT', body: JSON.stringify(dto) }),
  removeRouteNode: (id: string) => req<void>(`/route-nodes/${id}`, { method: 'DELETE' }),
  createRouteEdge: (buildingId: string, dto: RouteEdgeInput) =>
    req<RouteEdge>(`/buildings/${buildingId}/route-edges`, { method: 'POST', body: JSON.stringify(dto) }),
  updateRouteEdge: (id: string, type: RouteEdgeType, weight: number) =>
    req<RouteEdge>(`/route-edges/${id}`, { method: 'PUT', body: JSON.stringify({ type, weight }) }),
  removeRouteEdge: (id: string) => req<void>(`/route-edges/${id}`, { method: 'DELETE' }),
};

// ── Kiosk analytics (7.4) ──────────────────────────────────────────────────
export interface KioskEvent {
  id: string;
  type: 'SESSION_START' | 'SEARCH' | 'POI_VIEW';
  query: string | null;
  poiId: string | null;
  poiName: string | null;
  createdAt: string;
  screenId: string;
  screenName: string;
  buildingName: string | null;
}
export interface KioskEventsResult {
  items: KioskEvent[];
  // Total matching the filters server-side, which can exceed items.length — the endpoint caps
  // how many events one request returns (it's fetched in full for client-side aggregation, not
  // paged), so total is how the UI detects and surfaces truncation instead of silently rendering
  // incomplete search/destination rankings.
  total: number;
}
export const kioskAnalyticsApi = {
  list: (params?: { screenId?: string; from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.screenId) qs.set('screenId', params.screenId);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return req<KioskEventsResult>(`/kiosk-events${suffix}`);
  },
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
  uploadAudioFromVideo: async (file: File, onProgress?: (pct: number) => void): Promise<Asset> => {
    const token = getToken();
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/assets/upload-audio`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e: ProgressEvent) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => { if (xhr.status < 300) resolve(JSON.parse(xhr.responseText) as Asset); else reject(new Error(xhr.responseText)); };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(form);
    });
  },
  extractAudio: (id: string) => req<Asset>(`/assets/${id}/extract-audio`, { method: 'POST' }),
  get: (id: string) => req<Asset>(`/assets/${id}`),
  rename: (id: string, name: string) => req<Asset>(`/assets/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  setAudioEnabled: (id: string, audioEnabled: boolean) =>
    req<Asset>(`/assets/${id}/audio`, { method: 'PUT', body: JSON.stringify({ audioEnabled }) }),
  remove: (id: string) => req<void>(`/assets/${id}`, { method: 'DELETE' }),
  reprocess: (id: string) => req<Asset>(`/assets/${id}/reprocess`, { method: 'POST' }),
  // Marks an asset as just-picked in an editor's "existing asset" picker — fire-and-forget,
  // used to drive that picker's "recently used" sort.
  touch: (id: string) => req<void>(`/assets/${id}/touch`, { method: 'POST' }),
  createText: (name: string, content: string, style: TextStyle) =>
    req<Asset>('/assets/text', { method: 'POST', body: JSON.stringify({ name, content, ...style }) }),
  updateText: (id: string, dto: { name?: string; content?: string } & Partial<TextStyle>) =>
    req<Asset>(`/assets/${id}/text`, { method: 'PUT', body: JSON.stringify(dto) }),
  library: (params?: { category?: AssetCategory; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.search) qs.set('search', params.search);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return req<Asset[]>(`/assets/library${suffix}`);
  },
  useFromLibrary: (id: string) => req<Asset>(`/assets/library/${id}/use`, { method: 'POST' }),
  uploadToLibrary: async (file: File, category?: AssetCategory, tags?: string[], onProgress?: (pct: number) => void): Promise<Asset> => {
    const token = getToken();
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      if (category) form.append('category', category);
      if (tags?.length) form.append('tags', tags.join(','));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/assets/library`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = (e: ProgressEvent) => { if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100)); };
      xhr.onload = () => { if (xhr.status < 300) resolve(JSON.parse(xhr.responseText) as Asset); else reject(new Error(xhr.responseText)); };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(form);
    });
  },
  updateLibraryAsset: (id: string, dto: { name?: string; category?: AssetCategory; tags?: string[] }) =>
    req<Asset>(`/assets/library/${id}`, { method: 'PUT', body: JSON.stringify(dto) }),
  removeFromLibrary: (id: string) => req<void>(`/assets/library/${id}`, { method: 'DELETE' }),
  searchStockPhotos: (params?: { query?: string; page?: number }) => {
    const qs = new URLSearchParams();
    if (params?.query) qs.set('query', params.query);
    if (params?.page) qs.set('page', String(params.page));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return req<{ configured: boolean; photos: StockPhoto[] }>(`/assets/stock/search${suffix}`);
  },
  importStockPhoto: (photoId: number) =>
    req<Asset>('/assets/stock/import', { method: 'POST', body: JSON.stringify({ photoId }) }),
  searchStockVideos: (params?: { query?: string; page?: number }) => {
    const qs = new URLSearchParams();
    if (params?.query) qs.set('query', params.query);
    if (params?.page) qs.set('page', String(params.page));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return req<{ configured: boolean; videos: StockVideo[] }>(`/assets/stock-videos/search${suffix}`);
  },
  importStockVideo: (videoId: number) =>
    req<Asset>('/assets/stock-videos/import', { method: 'POST', body: JSON.stringify({ videoId }) }),
  searchIcons: (query: string, prefixes: string[]) =>
    req<{ icons: string[] }>(`/assets/icons/search?query=${encodeURIComponent(query)}&prefixes=${prefixes.join(',')}`),
  fetchIconSvg: (iconId: string) =>
    req<{ svg: string }>(`/assets/icons/svg?icon=${encodeURIComponent(iconId)}`),
  createApp: (providerId: string, sourceUrl: string, name?: string) =>
    req<Asset>('/assets/apps', { method: 'POST', body: JSON.stringify({ providerId, sourceUrl, name }) }),
  createAppPlaylist: (providerId: string, name: string, playbackOrder: AppPlaybackOrder, sourceUrls: string[]) =>
    req<Asset>('/assets/apps/playlist', {
      method: 'POST',
      body: JSON.stringify({ providerId, name, playbackOrder, items: sourceUrls.map(sourceUrl => ({ sourceUrl })) }),
    }),
};

// ── Apps (Assets page "Apps" tab) ──────────────────────────────────────────
export interface AppProvider {
  id: string;
  name: string;
  renderKind: 'iframe' | 'script';
}
export interface ResolvedApp {
  providerId: string;
  sourceUrl: string;
  title: string;
  thumbnailUrl: string | null;
  embedUrl: string;
  width: number | null;
  height: number | null;
}
export type AppPlaybackOrder = 'SEQUENTIAL' | 'SHUFFLE';
export interface AppPlaylistItem {
  sourceUrl: string;
  title: string;
  thumbnailUrl: string | null;
  embedUrl: string;
}
// Discriminated by `kind` — a single video (Assets page "Add a video") vs a custom playlist
// ("Create a playlist"), both stored as one APP asset's appConfig (see appsroadmap.md Phase 6).
export type AppConfig =
  | { kind: 'video'; title: string; thumbnailUrl: string | null; embedUrl: string; width: number | null; height: number | null }
  | { kind: 'playlist'; playbackOrder: AppPlaybackOrder; items: AppPlaylistItem[] };
export const appsApi = {
  providers: () => req<AppProvider[]>('/apps/providers'),
  resolve: (providerId: string, sourceUrl: string) =>
    req<ResolvedApp>('/apps/resolve', { method: 'POST', body: JSON.stringify({ providerId, sourceUrl }) }),
};

// ── Playlists ────────────────────────────────────────────────────────────────
export const playlistsApi = {
  list: () => req<PlaylistSummary[]>('/playlists'),
  create: (name: string) => req<PlaylistSummary>('/playlists', { method: 'POST', body: JSON.stringify({ name }) }),
  get: (id: string) => req<Playlist>(`/playlists/${id}`),
  rename: (id: string, name: string) => req<PlaylistSummary>(`/playlists/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  remove: (id: string) => req<void>(`/playlists/${id}`, { method: 'DELETE' }),
  addItem: (
    id: string,
    item: { kind?: PlaylistItemKind; assetId?: string; themeId?: string; layoutId?: string; designAssetId?: string },
    durationSecs: number, muted?: boolean, playFullVideo?: boolean,
  ) =>
    req<PlaylistItem>(`/playlists/${id}/items`, { method: 'POST', body: JSON.stringify({ ...item, durationSecs, muted, playFullVideo }) }),
  updateItem: (
    id: string, itemId: string, durationSecs: number, muted?: boolean, playFullVideo?: boolean,
    crop?: { cropZoom: number | null; cropOffsetX: number | null; cropOffsetY: number | null },
    transition?: { transitionStyle: TransitionStyle | null; transitionDurationMs?: number | null },
  ) =>
    req<PlaylistItem>(`/playlists/${id}/items/${itemId}`, { method: 'PUT', body: JSON.stringify({ durationSecs, muted, playFullVideo, ...crop, ...transition }) }),
  removeItem: (id: string, itemId: string) => req<void>(`/playlists/${id}/items/${itemId}`, { method: 'DELETE' }),
  reorder: (id: string, ids: string[]) => req<void>(`/playlists/${id}/reorder`, { method: 'PUT', body: JSON.stringify({ ids }) }),
  reorderPlaylists: (ids: string[]) => req<void>('/playlists/reorder', { method: 'PUT', body: JSON.stringify({ ids }) }),
  updateConfig: (
    id: string,
    config: {
      transitionStyle?: TransitionStyle; transitionDurationMs?: number; playbackOrder?: PlaybackOrder;
      scaleSettings?: Partial<Record<AssetType, ScaleFitMode>>;
    },
  ) =>
    req<Playlist>(`/playlists/${id}/config`, { method: 'PUT', body: JSON.stringify(config) }),
  // playsetting.md Phase 1/4 — short-lived token the Preview button hands to the player app so
  // it can open a read-only preview without a device pairing.
  previewToken: (id: string) => req<{ token: string; expiresAt: string }>(`/playlists/${id}/preview-token`, { method: 'POST' }),
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

// ── Themes ──────────────────────────────────────────────────────────────────
export const themesApi = {
  list: () => req<Theme[]>('/themes'),
  get: (id: string) => req<Theme>(`/themes/${id}`),
  create: (input: ThemeInput) => req<Theme>('/themes', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: ThemeInput) => req<Theme>(`/themes/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  duplicate: (id: string) => req<Theme>(`/themes/${id}/duplicate`, { method: 'POST' }),
  remove: (id: string) => req<void>(`/themes/${id}`, { method: 'DELETE' }),
};

// ── Design Templates & Design Assets (designer2, designer.md Phase 5) ────────
// Distinct from the legacy Theme above — DesignTemplate/DesignAsset carry a @lumina/design-schema
// DesignDocument, designer2's own canvas contract, not palette/typography/elements.
export type TemplateVisibility = 'GLOBAL' | 'SELECTED_TENANTS' | 'HIDDEN';
export type TemplateStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

export interface DesignTemplateInput {
  name: string;
  description?: string;
  category?: ThemeCategory;
  visibility?: TemplateVisibility;
  designJson?: DesignDocument;
}
export interface DesignTemplate {
  id: string;
  name: string;
  description: string | null;
  category: ThemeCategory;
  designJson: DesignDocument;
  schemaVersion: number;
  visibility: TemplateVisibility;
  status: TemplateStatus;
  versionNumber: number;
  thumbnailAssetId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  _count?: { tenantAccess: number; designAssets: number };
}
// Customer-facing gallery listing — a narrower projection (customerList's Prisma `select`),
// never the full designJson.
export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  category: ThemeCategory;
  thumbnailAssetId: string | null;
  versionNumber: number;
  publishedAt: string | null;
}
export interface DesignTemplateTenantAccess {
  templateId: string;
  tenantId: string;
  createdAt: string;
  tenant: { id: string; name: string; slug: string };
}
export interface DesignAsset {
  id: string;
  name: string;
  designJson: DesignDocument;
  schemaVersion: number;
  // designer.md Phase 10 — optimistic concurrency token; sent back on PATCH, 409 on mismatch.
  revision: number;
  thumbnailAssetId: string | null;
  sourceTemplateId: string | null;
  sourceTemplateVersion: number | null;
  organizationId: string;
  createdAt: string;
  updatedAt: string;
}

export interface DesignAssetVersion {
  id: string;
  versionNumber: number;
  createdAt: string;
  reason: string | null;
}

export interface DesignDraft {
  documentId: string;
  draftJson: DesignDocument;
  updatedAt: string;
}

export const adminTemplatesApi = {
  list: () => req<DesignTemplate[]>('/admin/templates'),
  get: (id: string) => req<DesignTemplate>(`/admin/templates/${id}`),
  create: (input: DesignTemplateInput) => req<DesignTemplate>('/admin/templates', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: Partial<DesignTemplateInput>) =>
    req<DesignTemplate>(`/admin/templates/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  publish: (id: string) => req<DesignTemplate>(`/admin/templates/${id}/publish`, { method: 'POST' }),
  unpublish: (id: string) => req<DesignTemplate>(`/admin/templates/${id}/unpublish`, { method: 'POST' }),
  archive: (id: string) => req<DesignTemplate>(`/admin/templates/${id}`, { method: 'DELETE' }),
  getTenantAccess: (id: string) => req<DesignTemplateTenantAccess[]>(`/admin/templates/${id}/tenant-access`),
  setTenantAccess: (id: string, tenantIds: string[]) =>
    req<DesignTemplateTenantAccess[]>(`/admin/templates/${id}/tenant-access`, { method: 'PUT', body: JSON.stringify({ tenantIds }) }),
};

export const templatesApi = {
  list: () => req<TemplateSummary[]>('/templates'),
  get: (id: string) => req<DesignTemplate>(`/templates/${id}`),
  createDesign: (id: string) => req<DesignAsset>(`/templates/${id}/create-design`, { method: 'POST' }),
};

// designer.md §21/§26 — Phase 10. `create`/`update` re-validate designJson (including asset
// ownership) server-side regardless of what the client sends. `update` requires `revision` — a
// 409 (surfaced as ApiError with status 409) means someone else saved in between. Duplicate/
// delete are not built yet — no UI trigger point without a "My Designs" browse page.
export const designsApi = {
  list: () => req<DesignAsset[]>('/designs'),
  get: (id: string) => req<DesignAsset>(`/designs/${id}`),
  create: (input: { name: string; designJson?: DesignDocument }) =>
    req<DesignAsset>('/designs', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: { designJson: DesignDocument; revision: number; name?: string }) =>
    req<DesignAsset>(`/designs/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  rename: (id: string, name: string) =>
    req<DesignAsset>(`/designs/${id}/name`, { method: 'PUT', body: JSON.stringify({ name }) }),
  listVersions: (id: string) => req<DesignAssetVersion[]>(`/designs/${id}/versions`),
  restoreVersion: (id: string, versionId: string) => req<DesignAsset>(`/designs/${id}/restore/${versionId}`, { method: 'POST' }),
};

// designer.md §19.6/§21/§26 — autosave draft, keyed by the client-generated DesignDocument.id
// (not a DesignAsset id — a brand-new unsaved design can still autosave before its first real
// Save). Never touches DesignAsset/revision/versions.
export const designDraftsApi = {
  get: (documentId: string) => req<DesignDraft | null>(`/design-drafts/${documentId}`),
  put: (documentId: string, draftJson: DesignDocument) =>
    req<DesignDraft>(`/design-drafts/${documentId}`, { method: 'PUT', body: JSON.stringify({ draftJson }) }),
  remove: (documentId: string) => req<void>(`/design-drafts/${documentId}`, { method: 'DELETE' }),
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
export type ZoneType = 'MEDIA' | 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER' | 'TIME' | 'DATE' | 'QR';
export type ElementShape = 'rectangle' | 'rounded' | 'circle' | 'triangle' | 'pentagon' | 'hexagon' | 'octagon' | 'star' | 'arrow';
export type UserRole = 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER' | 'LIBRARY_MANAGER';
export type StreamingType = 'ASSET' | 'PLAYLIST' | 'WAYFINDING';
export interface User { id: string; email: string; name: string; role: UserRole; orgId: string; isSuperAdmin: boolean; }
export interface ZoneInput {
  name: string; x: number; y: number; width: number; height: number; zIndex?: number;
  // Degrees, clockwise, about the zone's own center.
  rotation?: number;
  zoneType?: ZoneType;
  shape?: ElementShape;
  // Locks the zone in the editor canvas — false disables drag/resize/rotate regardless of
  // selection state or the click-to-select-to-edit setting.
  editable?: boolean;
  widgetConfig?: Record<string, unknown>;
  // Mutually exclusive — a MEDIA zone plays either a playlist or a single asset, never both.
  playlistId?: string; assetId?: string;
  audioPriority?: boolean; audioVolume?: number | null;
  // Per-placement image/video framing (crop editor) for a direct assetId zone — mirrors
  // PlaylistItem's crop fields, which cover the playlistId case.
  cropZoom?: number | null; cropOffsetX?: number | null; cropOffsetY?: number | null;
  // Dashboard-only, client-generated, stripped before every network call — see layouts/page.tsx.
  // Not sent to (or returned by) the API, so it's optional and absent from ZoneRecord.
  _localId?: string;
}
export interface ZoneRecord extends ZoneInput { id: string; playlist: { id: string; name: string } | null; asset: { id: string; name: string } | null; }
export interface Layout { id: string; name: string; zones: ZoneRecord[]; _count?: { playlistItems: number }; }
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
  emergencyActive: boolean; stopped: boolean; showClock: boolean;
  latitude: number | null; longitude: number | null;
  prayerMethod: string; athanEnabled: boolean; timezone: string; timezoneEnabled: boolean;
  screenshotUrl: string | null; screenshotUpdatedAt: string | null;
  hasContent: boolean; volume: number | null; orientation: 0 | 90 | 180 | 270;
  aspectRatio: '16:9' | '9:16' | 'stretch';
  kioskLocation: {
    id: string; floorId: string; x: number; y: number;
    floor?: { id: string; label: string; building: { id: string; name: string } };
    attractPlaylistId: string | null; attractThemeId: string | null;
  } | null;
}
export interface Building {
  id: string; name: string; address: string | null; createdAt: string; updatedAt: string;
  floors: Floor[];
}
export interface Floor {
  id: string; level: number; label: string; buildingId: string;
  floorPlanAssetId: string | null;
  floorPlanAsset: { id: string; name: string; thumbnailKey: string | null } | null;
  _count?: { pois: number };
}
export interface PoiCategory {
  id: string; label: string; labelAr: string | null; icon: string; color: string;
  organizationId: string | null;
}
export type PoiStatus = 'OPEN' | 'CLOSED' | 'RELOCATED';
export interface Poi {
  id: string; name: string; nameAr: string | null; x: number; y: number;
  description: string | null; descriptionAr: string | null; status: PoiStatus;
  externalRef: string | null; floorId: string; categoryId: string; category: PoiCategory;
  iconAssetId: string | null;
}
export interface PoiInput {
  name: string; nameAr?: string; x: number; y: number; categoryId: string;
  description?: string; descriptionAr?: string; status?: PoiStatus; externalRef?: string; iconAssetId?: string;
}
export interface PoiImportRow {
  name: string; nameAr?: string; x: number; y: number; categoryLabel: string; description?: string;
}
export type RouteEdgeType = 'WALK' | 'ELEVATOR' | 'ESCALATOR' | 'STAIRS';
export interface RouteNode { id: string; floorId: string; x: number; y: number; label: string | null; }
export interface RouteNodeInput { x: number; y: number; label?: string; }
export interface RouteEdge { id: string; fromNodeId: string; toNodeId: string; type: RouteEdgeType; weight: number; }
export interface RouteEdgeInput { fromNodeId: string; toNodeId: string; type?: RouteEdgeType; weight: number; }
export interface RouteGraph { nodes: RouteNode[]; edges: RouteEdge[]; }
export interface CrashReport {
  id: string; type: 'UNCAUGHT_EXCEPTION' | 'WATCHDOG_RECOVERY'; summary: string;
  stackTrace: string | null; occurredAt: string;
}
export interface FleetStatus {
  total: number; online: number; offline: number;
  screens: { id: string; crashCount7d: number }[];
}
// A font id from the shared FONT_LIBRARY (@lumina/types) — kept as a plain string here (not
// re-imported) so this file's existing "duplicate the server's shape locally" convention holds.
export type TextFontFamily = string;
export type TextSize = 'SMALL' | 'MEDIUM' | 'LARGE' | 'XLARGE';
export type TickerDirection = 'LEFT_TO_RIGHT' | 'RIGHT_TO_LEFT' | 'TOP_TO_BOTTOM' | 'BOTTOM_TO_TOP';
export interface TextStyle {
  textFontFamily: TextFontFamily; textColor: string; textSize: TextSize; textBackgroundColor?: string;
  textTickerEnabled?: boolean; textTickerDirection?: TickerDirection; textTickerSpeed?: number; textTickerCrossOffset?: number;
}
export type AssetCategory = 'BACKGROUND' | 'ICON' | 'ILLUSTRATION' | 'STOCK_PHOTO' | 'LOGO' | 'VIDEO_LOOP' | 'AUDIO_JINGLE' | 'GENERIC';
// A Pexels search result — not yet an Asset. Only turns into one (via importStockPhoto) once
// the user actually picks it, so browsing search results never creates orphaned asset rows.
export interface StockPhoto {
  id: number;
  thumbnailUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  photographer: string;
  photographerUrl: string;
  alt: string | null;
}
// A Pexels video search result — same "not yet an Asset" model as StockPhoto above.
export interface StockVideo {
  id: number;
  thumbnailUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  duration: number;
  photographer: string;
  photographerUrl: string;
}
export interface Asset {
  id: string; name: string; type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'TEXT' | 'DOCUMENT' | 'APP'; mimeType: string;
  sizeBytes: number; status: string; url: string | null; thumbnailUrl: string | null;
  downloadUrl: string | null; textContent: string | null;
  textFontFamily: TextFontFamily | null; textColor: string | null; textSize: TextSize | null;
  textBackgroundColor: string | null;
  textTickerEnabled: boolean; textTickerDirection: TickerDirection; textTickerSpeed: number | null; textTickerCrossOffset: number | null;
  hasAudioTrack: boolean; audioEnabled: boolean;
  // APP assets only — see appsroadmap.md. appProviderId is a registry id (e.g. "youtube");
  // sourceUrl is the link the user pasted (null for a playlist — see appConfig.items instead).
  appProviderId: string | null; sourceUrl: string | null; appConfig: AppConfig | null;
  category: AssetCategory; tags: string[];
  width: number | null; height: number | null; durationSecs: number | null; pageCount: number | null; createdAt: string;
  // Stamped by assetsApi.touch() whenever this asset is picked in an editor's "existing asset"
  // picker — null until first picked.
  lastUsedAt: string | null;
  // Only populated by the "my assets" list endpoint (playlist items + screens + zones
  // referencing it) — other endpoints (library, findOne, rename, etc.) don't compute it.
  usageCount?: number;
  inUse?: boolean;
}
export type PlaylistItemKind = 'ASSET' | 'THEME' | 'LAYOUT' | 'DESIGN';
export interface PlaylistItem {
  id: string; position: number; durationSecs: number; muted: boolean; playFullVideo: boolean;
  // Per-placement image/video framing (crop editor) — null means "show the whole asset", and
  // only ever meaningful for an ASSET-kind item.
  cropZoom: number | null; cropOffsetX: number | null; cropOffsetY: number | null;
  // Per-item transition override — null means "inherit the playlist's transitionStyle" (the
  // Transition dropdown's "Default (Use Playlist Transition)" option). See
  // resolveEffectiveTransition in @lumina/types for how the player resolves this.
  transitionStyle: TransitionStyle | null; transitionDurationMs: number | null;
  kind: PlaylistItemKind;
  // Exactly one of these is set, matching `kind` — a playlist item can be a plain asset
  // (including an APP-type one), a whole Theme, a whole Layout, or (designer.md Phase 11) a
  // whole Design.
  asset: Asset | null;
  theme: { id: string; name: string; category: ThemeCategory } | null;
  layout: { id: string; name: string } | null;
  design: { id: string; name: string } | null;
}
export type TransitionStyle = 'NONE' | 'FADE' | 'CROSSFADE' | 'SLIDE_LEFT' | 'SLIDE_RIGHT' | 'ZOOM' | 'FLIP';
// Every persistable transition identifier, in display order — the registry in @lumina/types is
// the actual source of truth for the player; this list (and the i18n key each maps to under
// playlistDetail.transition.*) just needs to stay a superset match with it for the dropdowns.
export const TRANSITION_STYLE_OPTIONS: TransitionStyle[] = ['NONE', 'FADE', 'CROSSFADE', 'SLIDE_LEFT', 'SLIDE_RIGHT', 'ZOOM', 'FLIP'];
export const TRANSITION_LABEL_KEYS: Record<TransitionStyle, string> = {
  NONE: 'none', FADE: 'fade', CROSSFADE: 'crossfade', SLIDE_LEFT: 'slideLeft', SLIDE_RIGHT: 'slideRight', ZOOM: 'zoom', FLIP: 'flip',
};
export type PlaybackOrder = 'SEQUENTIAL' | 'SHUFFLE';
// playsetting.md — same six kinds as Asset['type'], kept as its own alias here since
// scaleSettings is keyed by asset type but lives on Playlist, not Asset.
export type AssetType = Asset['type'];
export type ScaleFitMode = 'contain' | 'cover' | 'fill';
export interface PlaylistSummary {
  id: string; name: string; _count: { items: number }; updatedAt: string;
  totalDurationSecs: number; totalSizeBytes: number;
}
export interface Playlist extends PlaylistSummary {
  items: PlaylistItem[];
  transitionStyle: TransitionStyle; transitionDurationMs: number; playbackOrder: PlaybackOrder;
  // Per-asset-type contain/cover/fill override; a missing key means "use the player's default
  // for that type." Null until an admin opens Settings and saves at least one.
  scaleSettings: Partial<Record<AssetType, ScaleFitMode>> | null;
}

// ── Themes ──────────────────────────────────────────────────────────────────
export type ThemeCategory = 'RESTAURANT_MENU' | 'RETAIL_PROMO' | 'HOTEL_LOBBY' | 'CLINIC_WAITING' | 'MOSQUE' | 'GENERIC';
export type ThemeElementKind = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'PLAYLIST' | 'SHAPE' | 'BRUSH' | 'WIDGET' | 'ICON';
export interface ThemeBrushPoint { x: number; y: number; }
export type ThemeWidgetType = 'PRAYER' | 'WEATHER' | 'CURRENCY' | 'TICKER' | 'TIME' | 'DATE' | 'QR';

export interface ThemePalette {
  primary: string; secondary: string; background: string; surface: string;
  text: string; textMuted: string; accent: string;
}
export interface ThemeTypography { headingFont: string; bodyFont: string; baseSizePx: number; scale: number; }

export interface ThemeGradientFill { type: 'linear'; angle: number; from: string; to: string; }
export interface ThemeImageAdjustments {
  exposure: number; brightness: number; contrast: number; saturation: number; vibrance: number;
  temperature: number; tint: number; hue: number;
  duotone: { color1: string; color2: string } | null;
  preset?: string;
}
export interface ThemeElementStyle {
  color?: string; backgroundColor?: string | ThemeGradientFill; fontFamily?: string;
  fontSizePx?: number; fontWeight?: number | string; textAlign?: 'left' | 'center' | 'right';
  direction?: 'ltr' | 'rtl' | 'auto'; borderRadius?: number; opacity?: number;
  objectFit?: 'contain' | 'cover' | 'fill';
  // Per-placement image/video framing (crop editor) — see mediaCropStyle in @lumina/types.
  cropZoom?: number; cropOffsetX?: number; cropOffsetY?: number;
  // Clips the element's content to a shape within its (still rectangular) bounding box —
  // available on every element kind, not just SHAPE.
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
  id: string; x: number; y: number; width: number; height: number; zIndex: number;
  // Degrees, clockwise, about the element's own center.
  rotation: number;
  editable: boolean; label?: string; style: ThemeElementStyle;
  animation?: ThemeElementAnimation;
}
export type ThemeElement =
  | (ThemeElementBase & { kind: 'TEXT'; content: { text: string; translations?: Record<string, string>; assetId?: string | null } })
  | (ThemeElementBase & { kind: 'IMAGE'; content: { assetId: string | null } })
  | (ThemeElementBase & { kind: 'VIDEO'; content: { assetId: string | null } })
  | (ThemeElementBase & { kind: 'DOCUMENT'; content: { assetId: string | null; secondsPerPage: number } })
  | (ThemeElementBase & { kind: 'PLAYLIST'; content: { playlistId: string | null } })
  | (ThemeElementBase & { kind: 'SHAPE'; content: Record<string, never> })
  | (ThemeElementBase & { kind: 'BRUSH'; content: { points: ThemeBrushPoint[]; raster?: { dataUrl: string; width: number; height: number } } })
  | (ThemeElementBase & { kind: 'WIDGET'; content: { widgetType: ThemeWidgetType; widgetConfig: Record<string, unknown> } })
  | (ThemeElementBase & { kind: 'ICON'; content: { iconId: string; svg: string } });

export interface ThemeInput {
  name: string; category: ThemeCategory; aspectRatio?: string;
  palette: ThemePalette; typography: ThemeTypography; elements: ThemeElement[];
}
export interface Theme extends Omit<ThemeInput, 'aspectRatio'> {
  id: string; organizationId: string | null; aspectRatio: string; createdAt: string; updatedAt: string;
  _count?: { playlistItems: number };
}
