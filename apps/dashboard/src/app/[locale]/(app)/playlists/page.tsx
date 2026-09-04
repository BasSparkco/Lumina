'use client';
import { useMemo, useState } from 'react';
import Image from 'next/image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { List, Plus, Trash2, ChevronRight, ChevronDown, Copy, ClipboardCheck, Check, X, ImageIcon, Film, Music, Type, FileText, GripVertical, RefreshCw, Send, Shuffle, Sparkles, Crop, Search, Palette, LayoutGrid, LayoutTemplate, Smartphone, Volume2, VolumeX, Settings, Eye } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { playlistsApi, assetsApi, themesApi, layoutsApi, designsApi, PLAYER_URL, TRANSITION_STYLE_OPTIONS, TRANSITION_LABEL_KEYS, type PlaylistSummary, type Playlist, type PlaylistItem, type PlaylistItemKind, type Asset, type Theme, type Layout, type DesignAsset, type TransitionStyle, type PlaybackOrder } from '@/lib/api';
import { ASSET_SORT_OPTIONS, ASSET_TYPE_LABELS, distinctAssetTypes, sortAssets, formatRelativeTime, type AssetSortKey } from '@/lib/assetSort';
import { approvalsApi, APPROVAL_STATUS_STYLES, statusOf, type ApprovalRecord, type ApprovalSettings } from '@/lib/mocks/approvals';
import { PreviewFeatureNotice } from '@/components/PreviewFeatureNotice';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/context/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useDefaultItemDuration } from '@/hooks/useDefaultItemDuration';
import { useAuditLog } from '@/hooks/useAuditLog';
import { Toggle } from '@/components/Toggle';
import { ImageLightbox } from '@/components/ImageLightbox';
import { CropEditor, type MediaCrop } from '@/components/CropEditor';
import { PlaylistSettingsModal } from '@/components/PlaylistSettingsModal';

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

function formatDuration(totalSecs: number) {
  if (totalSecs < 60) return `${totalSecs}s`;
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  IMAGE: <ImageIcon className="w-3.5 h-3.5 text-blue-500" />,
  VIDEO: <Film className="w-3.5 h-3.5 text-purple-500" />,
  AUDIO: <Music className="w-3.5 h-3.5 text-green-500" />,
  TEXT: <Type className="w-3.5 h-3.5 text-amber-500" />,
  DOCUMENT: <FileText className="w-3.5 h-3.5 text-red-500" />,
  APP: <Smartphone className="w-3.5 h-3.5 text-teal-500" />,
};

type Translate = ReturnType<typeof useTranslations>;

/** One draggable row in a playlist's item list. A separate component (not inlined in the
 * parent's .map()) because useSortable is a hook — calling it once per item inside the parent's
 * own render body would violate the rules of hooks the moment the list length changes. */
