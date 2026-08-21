'use client';
import { useState } from 'react';
import NextImage from 'next/image';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Monitor, Plus, Unplug, Trash2, Tv2, RefreshCw, Send, AlertTriangle, Moon, Clock, FolderKanban, Pencil, X, Check, Pause, Play, TriangleAlert, Camera, Bug, FileQuestion, Volume2, MapPin, Image as ImageIcon, ListVideo, LayoutGrid, Palette, Search, Navigation } from 'lucide-react';
import { screensApi, playlistsApi, layoutsApi, themesApi, orgApi, assetsApi, wayfindingApi, type Screen, type StreamingType, type PlaylistSummary, type Layout, type Theme } from '@/lib/api';
import { PoiMapEditor } from '@/components/PoiMapEditor';
import { screenGroupsApi, type ScreenGroup } from '@/lib/mocks/screenGroups';
import { billingApi, planLimit } from '@/lib/mocks/billing';
import { useScreenSocket } from '@/hooks/useScreenSocket';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useFaithFeatures } from '@/hooks/useFaithFeatures';
import { useDateFormat, formatDateTime } from '@/hooks/useDateFormat';
import { useAuth } from '@/context/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { TimezoneSelect } from '@/components/TimezoneSelect';
import { AssetPicker } from '@/components/AssetPicker';

const PRAYER_METHOD_VALUES = [
  'UmmAlQura', 'Dubai', 'Kuwait', 'Qatar', 'Egyptian', 'MuslimWorldLeague',
  'Karachi', 'NorthAmerica', 'MoonsightingCommittee', 'Singapore', 'Tehran', 'Turkey',
];

