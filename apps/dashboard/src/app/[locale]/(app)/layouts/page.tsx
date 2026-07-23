'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Rnd } from 'react-rnd';
import { LayoutTemplate, Plus, Trash2, Pencil, X, Check, Copy } from 'lucide-react';
import { layoutsApi, playlistsApi, type Layout, type ZoneInput, type ZoneType } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useFaithFeatures } from '@/hooks/useFaithFeatures';
import { useAuth } from '@/context/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';

const PREVIEW_W = 400;
const PREVIEW_H = 225;
const SNAP_THRESHOLD = 6;
const MIN_ZONE_PX = 20;

const clampPct = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));

type Box = { left: number; top: number; width: number; height: number };

// Snap a moving edge (or center) to the nearest same-axis edge/center among other zones
// or the canvas bounds — mirrors the alignment guides in Google Drawings/Slides.
function snapDragAxis(pos: number, size: number, targets: number[]): { pos: number; guide: number | null } {
  const candidates = [pos, pos + size / 2, pos + size];
  let bestDiff = SNAP_THRESHOLD;
  let result: { pos: number; guide: number } | null = null;
  for (const target of targets) {
    for (const c of candidates) {
      const diff = Math.abs(c - target);
      if (diff < bestDiff) {
        bestDiff = diff;
        result = { pos: target - (c - pos), guide: target };
      }
    }
  }
  return result ?? { pos, guide: null };
}

function snapEdge(value: number, targets: number[]): { value: number; guide: number | null } {
  let bestDiff = SNAP_THRESHOLD;
  let best: number | null = null;
  for (const target of targets) {
    const diff = Math.abs(value - target);
    if (diff < bestDiff) { bestDiff = diff; best = target; }
  }
  return best !== null ? { value: best, guide: best } : { value, guide: null };
}

const ZONE_TYPE_VALUES: ZoneType[] = ['MEDIA', 'PRAYER', 'WEATHER', 'CURRENCY', 'TICKER'];

const PRESET_ZONE_KEYS = ['fullscreen', 'mainTicker', 'split5050', 'mainSidebar', 'mosque'] as const;
type PresetKey = typeof PRESET_ZONE_KEYS[number];

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
};

function toZoneInputs(layout: Layout): ZoneInput[] {
  return layout.zones.map(z => ({
    name: z.name, x: z.x, y: z.y, width: z.width, height: z.height,
    zIndex: z.zIndex,
    zoneType: z.zoneType ?? 'MEDIA',
    widgetConfig: z.widgetConfig,
    playlistId: z.playlist?.id,
  }));
}

