'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import {
  LayoutTemplate,
  Palette,
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
  Copy,
  Undo2,
  Redo2,
  Volume2,
  RotateCw,
  Layers,
  Lock,
  LockOpen,
  Images,
  MoonStar,
  CloudSun,
  DollarSign,
  Rss,
  Clock,
  Calendar,
  QrCode,
  Crop,
  Search,
  ImageDown,
  ChevronsDownUp,
  ChevronsUpDown,
  type LucideIcon,
} from 'lucide-react';
import { shapeClipStyle, type ThemeElementShape } from '@lumina/types';
import {
  assetsApi,
  layoutsApi,
  playlistsApi,
  type Layout,
  type ZoneInput,
  type ZoneType,
} from '@/lib/api';
import { EditorAddSidebar } from '@/components/EditorAddSidebar';
import { LayersPanel } from '@/components/LayersPanel';
import { nextLayerZIndex, bringToFront, sendToBack, sortByZDesc, reindexLayers } from '@/lib/layers';
import { LayoutCanvasPanel } from './LayoutCanvasPanel';
import { removeAssetBackground } from '@/lib/backgroundRemoval';
import { captureFabricCanvasAsAsset } from '@/lib/exportDesignAsAsset';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useFaithFeatures } from '@/hooks/useFaithFeatures';
import { useAuth } from '@/context/AuthContext';
import { useEditorDirty } from '@/context/EditorDirtyContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useEditorHistory } from '@/hooks/useEditorHistory';
import { AssetPicker } from '@/components/AssetPicker';
import { WidgetConfigFields } from '@/components/WidgetConfigFields';
import { CropEditor, type MediaCrop } from '@/components/CropEditor';
import { clampPct } from '@/lib/editorZoom';

const ZONE_SHAPES: ThemeElementShape[] = ['rectangle', 'rounded', 'circle', 'triangle', 'pentagon', 'hexagon', 'octagon', 'star'];

const ZONE_TYPE_VALUES: ZoneType[] = [
  'MEDIA',
  'PRAYER',
  'WEATHER',
  'CURRENCY',
  'TICKER',
  'TIME',
  'DATE',
  'QR',
];
const ZONE_TYPE_ICONS: Record<ZoneType, LucideIcon> = {
  MEDIA: Images,
  PRAYER: MoonStar,
  WEATHER: CloudSun,
  CURRENCY: DollarSign,
  TICKER: Rss,
  TIME: Clock,
  DATE: Calendar,
  QR: QrCode,
};

const PRESET_ZONE_KEYS = [
  'fullscreen',
  'mainTicker',
  'split5050',
  'mainSidebar',
  'mosque',
] as const;
type PresetKey = (typeof PRESET_ZONE_KEYS)[number];

const PRESET_ZONES: Record<PresetKey, ZoneInput[]> = {
  fullscreen: [{ name: 'Main', x: 0, y: 0, width: 100, height: 100, zIndex: 0, zoneType: 'MEDIA' }],
  mainTicker: [
    { name: 'Main', x: 0, y: 0, width: 100, height: 85, zIndex: 0, zoneType: 'MEDIA' },
    { name: 'Ticker', x: 0, y: 85, width: 100, height: 15, zIndex: 1, zoneType: 'TICKER' },
  ],
  split5050: [
    { name: 'Left', x: 0, y: 0, width: 50, height: 100, zIndex: 0, zoneType: 'MEDIA' },
    { name: 'Right', x: 50, y: 0, width: 50, height: 100, zIndex: 0, zoneType: 'MEDIA' },
  ],
  mainSidebar: [
    { name: 'Main', x: 0, y: 0, width: 70, height: 100, zIndex: 0, zoneType: 'MEDIA' },
    { name: 'Sidebar', x: 70, y: 0, width: 30, height: 100, zIndex: 1, zoneType: 'PRAYER' },
  ],
  mosque: [
    { name: 'Content', x: 0, y: 0, width: 65, height: 100, zIndex: 0, zoneType: 'MEDIA' },
    { name: 'Prayer Times', x: 65, y: 0, width: 35, height: 75, zIndex: 1, zoneType: 'PRAYER' },
    { name: 'Weather', x: 65, y: 75, width: 35, height: 25, zIndex: 1, zoneType: 'WEATHER' },
  ],
};

export const ZONE_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

const ZONE_TYPE_BADGE: Record<ZoneType, string> = {
  MEDIA: 'bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300',
  PRAYER: 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300',
  WEATHER: 'bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300',
  CURRENCY: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300',
  TICKER: 'bg-orange-100 dark:bg-orange-950 text-orange-700 dark:text-orange-300',
  TIME: 'bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300',
  DATE: 'bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300',
  QR: 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300',
};

// Client-only id used purely for stable React keys/history-diffing while editing — server zone
// ids aren't stable across saves (layouts.service.ts fully deletes and recreates every zone row
// on every save), so a fresh one is minted here rather than relying on `z.id`.
function withLocalId(zone: ZoneInput): ZoneInput {
  return zone._localId ? zone : { ...zone, _localId: crypto.randomUUID() };
}

function toZoneInputs(layout: Layout): ZoneInput[] {
  return layout.zones.map((z) =>
    withLocalId({
      name: z.name,
      x: z.x,
      y: z.y,
      width: z.width,
      height: z.height,
      zIndex: z.zIndex,
      rotation: z.rotation ?? 0,
      zoneType: z.zoneType ?? 'MEDIA',
      shape: z.shape ?? 'rectangle',
      editable: z.editable ?? true,
      widgetConfig: z.widgetConfig,
      playlistId: z.playlist?.id,
      assetId: z.asset?.id,
      audioPriority: z.audioPriority,
      audioVolume: z.audioVolume,
    }),
  );
}

