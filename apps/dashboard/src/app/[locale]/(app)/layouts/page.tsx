'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Rnd } from 'react-rnd';
import {
  LayoutTemplate,
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
  ZoomIn,
  ZoomOut,
  Crop,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { shapeClipStyle, mediaCropStyle, type ThemeElementShape } from '@lumina/types';
import {
  assetsApi,
  layoutsApi,
  playlistsApi,
  type Layout,
  type ZoneInput,
  type ZoneType,
} from '@/lib/api';
import { EditorAddSidebar } from '@/components/EditorAddSidebar';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useFaithFeatures } from '@/hooks/useFaithFeatures';
import { useRequireSelectToEdit } from '@/hooks/useRequireSelectToEdit';
import { useRotateHandleStyle } from '@/hooks/useRotateHandleStyle';
import { ZoneRotateHandle } from '@/components/ZoneRotateHandle';
import { useAuth } from '@/context/AuthContext';
import { useEditorDirty } from '@/context/EditorDirtyContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useEditorHistory } from '@/hooks/useEditorHistory';
import { AssetPicker } from '@/components/AssetPicker';
import { WidgetConfigFields } from '@/components/WidgetConfigFields';
import { CropEditor, type MediaCrop } from '@/components/CropEditor';
import {
  type Box,
  clampBox,
  computeAlignTargets,
  resolveResize,
  snapDragAxis,
} from '@/lib/canvasSnap';
import {
  RESIZE_HANDLES,
  RESIZE_HANDLE_AXIS,
  resizeHandleStyle,
  rotatedResizeAnchor,
  rotatedResizeBox,
  type ResizeHandle,
} from '@/lib/rotatedResize';

const ZONE_SHAPES: ThemeElementShape[] = ['rectangle', 'rounded', 'circle', 'triangle', 'pentagon', 'hexagon', 'octagon', 'star'];

const PREVIEW_W = 400;
const PREVIEW_H = 225;
const MIN_ZONE_PX = 20;
// Rotation drag snaps to the nearest 15° once within this many degrees.
const SNAP_DEG = 4;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;

const clampPct = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

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

const ZONE_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

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