// Latitude/longitude live here rather than in PrayerPanel below — Weather zones need a
// location just as much as Prayer zones do (see ZoneRenderer in the player), so gating the
// only place to set it behind the faith-features toggle silently broke Weather for anyone
// with that toggle off. This panel is always visible; PrayerPanel only adds prayer-specific
// settings (method, athan) on top of whatever location is set here.
function LocationPanel({ screen }: { screen: Screen }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canEditContent } = usePermissions();
  const logAction = useAuditLog();
  const t = useTranslations('screens');
  const [lat, setLat] = useState(screen.latitude?.toString() ?? '');
  const [lon, setLon] = useState(screen.longitude?.toString() ?? '');

  const locationMut = useMutation({
    mutationFn: () =>
      screensApi.updatePrayer(screen.id, {
        latitude: lat ? parseFloat(lat) : undefined,
        longitude: lon ? parseFloat(lon) : undefined,
      }),
    onSuccess: () => {
      logAction({
        resourceType: 'SCREEN', resourceName: screen.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-2 text-gray-600 dark:text-gray-300 font-medium text-xs">
        <MapPin className="w-3.5 h-3.5" /> {t('location.title')}
      </div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-0.5">{t('prayer.latitude')}</label>
          <input type="number" step="0.0001" value={lat} onChange={e => setLat(e.target.value)} disabled={!canEditContent}
            placeholder="e.g. 21.4225"
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50" />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-0.5">{t('prayer.longitude')}</label>
          <input type="number" step="0.0001" value={lon} onChange={e => setLon(e.target.value)} disabled={!canEditContent}
            placeholder="e.g. 39.8262"
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50" />
        </div>
      </div>
      {canEditContent && (
        <button onClick={() => locationMut.mutate()} disabled={locationMut.isPending}
          className="w-full text-xs py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded font-medium disabled:opacity-50">
          {locationMut.isPending ? t('location.saving') : t('location.save')}
        </button>
      )}
    </div>
  );
}

function PrayerPanel({ screen }: { screen: Screen }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canEditContent } = usePermissions();
  const logAction = useAuditLog();
  const t = useTranslations('screens');
  const [method, setMethod] = useState(screen.prayerMethod ?? 'UmmAlQura');
  const [athan, setAthan] = useState(screen.athanEnabled ?? false);

  const prayerMut = useMutation({
    mutationFn: () =>
      screensApi.updatePrayer(screen.id, {
        prayerMethod: method,
        athanEnabled: athan,
      }),
    onSuccess: () => {
      // Not passing the prayer method as `detail` here — unlike a role code or a playlist/
      // layout name, it'd need its own translation lookup at render time, and the audit log
      // has no reliable way to tell "this SCREEN update's detail is a prayer method code" apart
      // from a timezone string or a playlist name without a fragile heuristic.
      logAction({
        resourceType: 'SCREEN', resourceName: screen.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });

  return (
    <div className="border border-amber-200 dark:border-amber-800 rounded-lg p-3 bg-amber-50 dark:bg-amber-950/40">
      <div className="flex items-center gap-1.5 mb-2 text-amber-700 font-medium text-xs">
        <Moon className="w-3.5 h-3.5" /> {t('prayer.title')}
      </div>
      {(screen.latitude == null || screen.longitude == null) && (
        <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">{t('prayer.needsLocation')}</p>
      )}
      <div className="mb-2">
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-0.5">{t('prayer.method')}</label>
        <select value={method} onChange={e => setMethod(e.target.value)} disabled={!canEditContent}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50">
          {PRAYER_METHOD_VALUES.map(v => <option key={v} value={v}>{t(`prayer.methods.${v}`)}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600 mb-2 cursor-pointer">
        <input type="checkbox" checked={athan} onChange={e => setAthan(e.target.checked)} disabled={!canEditContent}
          className="w-3.5 h-3.5 accent-amber-500" />
        {t('prayer.athan')}
      </label>
      {canEditContent && (
        <button onClick={() => prayerMut.mutate()} disabled={prayerMut.isPending}
          className="w-full text-xs py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded font-medium disabled:opacity-50">
          {prayerMut.isPending ? t('prayer.saving') : t('prayer.save')}
        </button>
      )}
    </div>
  );
}

// The kiosk's floor + "you are here" pin — kept inline on Screens (not only reachable from the
// Wayfinding section) the same way asset/playlist/layout/theme pickers already are, since a
// screen's own content binding is something you configure right where the screen lives.
function KioskLocationPanel({ screen }: { screen: Screen }) {
  const qc = useQueryClient();
  const { canEditContent } = usePermissions();
  const t = useTranslations('screens');
  const { data: buildings = [] } = useQuery({ queryKey: ['buildings'], queryFn: wayfindingApi.listBuildings });
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  const [floorId, setFloorId] = useState(screen.kioskLocation?.floorId ?? '');

  const { data: pois = [] } = useQuery({
    queryKey: ['pois', floorId],
    queryFn: () => wayfindingApi.listPois(floorId),
    enabled: !!floorId,
  });

  const setLocationMut = useMutation({
    mutationFn: ({ x, y }: { x: number; y: number }) => screensApi.setKioskLocation(screen.id, floorId, x, y),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['screens'] }),
  });
  const clearMut = useMutation({
    mutationFn: () => screensApi.clearKioskLocation(screen.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['screens'] }),
  });

  const selectedFloor = buildings.flatMap(b => b.floors.map(f => ({ ...f, buildingName: b.name }))).find(f => f.id === floorId);
  const floorPlanUrl = selectedFloor?.floorPlanAssetId
    ? (assets.find(a => a.id === selectedFloor.floorPlanAssetId)?.url ?? null)
    : null;
  const activePin = floorId === screen.kioskLocation?.floorId && screen.kioskLocation ? { x: screen.kioskLocation.x, y: screen.kioskLocation.y } : null;

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 font-medium text-xs">
          <Navigation className="w-3.5 h-3.5" /> {t('kiosk.floor')}
        </div>
        {screen.kioskLocation && canEditContent && (
          <button onClick={() => clearMut.mutate()} disabled={clearMut.isPending}
            className="text-xs text-gray-400 dark:text-gray-500 hover:text-red-500">
            {t('kiosk.clear')}
          </button>
        )}
      </div>

      {buildings.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-2">{t('kiosk.noBuildings')}</p>
      ) : (
        <>
          <select
            value={floorId} disabled={!canEditContent}
            onChange={e => setFloorId(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50 mb-2">
            <option value="">{t('kiosk.noFloor')}</option>
            {buildings.map(b => (
              <optgroup key={b.id} label={b.name}>
                {b.floors.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
              </optgroup>
            ))}
          </select>

          {floorId && (
            <>
              {!floorPlanUrl && <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">{t('kiosk.noFloorPlan')}</p>}
              <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">{t('kiosk.location')}</label>
              <PoiMapEditor
                imageUrl={floorPlanUrl}
                pins={pois.map(p => ({ id: p.id, x: p.x, y: p.y, color: p.category.color, label: p.name }))}
                activePin={activePin}
                onActivePinChange={(x, y) => setLocationMut.mutate({ x, y })}
                disabled={!canEditContent}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

// Idle/attract-loop content (Phase 7.2) — reuses Playlist/Theme, no new content model. Only
// rendered once a kiosk floor/pin is set (see the ScreensPage call site below): the backend
// rejects setting attract content before a KioskLocation row exists, so hiding the picker until
// then avoids a picker the first save would just 404 out of.
function KioskAttractContentPanel({ screen }: { screen: Screen }) {
  const qc = useQueryClient();
  const { canEditContent } = usePermissions();
  const t = useTranslations('screens');
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });
  const { data: themes = [] } = useQuery({ queryKey: ['themes'], queryFn: themesApi.list });

  // Which selector is showing — independent of what's actually saved, so switching tabs to look
  // around doesn't itself clear the other field; only picking an option does that (the backend
  // already clears the other field server-side when one is set, so there's nothing to do here
  // beyond deciding which dropdown to render).
  const [tab, setTab] = useState<'PLAYLIST' | 'THEME'>(screen.kioskLocation?.attractThemeId ? 'THEME' : 'PLAYLIST');

  const setPlaylistMut = useMutation({
    mutationFn: (playlistId: string | null) => screensApi.setKioskAttractPlaylist(screen.id, playlistId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['screens'] }),
  });
  const setThemeMut = useMutation({
    mutationFn: (themeId: string | null) => screensApi.setKioskAttractTheme(screen.id, themeId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['screens'] }),
  });

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      <div className="flex items-center gap-1.5 mb-1 text-gray-600 dark:text-gray-300 font-medium text-xs">
        <Palette className="w-3.5 h-3.5" /> {t('kiosk.attract.title')}
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t('kiosk.attract.hint')}</p>

      <div className="grid grid-cols-2 gap-2 mb-2">
        <button
          onClick={() => setTab('PLAYLIST')}
          className={`text-xs py-1 rounded font-medium ${tab === 'PLAYLIST' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
        >
          {t('kiosk.attract.playlist')}
        </button>
        <button
          onClick={() => setTab('THEME')}
          className={`text-xs py-1 rounded font-medium ${tab === 'THEME' ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300'}`}
        >
          {t('kiosk.attract.theme')}
        </button>
      </div>

      {tab === 'PLAYLIST' ? (
        <select
          value={screen.kioskLocation?.attractPlaylistId ?? ''}
          disabled={!canEditContent}
          onChange={e => setPlaylistMut.mutate(e.target.value || null)}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
        >
          <option value="">{t('kiosk.attract.noneOption')}</option>
          {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ) : (
        <select
          value={screen.kioskLocation?.attractThemeId ?? ''}
          disabled={!canEditContent}
          onChange={e => setThemeMut.mutate(e.target.value || null)}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-50"
        >
          <option value="">{t('kiosk.attract.noneOption')}</option>
          {themes.map(th => <option key={th.id} value={th.id}>{th.name}</option>)}
        </select>
      )}
    </div>
  );
}

function ScreenshotPanel({ screen }: { screen: Screen }) {
  const qc = useQueryClient();
  const { canEditContent } = usePermissions();
  const { format: dateFormat } = useDateFormat();
  const t = useTranslations('screens');

  const captureMut = useMutation({
    mutationFn: () => screensApi.captureScreenshot(screen.id),
    // The player captures and uploads asynchronously — there's no immediate response to show,
    // so just quietly refetch a little later on the chance it already landed. The timestamp
    // is the actual source of truth for whether a *new* screenshot arrived, not this refetch.
    onSuccess: () => { setTimeout(() => void qc.invalidateQueries({ queryKey: ['screens'] }), 4000); },
  });

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-300 font-medium text-xs">
          <Camera className="w-3.5 h-3.5" /> {t('screenshot.title')}
        </div>
        {canEditContent && (
          <button onClick={() => captureMut.mutate()} disabled={captureMut.isPending}
            className="flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 disabled:opacity-50">
            <RefreshCw className={`w-3 h-3 ${captureMut.isPending ? 'animate-spin' : ''}`} /> {t('screenshot.refresh')}
          </button>
        )}
      </div>
      {screen.screenshotUrl ? (
        <>
          <div className="relative w-full aspect-video rounded overflow-hidden bg-black">
            <NextImage src={screen.screenshotUrl} alt={t('screenshot.title')} fill sizes="400px" className="object-cover" />
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {t('screenshot.capturedAt', { when: formatDateTime(screen.screenshotUpdatedAt!, dateFormat) })}
          </p>
        </>
      ) : (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-3 text-center">{t('screenshot.none')}</p>
      )}
    </div>
  );
}

function CrashHistoryPanel({ screen }: { screen: Screen }) {
  const t = useTranslations('screens');
  const { format: dateFormat } = useDateFormat();
  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['crashReports', screen.id],
    queryFn: () => screensApi.crashReports(screen.id),
  });

  return (
    <div className="border border-red-200 dark:border-red-900 rounded-lg p-3 bg-red-50 dark:bg-red-950/40">
      <div className="flex items-center gap-1.5 mb-2 text-red-700 dark:text-red-400 font-medium text-xs">
        <Bug className="w-3.5 h-3.5" /> {t('crashHistory.title')}
      </div>
      {isLoading && <p className="text-xs text-gray-400 dark:text-gray-500">{t('crashHistory.loading')}</p>}
      {!isLoading && reports.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 py-2 text-center">{t('crashHistory.none')}</p>
      )}
      {!isLoading && reports.length > 0 && (
        <ul className="space-y-1.5 max-h-40 overflow-y-auto">
          {reports.map(r => (
            <li key={r.id} className="text-xs bg-white dark:bg-gray-900 rounded px-2 py-1.5 border border-red-100 dark:border-red-900/60">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-red-700 dark:text-red-400">{t(`crashHistory.type.${r.type}`)}</span>
                <span className="text-gray-400 dark:text-gray-500 shrink-0">{formatDateTime(r.occurredAt, dateFormat)}</span>
              </div>
              <p className="text-gray-600 dark:text-gray-300 truncate" title={r.summary}>{r.summary}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VolumeControl({ screen, disabled }: { screen: Screen; disabled: boolean }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const logAction = useAuditLog();
  const t = useTranslations('screens');
  // Local draft so the slider tracks the pointer smoothly; the mutation only fires once the
  // user releases it, rather than on every intermediate onChange event while dragging.
  const [draft, setDraft] = useState(screen.volume ?? 100);

  const volumeMut = useMutation({
    mutationFn: (volume: number) => screensApi.setVolume(screen.id, volume),
    onSuccess: (updated) => {
      logAction({
        resourceType: 'SCREEN', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '', detail: `${updated.volume}%`,
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });

  return (
    <div>
      <label className="text-xs text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1">
        <Volume2 className="w-3 h-3" /> {t('volume')} <span className="ms-auto text-gray-500 dark:text-gray-400">{draft}%</span>
      </label>
      <input
        type="range" min={0} max={100} value={draft} disabled={disabled}
        onChange={e => setDraft(Number(e.target.value))}
        onMouseUp={() => volumeMut.mutate(draft)}
        onTouchEnd={() => volumeMut.mutate(draft)}
        className="w-full accent-indigo-600 disabled:opacity-50"
      />
    </div>
  );
}

export default function ScreensPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const locale = useLocale();
  const { user } = useAuth();
  const { canEditContent, canManageBilling } = usePermissions();
  const { confirmDelete } = useConfirmBeforeDelete();
  const { enabled: faithEnabled } = useFaithFeatures();
  const { format: dateFormat } = useDateFormat();
  const logAction = useAuditLog();
  const t = useTranslations('screens');
  const tc = useTranslations('common');
  const ta = useTranslations('auditLog');
  const { data: screens = [], isLoading, isFetching } = useQuery({ queryKey: ['screens'], queryFn: screensApi.list });
  const { data: currentPlan = 'FREE' } = useQuery({ queryKey: ['billingPlan'], queryFn: billingApi.getCurrentPlan });
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });
  const { data: layouts = [] } = useQuery({ queryKey: ['layouts'], queryFn: layoutsApi.list });
  const { data: themes = [] } = useQuery({ queryKey: ['themes'], queryFn: themesApi.list });
  const { data: groups = [] } = useQuery({ queryKey: ['screenGroups'], queryFn: screenGroupsApi.list });
  const { data: groupAssignments = {} } = useQuery({ queryKey: ['screenGroupAssignments'], queryFn: screenGroupsApi.getAssignments });
  const { data: orgSettings } = useQuery({ queryKey: ['orgSettings'], queryFn: orgApi.getSettings });
  const autoPublish = orgSettings?.autoPublish ?? false;
  const liveStatuses = useScreenSocket();

  const [showPair, setShowPair] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [pairError, setPairError] = useState('');
  const [expandedLocation, setExpandedLocation] = useState<string | null>(null);
  const [expandedTimezone, setExpandedTimezone] = useState<string | null>(null);
  const [expandedPrayer, setExpandedPrayer] = useState<string | null>(null);
  const [expandedScreenshot, setExpandedScreenshot] = useState<string | null>(null);
  const [expandedCrash, setExpandedCrash] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState('');
  const [publishedMessage, setPublishedMessage] = useState('');
  const [namingWarningScreen, setNamingWarningScreen] = useState<Screen | null>(null);
  const [search, setSearch] = useState('');
  const [showUnpaired, setShowUnpaired] = useState(false);

  const pairMut = useMutation({
    mutationFn: () => screensApi.pair(pairCode.trim().toUpperCase()),
    onSuccess: (created) => {
      logAction({
        resourceType: 'SCREEN', resourceName: created.name, action: 'CREATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
      setShowPair(false);
      setPairCode('');
      setRenameValue('');
      setNamingWarningScreen(created);
    },
    onError: (e: Error) => setPairError(e.message),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string; previousName: string }) => screensApi.rename(id, name),
    onSuccess: (renamed, { previousName }) => {
      logAction({
        resourceType: 'SCREEN', resourceName: previousName, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: ta('detailRenamedTo', { name: renamed.name }),
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
      setRenamingId(null);
    },
  });

  function startRename(screen: Screen) {
    if (!canEditContent) return;
    setRenamingId(screen.id);
    setRenameValue(screen.name);
  }

  function commitRename(screen: Screen) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === screen.name) { setRenamingId(null); return; }
    renameMut.mutate({ id: screen.id, name: trimmed, previousName: screen.name });
  }

  function commitNamingWarning() {
    if (!namingWarningScreen) return;
    const trimmed = renameValue.trim();
    const screen = namingWarningScreen;
    setNamingWarningScreen(null);
    setRenameValue('');
    if (!trimmed || trimmed === screen.name) return;
    renameMut.mutate({ id: screen.id, name: trimmed, previousName: screen.name });
  }

  const removeMut = useMutation({
    mutationFn: (screen: Screen) => screensApi.remove(screen.id),
    onSuccess: (_data, screen) => {
      logAction({
        resourceType: 'SCREEN', resourceName: screen.name, action: 'DELETE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<Screen[]>(['screens'], (old) => old?.filter(s => s.id !== screen.id));
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });

  const unpairMut = useMutation({
    mutationFn: (screen: Screen) => screensApi.unpair(screen.id),
    onSuccess: (_updated, screen) => {
      logAction({
        resourceType: 'SCREEN', resourceName: screen.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: ta('detailUnpaired'),
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });

  const assignMut = useMutation({
    mutationFn: ({ id, playlistId }: { id: string; playlistId: string | null }) => screensApi.assign(id, playlistId),
    onSuccess: (updated, { playlistId }) => {
      logAction({
        resourceType: 'SCREEN', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: playlistId ? playlists.find(p => p.id === playlistId)?.name : undefined,
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });

  const themeMut = useMutation({
    mutationFn: ({ id, themeId }: { id: string; themeId: string | null }) => screensApi.setTheme(id, themeId),
    onSuccess: (updated, { themeId }) => {
      logAction({
        resourceType: 'SCREEN', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: themeId ? themes.find(th => th.id === themeId)?.name : undefined,
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });

  const streamingTypeMut = useMutation({
    mutationFn: ({ id, streamingType }: { id: string; streamingType: StreamingType }) =>
      screensApi.setStreamingType(id, streamingType),
    onSuccess: (updated, { streamingType }) => {
      logAction({
        resourceType: 'SCREEN', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: t(`streamingType.${streamingType}`),
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });

  const assetMut = useMutation({
    mutationFn: ({ id, assetId }: { id: string; assetId: string | null }) => screensApi.setAsset(id, assetId),
    onSuccess: (updated) => {
      logAction({
        resourceType: 'SCREEN', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });

  const publishMut = useMutation({ mutationFn: (id: string) => screensApi.publish(id) });
  const reloadMut = useMutation({ mutationFn: (id: string) => screensApi.reload(id) });
  const layoutMut = useMutation({
    mutationFn: ({ id, layoutId }: { id: string; layoutId: string | null }) =>
      screensApi.setLayout(id, layoutId),
    onSuccess: (updated, { layoutId }) => {
      logAction({
        resourceType: 'SCREEN', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: layoutId ? layouts.find(l => l.id === layoutId)?.name : undefined,
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });
  const emergencyMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      screensApi.setEmergency(id, active),
    onSuccess: (updated) => {
      logAction({
        resourceType: 'SCREEN', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });
  const stopMut = useMutation({
    mutationFn: ({ id, stopped }: { id: string; stopped: boolean }) =>
      screensApi.setStopped(id, stopped),
    onSuccess: (updated, { stopped }) => {
      logAction({
        resourceType: 'SCREEN', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: stopped ? ta('detailStopped') : ta('detailResumed'),
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });
  const timezoneMut = useMutation({
    mutationFn: ({ id, timezone, timezoneEnabled }: { id: string; timezone: string; timezoneEnabled: boolean }) =>
      screensApi.updatePrayer(id, { timezone, timezoneEnabled }),
    onSuccess: (updated, { timezone, timezoneEnabled }) => {
      logAction({
        resourceType: 'SCREEN', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '', detail: timezoneEnabled ? timezone : undefined,
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });

  const showClockMut = useMutation({
    mutationFn: ({ id, showClock }: { id: string; showClock: boolean }) =>
      screensApi.setShowClock(id, showClock),
    onSuccess: (updated, { showClock }) => {
      logAction({
        resourceType: 'SCREEN', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: showClock ? ta('detailClockOn') : ta('detailClockOff'),
      });
      void qc.invalidateQueries({ queryKey: ['screens'] });
    },
  });

  const createGroupMut = useMutation({
    mutationFn: () => screenGroupsApi.create(newGroupName.trim()),
    onSuccess: (created) => {
      logAction({
        resourceType: 'GROUP', resourceName: created.name, action: 'CREATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<ScreenGroup[]>(['screenGroups'], (old) => (old ? [...old, created] : [created]));
      void qc.invalidateQueries({ queryKey: ['screenGroups'] });
      setNewGroupName('');
      setCreatingGroup(false);
    },
  });

  const renameGroupMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string; previousName: string }) => screenGroupsApi.rename(id, name),
    onSuccess: (updated, { previousName }) => {
      logAction({
        resourceType: 'GROUP', resourceName: previousName, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: ta('detailRenamedTo', { name: updated.name }),
      });
      qc.setQueryData<ScreenGroup[]>(['screenGroups'], (old) => old?.map(g => (g.id === updated.id ? updated : g)));
      void qc.invalidateQueries({ queryKey: ['screenGroups'] });
      setRenamingGroupId(null);
    },
  });

  const removeGroupMut = useMutation({
    mutationFn: (group: ScreenGroup) => screenGroupsApi.remove(group.id),
    onSuccess: (_data, group) => {
      logAction({
        resourceType: 'GROUP', resourceName: group.name, action: 'DELETE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<ScreenGroup[]>(['screenGroups'], (old) => old?.filter(g => g.id !== group.id));
      void qc.invalidateQueries({ queryKey: ['screenGroups'] });
      void qc.invalidateQueries({ queryKey: ['screenGroupAssignments'] });
      setActiveGroupId(prev => (prev === group.id ? null : prev));
    },
  });

  const assignGroupMut = useMutation({
    mutationFn: ({ screen, groupId }: { screen: Screen; groupId: string | null }) => screenGroupsApi.assign(screen.id, groupId),
    onSuccess: (_data, { screen, groupId }) => {
      const previousGroupId = groupAssignments[screen.id];
      const previousGroupName = previousGroupId ? groups.find(g => g.id === previousGroupId)?.name : undefined;
      const newGroupName = groupId ? groups.find(g => g.id === groupId)?.name : undefined;
      let detail: string | undefined;
      if (newGroupName && previousGroupName) detail = ta('detailMovedFromTo', { from: previousGroupName, to: newGroupName });
      else if (newGroupName) detail = ta('detailMovedToGroup', { group: newGroupName });
      else if (previousGroupName) detail = ta('detailRemovedFromGroup', { group: previousGroupName });
      logAction({
        resourceType: 'SCREEN', resourceName: screen.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail,
      });
      qc.setQueryData<Record<string, string>>(['screenGroupAssignments'], (old) => {
        const next = { ...old };
        if (groupId) next[screen.id] = groupId;
        else delete next[screen.id];
        return next;
      });
      void qc.invalidateQueries({ queryKey: ['screenGroupAssignments'] });
    },
  });

  const bulkPublishMut = useMutation({
    mutationFn: (screenIds: string[]) => Promise.all(screenIds.map(id => screensApi.publish(id))),
    onSuccess: (_data, screenIds) => {
      setPublishedMessage(t('groups.published', { count: screenIds.length }));
      setTimeout(() => setPublishedMessage(''), 4000);
    },
  });

  function statusFor(screen: Screen): 'ONLINE' | 'OFFLINE' {
    return liveStatuses[screen.id] ?? screen.status;
  }

  // Unpairing keeps the row around server-side (so re-pairing the same device lands back on
  // its name/history/settings), but it's no longer a screen anyone here is managing day to
  // day — hide it until something re-pairs into it.
  const pairedScreens = screens.filter(s => s.paired);
  const unpairedScreens = screens.filter(s => !s.paired);
  const groupFilteredScreens = activeGroupId ? pairedScreens.filter(s => groupAssignments[s.id] === activeGroupId) : pairedScreens;
  const visibleScreens = groupFilteredScreens.filter(s => s.name.toLowerCase().includes(search.toLowerCase()));
  const screenLimit = planLimit(currentPlan);
  const atScreenLimit = screenLimit !== null && pairedScreens.length >= screenLimit;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void qc.invalidateQueries({ queryKey: ['screens'] })}
            disabled={isFetching}
            title={t('refresh')}
            className="flex items-center gap-1.5 text-sm border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 px-3 py-2 rounded-lg font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} /> {t('refresh')}
          </button>
          {canEditContent && (
            atScreenLimit ? (
              <button
                onClick={() => canManageBilling && router.push(`/${locale}/billing`)}
                title={canManageBilling ? undefined : t('limitReachedContactAdmin')}
                className="flex items-center gap-2 bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-200 dark:hover:bg-amber-900">
                <AlertTriangle className="w-4 h-4" /> {t('limitReached', { limit: screenLimit })}
              </button>
            ) : (
              <button onClick={() => { setShowPair(true); setPairError(''); }}
                className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
                <Plus className="w-4 h-4" /> {t('pairScreen')}
              </button>
            )
          )}
        </div>
      </div>

      {pairedScreens.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute start-2.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tc('search')}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg ps-8 pe-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
      )}

      {/* Group filter bar */}
      <div className="flex items-center flex-wrap gap-2 mb-4">
        <button onClick={() => setActiveGroupId(null)}
          className={`text-sm px-4 py-2 rounded-full font-medium border transition-colors ${
            activeGroupId === null
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}>
          {t('groups.allScreens')}
        </button>
        {groups.map((group: ScreenGroup) => (
          <div key={group.id} className="group/chip relative">
            {renamingGroupId === group.id ? (
              <input autoFocus value={renameGroupValue} onChange={e => setRenameGroupValue(e.target.value)}
                onBlur={() => { const trimmed = renameGroupValue.trim(); if (trimmed) renameGroupMut.mutate({ id: group.id, name: trimmed, previousName: group.name }); else setRenamingGroupId(null); }}
                onKeyDown={e => {
                  if (e.key === 'Enter') { const trimmed = renameGroupValue.trim(); if (trimmed) renameGroupMut.mutate({ id: group.id, name: trimmed, previousName: group.name }); }
                  if (e.key === 'Escape') setRenamingGroupId(null);
                }}
                className="text-sm px-4 py-2 rounded-full border border-indigo-300 dark:border-indigo-700 dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-32" />
            ) : (
              <button onClick={() => setActiveGroupId(group.id)}
                className={`flex items-center gap-2 text-sm px-4 py-2 rounded-full font-medium border transition-colors ${
                  activeGroupId === group.id
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}>
                <FolderKanban className="w-3.5 h-3.5" /> {group.name}
                {canEditContent && (
                  <>
                    <span onClick={e => { e.stopPropagation(); setRenamingGroupId(group.id); setRenameGroupValue(group.name); }}
                      title={t('groups.renameTitle')} className="opacity-0 group-hover/chip:opacity-70 hover:opacity-100">
                      <Pencil className="w-3.5 h-3.5" />
                    </span>
                    <span onClick={e => { e.stopPropagation(); if (confirmDelete(t('groups.deleteConfirm'))) removeGroupMut.mutate(group); }}
                      title={t('groups.deleteTitle')} className="opacity-0 group-hover/chip:opacity-70 hover:opacity-100">
                      <X className="w-3.5 h-3.5" />
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        ))}
        {canEditContent && (
          creatingGroup ? (
            <div className="flex items-center gap-1.5">
              <input autoFocus value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newGroupName.trim()) createGroupMut.mutate(); if (e.key === 'Escape') setCreatingGroup(false); }}
                placeholder={t('groups.namePlaceholder')}
                className="text-sm px-4 py-2 rounded-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-32" />
              <button onClick={() => createGroupMut.mutate()} disabled={!newGroupName.trim() || createGroupMut.isPending}
                className="text-indigo-600 hover:text-indigo-700 disabled:opacity-50"><Check className="w-5 h-5" /></button>
              <button onClick={() => setCreatingGroup(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
          ) : (
            <button onClick={() => setCreatingGroup(true)}
              className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
              <Plus className="w-3.5 h-3.5" /> {t('groups.newGroup')}
            </button>
          )
        )}
        {activeGroupId && visibleScreens.length > 0 && canEditContent && !autoPublish && (
          <button onClick={() => bulkPublishMut.mutate(visibleScreens.map(s => s.id))} disabled={bulkPublishMut.isPending}
            className="ms-auto flex items-center gap-2 text-sm px-4 py-2 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 disabled:opacity-50">
            <Send className="w-3.5 h-3.5" /> {bulkPublishMut.isPending ? t('groups.publishing') : t('groups.publishToGroup')}
          </button>
        )}
      </div>

      {publishedMessage && (
        <div className="mb-4 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 text-sm px-4 py-2 rounded-lg">{publishedMessage}</div>
      )}

      {/* Pair modal */}
      {showPair && canEditContent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2"><Unplug className="w-4 h-4 text-indigo-600" /> {t('pairModalTitle')}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{t('pairModalBody')}</p>
            <input value={pairCode} onChange={e => { setPairCode(e.target.value.toUpperCase()); setPairError(''); }}
              placeholder="ABC123" maxLength={6}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm text-center tracking-widest font-mono text-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-2" />
            {pairError && <p className="text-xs text-red-600 mb-2">{pairError}</p>}
            <div className="flex gap-2 mt-2">
              <button onClick={() => setShowPair(false)}
                className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
              <button onClick={() => pairMut.mutate()} disabled={pairCode.length < 6 || pairMut.isPending}
                className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {pairMut.isPending ? t('pairing') : t('pair')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Naming warning — nudges the user to replace the auto-generated "Unnamed Screen N"
          right after pairing, since a fleet of same-named screens becomes hard to tell apart
          later. Closing without typing anything just keeps that serial-numbered default. */}
      {namingWarningScreen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-900 rounded-xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-2 flex items-center gap-2">
              <TriangleAlert className="w-4 h-4 text-amber-500" /> {t('nameWarning.title')}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              {t('nameWarning.body', { name: namingWarningScreen.name })}
            </p>
            <input
              autoFocus
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && renameValue.trim()) commitNamingWarning(); }}
              placeholder={t('nameWarning.placeholder')}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3" />
            <div className="flex gap-2">
              <button onClick={() => { setNamingWarningScreen(null); setRenameValue(''); }}
                className="flex-1 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">
                {t('nameWarning.skip')}
              </button>
              <button onClick={commitNamingWarning} disabled={!renameValue.trim() || renameMut.isPending}
                className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                {renameMut.isPending ? t('nameWarning.saving') : t('nameWarning.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && visibleScreens.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Monitor className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{pairedScreens.length === 0 ? t('empty') : tc('noMatches')}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 items-start">
        {visibleScreens.map((screen: Screen) => {
          const live = statusFor(screen);
          return (
            <div key={screen.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <Tv2 className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                  {renamingId === screen.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(screen)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') commitRename(screen);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      disabled={renameMut.isPending}
                      className="font-medium text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-800 border border-indigo-300 dark:border-indigo-700 rounded px-1 -mx-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  ) : (
                    <span
                      onClick={() => startRename(screen)}
                      title={canEditContent ? tc('clickToRename') : undefined}
                      className={`font-medium text-gray-900 dark:text-gray-100 text-sm truncate ${canEditContent ? 'cursor-text hover:text-indigo-600 dark:hover:text-indigo-400' : ''}`}>
                      {screen.name}
                    </span>
                  )}
                </div>
                <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${live === 'ONLINE' ? 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${live === 'ONLINE' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                  {live === 'ONLINE' ? t('online') : t('offline')}
                </span>
              </div>

              {!screen.hasContent && (
                <div title={t('awaitingContentTitle')}
                  className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-medium bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-2 py-1.5">
                  <FileQuestion className="w-3 h-3" /> {t('awaitingContent')}
                </div>
              )}

              <div>
                <label className="text-xs text-gray-400 dark:text-gray-500 mb-1 block">{t('streamingType.label')}</label>
                <div className="grid grid-cols-5 gap-1">
                  {(['ASSET', 'PLAYLIST', 'LAYOUT', 'THEME', 'WAYFINDING'] as const).map(st => {
                    const Icon = st === 'ASSET' ? ImageIcon : st === 'PLAYLIST' ? ListVideo : st === 'LAYOUT' ? LayoutGrid : st === 'THEME' ? Palette : Navigation;
                    return (
                      <button key={st} type="button" disabled={!canEditContent}
                        onClick={() => streamingTypeMut.mutate({ id: screen.id, streamingType: st })}
                        className={`flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg border font-medium disabled:opacity-50 ${
                          screen.streamingType === st
                            ? 'bg-indigo-600 border-indigo-600 text-white'
                            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                        }`}>
                        <Icon className="w-3 h-3" /> {t(`streamingType.${st}`)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {screen.streamingType === 'ASSET' && (
                <div>
                  <label className="text-xs text-gray-400 dark:text-gray-500 mb-1 block">{t('streamingType.assetLabel')}</label>
                  <AssetPicker
                    value={screen.assetId} disabled={!canEditContent} placeholder={t('none')}
                    onChange={assetId => assetMut.mutate({ id: screen.id, assetId })}
                  />
                </div>
              )}

              {screen.streamingType === 'PLAYLIST' && (
                <div>
                  <label className="text-xs text-gray-400 dark:text-gray-500 mb-1 block">{t('defaultPlaylist')}</label>
                  <select
                    value={screen.playlistId ?? ''} disabled={!canEditContent}
                    onChange={e => assignMut.mutate({ id: screen.id, playlistId: e.target.value || null })}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
                    <option value="">{t('none')}</option>
                    {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )}

              {screen.streamingType === 'LAYOUT' && (
                <div>
                  <label className="text-xs text-gray-400 dark:text-gray-500 mb-1 block">{t('layoutZones')}</label>
                  <select
                    value={screen.layoutId ?? ''} disabled={!canEditContent}
                    onChange={e => layoutMut.mutate({ id: screen.id, layoutId: e.target.value || null })}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
                    <option value="">{t('fullscreenNoLayout')}</option>
                    {layouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              )}

              {screen.streamingType === 'THEME' && (
                <div>
                  <label className="text-xs text-gray-400 dark:text-gray-500 mb-1 block">{t('streamingType.themeLabel')}</label>
                  <select
                    value={screen.themeId ?? ''} disabled={!canEditContent}
                    onChange={e => themeMut.mutate({ id: screen.id, themeId: e.target.value || null })}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
                    <option value="">{t('none')}</option>
                    {themes.map(th => <option key={th.id} value={th.id}>{th.name}</option>)}
                  </select>
                </div>
              )}

              {screen.streamingType === 'WAYFINDING' && <KioskLocationPanel screen={screen} />}
              {screen.streamingType === 'WAYFINDING' && screen.kioskLocation && <KioskAttractContentPanel screen={screen} />}

              {/* Timezone — collapsible, and only relevant when something actually consults it:
                  Playlist mode's schedule rules, or Layout mode's prayer/weather zones. */}
              {screen.streamingType !== 'ASSET' && (
                <>
                  <button
                    onClick={() => setExpandedTimezone(expandedTimezone === screen.id ? null : screen.id)}
                    className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    {expandedTimezone === screen.id ? t('hideTimezone') : t('configureTimezone')}
                    <span className="ml-auto text-gray-400 dark:text-gray-500 opacity-70 truncate max-w-[8rem]">{screen.timezone}</span>
                  </button>
                  {expandedTimezone === screen.id && (
                    <TimezoneSelect
                      value={screen.timezone} disabled={!canEditContent}
                      onChange={tz => timezoneMut.mutate({ id: screen.id, timezone: tz, timezoneEnabled: true })}
                    />
                  )}
                </>
              )}

              <VolumeControl screen={screen} disabled={!canEditContent} />

              <label className={`flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 ${canEditContent ? 'cursor-pointer' : ''}`}>
                <input type="checkbox" checked={screen.showClock} disabled={!canEditContent}
                  onChange={e => showClockMut.mutate({ id: screen.id, showClock: e.target.checked })}
                  className="w-3.5 h-3.5 accent-indigo-500 disabled:opacity-50" />
                <Clock className="w-3 h-3" /> {t('showClock')}
              </label>

              <div>
                <label className="text-xs text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1">
                  <FolderKanban className="w-3 h-3" /> {t('groups.label')}
                </label>
                <select
                  value={groupAssignments[screen.id] ?? ''} disabled={!canEditContent}
                  onChange={e => assignGroupMut.mutate({ screen, groupId: e.target.value || null })}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
                  <option value="">{t('groups.noGroup')}</option>
                  {groups.map((g: ScreenGroup) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>

              {/* Screen location — always available, since Weather zones need it too and
                  shouldn't be locked behind the faith-features toggle */}
              <button
                onClick={() => setExpandedLocation(expandedLocation === screen.id ? null : screen.id)}
                className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium">
                <MapPin className="w-3.5 h-3.5" />
                {expandedLocation === screen.id ? t('hideLocation') : t('configureLocation')}
                {screen.latitude != null && screen.longitude != null && (
                  <span className="ml-auto text-emerald-500 opacity-70">{t('set')}</span>
                )}
              </button>
              {expandedLocation === screen.id && <LocationPanel screen={screen} />}

              {/* Prayer settings */}
              {faithEnabled && (
                <button
                  onClick={() => setExpandedPrayer(expandedPrayer === screen.id ? null : screen.id)}
                  className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 font-medium">
                  <Moon className="w-3.5 h-3.5" />
                  {expandedPrayer === screen.id ? t('hideFaith') : t('configureFaith')}
                  {screen.latitude && screen.longitude && (
                    <span className="ml-auto text-amber-500 opacity-70">{t('set')}</span>
                  )}
                </button>
              )}
              {faithEnabled && expandedPrayer === screen.id && <PrayerPanel screen={screen} />}

              {/* Remote diagnostics: live-preview screenshot + crash history */}
              <button
                onClick={() => setExpandedScreenshot(expandedScreenshot === screen.id ? null : screen.id)}
                className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium">
                <Camera className="w-3.5 h-3.5" />
                {expandedScreenshot === screen.id ? t('screenshot.hide') : t('screenshot.show')}
                {screen.screenshotUrl && <span className="ml-auto text-emerald-500 opacity-70">{t('set')}</span>}
              </button>
              {expandedScreenshot === screen.id && <ScreenshotPanel screen={screen} />}

              <button
                onClick={() => setExpandedCrash(expandedCrash === screen.id ? null : screen.id)}
                className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium">
                <Bug className="w-3.5 h-3.5" />
                {expandedCrash === screen.id ? t('crashHistory.hide') : t('crashHistory.show')}
              </button>
              {expandedCrash === screen.id && <CrashHistoryPanel screen={screen} />}

              {screen.stopped && (
                <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400 font-medium bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-2 py-1.5">
                  <Pause className="w-3 h-3 fill-current" /> {t('stoppedBanner')}
                </div>
              )}

              {/* Action buttons */}
              {canEditContent && (
                <div className="flex flex-wrap gap-2">
                  {!autoPublish && (
                    <button
                      onClick={() => publishMut.mutate(screen.id)}
                      disabled={publishMut.isPending && publishMut.variables === screen.id}
                      title={t('publishTitle')}
                      className="flex-1 flex items-center justify-center gap-1 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-50 dark:hover:bg-indigo-950 disabled:opacity-50">
                      <Send className="w-3 h-3" /> {t('publish')}
                    </button>
                  )}
                  <button
                    onClick={() => stopMut.mutate({ id: screen.id, stopped: !screen.stopped })}
                    disabled={stopMut.isPending && stopMut.variables?.id === screen.id}
                    title={screen.stopped ? t('resumeStreamTitle') : t('pauseStreamTitle')}
                    className={`flex items-center justify-center gap-1 border py-1.5 px-3 rounded-lg text-xs font-medium disabled:opacity-50 ${
                      screen.stopped
                        ? 'border-emerald-300 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}>
                    {screen.stopped ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                    {screen.stopped ? t('resume') : t('pause')}
                  </button>
                  <button
                    onClick={() => emergencyMut.mutate({ id: screen.id, active: !screen.emergencyActive })}
                    disabled={emergencyMut.isPending && emergencyMut.variables?.id === screen.id}
                    title={screen.emergencyActive ? t('deactivateEmergency') : t('activateEmergency')}
                    className={`flex items-center justify-center gap-1 border py-1.5 px-3 rounded-lg text-xs font-medium disabled:opacity-50 ${
                      screen.emergencyActive
                        ? 'border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}>
                    <AlertTriangle className="w-3 h-3" />
                    {screen.emergencyActive ? t('stopEmergency') : t('emergency')}
                  </button>
                  <button
                    onClick={() => reloadMut.mutate(screen.id)}
                    disabled={reloadMut.isPending && reloadMut.variables === screen.id}
                    title={t('reloadTitle')}
                    className="flex items-center justify-center gap-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 py-1.5 px-3 rounded-lg text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
                    <RefreshCw className="w-3 h-3" /> {t('reload')}
                  </button>
                  <button
                    onClick={() => { if (confirmDelete(t('unpairConfirm'))) unpairMut.mutate(screen); }}
                    disabled={unpairMut.isPending && unpairMut.variables?.id === screen.id}
                    title={t('unpairTitle')}
                    className="flex items-center justify-center gap-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 py-1.5 px-3 rounded-lg text-xs font-medium hover:bg-amber-50 dark:hover:bg-amber-950/40 hover:text-amber-600 dark:hover:text-amber-400 hover:border-amber-200 dark:hover:border-amber-800 disabled:opacity-50">
                    <Unplug className="w-3 h-3" /> {t('unpair')}
                  </button>
                </div>
              )}

              <div className="flex justify-between items-center pt-1 border-t border-gray-100 dark:border-gray-800">
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {screen.lastSeenAt ? t('lastSeen', { when: formatDateTime(screen.lastSeenAt, dateFormat) }) : t('neverSeen')}
                </span>
                {canEditContent && (
                  <button onClick={() => { if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(screen); }}
                    title={t('deleteTitle')} aria-label={t('deleteTitle')}
                    className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Unpaired screens — kept server-side after Unpair so re-pairing the same device lands
          back on its name/history/settings, but that means they'd otherwise accumulate forever
          with no way to see or clean them up. Collapsed by default since day-to-day management
          only cares about the paired list above. */}
      {unpairedScreens.length > 0 && (
        <div className="mt-8 border-t border-gray-100 dark:border-gray-800 pt-4">
          <button
            onClick={() => setShowUnpaired(v => !v)}
            className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium">
            <Unplug className="w-4 h-4" />
            {showUnpaired
              ? t('unpairedSection.hide', { count: unpairedScreens.length })
              : t('unpairedSection.show', { count: unpairedScreens.length })}
          </button>
          {showUnpaired && (
            <div className="mt-3">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-3 max-w-2xl">{t('unpairedSection.hint')}</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {unpairedScreens.map(screen => (
                  <div key={screen.id} className="flex items-center justify-between gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{screen.name}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {screen.lastSeenAt ? t('lastSeen', { when: formatDateTime(screen.lastSeenAt, dateFormat) }) : t('neverSeen')}
                      </p>
                    </div>
                    {canEditContent && (
                      <button onClick={() => { if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(screen); }}
                        title={t('deleteTitle')} aria-label={t('deleteTitle')}
                        className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors shrink-0">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
