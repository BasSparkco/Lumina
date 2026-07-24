'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Monitor, Plus, Unplug, Trash2, Tv2, RefreshCw, Send, AlertTriangle, Moon, Clock, FolderKanban, Pencil, X, Check } from 'lucide-react';
import { screensApi, playlistsApi, layoutsApi, themesApi, assetsApi, type Screen, type ScreenContentType, type PlaylistSummary, type Layout, type Theme, type Asset } from '@/lib/api';
import { screenGroupsApi, type ScreenGroup } from '@/lib/mocks/screenGroups';
import { billingApi, planLimit } from '@/lib/mocks/billing';
import { useScreenSocket } from '@/hooks/useScreenSocket';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useAuth } from '@/context/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { TimezoneSelect } from '@/components/TimezoneSelect';

const PRAYER_METHOD_VALUES = [
  'UmmAlQura', 'Dubai', 'Kuwait', 'Qatar', 'Egyptian', 'MuslimWorldLeague',
  'Karachi', 'NorthAmerica', 'MoonsightingCommittee', 'Singapore', 'Tehran', 'Turkey',
];

function PrayerPanel({ screen }: { screen: Screen }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canEditContent } = usePermissions();
  const logAction = useAuditLog();
  const t = useTranslations('screens');
  const [lat, setLat] = useState(screen.latitude?.toString() ?? '');
  const [lon, setLon] = useState(screen.longitude?.toString() ?? '');
  const [method, setMethod] = useState(screen.prayerMethod ?? 'UmmAlQura');
  const [athan, setAthan] = useState(screen.athanEnabled ?? false);

  const prayerMut = useMutation({
    mutationFn: () =>
      screensApi.updatePrayer(screen.id, {
        latitude: lat ? parseFloat(lat) : undefined,
        longitude: lon ? parseFloat(lon) : undefined,
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
      <div className="grid grid-cols-2 gap-2 mb-2">
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-0.5">{t('prayer.latitude')}</label>
          <input type="number" step="0.0001" value={lat} onChange={e => setLat(e.target.value)} disabled={!canEditContent}
            placeholder="e.g. 21.4225"
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50" />
        </div>
        <div>
          <label className="text-xs text-gray-500 dark:text-gray-400 block mb-0.5">{t('prayer.longitude')}</label>
          <input type="number" step="0.0001" value={lon} onChange={e => setLon(e.target.value)} disabled={!canEditContent}
            placeholder="e.g. 39.8262"
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400 disabled:opacity-50" />
        </div>
      </div>
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

interface ScreenCardProps {
  screen: Screen;
  live: 'ONLINE' | 'OFFLINE';
  playlists: PlaylistSummary[];
  layouts: Layout[];
  themes: Theme[];
  assets: Asset[];
  groups: ScreenGroup[];
  groupId: string | null;
  canEditContent: boolean;
  renamingId: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  startRename: (screen: Screen) => void;
  commitRename: (screen: Screen) => void;
  setRenamingId: (id: string | null) => void;
  renamePending: boolean;
  expandedPrayer: string | null;
  setExpandedPrayer: (id: string | null) => void;
  onSetContent: (v: { id: string; contentType: ScreenContentType | null; assetId?: string | null; playlistId?: string | null; themeId?: string | null }) => Promise<Screen>;
  onSetLayout: (v: { id: string; layoutId: string | null }) => Promise<Screen>;
  onSetTimezone: (v: { id: string; timezone: string; timezoneEnabled: boolean }) => Promise<Screen>;
  onAssignGroup: (v: { screen: Screen; groupId: string | null }) => Promise<void>;
  onPublish: (id: string) => Promise<unknown>;
  onReload: (id: string) => void;
  reloadPending: boolean;
  onToggleEmergency: (v: { id: string; active: boolean }) => void;
  emergencyPending: boolean;
  onRemove: (screen: Screen) => void;
  confirmDelete: (msg: string) => boolean;
}

// The id of whichever source is active for the current content type — null covers "— None —"
// and every type but the active one, so a single field can drive the picker below the select.
function contentIdOf(screen: Screen): string | null {
  switch (screen.contentType) {
    case 'VIDEO':
    case 'IMAGE': return screen.assetId;
    case 'PLAYLIST': return screen.playlistId;
    case 'THEME': return screen.themeId;
    default: return null;
  }
}

function ScreenCard({
  screen, live, playlists, layouts, themes, assets, groups, groupId, canEditContent,
  renamingId, renameValue, setRenameValue, startRename, commitRename, setRenamingId, renamePending,
  expandedPrayer, setExpandedPrayer,
  onSetContent, onSetLayout, onSetTimezone, onAssignGroup, onPublish,
  onReload, reloadPending, onToggleEmergency, emergencyPending, onRemove, confirmDelete,
}: ScreenCardProps) {
  const t = useTranslations('screens');
  const tc = useTranslations('common');

  const [contentType, setContentType] = useState<ScreenContentType | null>(screen.contentType);
  const [contentId, setContentId] = useState<string | null>(contentIdOf(screen));
  const [layoutId, setLayoutId] = useState(screen.layoutId);
  const [timezone, setTimezone] = useState(screen.timezone);
  const [timezoneEnabled, setTimezoneEnabled] = useState(screen.timezoneEnabled);
  const [localGroupId, setLocalGroupId] = useState(groupId);
  const [isPublishing, setIsPublishing] = useState(false);

  const [baseline, setBaseline] = useState({
    contentType: screen.contentType, contentId: contentIdOf(screen), layoutId: screen.layoutId,
    timezone: screen.timezone, timezoneEnabled: screen.timezoneEnabled, groupId,
  });

  // "Adjusting state when a prop changes" (react.dev) — done during render, not in an effect,
  // so it resolves in the same commit instead of causing an extra render pass. Only pulls in
  // server values when there's nothing staged locally, so a background refetch (e.g. from
  // another screen's mutation invalidating ['screens']) never silently discards edits the
  // user hasn't published yet.
  const serverContentId = contentIdOf(screen);
  const serverChanged =
    screen.contentType !== baseline.contentType ||
    serverContentId !== baseline.contentId ||
    screen.layoutId !== baseline.layoutId ||
    screen.timezone !== baseline.timezone ||
    screen.timezoneEnabled !== baseline.timezoneEnabled ||
    groupId !== baseline.groupId;
  if (serverChanged) {
    const isDirtyNow =
      contentType !== baseline.contentType ||
      contentId !== baseline.contentId ||
      layoutId !== baseline.layoutId ||
      timezone !== baseline.timezone ||
      timezoneEnabled !== baseline.timezoneEnabled ||
      localGroupId !== baseline.groupId;
    setBaseline({
      contentType: screen.contentType, contentId: serverContentId, layoutId: screen.layoutId,
      timezone: screen.timezone, timezoneEnabled: screen.timezoneEnabled, groupId,
    });
    if (!isDirtyNow) {
      setContentType(screen.contentType);
      setContentId(serverContentId);
      setLayoutId(screen.layoutId);
      setTimezone(screen.timezone);
      setTimezoneEnabled(screen.timezoneEnabled);
      setLocalGroupId(groupId);
    }
  }

  const isDirty =
    contentType !== baseline.contentType ||
    contentId !== baseline.contentId ||
    layoutId !== baseline.layoutId ||
    timezone !== baseline.timezone ||
    timezoneEnabled !== baseline.timezoneEnabled ||
    localGroupId !== baseline.groupId;

  function changeContentType(next: ScreenContentType | '') {
    setContentType(next || null);
    setContentId(null);
  }

  async function handlePublish() {
    setIsPublishing(true);
    try {
      if (isDirty) {
        const tasks: Promise<unknown>[] = [];
        if (contentType !== baseline.contentType || contentId !== baseline.contentId) {
          tasks.push(onSetContent({
            id: screen.id,
            contentType,
            assetId: contentType === 'VIDEO' || contentType === 'IMAGE' ? contentId : undefined,
            playlistId: contentType === 'PLAYLIST' ? contentId : undefined,
            themeId: contentType === 'THEME' ? contentId : undefined,
          }));
        }
        if (layoutId !== baseline.layoutId) tasks.push(onSetLayout({ id: screen.id, layoutId }));
        if (timezone !== baseline.timezone || timezoneEnabled !== baseline.timezoneEnabled) {
          tasks.push(onSetTimezone({ id: screen.id, timezone, timezoneEnabled }));
        }
        if (localGroupId !== baseline.groupId) tasks.push(onAssignGroup({ screen, groupId: localGroupId }));
        await Promise.all(tasks);
      }
      await onPublish(screen.id);
    } finally {
      setIsPublishing(false);
    }
  }

  const videoAssets = assets.filter(a => a.type === 'VIDEO' && a.status === 'READY');
  const imageAssets = assets.filter(a => a.type === 'IMAGE' && a.status === 'READY');

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4 flex flex-col gap-3">
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
              disabled={renamePending}
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
        <span className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${live === 'ONLINE' ? 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${live === 'ONLINE' ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
          {live === 'ONLINE' ? t('online') : t('offline')}
        </span>
      </div>

      <div>
        <label className="text-xs text-gray-400 dark:text-gray-500 mb-1 block">{t('streamingType')}</label>
        <select
          value={contentType ?? ''} disabled={!canEditContent}
          onChange={e => changeContentType(e.target.value as ScreenContentType | '')}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 mb-1.5">
          <option value="">{t('none')}</option>
          <option value="VIDEO">{t('streamingTypes.VIDEO')}</option>
          <option value="IMAGE">{t('streamingTypes.IMAGE')}</option>
          <option value="PLAYLIST">{t('streamingTypes.PLAYLIST')}</option>
          <option value="THEME">{t('streamingTypes.THEME')}</option>
        </select>
        {contentType === 'VIDEO' && (
          <select
            value={contentId ?? ''} disabled={!canEditContent}
            onChange={e => setContentId(e.target.value || null)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
            <option value="">{t('noAsset')}</option>
            {videoAssets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {contentType === 'IMAGE' && (
          <select
            value={contentId ?? ''} disabled={!canEditContent}
            onChange={e => setContentId(e.target.value || null)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
            <option value="">{t('noAsset')}</option>
            {imageAssets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {contentType === 'PLAYLIST' && (
          <select
            value={contentId ?? ''} disabled={!canEditContent}
            onChange={e => setContentId(e.target.value || null)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
            <option value="">{t('none')}</option>
            {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        {contentType === 'THEME' && (
          <select
            value={contentId ?? ''} disabled={!canEditContent}
            onChange={e => setContentId(e.target.value || null)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
            <option value="">{t('noTheme')}</option>
            {themes.map(th => <option key={th.id} value={th.id}>{th.name}</option>)}
          </select>
        )}
      </div>

      <div>
        <label className="text-xs text-gray-400 dark:text-gray-500 mb-1 block">{t('layoutZones')}</label>
        <select
          value={layoutId ?? ''} disabled={!canEditContent}
          onChange={e => setLayoutId(e.target.value || null)}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
          <option value="">{t('fullscreenNoLayout')}</option>
          {layouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      <div>
        <label className="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 mb-1 cursor-pointer">
          <input type="checkbox" checked={timezoneEnabled} disabled={!canEditContent}
            onChange={e => setTimezoneEnabled(e.target.checked)}
            className="w-3.5 h-3.5 accent-indigo-500" />
          <Clock className="w-3 h-3" /> {t('timezoneEnable')}
        </label>
        {timezoneEnabled && (
          <TimezoneSelect
            value={timezone} disabled={!canEditContent}
            onChange={tz => setTimezone(tz)}
          />
        )}
      </div>

      <div>
        <label className="text-xs text-gray-400 dark:text-gray-500 mb-1 flex items-center gap-1">
          <FolderKanban className="w-3 h-3" /> {t('groups.label')}
        </label>
        <select
          value={localGroupId ?? ''} disabled={!canEditContent}
          onChange={e => setLocalGroupId(e.target.value || null)}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
          <option value="">{t('groups.noGroup')}</option>
          {groups.map((g: ScreenGroup) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {/* Prayer settings */}
      <button
        onClick={() => setExpandedPrayer(expandedPrayer === screen.id ? null : screen.id)}
        className="flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 font-medium">
        <Moon className="w-3.5 h-3.5" />
        {expandedPrayer === screen.id ? t('hideFaith') : t('configureFaith')}
        {screen.latitude && screen.longitude && (
          <span className="ml-auto text-amber-500 opacity-70">{t('set')}</span>
        )}
      </button>
      {expandedPrayer === screen.id && <PrayerPanel screen={screen} />}

      {isDirty && (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          {t('unsavedChanges')}
        </div>
      )}

      {/* Action buttons */}
      {canEditContent && (
        <div className="flex gap-2">
          <button
            onClick={() => { void handlePublish(); }}
            disabled={isPublishing}
            title={t('publishTitle')}
            className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 ${
              isDirty
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950'
            }`}>
            <Send className="w-3 h-3" /> {isPublishing ? t('publishing') : t('publish')}
          </button>
          <button
            onClick={() => onToggleEmergency({ id: screen.id, active: !screen.emergencyActive })}
            disabled={emergencyPending}
            title={screen.emergencyActive ? t('deactivateEmergency') : t('activateEmergency')}
            className={`flex items-center justify-center gap-1 border py-1.5 px-3 rounded-lg text-xs disabled:opacity-50 ${
              screen.emergencyActive
                ? 'border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 hover:bg-red-100 dark:hover:bg-red-950'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}>
            <AlertTriangle className="w-3 h-3" />
          </button>
          <button
            onClick={() => onReload(screen.id)}
            disabled={reloadPending}
            title={t('reloadTitle')}
            className="flex items-center justify-center gap-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 py-1.5 px-3 rounded-lg text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50">
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex justify-between items-center pt-1 border-t border-gray-100 dark:border-gray-800">
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {screen.lastSeenAt ? t('lastSeen', { when: new Date(screen.lastSeenAt).toLocaleString() }) : t('neverSeen')}
        </span>
        {canEditContent && (
          <button onClick={() => { if (confirmDelete(t('deleteConfirm'))) onRemove(screen); }}
            className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-500 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
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
  const logAction = useAuditLog();
  const t = useTranslations('screens');
  const tc = useTranslations('common');
  const ta = useTranslations('auditLog');
  const { data: screens = [], isLoading } = useQuery({ queryKey: ['screens'], queryFn: screensApi.list });
  const { data: currentPlan = 'FREE' } = useQuery({ queryKey: ['billingPlan'], queryFn: billingApi.getCurrentPlan });
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });
  const { data: layouts = [] } = useQuery({ queryKey: ['layouts'], queryFn: layoutsApi.list });
  const { data: themes = [] } = useQuery({ queryKey: ['themes'], queryFn: themesApi.list });
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  const { data: groups = [] } = useQuery({ queryKey: ['screenGroups'], queryFn: screenGroupsApi.list });
  const { data: groupAssignments = {} } = useQuery({ queryKey: ['screenGroupAssignments'], queryFn: screenGroupsApi.getAssignments });
  const liveStatuses = useScreenSocket();

  const [showPair, setShowPair] = useState(false);
  const [pairCode, setPairCode] = useState('');
  const [pairError, setPairError] = useState('');
  const [expandedPrayer, setExpandedPrayer] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState('');
  const [publishedMessage, setPublishedMessage] = useState('');

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

  const contentMut = useMutation({
    mutationFn: ({ id, contentType, assetId, playlistId, themeId }: { id: string; contentType: ScreenContentType | null; assetId?: string | null; playlistId?: string | null; themeId?: string | null }) =>
      screensApi.setContent(id, { contentType, assetId, playlistId, themeId }),
    onSuccess: (updated, { contentType, assetId, playlistId, themeId }) => {
      const detail =
        contentType === 'VIDEO' || contentType === 'IMAGE' ? assets.find(a => a.id === assetId)?.name
        : contentType === 'PLAYLIST' ? playlists.find(p => p.id === playlistId)?.name
        : contentType === 'THEME' ? themes.find(th => th.id === themeId)?.name
        : undefined;
      logAction({
        resourceType: 'SCREEN', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '', detail,
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

  const visibleScreens = activeGroupId ? screens.filter(s => groupAssignments[s.id] === activeGroupId) : screens;
  const screenLimit = planLimit(currentPlan);
  const atScreenLimit = screenLimit !== null && screens.length >= screenLimit;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
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
        {activeGroupId && visibleScreens.length > 0 && canEditContent && (
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

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && visibleScreens.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Monitor className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visibleScreens.map((screen: Screen) => (
          <ScreenCard
            key={screen.id}
            screen={screen}
            live={statusFor(screen)}
            playlists={playlists}
            layouts={layouts}
            themes={themes}
            assets={assets}
            groups={groups}
            groupId={groupAssignments[screen.id] ?? null}
            canEditContent={canEditContent}
            renamingId={renamingId}
            renameValue={renameValue}
            setRenameValue={setRenameValue}
            startRename={startRename}
            commitRename={commitRename}
            setRenamingId={setRenamingId}
            renamePending={renameMut.isPending}
            expandedPrayer={expandedPrayer}
            setExpandedPrayer={setExpandedPrayer}
            onSetContent={v => contentMut.mutateAsync(v)}
            onSetLayout={v => layoutMut.mutateAsync(v)}
            onSetTimezone={v => timezoneMut.mutateAsync(v)}
            onAssignGroup={v => assignGroupMut.mutateAsync(v)}
            onPublish={id => publishMut.mutateAsync(id)}
            onReload={id => reloadMut.mutate(id)}
            reloadPending={reloadMut.isPending}
            onToggleEmergency={v => emergencyMut.mutate(v)}
            emergencyPending={emergencyMut.isPending}
            onRemove={s => removeMut.mutate(s)}
            confirmDelete={confirmDelete}
          />
        ))}
      </div>
    </div>
  );
}