function WidgetConfigFields({ zone, onChange }: { zone: ZoneInput; onChange: (cfg: Record<string, unknown>) => void }) {
  const cfg = zone.widgetConfig ?? {};
  const t = useTranslations('layouts.widget');
  const ts = useTranslations('screens.prayer.methods');

  switch (zone.zoneType) {
    case 'PRAYER':
      return (
        <div className="col-span-7 grid grid-cols-3 gap-2 bg-amber-50 dark:bg-amber-950/40 rounded p-2 text-xs mt-1">
          <div>
            <label className="text-gray-500 block mb-0.5">{t('methodOverride')}</label>
            <select value={(cfg.method as string) ?? ''} onChange={e => onChange({ ...cfg, method: e.target.value || undefined })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="">{t('inheritFromScreen')}</option>
              {['UmmAlQura', 'Dubai', 'Kuwait', 'Qatar', 'Egyptian', 'MuslimWorldLeague', 'NorthAmerica'].map(m =>
                <option key={m} value={m}>{ts(m)}</option>
              )}
            </select>
          </div>
          <div>
            <label className="text-gray-500 block mb-0.5">{t('language')}</label>
            <select value={(cfg.lang as string) ?? 'en'} onChange={e => onChange({ ...cfg, lang: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabicNative')}</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer self-end">
            <input type="checkbox" checked={!!(cfg.athanEnabled)} onChange={e => onChange({ ...cfg, athanEnabled: e.target.checked })} />
            <span className="text-gray-600">{t('athanAudio')}</span>
          </label>
        </div>
      );
    case 'WEATHER':
      return (
        <div className="col-span-7 grid grid-cols-2 gap-2 bg-sky-50 dark:bg-sky-950/40 rounded p-2 text-xs mt-1">
          <div>
            <label className="text-gray-500 block mb-0.5">{t('language')}</label>
            <select value={(cfg.lang as string) ?? 'en'} onChange={e => onChange({ ...cfg, lang: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabic')}</option>
            </select>
          </div>
          <p className="text-gray-400 self-center">{t('locationInherited')}</p>
        </div>
      );
    case 'CURRENCY':
      return (
        <div className="col-span-7 grid grid-cols-2 gap-2 bg-emerald-50 dark:bg-emerald-950/40 rounded p-2 text-xs mt-1">
          <div>
            <label className="text-gray-500 block mb-0.5">{t('baseCurrency')}</label>
            <select value={(cfg.base as string) ?? 'USD'} onChange={e => onChange({ ...cfg, base: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              {['USD', 'EUR', 'GBP', 'SAR', 'AED'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-gray-500 block mb-0.5">{t('language')}</label>
            <select value={(cfg.lang as string) ?? 'en'} onChange={e => onChange({ ...cfg, lang: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabic')}</option>
            </select>
          </div>
        </div>
      );
    case 'TICKER':
      return (
        <div className="col-span-7 bg-orange-50 dark:bg-orange-950/40 rounded p-2 text-xs mt-1">
          <label className="text-gray-500 block mb-0.5">{t('rssFeedUrl')}</label>
          <input type="url" value={(cfg.feedUrl as string) ?? ''} onChange={e => onChange({ ...cfg, feedUrl: e.target.value })}
            placeholder="https://feeds.bbcnews.com/world/rss.xml"
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400" />
        </div>
      );
    default:
      return null;
  }
}

export default function LayoutsPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canEditContent } = usePermissions();
  const { confirmDelete } = useConfirmBeforeDelete();
  const { enabled: faithEnabled } = useFaithFeatures();
  const logAction = useAuditLog();
  const t = useTranslations('layouts');
  const tc = useTranslations('common');
  const ta = useTranslations('auditLog');
  const { data: layouts = [], isLoading } = useQuery({ queryKey: ['layouts'], queryFn: layoutsApi.list });
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });

  const [editing, setEditing] = useState<Layout | 'new' | null>(null);
  const [name, setName] = useState('');
  const [zones, setZones] = useState<ZoneInput[]>([]);
  const [deleteError, setDeleteError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Live preview canvas size in px — kept in sync with its actual rendered width so the
  // preview can take up most of the page instead of a fixed small box.
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: PREVIEW_W, height: PREVIEW_H });
  // The zone currently being dragged/resized, tracked outside `zones` state so interaction
  // frames don't re-render the settings list below the preview — only committed on drop.
  const [dragBox, setDragBox] = useState<{ index: number } & Box | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () => setPreviewSize({ width: el.clientWidth, height: el.clientWidth * 9 / 16 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing]);

  // Not everyone needs prayer-time widgets — keep the "Mosque" preset and PRAYER zone type
  // out of the way until the org opts in via Settings.
  const visiblePresetKeys = faithEnabled ? PRESET_ZONE_KEYS : PRESET_ZONE_KEYS.filter(k => k !== 'mosque');
  const visibleZoneTypes = faithEnabled ? ZONE_TYPE_VALUES : ZONE_TYPE_VALUES.filter(zt => zt !== 'PRAYER');

  const createMut = useMutation({
    mutationFn: () => layoutsApi.create(name, zones),
    onSuccess: (created) => {
      logAction({
        resourceType: 'LAYOUT', resourceName: created.name, action: 'CREATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['layouts'] });
      setEditing(null);
    },
  });

  const updateMut = useMutation({
    mutationFn: () => layoutsApi.update((editing as Layout).id, name, zones),
    onSuccess: (updated) => {
      logAction({
        resourceType: 'LAYOUT', resourceName: updated.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
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
        resourceType: 'LAYOUT', resourceName: layout.name, action: 'DELETE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
      });
      qc.setQueryData<Layout[]>(['layouts'], (old) => old?.filter(l => l.id !== layout.id));
      void qc.invalidateQueries({ queryKey: ['layouts'] });
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  const renameMut = useMutation({
    mutationFn: ({ layout, name: newName }: { layout: Layout; name: string }) =>
      layoutsApi.update(layout.id, newName, toZoneInputs(layout)),
    onSuccess: (updated, { layout }) => {
      logAction({
        resourceType: 'LAYOUT', resourceName: layout.name, action: 'UPDATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
        detail: ta('detailRenamedTo', { name: updated.name }),
      });
      void qc.invalidateQueries({ queryKey: ['layouts'] });
      setRenamingId(null);
    },
  });

  const duplicateMut = useMutation({
    mutationFn: (layout: Layout) => layoutsApi.create(`${layout.name} (copy)`, toZoneInputs(layout)),
    onSuccess: (created, layout) => {
      logAction({
        resourceType: 'LAYOUT', resourceName: created.name, action: 'CREATE',
        userName: user?.name ?? '', userEmail: user?.email ?? '',
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
    if (!trimmed || trimmed === layout.name) { setRenamingId(null); return; }
    renameMut.mutate({ layout, name: trimmed });
  }

  function openNew() {
    setEditing('new');
    setName('New Layout');
    setZones(PRESET_ZONES.fullscreen);
  }

  function openEdit(layout: Layout) {
    setEditing(layout);
    setName(layout.name);
    setZones(toZoneInputs(layout));
  }

  function updateZone(i: number, patch: Partial<ZoneInput>) {
    setZones(prev => prev.map((z, idx) => idx === i ? { ...z, ...patch } : z));
  }

  const getBoxPx = useCallback((z: ZoneInput): Box => ({
    left: (z.x / 100) * previewSize.width,
    top: (z.y / 100) * previewSize.height,
    width: (z.width / 100) * previewSize.width,
    height: (z.height / 100) * previewSize.height,
  }), [previewSize]);

  const computeTargets = useCallback((excludeIndex: number) => {
    const xs = new Set<number>([0, previewSize.width / 2, previewSize.width]);
    const ys = new Set<number>([0, previewSize.height / 2, previewSize.height]);
    zones.forEach((z, idx) => {
      if (idx === excludeIndex) return;
      const b = getBoxPx(z);
      xs.add(b.left); xs.add(b.left + b.width / 2); xs.add(b.left + b.width);
      ys.add(b.top); ys.add(b.top + b.height / 2); ys.add(b.top + b.height);
    });
    return { xs: [...xs], ys: [...ys] };
  }, [zones, previewSize, getBoxPx]);

  const clampBox = useCallback((box: Box): Box => {
    const width = Math.min(box.width, previewSize.width);
    const height = Math.min(box.height, previewSize.height);
    return {
      width, height,
      left: Math.min(Math.max(box.left, 0), previewSize.width - width),
      top: Math.min(Math.max(box.top, 0), previewSize.height - height),
    };
  }, [previewSize]);

  function handleDrag(i: number, x: number, y: number) {
    const z = zones[i];
    if (!z) return;
    const box = getBoxPx(z);
    const { xs, ys } = computeTargets(i);
    const snapX = snapDragAxis(x, box.width, xs);
    const snapY = snapDragAxis(y, box.height, ys);
    const next = clampBox({ left: snapX.pos, top: snapY.pos, width: box.width, height: box.height });
    setDragBox({ index: i, ...next });
    setGuides({ v: snapX.guide !== null ? [snapX.guide] : [], h: snapY.guide !== null ? [snapY.guide] : [] });
  }

  function handleDragStop(i: number, x: number, y: number) {
    const z = zones[i];
    if (!z) return;
    const box = getBoxPx(z);
    const { xs, ys } = computeTargets(i);
    const snapX = snapDragAxis(x, box.width, xs);
    const snapY = snapDragAxis(y, box.height, ys);
    const next = clampBox({ left: snapX.pos, top: snapY.pos, width: box.width, height: box.height });
    updateZone(i, {
      x: clampPct(next.left / previewSize.width * 100),
      y: clampPct(next.top / previewSize.height * 100),
    });
    setDragBox(null);
    setGuides({ v: [], h: [] });
  }

  function resolveResize(i: number, direction: string, box: Box): Box {
    const { xs, ys } = computeTargets(i);
    let { left, top, width, height } = box;
    let right = left + width, bottom = top + height;
    const vGuides: number[] = [];
    const hGuides: number[] = [];

    if (/right/i.test(direction)) {
      const s = snapEdge(right, xs);
      if (s.guide !== null) { right = s.value; vGuides.push(s.guide); }
    }
    if (/left/i.test(direction)) {
      const s = snapEdge(left, xs);
      if (s.guide !== null) { left = s.value; vGuides.push(s.guide); }
    }
    if (/bottom/i.test(direction)) {
      const s = snapEdge(bottom, ys);
      if (s.guide !== null) { bottom = s.value; hGuides.push(s.guide); }
    }
    if (/top/i.test(direction)) {
      const s = snapEdge(top, ys);
      if (s.guide !== null) { top = s.value; hGuides.push(s.guide); }
    }

    width = Math.max(MIN_ZONE_PX, right - left);
    height = Math.max(MIN_ZONE_PX, bottom - top);
    const next = clampBox({ left, top, width, height });
    setGuides({ v: vGuides, h: hGuides });
    return next;
  }

  function handleResize(i: number, direction: string, ref: HTMLElement, position: { x: number; y: number }) {
    const box: Box = { left: position.x, top: position.y, width: parseFloat(ref.style.width), height: parseFloat(ref.style.height) };
    const next = resolveResize(i, direction, box);
    setDragBox({ index: i, ...next });
  }

  function handleResizeStop(i: number, direction: string, ref: HTMLElement, position: { x: number; y: number }) {
    const box: Box = { left: position.x, top: position.y, width: parseFloat(ref.style.width), height: parseFloat(ref.style.height) };
    const next = resolveResize(i, direction, box);
    updateZone(i, {
      x: clampPct(next.left / previewSize.width * 100),
      y: clampPct(next.top / previewSize.height * 100),
      width: clampPct(next.width / previewSize.width * 100),
      height: clampPct(next.height / previewSize.height * 100),
    });
    setDragBox(null);
    setGuides({ v: [], h: [] });
  }

  const saving = createMut.isPending || updateMut.isPending;

  return (
    <div className="p-8 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        {canEditContent && (
          <button onClick={openNew}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> {t('newLayout')}
          </button>
        )}
      </div>

      {/* Editor panel */}
      {editing && canEditContent && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 mb-8 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <input value={name} onChange={e => setName(e.target.value)}
              className="text-lg font-semibold text-gray-900 dark:text-gray-100 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-indigo-500 focus:outline-none bg-transparent w-64"
              placeholder={t('layoutName')} />
            <div className="flex gap-2 flex-wrap">
              {visiblePresetKeys.map(preset => (
                <button key={preset} onClick={() => setZones(PRESET_ZONES[preset])}
                  className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800">
                  {t(`presets.${preset}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Visual preview, full-width, with zone settings stacked below */}
          <div className="flex flex-col gap-6">
            {/* Screen preview — drag to move, drag the edges/corners to resize, like resizing a window.
                Pink guide lines snap moving edges/centers to other zones and the canvas bounds. */}
            <div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t('preview')}</div>
              <div ref={previewRef} style={{ width: '100%', aspectRatio: '16 / 9', background: '#111', position: 'relative', borderRadius: 6, overflow: 'hidden' }}>
                {previewSize.width > 0 && zones.map((z, i) => {
                  const box = dragBox && dragBox.index === i ? dragBox : getBoxPx(z);
                  return (
                    <Rnd
                      key={i}
                      bounds="parent"
                      minWidth={MIN_ZONE_PX}
                      minHeight={MIN_ZONE_PX}
                      size={{ width: box.width, height: box.height }}
                      position={{ x: box.left, y: box.top }}
                      onDrag={(_e, d) => handleDrag(i, d.x, d.y)}
                      onDragStop={(_e, d) => handleDragStop(i, d.x, d.y)}
                      onResize={(_e, dir, ref, _delta, position) => handleResize(i, dir, ref, position)}
                      onResizeStop={(_e, dir, ref, _delta, position) => handleResizeStop(i, dir, ref, position)}
                      style={{
                        background: ZONE_COLORS[i % ZONE_COLORS.length] + '55',
                        border: `2px solid ${ZONE_COLORS[i % ZONE_COLORS.length]}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexDirection: 'column', gap: 2,
                      }}>
                      <span style={{ fontSize: 11, color: '#fff', fontWeight: 600, textAlign: 'center' }}>{z.name}</span>
                      <span style={{ opacity: 0.7, fontSize: 10, color: '#fff' }}>{t(`zoneTypes.${z.zoneType ?? 'MEDIA'}`)}</span>
                    </Rnd>
                  );
                })}
                {guides.v.map((x, idx) => (
                  <div key={`v-${idx}`} style={{ position: 'absolute', left: x, top: 0, width: 0, height: '100%', borderLeft: '1px solid #ec4899', pointerEvents: 'none', zIndex: 50 }} />
                ))}
                {guides.h.map((y, idx) => (
                  <div key={`h-${idx}`} style={{ position: 'absolute', top: y, left: 0, height: 0, width: '100%', borderTop: '1px solid #ec4899', pointerEvents: 'none', zIndex: 50 }} />
                ))}
              </div>
            </div>

            {/* Zone list */}
            <div className="max-w-4xl space-y-3">
              <div className="grid grid-cols-7 gap-2 text-[10px] text-gray-400 dark:text-gray-500 px-0.5">
                <span />
                <span className="col-span-2">{tc('name')}</span>
                <span title={t('zoneXTitle')}>{t('zoneX')}</span>
                <span title={t('zoneYTitle')}>{t('zoneY')}</span>
                <span title={t('zoneWidthTitle')}>{t('zoneWidth')}</span>
                <span title={t('zoneHeightTitle')}>{t('zoneHeight')}</span>
              </div>
              {zones.map((z, i) => (
                <div key={i} className="space-y-1">
                  <div className="grid grid-cols-7 gap-2 items-center text-xs">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }} />
                    <input value={z.name} onChange={e => updateZone(i, { name: e.target.value })}
                      className="col-span-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder={tc('name')} />
                    {(['x', 'y', 'width', 'height'] as const).map(field => (
                      <input key={field} type="number" min={0} max={100}
                        value={z[field]} onChange={e => updateZone(i, { [field]: parseFloat(e.target.value) })}
                        className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        title={field} />
                    ))}
                    {/* Zone type */}
                    <select value={z.zoneType ?? 'MEDIA'} onChange={e => updateZone(i, { zoneType: e.target.value as ZoneType, widgetConfig: {} })}
                      className="col-span-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                      {/* Keep an existing PRAYER zone's own option visible even with the feature
                          off, so its <select> doesn't silently show a value with no matching
                          option — but don't offer PRAYER for zones that aren't already that type. */}
                      {(visibleZoneTypes.includes(z.zoneType ?? 'MEDIA') ? visibleZoneTypes : [...visibleZoneTypes, z.zoneType ?? 'MEDIA']).map(zt => (
                        <option key={zt} value={zt}>{t(`zoneTypes.${zt}`)}</option>
                      ))}
                    </select>
                    {/* Playlist (only for MEDIA) */}
                    {(z.zoneType ?? 'MEDIA') === 'MEDIA' ? (
                      <select value={z.playlistId ?? ''} onChange={e => updateZone(i, { playlistId: e.target.value || undefined })}
                        className="col-span-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                        <option value="">{t('noPlaylist')}</option>
                        {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    ) : (
                      <div className="col-span-2" />
                    )}
                    <button onClick={() => setZones(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-400 dark:text-gray-500 hover:text-red-500"><X className="w-3 h-3" /></button>
                  </div>
                  {/* Widget-specific config */}
                  {z.zoneType && z.zoneType !== 'MEDIA' && (
                    <WidgetConfigFields
                      zone={z}
                      onChange={cfg => updateZone(i, { widgetConfig: cfg })}
                    />
                  )}
                </div>
              ))}
              <button onClick={() => setZones(prev => [...prev, { name: `Zone ${prev.length + 1}`, x: 0, y: 0, width: 50, height: 50, zoneType: 'MEDIA' }])}
                className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                <Plus className="w-3 h-3" /> {t('addZone')}
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
            <button onClick={() => setEditing(null)}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
              {tc('cancel')}
            </button>
            <button onClick={() => editing === 'new' ? createMut.mutate() : updateMut.mutate()}
              disabled={!name.trim() || zones.length === 0 || saving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              <Check className="w-4 h-4" /> {saving ? t('saving') : t('saveLayout')}
            </button>
          </div>
        </div>
      )}

      {deleteError && <div className="mb-4 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-sm px-4 py-2 rounded-lg">{deleteError}</div>}

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && layouts.length === 0 && !editing && (
        <div className="text-center py-16 text-gray-400">
          <LayoutTemplate className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {layouts.map((layout: Layout) => {
          const isEditingThis = editing !== null && editing !== 'new' && editing.id === layout.id;
          return (
          <div key={layout.id} className={`bg-white dark:bg-gray-900 rounded-xl border p-4 ${isEditingThis ? 'border-indigo-400 dark:border-indigo-500 ring-2 ring-indigo-100 dark:ring-indigo-900/50' : 'border-gray-200 dark:border-gray-800'}`}>
            <div className="flex items-center justify-between mb-3 gap-2">
              {isEditingThis && (
                <span className="flex items-center gap-1 shrink-0 text-[10px] font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-1.5 py-0.5 rounded">
                  <Pencil className="w-2.5 h-2.5" /> {t('currentlyEditing')}
                </span>
              )}
              {renamingId === layout.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={e => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(layout)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitRename(layout);
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  disabled={renameMut.isPending}
                  className="font-medium text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-800 border border-indigo-300 dark:border-indigo-700 rounded px-1 -mx-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              ) : (
                <span
                  onClick={() => startRename(layout)}
                  title={canEditContent ? tc('clickToRename') : undefined}
                  className={`font-medium text-gray-900 dark:text-gray-100 text-sm truncate ${canEditContent ? 'cursor-text hover:text-indigo-600 dark:hover:text-indigo-400' : ''}`}>
                  {layout.name}
                </span>
              )}
              {canEditContent && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => duplicateMut.mutate(layout)} disabled={duplicateMut.isPending}
                    title={t('duplicate')} className="p-1 text-gray-400 dark:text-gray-500 hover:text-indigo-600 disabled:opacity-50"><Copy className="w-3.5 h-3.5" /></button>
                  <button onClick={() => { if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(layout); }}
                    className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              )}
            </div>

            {/* Mini preview — click to edit */}
            <button
              onClick={() => canEditContent && openEdit(layout)}
              disabled={!canEditContent}
              title={canEditContent ? t('clickToEdit') : undefined}
              className="group relative w-full block disabled:cursor-default"
              style={{ aspectRatio: '16/9', background: '#111', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
              {layout.zones.map((z, i) => (
                <div key={z.id} style={{
                  position: 'absolute',
                  left: `${z.x}%`, top: `${z.y}%`,
                  width: `${z.width}%`, height: `${z.height}%`,
                  background: ZONE_COLORS[i % ZONE_COLORS.length] + '66',
                  border: `1px solid ${ZONE_COLORS[i % ZONE_COLORS.length]}`,
                }} />
              ))}
              {canEditContent && (
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                  <span className="flex items-center gap-1.5 text-white text-xs font-medium">
                    <Pencil className="w-3.5 h-3.5" /> {t('editLayout')}
                  </span>
                </div>
              )}
            </button>

            <div className="space-y-1">
              {layout.zones.map((z, i) => {
                const zt = z.zoneType ?? 'MEDIA';
                return (
                  <div key={z.id} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }} />
                    <span className="font-medium text-gray-700 dark:text-gray-300">{z.name}</span>
                    <span className={`px-1 py-0.5 rounded text-[10px] font-medium ${ZONE_TYPE_BADGE[zt]}`}>{t(`zoneTypes.${zt}`)}</span>
                    {zt === 'MEDIA' && (
                      <>
                        <span className="text-gray-400 dark:text-gray-500">→</span>
                        <span>{z.playlist?.name ?? <em className="text-gray-300 dark:text-gray-500">{t('noPlaylistBadge')}</em>}</span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {layout._count && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{t('screenCount', { count: layout._count.screens })}</p>
            )}
          </div>
          );
        })}
      </div>
    </div>
  );
}