export function LayoutsSection({ onSelectTab }: { onSelectTab: (tab: 'layouts' | 'themes') => void }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canEditContent } = usePermissions();
  const { confirmDelete } = useConfirmBeforeDelete();
  const { enabled: faithEnabled } = useFaithFeatures();
  const logAction = useAuditLog();
  const t = useTranslations('layouts');
  const tc = useTranslations('common');
  const tCrop = useTranslations('cropEditor');
  const ta = useTranslations('auditLog');
  const tNav = useTranslations('nav');
  const { data: layouts = [], isLoading } = useQuery({
    queryKey: ['layouts'],
    queryFn: layoutsApi.list,
  });
  const { data: playlists = [] } = useQuery({
    queryKey: ['playlists'],
    queryFn: playlistsApi.list,
  });
  // Same query key AssetPicker uses, so this just reads react-query's existing cache instead of
  // firing a second request — needed here so the canvas can render the actual selected asset's
  // thumbnail instead of always showing a flat placeholder box.
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });

  const [editing, setEditing] = useState<Layout | 'new' | null>(null);
  const [name, setName] = useState('');
  const [zones, setZones] = useState<ZoneInput[]>([]);
  const [deleteError, setDeleteError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useState('');

  interface EditorSnapshot {
    name: string;
    zones: ZoneInput[];
  }
  const { canUndo, canRedo, undo, redo, commit, captureForHistory, commitCaptured } =
    useEditorHistory<EditorSnapshot>(
      editing,
      () => ({ name, zones }),
      (s) => {
        setName(s.name);
        setZones(s.zones);
      },
    );

  // Lets the app shell warn before navigating away mid-edit — canUndo already tracks "at least
  // one change committed since this session opened" so it doubles as the dirty flag for free.
  const { setDirty } = useEditorDirty();
  useEffect(() => {
    setDirty(editing !== null && canUndo);
  }, [editing, canUndo, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  // A zone must be selected (single click) before it can be dragged/resized/rotated — unless
  // requireSelectToEdit is off, or the zone is locked (editable: false), which always wins.
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [layersPanelOpen, setLayersPanelOpen] = useState(false);
  // Populated by LayoutCanvasPanel's exportRef with a function that rasterizes the live fabric
  // canvas to a PNG data URL — a plain ref (not state) since it never needs to trigger a re-render.
  const getCanvasPngRef = useRef<(() => string) | null>(null);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [bgRemovingZoneKey, setBgRemovingZoneKey] = useState<string | null>(null);
  // Purely a view toggle to reduce clutter — hides the zone card grid without touching selection/data.
  const [zoneCardsCollapsed, setZoneCardsCollapsed] = useState(false);
  const [bgRemoveError, setBgRemoveError] = useState('');
  const [croppingZoneKey, setCroppingZoneKey] = useState<string | null>(null);
  // UI-only: which zones have the media-source toggle set to "Asset". Needed because a brand
  // new/never-saved zone has both assetId and playlistId undefined — without this, clicking
  // "Asset" cleared playlistId (already undefined, so nothing visibly changed) and the picker
  // below stayed on the Playlist select forever, since it switched purely on `z.assetId` being
  // truthy. The "Asset" button looked like it did nothing until a playlist had been picked once.
  const [assetModeZones, setAssetModeZones] = useState<Set<string>>(new Set());

  // Delete/Backspace removes the selected zone, mirroring most design tools — skipped while any
  // text field has focus, so it never fights normal text editing.
  useEffect(() => {
    if (!editing) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (!selectedZoneId) return;
      const i = zones.findIndex((z, idx) => (z._localId ?? String(idx)) === selectedZoneId);
      if (i < 0) return;
      e.preventDefault();
      removeZone(i);
      setSelectedZoneId(null);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editing, selectedZoneId, zones]);

  // Resets zone selection whenever a different layout (or 'new') is opened — adjusted during
  // render rather than in an effect, so there's no flash of the previous selection before the
  // reset lands. (Zoom/drag/hover/context-menu state resets the same way, inside
  // LayoutCanvasPanel — it stays local to that component.)
  const [prevEditing, setPrevEditing] = useState(editing);
  if (editing !== prevEditing) {
    setPrevEditing(editing);
    setSelectedZoneId(null);
  }

  // Not everyone needs prayer-time widgets — keep the "Mosque" preset and PRAYER zone type
  // out of the way until the org opts in via Settings.
  const visiblePresetKeys = faithEnabled
    ? PRESET_ZONE_KEYS
    : PRESET_ZONE_KEYS.filter((k) => k !== 'mosque');
  const visibleZoneTypes = faithEnabled
    ? ZONE_TYPE_VALUES
    : ZONE_TYPE_VALUES.filter((zt) => zt !== 'PRAYER');

  const createMut = useMutation({
    mutationFn: () => layoutsApi.create(name, zones),
    onSuccess: (created) => {
      logAction({
        resourceType: 'LAYOUT',
        resourceName: created.name,
        action: 'CREATE',
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['layouts'] });
      setEditing(null);
    },
  });

  const updateMut = useMutation({
    mutationFn: () => layoutsApi.update((editing as Layout).id, name, zones),
    onSuccess: (updated) => {
      logAction({
        resourceType: 'LAYOUT',
        resourceName: updated.name,
        action: 'UPDATE',
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['layouts'] });
      setEditing(null);
    },
  });

  // Rasterizes the canvas to a PNG and uploads it as a plain image Asset, alongside (not
  // instead of) the layout itself — the layout keeps saving as its own structured template via
  // saveLayout above; this just gives an easier way to reuse the design as a flat picture.
  const saveAsAssetMut = useMutation({
    mutationFn: async () => {
      // getPng() clears the canvas's own selection/hover chrome internally before rasterizing,
      // so no React-side deselect is needed here.
      const getPng = getCanvasPngRef.current;
      if (!getPng) throw new Error('Canvas not ready');
      return captureFabricCanvasAsAsset(getPng(), name);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['assets'] });
      toast.success(t('saveAsAssetSuccess'));
    },
  });

  const removeMut = useMutation({
    mutationFn: (layout: Layout) => layoutsApi.remove(layout.id),
    onSuccess: (_data, layout) => {
      setDeleteError('');
      logAction({
        resourceType: 'LAYOUT',
        resourceName: layout.name,
        action: 'DELETE',
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
      });
      qc.setQueryData<Layout[]>(['layouts'], (old) => old?.filter((l) => l.id !== layout.id));
      void qc.invalidateQueries({ queryKey: ['layouts'] });
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  const renameMut = useMutation({
    mutationFn: ({ layout, name: newName }: { layout: Layout; name: string }) =>
      layoutsApi.update(layout.id, newName, toZoneInputs(layout)),
    onSuccess: (updated, { layout }) => {
      logAction({
        resourceType: 'LAYOUT',
        resourceName: layout.name,
        action: 'UPDATE',
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
        detail: ta('detailRenamedTo', { name: updated.name }),
      });
      void qc.invalidateQueries({ queryKey: ['layouts'] });
      setRenamingId(null);
    },
  });

  const duplicateMut = useMutation({
    mutationFn: (layout: Layout) =>
      layoutsApi.create(`${layout.name} (copy)`, toZoneInputs(layout)),
    onSuccess: (created, layout) => {
      logAction({
        resourceType: 'LAYOUT',
        resourceName: created.name,
        action: 'CREATE',
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
        detail: ta('detailDuplicatedFrom', { name: layout.name }),
      });
      void qc.invalidateQueries({ queryKey: ['layouts'] });
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  function startRename(layout: Layout) {
    if (!canEditContent) return;
    setRenamingId(layout.id);
    setRenameValue(layout.name);
  }

  function commitRename(layout: Layout) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === layout.name) {
      setRenamingId(null);
      return;
    }
    renameMut.mutate({ layout, name: trimmed });
  }

  function openNew() {
    setEditing('new');
    setName('New Layout');
    setZones(PRESET_ZONES.fullscreen.map(withLocalId));
  }

  function openEdit(layout: Layout) {
    setEditing(layout);
    setName(layout.name);
    setZones(toZoneInputs(layout));
  }

  function updateZone(i: number, patch: Partial<ZoneInput>) {
    setZones((prev) => prev.map((z, idx) => (idx === i ? { ...z, ...patch } : z)));
  }

  // Shared by the generic "Add zone" button in the card list and the type-specific entries in
  // the right-side add sidebar — selects the new zone immediately so its card is ready to edit.
  function addZoneOfType(zoneType: ZoneType) {
    const zone = withLocalId({
      name: `Zone ${zones.length + 1}`,
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      zoneType,
      zIndex: nextLayerZIndex(zones.map((z) => ({ zIndex: z.zIndex ?? 0 }))),
    });
    commit(() => setZones((prev) => [...prev, zone]));
    setSelectedZoneId(zone._localId ?? null);
  }
  // Nudged slightly so the copy is visibly distinct from the original instead of sitting exactly
  // on top of it.
  function duplicateZone(i: number) {
    const z = zones[i];
    if (!z) return;
    const copy = withLocalId({
      ...z,
      _localId: undefined,
      x: clampPct(z.x + 3),
      y: clampPct(z.y + 3),
      zIndex: nextLayerZIndex(zones.map((z) => ({ zIndex: z.zIndex ?? 0 }))),
    });
    commit(() => setZones((prev) => [...prev, copy]));
    setSelectedZoneId(copy._localId ?? null);
  }
  function removeZone(i: number) {
    commit(() => setZones((prev) => prev.filter((_, idx) => idx !== i)));
  }
  function bringZoneToFront(i: number) {
    const z = zones[i];
    if (!z) return;
    const zIndex = bringToFront(zones.map((z) => ({ zIndex: z.zIndex ?? 0 })), z.zIndex ?? 0);
    commit(() => updateZone(i, { zIndex }));
  }
  function sendZoneToBack(i: number) {
    const z = zones[i];
    if (!z) return;
    const zIndex = sendToBack(zones.map((z) => ({ zIndex: z.zIndex ?? 0 })), z.zIndex ?? 0);
    commit(() => updateZone(i, { zIndex }));
  }
  // Layers panel drag-reorder — `orderedKeys` is front-to-back (topmost row = front-most).
  function reorderZoneLayers(orderedKeys: string[]) {
    commit(() =>
      setZones((prev) => {
        const byKey = new Map(prev.map((z, i) => [z._localId ?? String(i), z]));
        const ordered = orderedKeys.map((k) => byKey.get(k)).filter((z): z is ZoneInput => !!z);
        const reindexed = reindexLayers(ordered, (z, zIndex) => ({ ...z, zIndex }));
        const reindexedByKey = new Map(reindexed.map((z, i) => [z._localId ?? String(i), z]));
        return prev.map((z, i) => reindexedByKey.get(z._localId ?? String(i)) ?? z);
      }),
    );
  }
  // Right-click "Edit" — unlike the theme editor, a zone's card always shows its full field set
  // regardless of selection, so this just needs to scroll it into view (it may be below the fold).
  function editZoneFromContextMenu(key: string) {
    setSelectedZoneId(key);
    requestAnimationFrame(() => {
      document.getElementById(`layout-zone-card-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  // Right-click shortcut for the same client-side background removal ImagePicker's own button
  // offers — acts on whatever image asset the zone already has, without a trip through its
  // settings. Only offered for zones pointed at an IMAGE asset (video/playlist zones don't apply).
  async function hideZoneBackground(i: number, key: string) {
    if (bgRemovingZoneKey) return;
    const z = zones[i];
    if (!z?.assetId) return;
    const asset = assets.find((a) => a.id === z.assetId);
    if (!asset || asset.type !== 'IMAGE') return;
    setBgRemoveError('');
    setBgRemovingZoneKey(key);
    try {
      const newAsset = await removeAssetBackground(asset);
      void qc.invalidateQueries({ queryKey: ['assets'] });
      commit(() => updateZone(i, { assetId: newAsset.id }));
    } catch (e) {
      setBgRemoveError(e instanceof Error ? e.message : 'Background removal failed');
    } finally {
      setBgRemovingZoneKey(null);
    }
  }
  const saving = createMut.isPending || updateMut.isPending;

  return (
    // Wider cap while editing, but only at the breakpoint where EditorAddSidebar's persistent
    // rail actually shows (see its own comment) — that rail reserves space via `pe-72` on the
    // editor panel below, and widening the page cap to match keeps the editing area at least as
    // big as its normal (no-sidebar) size instead of just eating into the original 1400px.
    <div className={`mx-auto max-w-[1400px] p-8 ${editing ? 'min-[1440px]:max-w-[2400px]' : ''}`}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
        </div>
        {canEditContent && (
          <button
            onClick={openNew}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> {t('newLayout')}
          </button>
        )}
      </div>

      {!editing && (
        <div className="flex gap-1 mb-6 border-b border-gray-200 dark:border-gray-800">
          <button onClick={() => onSelectTab('layouts')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors border-indigo-600 text-indigo-600 dark:text-indigo-400">
            <LayoutTemplate className="w-4 h-4" /> {tNav('layouts')}
          </button>
          <button onClick={() => onSelectTab('themes')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <Palette className="w-4 h-4" /> {tNav('themes')}
          </button>
        </div>
      )}

      {/* Editor panel */}
      {editing && canEditContent && (
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm min-[1440px]:pe-72 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-5 flex items-center justify-between">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={captureForHistory}
              onBlur={commitCaptured}
              className="w-64 border-b border-transparent bg-transparent text-lg font-semibold text-gray-900 hover:border-gray-300 focus:border-indigo-500 focus:outline-none dark:text-gray-100 dark:hover:border-gray-600"
              placeholder={t('layoutName')}
            />
            <div className="flex flex-wrap gap-2">
              {visiblePresetKeys.map((preset) => (
                <button
                  key={preset}
                  onClick={() => commit(() => setZones(PRESET_ZONES[preset].map(withLocalId)))}
                  className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
                >
                  {t(`presets.${preset}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Save/cancel sit above the canvas (not just below the zone cards) so they're
              reachable without scrolling past the whole editor on tall layouts. */}
          <div className="mb-5 flex items-center justify-end gap-2 border-b border-gray-100 pb-4 dark:border-gray-800">
            <button
              onClick={undo}
              disabled={!canUndo}
              title={`${t('undo')} (Ctrl+Z)`}
              className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <Undo2 className="h-4 w-4" />
            </button>
            <button
              onClick={redo}
              disabled={!canRedo}
              title={`${t('redo')} (Ctrl+Shift+Z)`}
              className="me-auto rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50 disabled:opacity-30 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <Redo2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setLayersPanelOpen((v) => !v)}
              title={tc('layers')}
              aria-pressed={layersPanelOpen}
              className={`rounded-lg border p-2 hover:bg-gray-50 dark:hover:bg-gray-800 ${
                layersPanelOpen
                  ? 'border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400'
                  : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'
              }`}
            >
              <Layers className="h-4 w-4" />
            </button>
            <button
              onClick={() => saveAsAssetMut.mutate()}
              disabled={zones.length === 0 || saveAsAssetMut.isPending}
              title={t('saveAsAssetHint')}
              className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ImageDown className="h-4 w-4" />{' '}
              {saveAsAssetMut.isPending ? t('savingAsset') : t('saveAsAsset')}
            </button>
            <button
              onClick={() => setEditing(null)}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {tc('cancel')}
            </button>
            <button
              onClick={() => (editing === 'new' ? createMut.mutate() : updateMut.mutate())}
              disabled={!name.trim() || zones.length === 0 || saving}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> {saving ? t('saving') : t('saveLayout')}
            </button>
          </div>

          {/* Visual preview, full-width, with zone settings stacked below. The floating
              EditorAddSidebar (rendered after this panel, outside its layout flow entirely) is
              the primary way to add new zones, so the zone cards can focus on editing what
              already exists — the generic "Add zone" button in the card list still works too. */}
          <div className="flex flex-col gap-6">
            <LayoutCanvasPanel
              editing={editing}
              zones={zones}
              assets={assets}
              selectedZoneId={selectedZoneId}
              onSelectZone={setSelectedZoneId}
              updateZone={updateZone}
              commit={commit}
              duplicateZone={duplicateZone}
              removeZone={removeZone}
              bringZoneToFront={bringZoneToFront}
              sendZoneToBack={sendZoneToBack}
              editZoneFromContextMenu={editZoneFromContextMenu}
              hideZoneBackground={(i, key) => void hideZoneBackground(i, key)}
              bgRemovingZoneKey={bgRemovingZoneKey}
              onOpenAddPanel={() => setAddPanelOpen(true)}
              exportRef={(getPng) => { getCanvasPngRef.current = getPng; }}
            />

            {/* Zone cards — one per zone, mirroring the screens page's per-screen card layout
                instead of the old flat grid-of-input-rows (confusing to line up at a glance). */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs text-gray-400 dark:text-gray-500">{t('zones')}</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setZoneCardsCollapsed((v) => !v)}
                    title={zoneCardsCollapsed ? t('expandAll') : t('collapseAll')}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    {zoneCardsCollapsed ? (
                      <ChevronsUpDown className="h-3 w-3" />
                    ) : (
                      <ChevronsDownUp className="h-3 w-3" />
                    )}
                    {zoneCardsCollapsed ? t('expandAll') : t('collapseAll')}
                  </button>
                  <button
                    onClick={() => addZoneOfType('MEDIA')}
                    className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
                  >
                    <Plus className="h-3 w-3" /> {t('addZone')}
                  </button>
                </div>
              </div>
              <div
                className={`grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3 ${zoneCardsCollapsed ? 'hidden' : ''}`}
              >
                {zones.map((z, i) => {
                  const key = z._localId ?? String(i);
                  const isSelected = selectedZoneId === key;
                  return (
                    <div
                      key={key}
                      id={`layout-zone-card-${key}`}
                      onClick={() => setSelectedZoneId(key)}
                      className={`flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-white p-3 transition-colors dark:bg-gray-900 ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500 dark:bg-indigo-950/20'
                          : 'border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }}
                        />
                        <input
                          value={z.name}
                          onChange={(e) => updateZone(i, { name: e.target.value })}
                          onFocus={captureForHistory}
                          onBlur={commitCaptured}
                          className="min-w-0 flex-1 rounded border border-transparent px-1.5 py-1 text-sm font-medium hover:border-gray-200 focus:border-indigo-500 focus:outline-none dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-700"
                          placeholder={tc('name')}
                        />
                        <label
                          className="flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500"
                          title={t('editableHint')}
                        >
                          <input
                            type="checkbox"
                            checked={z.editable ?? true}
                            onChange={(e) =>
                              commit(() => updateZone(i, { editable: e.target.checked }))
                            }
                          />
                          {(z.editable ?? true) ? (
                            <LockOpen className="h-3 w-3" />
                          ) : (
                            <Lock className="h-3 w-3" />
                          )}
                        </label>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            commit(() => setZones((prev) => prev.filter((_, idx) => idx !== i)));
                          }}
                          className="shrink-0 text-gray-400 hover:text-red-500 dark:text-gray-500"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <label className="mb-1 block text-xs text-gray-400 dark:text-gray-500">
                            {tc('type')}
                          </label>
                          <select
                            value={z.zoneType ?? 'MEDIA'}
                            onChange={(e) =>
                              commit(() =>
                                updateZone(i, {
                                  zoneType: e.target.value as ZoneType,
                                  widgetConfig: {},
                                }),
                              )
                            }
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          >
                            {/* Keep an existing PRAYER zone's own option visible even with the feature
                              off, so its <select> doesn't silently show a value with no matching
                              option — but don't offer PRAYER for zones that aren't already that type. */}
                            {(visibleZoneTypes.includes(z.zoneType ?? 'MEDIA')
                              ? visibleZoneTypes
                              : [...visibleZoneTypes, z.zoneType ?? 'MEDIA']
                            ).map((zt) => (
                              <option key={zt} value={zt}>
                                {t(`zoneTypes.${zt}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-gray-400 dark:text-gray-500">
                            {t('shape')}
                          </label>
                          <select
                            value={z.shape ?? 'rectangle'}
                            onChange={(e) =>
                              commit(() =>
                                updateZone(i, { shape: e.target.value as ThemeElementShape }),
                              )
                            }
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          >
                            {ZONE_SHAPES.map((s) => (
                              <option key={s} value={s}>
                                {t(`shapeTypes.${s}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-6 gap-1.5">
                        {(['x', 'y', 'width', 'height'] as const).map((field) => (
                          <div key={field}>
                            <label
                              className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500"
                              title={
                                field === 'x'
                                  ? t('zoneXTitle')
                                  : field === 'y'
                                    ? t('zoneYTitle')
                                    : field === 'width'
                                      ? t('zoneWidthTitle')
                                      : t('zoneHeightTitle')
                              }
                            >
                              {field === 'x'
                                ? t('zoneX')
                                : field === 'y'
                                  ? t('zoneY')
                                  : field === 'width'
                                    ? t('zoneWidth')
                                    : t('zoneHeight')}
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={z[field]}
                              onChange={(e) =>
                                updateZone(i, { [field]: parseFloat(e.target.value) })
                              }
                              onFocus={captureForHistory}
                              onBlur={commitCaptured}
                              className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                            />
                          </div>
                        ))}
                        <div>
                          <label
                            className="mb-0.5 flex items-center gap-0.5 text-[10px] text-gray-400 dark:text-gray-500"
                            title={t('zoneLayerTitle')}
                          >
                            <Layers className="h-2.5 w-2.5" /> {t('layer.label')}
                          </label>
                          <input
                            type="number"
                            value={z.zIndex ?? 0}
                            onChange={(e) =>
                              updateZone(i, { zIndex: parseInt(e.target.value, 10) || 0 })
                            }
                            onFocus={captureForHistory}
                            onBlur={commitCaptured}
                            className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          />
                        </div>
                        <div>
                          <label
                            className="mb-0.5 flex items-center gap-0.5 text-[10px] text-gray-400 dark:text-gray-500"
                            title={t('zoneRotationTitle')}
                          >
                            <RotateCw className="h-2.5 w-2.5" /> {t('zoneRotation')}
                          </label>
                          <input
                            type="number"
                            min={-360}
                            max={360}
                            value={z.rotation ?? 0}
                            onChange={(e) =>
                              updateZone(i, { rotation: parseInt(e.target.value, 10) || 0 })
                            }
                            onFocus={captureForHistory}
                            onBlur={commitCaptured}
                            className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          />
                        </div>
                      </div>

                      {/* Media source — playlist or a single asset, mutually exclusive. Whichever
                        field is being switched away from is cleared, but the other keeps
                        whatever it last held, so toggling back restores your previous pick.
                        Which picker shows is driven by `assetMode` (explicit toggle state), not
                        by `z.assetId` alone — a zone with neither field set yet still needs the
                        "Asset" button to switch the picker over before anything has been chosen. */}
                      {(z.zoneType ?? 'MEDIA') === 'MEDIA' &&
                        (() => {
                          const assetMode = z.assetId != null || assetModeZones.has(key);
                          return (
                            <div>
                              <label className="mb-1 block text-xs text-gray-400 dark:text-gray-500">
                                {t('mediaSource.label')}
                              </label>
                              <div className="mb-1.5 grid grid-cols-2 gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    commit(() => updateZone(i, { assetId: undefined }));
                                    setAssetModeZones((prev) => {
                                      if (!prev.has(key)) return prev;
                                      const next = new Set(prev);
                                      next.delete(key);
                                      return next;
                                    });
                                  }}
                                  className={`rounded border py-1 text-xs font-medium ${!assetMode ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'}`}
                                >
                                  {t('mediaSource.playlist')}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    commit(() => updateZone(i, { playlistId: undefined }));
                                    setAssetModeZones((prev) =>
                                      prev.has(key) ? prev : new Set(prev).add(key),
                                    );
                                  }}
                                  className={`rounded border py-1 text-xs font-medium ${assetMode ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'}`}
                                >
                                  {t('mediaSource.asset')}
                                </button>
                              </div>
                              {assetMode ? (
                                <AssetPicker
                                  value={z.assetId ?? null}
                                  placeholder={t('noAsset')}
                                  onChange={(assetId) =>
                                    commit(() => updateZone(i, { assetId: assetId ?? undefined }))
                                  }
                                  pasteHint={t('pasteImageHint')}
                                  pasteError={t('pasteImageError')}
                                  uploadingLabel={t('uploadingImage')}
                                  uploadFailedLabel={t('uploadImageFailed')}
                                />
                              ) : (
                                <select
                                  value={z.playlistId ?? ''}
                                  onChange={(e) =>
                                    commit(() =>
                                      updateZone(i, { playlistId: e.target.value || undefined }),
                                    )
                                  }
                                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                >
                                  <option value="">{t('noPlaylist')}</option>
                                  {playlists.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                              {assetMode && z.assetId && (() => {
                                const zoneAsset = assets.find((a) => a.id === z.assetId);
                                if (!zoneAsset || (zoneAsset.type !== 'IMAGE' && zoneAsset.type !== 'VIDEO')) return null;
                                return (
                                  <button
                                    type="button"
                                    onClick={() => setCroppingZoneKey(key)}
                                    className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded border border-gray-200 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                                  >
                                    <Crop className="h-3 w-3" /> {tCrop('editCrop')}
                                  </button>
                                );
                              })()}
                            </div>
                          );
                        })()}

                      {/* Audio balancing across zones — default (both unset) is every zone's own
                        audio plays at the screen's volume simultaneously. */}
                      {(z.zoneType ?? 'MEDIA') === 'MEDIA' && (
                        <div className="space-y-1.5 rounded-lg border border-gray-100 p-2 dark:border-gray-800">
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                            <input
                              type="checkbox"
                              checked={!!z.audioPriority}
                              onChange={(e) =>
                                commit(() =>
                                  setZones((prev) =>
                                    prev.map((zn, idx) =>
                                      idx === i
                                        ? { ...zn, audioPriority: e.target.checked }
                                        : e.target.checked
                                          ? { ...zn, audioPriority: false }
                                          : zn,
                                    ),
                                  ),
                                )
                              }
                              className="h-3.5 w-3.5 accent-indigo-500"
                            />
                            {t('audio.priority')}
                          </label>
                          <p className="text-[10px] text-gray-400 dark:text-gray-500">
                            {t('audio.priorityHint')}
                          </p>
                          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                            <input
                              type="checkbox"
                              checked={z.audioVolume != null}
                              onChange={(e) =>
                                commit(() =>
                                  updateZone(i, { audioVolume: e.target.checked ? 100 : null }),
                                )
                              }
                              className="h-3.5 w-3.5 accent-indigo-500"
                            />
                            {t('audio.customVolume')}
                          </label>
                          {z.audioVolume != null && (
                            <div className="flex items-center gap-2">
                              <Volume2 className="h-3 w-3 shrink-0 text-gray-400" />
                              <input
                                type="range"
                                min={0}
                                max={100}
                                value={z.audioVolume ?? 100}
                                onFocus={captureForHistory}
                                onChange={(e) =>
                                  updateZone(i, { audioVolume: Number(e.target.value) })
                                }
                                onMouseUp={commitCaptured}
                                onTouchEnd={commitCaptured}
                                className="flex-1 accent-indigo-600"
                              />
                              <span className="w-8 text-end text-xs text-gray-500 dark:text-gray-400">
                                {z.audioVolume}%
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Widget-specific config */}
                      {z.zoneType && z.zoneType !== 'MEDIA' && (
                        <WidgetConfigFields
                          widgetType={z.zoneType}
                          config={z.widgetConfig ?? {}}
                          onChange={(cfg) => updateZone(i, { widgetConfig: cfg })}
                          onChangeCommitted={(cfg) =>
                            commit(() => updateZone(i, { widgetConfig: cfg }))
                          }
                          onFocusField={captureForHistory}
                          onBlurField={commitCaptured}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {croppingZoneKey && (() => {
            const i = zones.findIndex((zn, idx) => (zn._localId ?? String(idx)) === croppingZoneKey);
            const z = i >= 0 ? zones[i] : undefined;
            const asset = z?.assetId ? assets.find((a) => a.id === z.assetId) : undefined;
            if (!z || !asset || (asset.type !== 'IMAGE' && asset.type !== 'VIDEO') || !asset.url) return null;
            return (
              <CropEditor
                mediaUrl={asset.url}
                mediaType={asset.type}
                name={z.name}
                shape={z.shape}
                aspectRatio={(z.width / z.height) * (16 / 9)}
                initialCrop={{
                  cropZoom: z.cropZoom ?? null,
                  cropOffsetX: z.cropOffsetX ?? null,
                  cropOffsetY: z.cropOffsetY ?? null,
                }}
                onClose={() => setCroppingZoneKey(null)}
                onSave={(crop: MediaCrop) => {
                  commit(() => updateZone(i, crop));
                  setCroppingZoneKey(null);
                }}
              />
            );
          })()}

          <EditorAddSidebar
            title={t('addZone')}
            openLabel={tc('openAddPanel')}
            closeLabel={tc('closeAddPanel')}
            open={addPanelOpen}
            onOpenChange={setAddPanelOpen}
            sections={[
              {
                heading: t('addGroups.media'),
                items: [
                  {
                    key: 'MEDIA',
                    label: t('zoneTypes.MEDIA'),
                    icon: ZONE_TYPE_ICONS.MEDIA,
                    onClick: () => addZoneOfType('MEDIA'),
                  },
                ],
              },
              {
                heading: t('addGroups.dataFeeds'),
                items: (['WEATHER', 'CURRENCY', 'TICKER'] as ZoneType[]).map((zt) => ({
                  key: zt,
                  label: t(`zoneTypes.${zt}`),
                  icon: ZONE_TYPE_ICONS[zt],
                  onClick: () => addZoneOfType(zt),
                })),
              },
              {
                heading: t('addGroups.timeDate'),
                items: (['TIME', 'DATE'] as ZoneType[]).map((zt) => ({
                  key: zt,
                  label: t(`zoneTypes.${zt}`),
                  icon: ZONE_TYPE_ICONS[zt],
                  onClick: () => addZoneOfType(zt),
                })),
              },
              {
                heading: t('addGroups.faith'),
                items: [
                  {
                    key: 'PRAYER',
                    label: t('zoneTypes.PRAYER'),
                    icon: ZONE_TYPE_ICONS.PRAYER,
                    onClick: () => addZoneOfType('PRAYER'),
                  },
                ],
              },
              {
                heading: t('addGroups.interactive'),
                items: [
                  {
                    key: 'QR',
                    label: t('zoneTypes.QR'),
                    icon: ZONE_TYPE_ICONS.QR,
                    onClick: () => addZoneOfType('QR'),
                  },
                ],
              },
            ]}
          />

          <LayersPanel
            open={layersPanelOpen}
            onOpenChange={setLayersPanelOpen}
            items={sortByZDesc(zones.map((z, i) => ({ ...z, zIndex: z.zIndex ?? 0, _key: z._localId ?? String(i) }))).map(
              (z) => ({
                id: z._key,
                zIndex: z.zIndex,
                label: z.name,
                icon: ZONE_TYPE_ICONS[z.zoneType ?? 'MEDIA'],
              }),
            )}
            selectedId={selectedZoneId}
            onSelect={setSelectedZoneId}
            onReorder={reorderZoneLayers}
            title={tc('layers')}
            emptyLabel={tc('noLayers')}
            closeLabel={tc('closeLayersPanel')}
          />
        </div>
      )}

      {deleteError && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {deleteError}
        </div>
      )}

      {bgRemoveError && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {bgRemoveError}
        </div>
      )}

      {!editing && layouts.length > 0 && (
        <div className="relative mb-5 max-w-sm">
          <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tc('search')}
            className="w-full rounded-lg border border-gray-200 py-2 ps-8 pe-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
      )}

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && layouts.length === 0 && !editing && (
        <div className="py-16 text-center text-gray-400">
          <LayoutTemplate className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {!isLoading && !editing && layouts.length > 0 &&
        layouts.filter((l) => l.name.toLowerCase().includes(search.toLowerCase())).length === 0 && (
        <div className="py-16 text-center text-gray-400">
          <Search className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">{tc('noMatches')}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {layouts.filter((l) => l.name.toLowerCase().includes(search.toLowerCase())).map((layout: Layout) => {
          const isEditingThis = editing !== null && editing !== 'new' && editing.id === layout.id;
          return (
            <div
              key={layout.id}
              className={`rounded-xl border bg-white p-4 dark:bg-gray-900 ${isEditingThis ? 'border-indigo-400 ring-2 ring-indigo-100 dark:border-indigo-500 dark:ring-indigo-900/50' : 'border-gray-200 dark:border-gray-800'}`}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                {isEditingThis && (
                  <span className="flex shrink-0 items-center gap-1 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
                    <Pencil className="h-2.5 w-2.5" /> {t('currentlyEditing')}
                  </span>
                )}
                {renamingId === layout.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(layout)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(layout);
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    disabled={renameMut.isPending}
                    className="-mx-1 min-w-0 rounded border border-indigo-300 px-1 text-sm font-medium text-gray-900 focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-indigo-700 dark:bg-gray-800 dark:text-gray-100"
                  />
                ) : (
                  <span
                    onClick={() => startRename(layout)}
                    title={canEditContent ? tc('clickToRename') : undefined}
                    className={`truncate text-sm font-medium text-gray-900 dark:text-gray-100 ${canEditContent ? 'cursor-text hover:text-indigo-600 dark:hover:text-indigo-400' : ''}`}
                  >
                    {layout.name}
                  </span>
                )}
                {canEditContent && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => duplicateMut.mutate(layout)}
                      disabled={duplicateMut.isPending}
                      title={t('duplicate')}
                      className="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-50 dark:text-gray-500"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(layout);
                      }}
                      className="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              {/* Mini preview — click to edit */}
              <button
                onClick={() => canEditContent && openEdit(layout)}
                disabled={!canEditContent}
                title={canEditContent ? t('clickToEdit') : undefined}
                className="group relative block w-full disabled:cursor-default"
                style={{
                  aspectRatio: '16/9',
                  background: '#111',
                  borderRadius: 4,
                  overflow: 'hidden',
                  marginBottom: 8,
                }}
              >
                {layout.zones.map((z, i) => {
                  const zt = z.zoneType ?? 'MEDIA';
                  const color = ZONE_COLORS[i % ZONE_COLORS.length];
                  // MEDIA zones bound directly to an Asset (not a playlist) can show its real
                  // thumbnail — z.asset only carries {id, name} from the API, so cross-reference
                  // the already-fetched full asset list for thumbnailUrl/type.
                  const zoneAsset = zt === 'MEDIA' && z.asset ? assets.find((a) => a.id === z.asset!.id) : undefined;
                  const thumbUrl =
                    zoneAsset && zoneAsset.status === 'READY'
                      ? (zoneAsset.thumbnailUrl ?? (zoneAsset.type === 'IMAGE' ? zoneAsset.url : null))
                      : null;
                  const Icon = ZONE_TYPE_ICONS[zt];
                  return (
                    <div
                      key={z.id}
                      style={{
                        position: 'absolute',
                        left: `${z.x}%`,
                        top: `${z.y}%`,
                        width: `${z.width}%`,
                        height: `${z.height}%`,
                        background: thumbUrl ? '#000' : color + '66',
                        border: `1px solid ${color}`,
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        ...shapeClipStyle(z.shape),
                      }}
                    >
                      {thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- small grid thumbnail, not a static/local image
                        <img
                          src={thumbUrl}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <Icon className="h-3.5 w-3.5 opacity-70" style={{ color }} />
                      )}
                    </div>
                  );
                })}
                {canEditContent && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
                    <span className="flex items-center gap-1.5 text-xs font-medium text-white">
                      <Pencil className="h-3.5 w-3.5" /> {t('editLayout')}
                    </span>
                  </div>
                )}
              </button>

              <div className="space-y-1">
                {layout.zones.map((z, i) => {
                  const zt = z.zoneType ?? 'MEDIA';
                  return (
                    <div
                      key={z.id}
                      className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400"
                    >
                      <div
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }}
                      />
                      <span className="font-medium text-gray-700 dark:text-gray-300">{z.name}</span>
                      <span
                        className={`rounded px-1 py-0.5 text-[10px] font-medium ${ZONE_TYPE_BADGE[zt]}`}
                      >
                        {t(`zoneTypes.${zt}`)}
                      </span>
                      {zt === 'MEDIA' && (
                        <>
                          <span className="text-gray-400 dark:text-gray-500">→</span>
                          <span>
                            {z.playlist?.name ?? (
                              <em className="text-gray-300 dark:text-gray-500">
                                {t('noPlaylistBadge')}
                              </em>
                            )}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
              {layout._count && (
                <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                  {t('playlistItemCount', { count: layout._count.playlistItems })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