function PlaylistItemRow({
  item, index, canEditContent, t, tCrop, onView, onCrop, onDurationChange, onTogglePlayFullVideo, onToggleMuted, onTransitionChange, onRemove,
}: {
  item: PlaylistItem;
  index: number;
  canEditContent: boolean;
  t: Translate;
  tCrop: Translate;
  onView: () => void;
  onCrop: () => void;
  onDurationChange: (dur: number) => void;
  onTogglePlayFullVideo: () => void;
  onToggleMuted: () => void;
  onTransitionChange: (transitionStyle: TransitionStyle | null) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl flex items-center gap-3 px-3 py-2.5 ${isDragging ? 'z-10 opacity-70 shadow-lg' : ''}`}
    >
      {canEditContent && (
        <button type="button" {...attributes} {...listeners}
          className="cursor-grab touch-none p-0.5 text-gray-300 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 active:cursor-grabbing">
          <GripVertical className="w-3.5 h-3.5" />
        </button>
      )}

      <span className="text-xs text-gray-300 dark:text-gray-500 w-4 text-center">{index + 1}</span>

      {item.kind === 'ASSET' && item.asset ? (
        item.asset.thumbnailUrl ? (
          <button onClick={onView} title={t('clickToView')}
            className="w-10 h-10 rounded overflow-hidden shrink-0 hover:ring-2 hover:ring-indigo-400 transition-all">
            <Image src={item.asset.thumbnailUrl} width={40} height={40} className="w-full h-full object-cover" alt="" />
          </button>
        ) : (
          <div className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">{TYPE_ICON[item.asset.type]}</div>
        )
      ) : (
        <div className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
          {item.kind === 'THEME' ? <Palette className="w-3.5 h-3.5 text-indigo-500" />
            : item.kind === 'LAYOUT' ? <LayoutGrid className="w-3.5 h-3.5 text-indigo-500" />
            : <LayoutTemplate className="w-3.5 h-3.5 text-indigo-500" />}
        </div>
      )}

      <div className="flex-1 min-w-0">
        {item.kind === 'ASSET' && item.asset ? (
          <>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{item.asset.name}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">{TYPE_ICON[item.asset.type]} {item.asset.type}</p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {item.kind === 'THEME' ? item.theme?.name : item.kind === 'LAYOUT' ? item.layout?.name : item.design?.name}
            </p>
            <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
              {item.kind === 'THEME' ? <Palette className="w-3.5 h-3.5" />
                : item.kind === 'LAYOUT' ? <LayoutGrid className="w-3.5 h-3.5" />
                : <LayoutTemplate className="w-3.5 h-3.5" />}
              {item.kind === 'THEME' ? t('itemKind.theme') : item.kind === 'LAYOUT' ? t('itemKind.layout') : t('itemKind.design')}
            </p>
          </>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {item.kind === 'ASSET' && item.asset?.type === 'VIDEO' && (
          <input type="checkbox" checked={item.playFullVideo} disabled={!canEditContent}
            onChange={onTogglePlayFullVideo} title={t('playFullVideo')}
            className="w-3.5 h-3.5 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50" />
        )}
        <input type="number" min={1} max={3600}
          disabled={!canEditContent || (item.kind === 'ASSET' && item.asset?.type === 'VIDEO' && item.playFullVideo)}
          value={item.kind === 'ASSET' && item.asset?.type === 'VIDEO' && item.playFullVideo
            ? (item.asset.durationSecs ?? item.durationSecs)
            : item.durationSecs}
          title={item.kind === 'ASSET' && item.asset?.type === 'VIDEO' && item.playFullVideo ? t('videoDuration') : undefined}
          onChange={e => onDurationChange(Number(e.target.value))}
          className="w-14 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50" />
        <span className="text-xs text-gray-400 dark:text-gray-500">{t('seconds')}</span>
      </div>

      {canEditContent && item.kind === 'ASSET' && item.asset && (item.asset.type === 'VIDEO' || item.asset.type === 'APP') && (
        <button onClick={onToggleMuted} title={item.muted ? t('unmute') : t('mute')}
          className="p-1 text-gray-300 dark:text-gray-500 hover:text-indigo-500 transition-colors">
          {item.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
      )}

      {canEditContent && item.kind === 'ASSET' && item.asset && (item.asset.type === 'IMAGE' || item.asset.type === 'VIDEO') && (
        <button onClick={onCrop} title={tCrop('editCrop')}
          className="p-1 text-gray-300 dark:text-gray-500 hover:text-indigo-500 transition-colors">
          <Crop className="w-3.5 h-3.5" />
        </button>
      )}

      {canEditContent && item.kind === 'ASSET' && item.asset && (
        <select
          value={item.transitionStyle ?? 'DEFAULT'}
          title={t('itemTransition.label')}
          onChange={e => onTransitionChange(e.target.value === 'DEFAULT' ? null : e.target.value as TransitionStyle)}
          className="border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="DEFAULT">{t('itemTransition.default')}</option>
          {TRANSITION_STYLE_OPTIONS.map(id => (
            <option key={id} value={id}>{t(`transition.${TRANSITION_LABEL_KEYS[id]}`)}</option>
          ))}
        </select>
      )}

      {canEditContent && (
        <button onClick={onRemove}
          className="p-1 text-gray-300 dark:text-gray-500 hover:text-red-500 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

/** The items/settings for one expanded playlist — everything that used to live on its own
 * /playlists/[id] page, now mounted inline only while that row is expanded (so collapsed rows
 * don't pay for items/approval queries they aren't showing). */
function PlaylistDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canEditContent, canApproveContent } = usePermissions();
  const { duration: defaultDuration } = useDefaultItemDuration();
  const logAction = useAuditLog();
  const t = useTranslations('playlistDetail');
  const tc = useTranslations('common');
  const ta = useTranslations('approvals');
  const tAssets = useTranslations('assets');
  const tCrop = useTranslations('cropEditor');
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [itemKindTab, setItemKindTab] = useState<PlaylistItemKind>('ASSET');
  const [assetSearch, setAssetSearch] = useState('');
  const [assetSort, setAssetSort] = useState<AssetSortKey>('recentlyAdded');
  // Empty = every type shown; combines (AND) with search/sort — e.g. "recently used" + IMAGE only.
  const [assetTypeFilter, setAssetTypeFilter] = useState<Set<Asset['type']>>(new Set());
  const [viewingItemId, setViewingItemId] = useState<string | null>(null);
  const [croppingItemId, setCroppingItemId] = useState<string | null>(null);
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const { data: playlist, isLoading } = useQuery({
    queryKey: ['playlist', id],
    queryFn: () => playlistsApi.get(id),
  });

  const { data: approval, isLoading: approvalLoading } = useQuery({
    queryKey: ['approval', id],
    queryFn: () => approvalsApi.get(id),
  });
  const { data: approvalSettings = { required: true } } = useQuery({
    queryKey: ['approvalSettings'], queryFn: approvalsApi.getSettings,
  });
  const status = statusOf(approval, approvalSettings);

  // Admins/owners are the approvers, so their own submissions have no one left to review
  // them — auto-approve instead of routing to the Pending Approvals queue. Same when the org
  // has turned approvals off entirely: nothing should require manual review while that's set.
  const submitMut = useMutation({
    mutationFn: () => (canApproveContent || !approvalSettings.required)
      ? approvalsApi.approve(id, user?.name ?? user?.email ?? '')
      : approvalsApi.submit(id, user?.name ?? user?.email ?? ''),
    onSuccess: (updated) => {
      logAction({
        resourceType: 'PLAYLIST', resourceName: playlist?.name ?? '', action: canApproveContent ? 'APPROVE' : 'SUBMIT',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<ApprovalRecord>(['approval', id], updated);
      qc.setQueryData<Record<string, ApprovalRecord>>(['approvals'], (old) => ({ ...old, [id]: updated }));
      void qc.invalidateQueries({ queryKey: ['approval', id] });
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });

  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list, enabled: showAssetPicker });
  const { data: themesList = [] } = useQuery({ queryKey: ['themes'], queryFn: themesApi.list, enabled: showAssetPicker });
  const { data: layoutsList = [] } = useQuery({ queryKey: ['layouts'], queryFn: layoutsApi.list, enabled: showAssetPicker });
  const { data: designsList = [] } = useQuery({ queryKey: ['designs'], queryFn: designsApi.list, enabled: showAssetPicker });
  const readyAssets = useMemo(() => assets.filter((a: Asset) => a.status === 'READY'), [assets]);
  const availableAssetTypes = useMemo(() => distinctAssetTypes(readyAssets), [readyAssets]);
  const pickableAssets = useMemo(() => {
    const q = assetSearch.trim().toLowerCase();
    let matched = q ? readyAssets.filter((a) => a.name.toLowerCase().includes(q)) : readyAssets;
    if (assetTypeFilter.size > 0) matched = matched.filter((a) => assetTypeFilter.has(a.type));
    return sortAssets(matched, assetSort);
  }, [readyAssets, assetSearch, assetSort, assetTypeFilter]);

  function toggleAssetType(t: Asset['type']) {
    setAssetTypeFilter((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t); else next.add(t);
      return next.size === availableAssetTypes.length ? new Set() : next;
    });
  }

  const addMut = useMutation({
    mutationFn: ({ kind, assetId, themeId, layoutId, designAssetId, dur }: { kind: PlaylistItemKind; assetId?: string; themeId?: string; layoutId?: string; designAssetId?: string; dur: number }) =>
      playlistsApi.addItem(id, { kind, assetId, themeId, layoutId, designAssetId }, dur),
    onSuccess: (created, { kind, assetId, themeId, layoutId, designAssetId }) => {
      const name = kind === 'ASSET' ? assets.find((a: Asset) => a.id === assetId)?.name
        : kind === 'THEME' ? themesList.find((th: Theme) => th.id === themeId)?.name
        : kind === 'LAYOUT' ? layoutsList.find((l: Layout) => l.id === layoutId)?.name
        : designsList.find((d: DesignAsset) => d.id === designAssetId)?.name;
      logAction({
        resourceType: 'PLAYLIST', resourceName: playlist?.name ?? '', action: 'ADD_ITEM',
        userName: user?.name ?? '', userEmail: user?.email ?? '', detail: name ?? '',
      });
      qc.setQueryData<Playlist>(['playlist', id], (old) => old && { ...old, items: [...old.items, created] });
      void qc.invalidateQueries({ queryKey: ['playlist', id] });
      void qc.invalidateQueries({ queryKey: ['playlists'] });
      // Fire-and-forget: drives the "recently used" sort in this and other asset pickers, but a
      // failed touch shouldn't block or error out an otherwise-successful add.
      if (kind === 'ASSET' && assetId) {
        void assetsApi.touch(assetId).then(() => qc.invalidateQueries({ queryKey: ['assets'] })).catch(() => {});
      }
      setShowAssetPicker(false);
      setAssetSearch('');
    },
  });

  const removeMut = useMutation({
    mutationFn: (item: PlaylistItem) => playlistsApi.removeItem(id, item.id),
    onSuccess: (_data, item) => {
      logAction({
        resourceType: 'PLAYLIST', resourceName: playlist?.name ?? '', action: 'REMOVE_ITEM',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: item.asset?.name ?? item.theme?.name ?? item.layout?.name ?? item.design?.name ?? '',
      });
      qc.setQueryData<Playlist>(['playlist', id], (old) => old && { ...old, items: old.items.filter(i => i.id !== item.id) });
      void qc.invalidateQueries({ queryKey: ['playlist', id] });
      void qc.invalidateQueries({ queryKey: ['playlists'] });
    },
  });

  const durMut = useMutation({
    mutationFn: ({ itemId, dur }: { itemId: string; dur: number }) => playlistsApi.updateItem(id, itemId, dur),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); },
  });

  const mutedMut = useMutation({
    mutationFn: (item: PlaylistItem) => playlistsApi.updateItem(id, item.id, item.durationSecs, !item.muted, item.playFullVideo),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); },
  });

  const playFullVideoMut = useMutation({
    mutationFn: (item: PlaylistItem) => playlistsApi.updateItem(id, item.id, item.durationSecs, item.muted, !item.playFullVideo),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); },
  });

  const cropMut = useMutation({
    mutationFn: ({ item, crop }: { item: PlaylistItem; crop: MediaCrop }) =>
      playlistsApi.updateItem(id, item.id, item.durationSecs, item.muted, item.playFullVideo, crop),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); },
  });

  const itemTransitionMut = useMutation({
    mutationFn: ({ item, transitionStyle }: { item: PlaylistItem; transitionStyle: TransitionStyle | null }) =>
      playlistsApi.updateItem(id, item.id, item.durationSecs, item.muted, item.playFullVideo, undefined, { transitionStyle }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); },
  });

  const reorderMut = useMutation({
    mutationFn: (ids: string[]) => playlistsApi.reorder(id, ids),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); },
  });

  const configMut = useMutation({
    mutationFn: (config: { transitionStyle?: TransitionStyle; transitionDurationMs?: number; playbackOrder?: PlaybackOrder }) =>
      playlistsApi.updateConfig(id, config),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlist', id] }); },
  });

  function handleDragEnd(e: DragEndEvent) {
    if (!playlist) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const orderedIds = playlist.items.map(i => i.id);
    const oldIndex = orderedIds.indexOf(String(active.id));
    const newIndex = orderedIds.indexOf(String(over.id));
    reorderMut.mutate(arrayMove(orderedIds, oldIndex, newIndex));
  }

  if (isLoading) return <div className="px-4 py-6 text-sm text-gray-400">{t('loading')}</div>;
  if (!playlist) return <div className="px-4 py-6 text-sm text-red-500">{t('notFound')}</div>;

  return (
    <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-4 space-y-4" onClick={e => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-4 bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
            <label className="text-xs text-gray-500 dark:text-gray-400">{t('transition.label')}</label>
            <select value={playlist.transitionStyle} disabled={!canEditContent}
              onChange={e => configMut.mutate({ transitionStyle: e.target.value as TransitionStyle })}
              className="border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
              {TRANSITION_STYLE_OPTIONS.map(id => (
                <option key={id} value={id}>{t(`transition.${TRANSITION_LABEL_KEYS[id]}`)}</option>
              ))}
            </select>
            {playlist.transitionStyle !== 'NONE' && (
              <>
                <input type="number" min={100} max={3000} step={100} value={playlist.transitionDurationMs}
                  disabled={!canEditContent}
                  onChange={e => configMut.mutate({ transitionDurationMs: Math.min(3000, Math.max(100, Number(e.target.value) || 100)) })}
                  className="w-20 border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg px-2 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50" />
                <span className="text-xs text-gray-400 dark:text-gray-500">{t('transition.ms')}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Shuffle className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
            <label className="text-xs text-gray-500 dark:text-gray-400">{t('playbackOrder.label')}</label>
            <select value={playlist.playbackOrder} disabled={!canEditContent}
              onChange={e => configMut.mutate({ playbackOrder: e.target.value as PlaybackOrder })}
              className="border border-gray-200 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50">
              <option value="SEQUENTIAL">{t('playbackOrder.sequential')}</option>
              <option value="SHUFFLE">{t('playbackOrder.shuffle')}</option>
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canEditContent && !approvalLoading && (status === 'DRAFT' || status === 'REJECTED') && (
            <button onClick={() => submitMut.mutate()} disabled={submitMut.isPending}
              className="flex items-center gap-2 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 px-3 py-2 rounded-lg text-xs font-medium hover:bg-indigo-50 dark:hover:bg-indigo-950 disabled:opacity-50">
              <Send className="w-3.5 h-3.5" />
              {submitMut.isPending ? t('submitting') : canApproveContent ? ta('approve') : t('submitForReview')}
            </button>
          )}
          {canEditContent && (
            <button onClick={() => setShowAssetPicker(true)}
              className="flex items-center gap-2 bg-indigo-600 text-white px-3 py-2 rounded-lg text-xs font-medium hover:bg-indigo-700">
              <Plus className="w-3.5 h-3.5" /> {t('addItem')}
            </button>
          )}
        </div>
      </div>

      {status === 'PENDING' && (
        <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          {t('pendingReviewBanner')}
        </div>
      )}
      {status === 'REJECTED' && approval?.comment && (
        <div className="text-xs text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
          <span className="font-medium">{t('rejectedReasonLabel')}: </span>{approval.comment}
        </div>
      )}

      {/* Asset picker modal */}
      {showAssetPicker && canEditContent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowAssetPicker(false); setAssetSearch(''); }}>
          <div className="bg-white dark:bg-gray-900 rounded-xl p-5 w-full max-w-lg shadow-xl max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-3">{t('pickAsset')}</h2>
            <div className="grid grid-cols-4 gap-1 mb-3">
              {([
                { kind: 'ASSET' as const, label: t('itemKind.asset'), Icon: ImageIcon },
                { kind: 'THEME' as const, label: t('itemKind.theme'), Icon: Palette },
                { kind: 'LAYOUT' as const, label: t('itemKind.layout'), Icon: LayoutGrid },
                { kind: 'DESIGN' as const, label: t('itemKind.design'), Icon: LayoutTemplate },
              ]).map(({ kind, label, Icon }) => (
                <button key={kind} type="button" onClick={() => setItemKindTab(kind)}
                  className={`flex items-center justify-center gap-1 text-xs py-1.5 rounded-lg border font-medium ${
                    itemKindTab === kind
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}>
                  <Icon className="w-3.5 h-3.5" /> {label}
                </button>
              ))}
            </div>

            {itemKindTab === 'ASSET' && (
              <>
                <div className="flex gap-1.5 mb-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input value={assetSearch} onChange={(e) => setAssetSearch(e.target.value)}
                      placeholder="Search assets…"
                      className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                  <select value={assetSort} onChange={(e) => setAssetSort(e.target.value as AssetSortKey)} title="Sort by"
                    className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500">
                    {ASSET_SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                </div>
                {availableAssetTypes.length > 1 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    <button type="button" onClick={() => setAssetTypeFilter(new Set())}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        assetTypeFilter.size === 0
                          ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                          : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'
                      }`}>
                      All
                    </button>
                    {availableAssetTypes.map((ty) => {
                      const active = assetTypeFilter.size === 0 || assetTypeFilter.has(ty);
                      return (
                        <button key={ty} type="button" onClick={() => toggleAssetType(ty)}
                          className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                            active
                              ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                              : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'
                          }`}>
                          {TYPE_ICON[ty]} {ASSET_TYPE_LABELS[ty]}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="overflow-y-auto flex-1 space-y-1">
                  {pickableAssets.map((a: Asset) => (
                    <button key={a.id} onClick={() => addMut.mutate({ kind: 'ASSET', assetId: a.id, dur: defaultDuration })}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-start transition-colors">
                      {a.thumbnailUrl
                        ? <Image src={a.thumbnailUrl} width={40} height={40} className="w-10 h-10 rounded object-cover shrink-0" alt="" />
                        : <div className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">{TYPE_ICON[a.type]}</div>
                      }
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{a.name}</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">{TYPE_ICON[a.type]} {a.type}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
                        {assetSort === 'mostUsed'
                          ? `${a.usageCount ?? 0}×`
                          : assetSort === 'recentlyUsed'
                            ? (a.lastUsedAt ? formatRelativeTime(a.lastUsedAt) : '—')
                            : assetSort === 'recentlyAdded'
                              ? formatRelativeTime(a.createdAt)
                              : ''}
                      </span>
                      {addMut.isPending && <RefreshCw className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 animate-spin" />}
                    </button>
                  ))}
                  {pickableAssets.length === 0 && (
                    <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">
                      {readyAssets.length === 0 ? t('noReadyAssets') : 'No assets found'}
                    </p>
                  )}
                </div>
              </>
            )}

            {itemKindTab === 'THEME' && (
              <div className="overflow-y-auto flex-1 space-y-1">
                {themesList.map((th: Theme) => (
                  <button key={th.id} onClick={() => addMut.mutate({ kind: 'THEME', themeId: th.id, dur: defaultDuration })}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-start transition-colors">
                    <div className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                      <Palette className="w-3.5 h-3.5 text-indigo-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{th.name}</p>
                    </div>
                    {addMut.isPending && <RefreshCw className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 animate-spin" />}
                  </button>
                ))}
                {themesList.length === 0 && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">{t('noThemes')}</p>
                )}
              </div>
            )}

            {itemKindTab === 'LAYOUT' && (
              <div className="overflow-y-auto flex-1 space-y-1">
                {layoutsList.map((l: Layout) => (
                  <button key={l.id} onClick={() => addMut.mutate({ kind: 'LAYOUT', layoutId: l.id, dur: defaultDuration })}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-start transition-colors">
                    <div className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                      <LayoutGrid className="w-3.5 h-3.5 text-indigo-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{l.name}</p>
                    </div>
                    {addMut.isPending && <RefreshCw className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 animate-spin" />}
                  </button>
                ))}
                {layoutsList.length === 0 && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">{t('noLayouts')}</p>
                )}
              </div>
            )}

            {itemKindTab === 'DESIGN' && (
              <div className="overflow-y-auto flex-1 space-y-1">
                {designsList.map((d: DesignAsset) => (
                  <button key={d.id} onClick={() => addMut.mutate({ kind: 'DESIGN', designAssetId: d.id, dur: defaultDuration })}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-start transition-colors">
                    <div className="w-10 h-10 rounded bg-gray-100 dark:bg-gray-800 flex items-center justify-center shrink-0">
                      <LayoutTemplate className="w-3.5 h-3.5 text-indigo-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{d.name}</p>
                    </div>
                    {addMut.isPending && <RefreshCw className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 animate-spin" />}
                  </button>
                ))}
                {designsList.length === 0 && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">{t('noDesigns')}</p>
                )}
              </div>
            )}

            <button onClick={() => { setShowAssetPicker(false); setAssetSearch(''); }}
              className="mt-3 w-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 py-2 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
          </div>
        </div>
      )}

      {playlist.items.length === 0 && (
        <div className="text-center py-10 text-gray-400">
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={playlist.items.map(i => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {playlist.items.map((item: PlaylistItem, i: number) => (
              <PlaylistItemRow
                key={item.id}
                item={item}
                index={i}
                canEditContent={canEditContent}
                t={t}
                tCrop={tCrop}
                onView={() => setViewingItemId(item.id)}
                onCrop={() => setCroppingItemId(item.id)}
                onDurationChange={dur => durMut.mutate({ itemId: item.id, dur })}
                onTogglePlayFullVideo={() => playFullVideoMut.mutate(item)}
                onToggleMuted={() => mutedMut.mutate(item)}
                onTransitionChange={transitionStyle => itemTransitionMut.mutate({ item, transitionStyle })}
                onRemove={() => removeMut.mutate(item)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {viewingItemId && (() => {
        const item = playlist.items.find(i => i.id === viewingItemId);
        const asset = item?.asset;
        const imageUrl = asset?.url ?? asset?.thumbnailUrl;
        if (!item || !asset || !imageUrl) return null;
        return (
          <ImageLightbox
            name={asset.name}
            imageUrl={imageUrl}
            sizeLabel={formatBytes(asset.sizeBytes)}
            typeLabel={asset.type}
            canEdit={canEditContent}
            onClose={() => setViewingItemId(null)}
            downloadUrl={asset.downloadUrl}
            downloadLabel={tAssets('download')}
            deleteLabel={t('removeFromPlaylist')}
            onDelete={() => {
              removeMut.mutate(item);
              setViewingItemId(null);
            }}
          />
        );
      })()}

      {croppingItemId && (() => {
        const item = playlist.items.find(i => i.id === croppingItemId);
        const asset = item?.asset;
        const mediaUrl = asset?.url;
        if (!item || !asset || !mediaUrl || (asset.type !== 'IMAGE' && asset.type !== 'VIDEO')) return null;
        return (
          <CropEditor
            mediaUrl={mediaUrl}
            mediaType={asset.type}
            name={asset.name}
            aspectRatio={16 / 9}
            initialCrop={{ cropZoom: item.cropZoom, cropOffsetX: item.cropOffsetX, cropOffsetY: item.cropOffsetY }}
            onClose={() => setCroppingItemId(null)}
            onSave={(crop) => {
              cropMut.mutate({ item, crop });
              setCroppingItemId(null);
            }}
          />
        );
      })()}
    </div>
  );
}

type SortableRowRenderProps = Pick<ReturnType<typeof useSortable>, 'attributes' | 'listeners' | 'setNodeRef' | 'isDragging'> & { style: React.CSSProperties };

/** Same reasoning as PlaylistItemRow above — useSortable is a hook, so each row's drag state
 * needs its own component. A render-prop here (instead of duplicating the whole row's markup
 * into a new component) lets the existing row JSX below stay put. */
function SortablePlaylistRow({ id, disabled, children }: {
  id: string;
  disabled: boolean;
  children: (props: SortableRowRenderProps) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return <>{children({ attributes, listeners, setNodeRef, isDragging, style: { transform: CSS.Transform.toString(transform), transition } })}</>;
}

export default function PlaylistsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canEditContent, canApproveContent } = usePermissions();
  const { confirmDelete } = useConfirmBeforeDelete();
  const logAction = useAuditLog();
  const t = useTranslations('playlists');
  const tc = useTranslations('common');
  const ta = useTranslations('auditLog');
  const tApp = useTranslations('approvals');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectComment, setRejectComment] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [settingsPlaylist, setSettingsPlaylist] = useState<{ id: string; name: string } | null>(null);
  const dragSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const { data: playlists = [], isLoading } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });
  const { data: approvals = {}, isLoading: approvalsLoading } = useQuery({ queryKey: ['approvals'], queryFn: approvalsApi.listAll });
  // Not gated behind canApproveContent — this is an org-wide setting that changes what every
  // role sees on the status badges below, not just what admins can act on.
  const { data: approvalSettings = { required: true }, isLoading: settingsLoading } = useQuery({
    queryKey: ['approvalSettings'], queryFn: approvalsApi.getSettings,
  });

  const settingsMut = useMutation({
    mutationFn: (settings: ApprovalSettings) => approvalsApi.updateSettings(settings),
    onSuccess: (settings) => qc.setQueryData(['approvalSettings'], settings),
  });

  const approveMut = useMutation({
    mutationFn: (playlist: PlaylistSummary) => approvalsApi.approve(playlist.id, user?.name ?? user?.email ?? ''),
    onSuccess: (updated, playlist) => {
      logAction({
        resourceType: 'PLAYLIST', resourceName: playlist.name, action: 'APPROVE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<Record<string, ApprovalRecord>>(['approvals'], (old) => ({ ...old, [playlist.id]: updated }));
      void qc.invalidateQueries({ queryKey: ['approvals'] });
    },
  });

  const rejectMut = useMutation({
    mutationFn: ({ playlist, comment }: { playlist: PlaylistSummary; comment: string }) =>
      approvalsApi.reject(playlist.id, user?.name ?? user?.email ?? '', comment),
    onSuccess: (updated, { playlist, comment }) => {
      logAction({
        resourceType: 'PLAYLIST', resourceName: playlist.name, action: 'REJECT',
        userName: user?.name ?? '', userEmail: user?.email ?? '', detail: comment,
      });
      qc.setQueryData<Record<string, ApprovalRecord>>(['approvals'], (old) => ({ ...old, [playlist.id]: updated }));
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      setRejectingId(null);
      setRejectComment('');
    },
  });

  const createMut = useMutation({
    mutationFn: () => playlistsApi.create(newName.trim()),
    onSuccess: (created) => {
      logAction({
        resourceType: 'PLAYLIST', resourceName: created.name, action: 'CREATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['playlists'] });
      setNewName('');
      setCreating(false);
      setExpandedId(created.id);
    },
  });

  const removeMut = useMutation({
    mutationFn: (playlist: PlaylistSummary) => playlistsApi.remove(playlist.id),
    onSuccess: (_data, playlist) => {
      setDeleteError('');
      logAction({
        resourceType: 'PLAYLIST', resourceName: playlist.name, action: 'DELETE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<PlaylistSummary[]>(['playlists'], (old) => old?.filter(p => p.id !== playlist.id));
      void qc.invalidateQueries({ queryKey: ['playlists'] });
      setExpandedId(prev => (prev === playlist.id ? null : prev));
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string; previousName: string }) => playlistsApi.rename(id, name),
    onSuccess: (renamed, { previousName }) => {
      logAction({
        resourceType: 'PLAYLIST', resourceName: previousName, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: ta('detailRenamedTo', { name: renamed.name }),
      });
      void qc.invalidateQueries({ queryKey: ['playlists'] });
      setRenamingId(null);
    },
  });

  const duplicateMut = useMutation({
    mutationFn: async (playlist: PlaylistSummary) => {
      const full = await playlistsApi.get(playlist.id);
      const created = await playlistsApi.create(`${playlist.name} (copy)`);
      for (const item of full.items) {
        await playlistsApi.addItem(
          created.id,
          { kind: item.kind, assetId: item.asset?.id, themeId: item.theme?.id, layoutId: item.layout?.id },
          item.durationSecs,
        );
      }
      return created;
    },
    onSuccess: (created, playlist) => {
      setDeleteError('');
      logAction({
        resourceType: 'PLAYLIST', resourceName: created.name, action: 'CREATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: ta('detailDuplicatedFrom', { name: playlist.name }),
      });
      void qc.invalidateQueries({ queryKey: ['playlists'] });
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  const reorderPlaylistsMut = useMutation({
    mutationFn: (ids: string[]) => playlistsApi.reorderPlaylists(ids),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['playlists'] }); },
  });

  // playsetting.md Phase 4 — mints a short-lived token and opens the player app's read-only
  // preview in a new tab. Not gated behind canEditContent: Preview mutates nothing, so it's
  // available to any role that can see this playlist at all (same as expanding its row).
  const previewMut = useMutation({
    mutationFn: (id: string) => playlistsApi.previewToken(id),
    onSuccess: ({ token }, id) => {
      window.open(`${PLAYER_URL}/preview?playlistId=${id}&token=${token}`, '_blank', 'noopener,noreferrer');
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  function handlePlaylistDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const orderedIds = playlists.map((pl: PlaylistSummary) => pl.id);
    const oldIndex = orderedIds.indexOf(String(active.id));
    const newIndex = orderedIds.indexOf(String(over.id));
    reorderPlaylistsMut.mutate(arrayMove(orderedIds, oldIndex, newIndex));
  }

  function startRename(playlist: PlaylistSummary) {
    if (!canEditContent) return;
    setRenamingId(playlist.id);
    setRenameValue(playlist.name);
  }

  function commitRename(playlist: PlaylistSummary) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === playlist.name) { setRenamingId(null); return; }
    renameMut.mutate({ id: playlist.id, name: trimmed, previousName: playlist.name });
  }

  function toggleExpanded(id: string) {
    setExpandedId(prev => (prev === id ? null : id));
  }

  const pending = canApproveContent
    ? playlists.filter((pl: PlaylistSummary) => statusOf(approvals[pl.id], approvalSettings) === 'PENDING')
    : [];

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        {canEditContent && (
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> {t('newPlaylist')}
          </button>
        )}
      </div>

      {/* Unlike the rest of this page, the approval workflow below (this card, and the pending-
          approvals queue further down) is still mock-backed — see PreviewFeatureNotice. Scoped
          to canApproveContent since that's the only audience who'd see the workflow at all. */}
      {canApproveContent && !settingsLoading && <PreviewFeatureNotice />}

      {canApproveContent && !settingsLoading && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{tApp('requireApproval')}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{tApp('requireApprovalDesc')}</p>
          </div>
          <Toggle checked={approvalSettings.required} onChange={v => settingsMut.mutate({ required: v })} />
        </div>
      )}

      {canApproveContent && !approvalsLoading && !settingsLoading && pending.length > 0 && (
        <div className="mb-6">
          <p className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            <ClipboardCheck className="w-4 h-4 text-amber-600" /> {tApp('pendingSectionTitle', { count: pending.length })}
          </p>
          <div className="space-y-2">
            {pending.map((pl: PlaylistSummary) => {
              const record = approvals[pl.id];
              const isRejecting = rejectingId === pl.id;
              return (
                <div key={pl.id} className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <button onClick={() => {
                        setExpandedId(pl.id);
                        document.getElementById(`playlist-row-${pl.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }}
                        className="text-sm font-medium text-gray-900 dark:text-gray-100 hover:text-indigo-600 dark:hover:text-indigo-400 text-start">
                        {pl.name}
                      </button>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        {t('itemCount', { count: pl._count.items })}
                        {record?.submittedByName && ` · ${tApp('submittedBy', { name: record.submittedByName })}`}
                      </p>
                    </div>
                    {!isRejecting && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => setRejectingId(pl.id)}
                          className="flex items-center gap-1 border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-red-50 dark:hover:bg-red-950/40">
                          <X className="w-3.5 h-3.5" /> {tApp('reject')}
                        </button>
                        <button onClick={() => approveMut.mutate(pl)} disabled={approveMut.isPending}
                          className="flex items-center gap-1 bg-emerald-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50">
                          <Check className="w-3.5 h-3.5" /> {tApp('approve')}
                        </button>
                      </div>
                    )}
                  </div>

                  {isRejecting && (
                    <div className="mt-3 pt-3 border-t border-amber-200 dark:border-amber-900">
                      <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">{tApp('rejectReasonLabel')}</label>
                      <textarea autoFocus value={rejectComment} onChange={e => setRejectComment(e.target.value)}
                        placeholder={tApp('rejectReasonPlaceholder')} rows={2}
                        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                      <div className="flex justify-end gap-2 mt-2">
                        <button onClick={() => { setRejectingId(null); setRejectComment(''); }}
                          className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
                          {tApp('cancel')}
                        </button>
                        <button onClick={() => rejectMut.mutate({ playlist: pl, comment: rejectComment.trim() })}
                          disabled={!rejectComment.trim() || rejectMut.isPending}
                          className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-50">
                          {rejectMut.isPending ? tApp('rejecting') : tApp('confirmReject')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {creating && canEditContent && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4 mb-4 flex gap-2">
          <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) createMut.mutate(); if (e.key === 'Escape') setCreating(false); }}
            placeholder={t('namePlaceholder')}
            className="flex-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <button onClick={() => createMut.mutate()} disabled={!newName.trim() || createMut.isPending}
            className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {createMut.isPending ? t('creating') : tc('create')}
          </button>
          <button onClick={() => setCreating(false)}
            className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-800">{tc('cancel')}</button>
        </div>
      )}

      {deleteError && <div className="mb-4 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-sm px-4 py-2 rounded-lg">{deleteError}</div>}

      {playlists.length > 0 && (
        <div className="relative mb-5 max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute start-2.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tc('search')}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg ps-8 pe-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500" />
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && playlists.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <List className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {!isLoading && playlists.length > 0 &&
        playlists.filter((pl: PlaylistSummary) => pl.name.toLowerCase().includes(search.toLowerCase())).length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{tc('noMatches')}</p>
        </div>
      )}

      {(() => {
        // Dragging reorders the *unfiltered* list by array index, which doesn't map cleanly onto
        // a filtered subset — so only enable it with the search box empty.
        const canDragPlaylists = canEditContent && !search.trim();
        const visiblePlaylists = playlists.filter((pl: PlaylistSummary) => pl.name.toLowerCase().includes(search.toLowerCase()));
        return (
          <DndContext sensors={dragSensors} collisionDetection={closestCenter} onDragEnd={handlePlaylistDragEnd}>
            <SortableContext items={visiblePlaylists.map((pl: PlaylistSummary) => pl.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {visiblePlaylists.map((pl: PlaylistSummary) => {
                  const isExpanded = expandedId === pl.id;
                  return (
                    <SortablePlaylistRow key={pl.id} id={pl.id} disabled={!canDragPlaylists}>
                      {({ attributes, listeners, setNodeRef, style, isDragging }) => (
                        <div ref={setNodeRef} style={style} id={`playlist-row-${pl.id}`}
                          className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden transition-colors hover:border-indigo-200 dark:hover:border-indigo-800 ${isDragging ? 'z-10 opacity-70 shadow-lg' : ''}`}>
                          <div
                            onClick={() => { if (renamingId !== pl.id) toggleExpanded(pl.id); }}
                            className="flex items-center gap-3 px-4 py-3 cursor-pointer group">
                            {canDragPlaylists && (
                              <button type="button" {...attributes} {...listeners} onClick={e => e.stopPropagation()} title={t('dragToReorder')}
                                className="cursor-grab touch-none p-0.5 text-gray-300 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 active:cursor-grabbing shrink-0">
                                <GripVertical className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <List className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                {renamingId === pl.id ? (
                                  <input
                                    autoFocus
                                    value={renameValue}
                                    onClick={e => e.stopPropagation()}
                                    onChange={e => setRenameValue(e.target.value)}
                                    onBlur={() => commitRename(pl)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') commitRename(pl);
                                      if (e.key === 'Escape') setRenamingId(null);
                                    }}
                                    disabled={renameMut.isPending}
                                    className="text-sm font-medium text-gray-900 dark:text-gray-100 dark:bg-gray-800 border border-indigo-300 dark:border-indigo-700 rounded px-1 -mx-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                  />
                                ) : (
                                  <p
                                    onClick={e => { if (canEditContent) { e.stopPropagation(); startRename(pl); } }}
                                    title={canEditContent ? tc('clickToRename') : undefined}
                                    className={`text-sm font-medium text-gray-900 dark:text-gray-100 ${canEditContent ? 'cursor-text hover:text-indigo-600 dark:hover:text-indigo-400' : ''}`}>
                                    {pl.name}
                                  </p>
                                )}
                                {!approvalsLoading && !settingsLoading && (
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${APPROVAL_STATUS_STYLES[statusOf(approvals[pl.id], approvalSettings)]}`}>
                                    {tc(`approvalStatus.${statusOf(approvals[pl.id], approvalSettings)}`)}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-400 dark:text-gray-500">
                                {t('itemCount', { count: pl._count.items })}
                                {pl._count.items > 0 && ` · ${formatDuration(pl.totalDurationSecs)} · ${formatBytes(pl.totalSizeBytes)}`}
                              </p>
                            </div>
                            {canEditContent && (
                              <button onClick={e => { e.stopPropagation(); duplicateMut.mutate(pl); }} disabled={duplicateMut.isPending}
                                title={t('duplicate')} className="p-1 text-gray-300 dark:text-gray-500 hover:text-indigo-600 transition-colors disabled:opacity-50">
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canEditContent && (
                              <button onClick={e => { e.stopPropagation(); if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(pl); }}
                                className="p-1 text-gray-300 dark:text-gray-500 hover:text-red-500 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button onClick={e => { e.stopPropagation(); previewMut.mutate(pl.id); }}
                              disabled={previewMut.isPending}
                              title={t('preview')} className="p-1 text-gray-300 dark:text-gray-500 hover:text-indigo-600 transition-colors disabled:opacity-50">
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            {canEditContent && (
                              <button onClick={e => { e.stopPropagation(); setSettingsPlaylist({ id: pl.id, name: pl.name }); }}
                                title={t('settings')} className="p-1 text-gray-300 dark:text-gray-500 hover:text-indigo-600 transition-colors">
                                <Settings className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {isExpanded
                              ? <ChevronDown className="w-4 h-4 text-indigo-500 shrink-0" />
                              : <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-500 group-hover:text-indigo-400 transition-colors shrink-0" />}
                          </div>

                          {isExpanded && <PlaylistDetail id={pl.id} />}
                        </div>
                      )}
                    </SortablePlaylistRow>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        );
      })()}

      {settingsPlaylist && (
        <PlaylistSettingsModal
          id={settingsPlaylist.id}
          name={settingsPlaylist.name}
          canEdit={canEditContent}
          onClose={() => setSettingsPlaylist(null)}
        />
      )}
    </div>
  );
}