export default function LayoutsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canEditContent } = usePermissions();
  const { confirmDelete } = useConfirmBeforeDelete();
  const { enabled: faithEnabled } = useFaithFeatures();
  const { enabled: requireSelectToEdit } = useRequireSelectToEdit();
  const { style: rotateHandleStyle } = useRotateHandleStyle();
  const logAction = useAuditLog();
  const t = useTranslations('layouts');
  const tc = useTranslations('common');
  const tCrop = useTranslations('cropEditor');
  const ta = useTranslations('auditLog');
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

  // Live preview canvas size in px — kept in sync with its actual rendered width so the
  // preview can take up most of the page instead of a fixed small box.
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: PREVIEW_W, height: PREVIEW_H });
  // The zone currently being dragged/resized, tracked outside `zones` state so interaction
  // frames don't re-render the settings list below the preview — only committed on drop.
  const [dragBox, setDragBox] = useState<({ index: number } & Box) | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [rotationDrag, setRotationDrag] = useState<{ index: number; deg: number } | null>(null);
  // A zone must be selected (single click) before it can be dragged/resized/rotated — unless
  // requireSelectToEdit is off, or the zone is locked (editable: false), which always wins.
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [croppingZoneKey, setCroppingZoneKey] = useState<string | null>(null);
  // UI-only: which zones have the media-source toggle set to "Asset". Needed because a brand
  // new/never-saved zone has both assetId and playlistId undefined — without this, clicking
  // "Asset" cleared playlistId (already undefined, so nothing visibly changed) and the picker
  // below stayed on the Playlist select forever, since it switched purely on `z.assetId` being
  // truthy. The "Asset" button looked like it did nothing until a playlist had been picked once.
  const [assetModeZones, setAssetModeZones] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedZoneId(null);
  }, [editing]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () =>
      setPreviewSize({ width: el.clientWidth, height: (el.clientWidth * 9) / 16 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing]);

  // Canvas zoom: previewRef's own box is deliberately resized (not CSS-transform-scaled), so every
  // existing bit of pointer math above — which already works purely off previewSize/getBoundingClientRect
  // of the real rendered box — keeps working unchanged at any zoom level. zoomViewportRef measures the
  // *unzoomed* available width so the scroll window's size stays stable while only its content grows.
  const [zoom, setZoom] = useState(1);
  const zoomViewportRef = useRef<HTMLDivElement>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);

  useEffect(() => {
    setZoom(1);
  }, [editing]);

  useEffect(() => {
    const el = zoomViewportRef.current;
    if (!el) return;
    const update = () => setNaturalWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing]);

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
    });
    commit(() => setZones((prev) => [...prev, zone]));
    setSelectedZoneId(zone._localId ?? null);
  }

  // A locked zone (editable: false) can never be dragged/resized/rotated, regardless of
  // selection or the requireSelectToEdit setting. Otherwise interaction is gated on selection
  // only when that setting is on — off restores immediate drag/resize on first touch.
  function zoneIsInteractive(z: ZoneInput, isSelected: boolean) {
    if (z.editable === false) return false;
    return !requireSelectToEdit || isSelected;
  }

  const getBoxPx = useCallback(
    (z: ZoneInput): Box => ({
      left: (z.x / 100) * previewSize.width,
      top: (z.y / 100) * previewSize.height,
      width: (z.width / 100) * previewSize.width,
      height: (z.height / 100) * previewSize.height,
    }),
    [previewSize],
  );

  // Alignment guides only make sense against another zone's actual visible edges — a rotated
  // zone's unrotated left/top/width/height box doesn't correspond to anything on screen, so it's
  // excluded both as a snap target for others and (in handleDrag/handleResize below) as something
  // that itself snaps while being dragged/resized.
  const computeTargets = useCallback(
    (excludeIndex: number) => {
      const otherBoxes = zones
        .filter((z, idx) => idx !== excludeIndex && !(z.rotation ?? 0))
        .map(getBoxPx);
      return computeAlignTargets(previewSize.width, previewSize.height, otherBoxes);
    },
    [zones, previewSize, getBoxPx],
  );

  const clampToCanvas = useCallback(
    (box: Box): Box => clampBox(box, previewSize.width, previewSize.height),
    [previewSize],
  );

  function handleDrag(i: number, x: number, y: number) {
    const z = zones[i];
    if (!z) return;
    const box = getBoxPx(z);
    if (z.rotation) {
      setDragBox({
        index: i,
        ...clampToCanvas({ left: x, top: y, width: box.width, height: box.height }),
      });
      setGuides({ v: [], h: [] });
      return;
    }
    const { xs, ys } = computeTargets(i);
    const snapX = snapDragAxis(x, box.width, xs);
    const snapY = snapDragAxis(y, box.height, ys);
    const next = clampToCanvas({
      left: snapX.pos,
      top: snapY.pos,
      width: box.width,
      height: box.height,
    });
    setDragBox({ index: i, ...next });
    setGuides({
      v: snapX.guide !== null ? [snapX.guide] : [],
      h: snapY.guide !== null ? [snapY.guide] : [],
    });
  }

  function handleDragStop(i: number, x: number, y: number) {
    const z = zones[i];
    if (!z) return;
    const box = getBoxPx(z);
    if (z.rotation) {
      const next = clampToCanvas({ left: x, top: y, width: box.width, height: box.height });
      commit(() =>
        updateZone(i, {
          x: clampPct((next.left / previewSize.width) * 100),
          y: clampPct((next.top / previewSize.height) * 100),
        }),
      );
      setDragBox(null);
      setGuides({ v: [], h: [] });
      return;
    }
    const { xs, ys } = computeTargets(i);
    const snapX = snapDragAxis(x, box.width, xs);
    const snapY = snapDragAxis(y, box.height, ys);
    const next = clampToCanvas({
      left: snapX.pos,
      top: snapY.pos,
      width: box.width,
      height: box.height,
    });
    commit(() =>
      updateZone(i, {
        x: clampPct((next.left / previewSize.width) * 100),
        y: clampPct((next.top / previewSize.height) * 100),
      }),
    );
    setDragBox(null);
    setGuides({ v: [], h: [] });
  }

  function handleResize(
    i: number,
    direction: string,
    ref: HTMLElement,
    position: { x: number; y: number },
  ) {
    const box: Box = {
      left: position.x,
      top: position.y,
      width: parseFloat(ref.style.width),
      height: parseFloat(ref.style.height),
    };
    const { box: next, guides } = resolveResize(
      direction,
      box,
      computeTargets(i),
      MIN_ZONE_PX,
      previewSize.width,
      previewSize.height,
    );
    setDragBox({ index: i, ...next });
    setGuides(guides);
  }

  function handleResizeStop(
    i: number,
    direction: string,
    ref: HTMLElement,
    position: { x: number; y: number },
  ) {
    const box: Box = {
      left: position.x,
      top: position.y,
      width: parseFloat(ref.style.width),
      height: parseFloat(ref.style.height),
    };
    const { box: next } = resolveResize(
      direction,
      box,
      computeTargets(i),
      MIN_ZONE_PX,
      previewSize.width,
      previewSize.height,
    );
    commit(() =>
      updateZone(i, {
        x: clampPct((next.left / previewSize.width) * 100),
        y: clampPct((next.top / previewSize.height) * 100),
        width: clampPct((next.width / previewSize.width) * 100),
        height: clampPct((next.height / previewSize.height) * 100),
      }),
    );
    setDragBox(null);
    setGuides({ v: [], h: [] });
  }

  // Drag-to-rotate: mirrors the theme editor's handle — angle is measured from the zone's own
  // (unrotated) center to the mouse, in the preview canvas's own coordinate space.
  function startRotateZone(e: React.MouseEvent, i: number) {
    e.preventDefault();
    e.stopPropagation();
    const canvas = previewRef.current;
    const z = zones[i];
    if (!canvas || !z) return;
    const canvasRect = canvas.getBoundingClientRect();
    const box = getBoxPx(z);
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;

    function rawAngleFor(clientX: number, clientY: number): number {
      const mx = clientX - canvasRect.left;
      const my = clientY - canvasRect.top;
      let deg = Math.atan2(my - cy, mx - cx) * (180 / Math.PI) + 90;
      return ((deg % 360) + 360) % 360;
    }

    // The corner handles sit well off the box's own top-center reference point, so the mouse's
    // raw angle at drag start doesn't equal the zone's current rotation (e.g. grabbing the "ne"
    // handle starts ~45-135° off, depending on aspect ratio) — using it directly would snap the
    // rotation to wherever that handle happens to sit the instant the drag begins. Capturing that
    // gap once and holding it constant for the drag makes rotation track the mouse's angular
    // movement from whichever point was actually grabbed, continuing smoothly from the current
    // rotation instead of jumping to it.
    const startOffset = rawAngleFor(e.clientX, e.clientY) - (z.rotation ?? 0);

    function angleFor(clientX: number, clientY: number): number {
      let deg = rawAngleFor(clientX, clientY) - startOffset;
      deg = ((deg % 360) + 360) % 360;
      const nearest15 = Math.round(deg / 15) * 15;
      if (Math.abs(deg - nearest15) <= SNAP_DEG) deg = nearest15 % 360;
      return Math.round(deg);
    }

    function onMove(ev: MouseEvent) {
      setRotationDrag({ index: i, deg: angleFor(ev.clientX, ev.clientY) });
    }
    function onUp(ev: MouseEvent) {
      commit(() => updateZone(i, { rotation: angleFor(ev.clientX, ev.clientY) }));
      setRotationDrag(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Custom resize handles for rotated zones — react-rnd's own resize handles stay anchored to
  // the zone's unrotated bounding box, so once a zone is rotated they end up nowhere near its
  // visible (rotated) corners/edges. These handles are rendered inside the same rotated wrapper
  // as the shape, so they always sit at its true visual corners/edges, and the drag math in
  // rotatedResizeBox() undoes the rotation before computing the new width/height.
  function startResizeZone(e: React.MouseEvent, i: number, handle: ResizeHandle) {
    e.preventDefault();
    e.stopPropagation();
    const canvas = previewRef.current;
    const z = zones[i];
    if (!canvas || !z) return;
    const canvasRect = canvas.getBoundingClientRect();
    const box = getBoxPx(z);
    const rotation = z.rotation ?? 0;
    const anchor = rotatedResizeAnchor(box, rotation, handle);

    function compute(clientX: number, clientY: number): Box {
      const mouse = { x: clientX - canvasRect.left, y: clientY - canvasRect.top };
      return clampBox(
        rotatedResizeBox(rotation, handle, anchor, mouse, box, MIN_ZONE_PX),
        previewSize.width,
        previewSize.height,
      );
    }

    function onMove(ev: MouseEvent) {
      setDragBox({ index: i, ...compute(ev.clientX, ev.clientY) });
    }
    function onUp(ev: MouseEvent) {
      const next = compute(ev.clientX, ev.clientY);
      commit(() =>
        updateZone(i, {
          x: clampPct((next.left / previewSize.width) * 100),
          y: clampPct((next.top / previewSize.height) * 100),
          width: clampPct((next.width / previewSize.width) * 100),
          height: clampPct((next.height / previewSize.height) * 100),
        }),
      );
      setDragBox(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const saving = createMut.isPending || updateMut.isPending;

  return (
    // Wider cap while editing, but only at the breakpoint where EditorAddSidebar's persistent
    // rail actually shows (see its own comment) — that rail reserves space via `pe-72` on the
    // editor panel below, and widening the page cap to match keeps the editing area at least as
    // big as its normal (no-sidebar) size instead of just eating into the original 1400px.
    <div className={`mx-auto max-w-[1400px] p-8 ${editing ? 'min-[1920px]:max-w-[2400px]' : ''}`}>
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

      {/* Editor panel */}
      {editing && canEditContent && (
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm min-[1920px]:pe-72 dark:border-gray-800 dark:bg-gray-900">
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

          {/* Visual preview, full-width, with zone settings stacked below. The floating
              EditorAddSidebar (rendered after this panel, outside its layout flow entirely) is
              the primary way to add new zones, so the zone cards can focus on editing what
              already exists — the generic "Add zone" button in the card list still works too. */}
          <div className="flex flex-col gap-6">
            {/* Screen preview — drag to move, drag the edges/corners to resize, like resizing a window.
                Pink guide lines snap moving edges/centers to other zones and the canvas bounds. */}
            <div>
              {/* Extra bottom margin (vs. a plain mb-1) leaves clearance above the frame so the
                  corner rotate handles — which sit outside the frame's own edge — don't get
                  visually covered by this row. */}
              <div className="mb-6 flex items-center justify-between">
                <span className="text-xs text-gray-400 dark:text-gray-500">{t('preview')}</span>
                <div className="flex items-center gap-1 text-gray-400 dark:text-gray-500">
                  <button
                    type="button"
                    title={tc('zoomOut')}
                    onClick={() => setZoom((z) => clampZoom(z / ZOOM_STEP))}
                    className="rounded p-1 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title={tc('zoomReset')}
                    onClick={() => setZoom(1)}
                    className="w-10 rounded px-1 py-0.5 text-center text-[10px] tabular-nums hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  >
                    {Math.round(zoom * 100)}%
                  </button>
                  <button
                    type="button"
                    title={tc('zoomIn')}
                    onClick={() => setZoom((z) => clampZoom(z * ZOOM_STEP))}
                    className="rounded p-1 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div
                ref={zoomViewportRef}
                onWheel={(e) => {
                  if (!e.ctrlKey) return;
                  e.preventDefault();
                  setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * 0.0015)));
                }}
                // Only clip once actually zoomed in (there's then real off-screen content to pan
                // to via scrolling) — at the default 100% zoom, staying unclipped lets the corner
                // rotate handles stick out past the frame edge instead of being cut off flush
                // against it.
                style={{ width: '100%', aspectRatio: '16 / 9', overflow: zoom > 1 ? 'auto' : 'visible', borderRadius: 6 }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: naturalWidth ? naturalWidth * zoom : '100%',
                    aspectRatio: '16 / 9',
                  }}
                >
                <div
                  ref={previewRef}
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) setSelectedZoneId(null);
                  }}
                  // Clipped to the frame — a rotated zone's fill must never visually spill onto
                  // the rest of the editor once its rotated footprint exceeds the canvas rect.
                  // The rotate grip and the custom rotation-aware resize handles are rendered
                  // separately, in the unclipped overlay just below (same box/rotation math), so
                  // they stay reachable even where they'd otherwise land outside the frame.
                  style={{
                    width: '100%',
                    aspectRatio: '16 / 9',
                    background: '#111',
                    position: 'relative',
                    // Contains each zone's own stacking (if it ever gets a `zIndex` CSS style) within
                    // this frame, so nothing can paint above the unclipped resize-handle overlay
                    // rendered as this div's sibling further down.
                    isolation: 'isolate',
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  {previewSize.width > 0 &&
                    zones.map((z, i) => {
                      const box = dragBox && dragBox.index === i ? dragBox : getBoxPx(z);
                      const liveRotation =
                        rotationDrag && rotationDrag.index === i
                          ? rotationDrag.deg
                          : (z.rotation ?? 0);
                      const key = z._localId ?? String(i);
                      const isSelected = selectedZoneId === key;
                      const isHovered = hoveredZoneId === key;
                      const locked = z.editable === false;
                      const interactive = zoneIsInteractive(z, isSelected);
                      const rotation = z.rotation ?? 0;
                      const color = ZONE_COLORS[i % ZONE_COLORS.length];
                      const asset = z.assetId ? assets.find((a) => a.id === z.assetId) : undefined;
                      const thumb =
                        asset && asset.status === 'READY'
                          ? (asset.thumbnailUrl ?? asset.url)
                          : null;
                      return (
                        <Rnd
                          key={key}
                          bounds="parent"
                          minWidth={MIN_ZONE_PX}
                          minHeight={MIN_ZONE_PX}
                          disableDragging={!interactive}
                          // react-rnd's own resize handles are anchored to the unrotated box, which no
                          // longer matches the visible (rotated) shape — once rotated, use the custom
                          // rotation-aware handles rendered below instead.
                          enableResizing={interactive && rotation === 0 ? undefined : false}
                          cancel=".rotate-handle, .resize-handle"
                          size={{ width: box.width, height: box.height }}
                          position={{ x: box.left, y: box.top }}
                          onMouseDown={() => setSelectedZoneId(key)}
                          onDragStart={() => setSelectedZoneId(key)}
                          onDrag={(_e, d) => handleDrag(i, d.x, d.y)}
                          onDragStop={(_e, d) => handleDragStop(i, d.x, d.y)}
                          onResize={(_e, dir, ref, _delta, position) =>
                            handleResize(i, dir, ref, position)
                          }
                          onResizeStop={(_e, dir, ref, _delta, position) =>
                            handleResizeStop(i, dir, ref, position)
                          }
                          style={{ overflow: 'visible' }}
                        >
                          {/* react-rnd/react-draggable owns the root node's own `transform` (translate()
                            for positioning) and clobbers a rotate() set alongside it — rotation lives
                            on this separate inner wrapper instead. */}
                          <div
                            onMouseEnter={() => setHoveredZoneId(key)}
                            onMouseLeave={() => setHoveredZoneId((id) => (id === key ? null : id))}
                            style={{
                              width: '100%',
                              height: '100%',
                              position: 'relative',
                              transform: liveRotation ? `rotate(${liveRotation}deg)` : undefined,
                            }}
                          >
                            {/* Shape-clipped fill — the actual visible zone. The true rectangular
                              bounding box (below) only shows on hover/select, since a circle/triangle
                              shape would otherwise look like it has an invisible rectangular halo. */}
                            <div
                              style={{
                                position: 'absolute',
                                inset: 0,
                                background: thumb ? '#000' : color + '55',
                                border: `2px solid ${color}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexDirection: 'column',
                                gap: 2,
                                overflow: 'hidden',
                                ...shapeClipStyle(z.shape),
                              }}
                            >
                              {thumb ? (
                                // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote asset URL, not a static/local image
                                <img
                                  src={thumb}
                                  alt={z.name}
                                  draggable={false}
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: asset?.type === 'IMAGE' ? 'fill' : 'contain',
                                    ...mediaCropStyle(z),
                                  }}
                                />
                              ) : (
                                <>
                                  <span
                                    style={{
                                      fontSize: 11,
                                      color: '#fff',
                                      fontWeight: 600,
                                      textAlign: 'center',
                                    }}
                                  >
                                    {z.name}
                                  </span>
                                  <span style={{ opacity: 0.7, fontSize: 10, color: '#fff' }}>
                                    {t(`zoneTypes.${z.zoneType ?? 'MEDIA'}`)}
                                  </span>
                                </>
                              )}
                            </div>
                            {(isHovered || isSelected) && (
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: -2,
                                  border: `1px dashed ${color}`,
                                  pointerEvents: 'none',
                                }}
                              />
                            )}
                            {locked && (
                              <div
                                title={t('lockedHint')}
                                style={{
                                  position: 'absolute',
                                  top: 3,
                                  insetInlineStart: 3,
                                  color: '#fff',
                                  background: 'rgba(0,0,0,0.5)',
                                  borderRadius: 4,
                                  padding: 2,
                                  lineHeight: 0,
                                }}
                              >
                                <Lock className="h-2.5 w-2.5" />
                              </div>
                            )}
                          </div>
                        </Rnd>
                      );
                    })}
                  {guides.v.map((x, idx) => (
                    <div
                      key={`v-${idx}`}
                      style={{
                        position: 'absolute',
                        left: x,
                        top: 0,
                        width: 0,
                        height: '100%',
                        borderLeft: '1px solid #ec4899',
                        pointerEvents: 'none',
                        zIndex: 50,
                      }}
                    />
                  ))}
                  {guides.h.map((y, idx) => (
                    <div
                      key={`h-${idx}`}
                      style={{
                        position: 'absolute',
                        top: y,
                        left: 0,
                        height: 0,
                        width: '100%',
                        borderTop: '1px solid #ec4899',
                        pointerEvents: 'none',
                        zIndex: 50,
                      }}
                    />
                  ))}
                </div>
                {/* Unclipped overlay for the rotate grip + rotation-aware resize handles — sits
                    outside the frame's overflow:hidden clip above so they stay grabbable even when
                    a rotated zone's box would put them past the frame edge. Absolutely positioned
                    over the exact same rect as the frame; only individual handles accept pointer
                    events, the rest passes clicks through to the frame beneath. */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    overflow: 'visible',
                    pointerEvents: 'none',
                  }}
                >
                  {previewSize.width > 0 &&
                    zones.map((z, i) => {
                      const box = dragBox && dragBox.index === i ? dragBox : getBoxPx(z);
                      const liveRotation =
                        rotationDrag && rotationDrag.index === i
                          ? rotationDrag.deg
                          : (z.rotation ?? 0);
                      const key = z._localId ?? String(i);
                      const isSelected = selectedZoneId === key;
                      const interactive = zoneIsInteractive(z, isSelected);
                      const rotation = z.rotation ?? 0;
                      const color = ZONE_COLORS[i % ZONE_COLORS.length];
                      if (!interactive) return null;
                      return (
                        <div
                          key={key}
                          style={{
                            position: 'absolute',
                            left: box.left,
                            top: box.top,
                            width: box.width,
                            height: box.height,
                            transform: liveRotation ? `rotate(${liveRotation}deg)` : undefined,
                          }}
                        >
                          {/* Resize handles render before the rotate handle so that, wherever the
                              two visually overlap near a corner, the rotate handle — painted last
                              — is the one that actually receives the click. */}
                          {rotation !== 0 &&
                            RESIZE_HANDLES.map((h) => (
                              <div
                                key={h}
                                className="resize-handle"
                                onMouseDown={(e) => startResizeZone(e, i, h)}
                                title={t('resizeHint')}
                                style={{
                                  ...resizeHandleStyle(h),
                                  width: 8,
                                  height: 8,
                                  borderRadius: 2,
                                  background: color,
                                  border: '1.5px solid white',
                                  cursor: RESIZE_HANDLE_AXIS[h].cursor,
                                  boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
                                  pointerEvents: 'auto',
                                }}
                              />
                            ))}
                          <ZoneRotateHandle
                            style={rotateHandleStyle}
                            color={color ?? '#6366f1'}
                            hint={t('rotateHint')}
                            onStartRotate={(e) => startRotateZone(e, i)}
                          />
                        </div>
                      );
                    })}
                </div>
              </div>
              </div>
            </div>

            {/* Zone cards — one per zone, mirroring the screens page's per-screen card layout
                instead of the old flat grid-of-input-rows (confusing to line up at a glance). */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs text-gray-400 dark:text-gray-500">{t('zones')}</div>
                <button
                  onClick={() => addZoneOfType('MEDIA')}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
                >
                  <Plus className="h-3 w-3" /> {t('addZone')}
                </button>
              </div>
              <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {zones.map((z, i) => {
                  const key = z._localId ?? String(i);
                  const isSelected = selectedZoneId === key;
                  return (
                    <div
                      key={key}
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

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-gray-100 pt-4 dark:border-gray-800">
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
        </div>
      )}

      {deleteError && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {deleteError}
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
                {layout.zones.map((z, i) => (
                  <div
                    key={z.id}
                    style={{
                      position: 'absolute',
                      left: `${z.x}%`,
                      top: `${z.y}%`,
                      width: `${z.width}%`,
                      height: `${z.height}%`,
                      background: ZONE_COLORS[i % ZONE_COLORS.length] + '66',
                      border: `1px solid ${ZONE_COLORS[i % ZONE_COLORS.length]}`,
                      ...shapeClipStyle(z.shape),
                    }}
                  />
                ))}
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
                  {t('screenCount', { count: layout._count.screens })}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
