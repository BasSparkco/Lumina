'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { Rnd } from 'react-rnd';
import { Palette, Plus, Trash2, Pencil, X, Check, Copy, Sparkles, RotateCw } from 'lucide-react';
import {
  themesApi, playlistsApi,
  type Theme, type ThemeInput, type ThemeElement, type ThemeElementKind, type ThemeElementStyle,
  type ThemeCategory, type ThemePalette, type ThemeTypography, type ThemeWidgetType,
} from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useAuth } from '@/context/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { AssetPicker } from '@/components/AssetPicker';
import { FontPicker, fontStack } from '@/components/FontPicker';
import { DEFAULT_FONT_ID } from '@lumina/types';

const PREVIEW_W = 640;
const PREVIEW_H = 360;
// Grid thumbnails scale text relative to this reference width rather than PREVIEW_W (the
// editor canvas), since thumbnail cards render much narrower than the full editor.
const CARD_SCALE_W = 400;

const clampPct = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));

const CATEGORY_VALUES: ThemeCategory[] = ['RESTAURANT_MENU', 'RETAIL_PROMO', 'HOTEL_LOBBY', 'CLINIC_WAITING', 'MOSQUE', 'GENERIC'];
const ASPECT_RATIOS = ['16:9', '9:16', '4:3', '1:1'] as const;
const ELEMENT_KIND_VALUES: ThemeElementKind[] = ['TEXT', 'IMAGE', 'VIDEO', 'PLAYLIST', 'SHAPE', 'WIDGET'];
const WIDGET_TYPE_VALUES: ThemeWidgetType[] = ['PRAYER', 'WEATHER', 'CURRENCY', 'TICKER'];
const PALETTE_ROLES: (keyof ThemePalette)[] = ['primary', 'secondary', 'background', 'surface', 'text', 'textMuted', 'accent'];
const PRAYER_METHOD_VALUES = ['UmmAlQura', 'Dubai', 'Kuwait', 'Qatar', 'Egyptian', 'MuslimWorldLeague', 'NorthAmerica'];

const KIND_COLORS: Record<ThemeElementKind, string> = {
  TEXT: '#6366f1', IMAGE: '#0ea5e9', VIDEO: '#8b5cf6', PLAYLIST: '#10b981', SHAPE: '#64748b', WIDGET: '#f59e0b',
};

const SNAP_PX = 6;
// Rotation drag snaps to the nearest 15° once within this many degrees — mirrors the
// position/resize edge-snapping below, so square/45°/diagonal placements are easy to hit exactly.
const SNAP_DEG = 4;
interface Rect { x: number; y: number; width: number; height: number }

// Figma-style smart guides: snaps the active element's edges/center onto any other element's
// (or the canvas's own) edges/center once within SNAP_PX, and reports where to draw the guide
// lines. Resize anchors the drag origin (top-left) and only snaps the growing right/bottom edge.
function computeSnap(rect: Rect, activeId: string, elements: ThemeElement[], canvasW: number, canvasH: number, mode: 'drag' | 'resize'): { rect: Rect; guides: { v: number[]; h: number[] } } {
  const targets = elements
    .filter(e => e.id !== activeId)
    .map(e => ({
      left: (e.x / 100) * canvasW,
      right: ((e.x + e.width) / 100) * canvasW,
      centerX: ((e.x + e.width / 2) / 100) * canvasW,
      top: (e.y / 100) * canvasH,
      bottom: ((e.y + e.height) / 100) * canvasH,
      centerY: ((e.y + e.height / 2) / 100) * canvasH,
    }));
  targets.push({ left: 0, right: canvasW, centerX: canvasW / 2, top: 0, bottom: canvasH, centerY: canvasH / 2 });

  let { x, y, width, height } = rect;
  const vGuides = new Set<number>();
  const hGuides = new Set<number>();

  if (mode === 'drag') {
    const left = x, right = x + width, centerX = x + width / 2;
    for (const t of targets) {
      for (const tv of [t.left, t.centerX, t.right]) {
        if (Math.abs(left - tv) <= SNAP_PX) { x = tv; vGuides.add(tv); }
        else if (Math.abs(centerX - tv) <= SNAP_PX) { x = tv - width / 2; vGuides.add(tv); }
        else if (Math.abs(right - tv) <= SNAP_PX) { x = tv - width; vGuides.add(tv); }
      }
    }
    const top = y, bottom = y + height, centerY = y + height / 2;
    for (const t of targets) {
      for (const tv of [t.top, t.centerY, t.bottom]) {
        if (Math.abs(top - tv) <= SNAP_PX) { y = tv; hGuides.add(tv); }
        else if (Math.abs(centerY - tv) <= SNAP_PX) { y = tv - height / 2; hGuides.add(tv); }
        else if (Math.abs(bottom - tv) <= SNAP_PX) { y = tv - height; hGuides.add(tv); }
      }
    }
  } else {
    const right = x + width;
    for (const t of targets) {
      for (const tv of [t.left, t.centerX, t.right]) {
        if (Math.abs(right - tv) <= SNAP_PX) { width = tv - x; vGuides.add(tv); }
      }
    }
    const bottom = y + height;
    for (const t of targets) {
      for (const tv of [t.top, t.centerY, t.bottom]) {
        if (Math.abs(bottom - tv) <= SNAP_PX) { height = tv - y; hGuides.add(tv); }
      }
    }
  }

  return { rect: { x, y, width, height }, guides: { v: [...vGuides], h: [...hGuides] } };
}

function resolveColor(value: string | undefined, palette: ThemePalette): string | undefined {
  if (!value) return undefined;
  if (value.startsWith('palette.')) return palette[value.slice(8) as keyof ThemePalette] ?? value;
  return value;
}

function defaultPalette(): ThemePalette {
  return { primary: '#6366f1', secondary: '#111827', background: '#0f172a', surface: '#1e293b', text: '#f8fafc', textMuted: '#94a3b8', accent: '#f59e0b' };
}
function defaultTypography(): ThemeTypography {
  return { headingFont: DEFAULT_FONT_ID, bodyFont: DEFAULT_FONT_ID, baseSizePx: 16, scale: 1.25 };
}
function defaultContentForKind(kind: ThemeElementKind): ThemeElement['content'] {
  switch (kind) {
    case 'TEXT': return { text: 'New text' };
    case 'IMAGE': return { assetId: null };
    case 'VIDEO': return { assetId: null };
    case 'PLAYLIST': return { playlistId: null };
    case 'SHAPE': return {};
    case 'WIDGET': return { widgetType: 'PRAYER', widgetConfig: {} };
  }
}
function newElementId() { return `el_${Math.random().toString(36).slice(2, 9)}`; }
function blankTheme(): ThemeInput {
  return {
    name: 'New Theme',
    category: 'GENERIC',
    aspectRatio: '16:9',
    palette: defaultPalette(),
    typography: defaultTypography(),
    elements: [
      { id: 'bg', kind: 'SHAPE', x: 0, y: 0, width: 100, height: 100, zIndex: 0, rotation: 0, editable: false, style: { backgroundColor: 'palette.background' }, content: {} },
      { id: newElementId(), kind: 'TEXT', x: 5, y: 8, width: 60, height: 15, zIndex: 1, rotation: 0, editable: true, label: 'Title', style: { fontFamily: 'heading', fontSizePx: 36, fontWeight: 700, color: 'palette.text' }, content: { text: 'New Theme' } },
    ],
  };
}
function themeToInput(theme: Theme): ThemeInput {
  return { name: theme.name, category: theme.category, aspectRatio: theme.aspectRatio, palette: theme.palette, typography: theme.typography, elements: theme.elements };
}

function CopyHexButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={e => {
        e.preventDefault();
        e.stopPropagation();
        void (async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            // clipboard API unavailable (e.g. insecure context) — nothing more we can do
          }
        })();
      }}
      title={copied ? 'Copied!' : `Copy ${value}`}
      className="shrink-0 p-1 text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400">
      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string | undefined; onChange: (v: string | undefined) => void }) {
  const isPaletteRef = value?.startsWith('palette.') ?? false;
  return (
    <div>
      <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{label}</label>
      <div className="flex gap-1 items-center">
        <select
          value={isPaletteRef ? value!.slice(8) : (value ? 'custom' : '')}
          onChange={e => {
            const v = e.target.value;
            if (!v) onChange(undefined);
            else if (v === 'custom') onChange(value && !isPaletteRef ? value : '#000000');
            else onChange(`palette.${v}`);
          }}
          className="flex-1 min-w-0 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none">
          <option value="">—</option>
          {PALETTE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          <option value="custom">Custom…</option>
        </select>
        {!isPaletteRef && value && (
          <>
            <input type="color" value={value} onChange={e => onChange(e.target.value)} className="w-7 h-7 shrink-0 border border-gray-200 dark:border-gray-700 rounded cursor-pointer" />
            <span className="text-[9px] font-mono text-gray-400 dark:text-gray-500 shrink-0">{value}</span>
            <CopyHexButton value={value} />
          </>
        )}
      </div>
    </div>
  );
}

function WidgetConfigFields({ widgetType, config, onChange }: { widgetType: ThemeWidgetType; config: Record<string, unknown>; onChange: (cfg: Record<string, unknown>) => void }) {
  const t = useTranslations('layouts.widget');
  const ts = useTranslations('screens.prayer.methods');
  switch (widgetType) {
    case 'PRAYER':
      return (
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div>
            <label className="text-gray-400 block mb-0.5">{t('methodOverride')}</label>
            <select value={(config.method as string) ?? ''} onChange={e => onChange({ ...config, method: e.target.value || undefined })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="">{t('inheritFromScreen')}</option>
              {PRAYER_METHOD_VALUES.map(m => <option key={m} value={m}>{ts(m)}</option>)}
            </select>
          </div>
          <div>
            <label className="text-gray-400 block mb-0.5">{t('language')}</label>
            <select value={(config.lang as string) ?? 'en'} onChange={e => onChange({ ...config, lang: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabicNative')}</option>
            </select>
          </div>
          <label className="flex items-center gap-1.5 col-span-2 cursor-pointer">
            <input type="checkbox" checked={!!config.athanEnabled} onChange={e => onChange({ ...config, athanEnabled: e.target.checked })} />
            <span className="text-gray-500 dark:text-gray-400">{t('athanAudio')}</span>
          </label>
        </div>
      );
    case 'WEATHER':
      return (
        <div className="text-[10px]">
          <label className="text-gray-400 block mb-0.5">{t('language')}</label>
          <select value={(config.lang as string) ?? 'en'} onChange={e => onChange({ ...config, lang: e.target.value })}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
            <option value="en">{t('english')}</option>
            <option value="ar">{t('arabic')}</option>
          </select>
        </div>
      );
    case 'CURRENCY':
      return (
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <div>
            <label className="text-gray-400 block mb-0.5">{t('baseCurrency')}</label>
            <select value={(config.base as string) ?? 'USD'} onChange={e => onChange({ ...config, base: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              {['USD', 'EUR', 'GBP', 'SAR', 'AED'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-gray-400 block mb-0.5">{t('language')}</label>
            <select value={(config.lang as string) ?? 'en'} onChange={e => onChange({ ...config, lang: e.target.value })}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none">
              <option value="en">{t('english')}</option>
              <option value="ar">{t('arabic')}</option>
            </select>
          </div>
        </div>
      );
    case 'TICKER':
      return (
        <div className="text-[10px]">
          <label className="text-gray-400 block mb-0.5">{t('rssFeedUrl')}</label>
          <input type="url" value={(config.feedUrl as string) ?? ''} onChange={e => onChange({ ...config, feedUrl: e.target.value })}
            placeholder="https://feeds.bbcnews.com/world/rss.xml"
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none" />
        </div>
      );
  }
}

export default function ThemesPage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { canEditContent } = usePermissions();
  const { confirmDelete } = useConfirmBeforeDelete();
  const logAction = useAuditLog();
  const t = useTranslations('themes');
  const tc = useTranslations('common');
  const ta = useTranslations('auditLog');

  const { data: themes = [], isLoading } = useQuery({ queryKey: ['themes'], queryFn: themesApi.list });
  const { data: playlists = [] } = useQuery({ queryKey: ['playlists'], queryFn: playlistsApi.list });

  const presets = themes.filter(th => th.organizationId === null);
  const ownThemes = themes.filter(th => th.organizationId !== null);

  const [editing, setEditing] = useState<Theme | 'new' | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ThemeCategory>('GENERIC');
  const [aspectRatio, setAspectRatio] = useState<string>('16:9');
  const [palette, setPalette] = useState<ThemePalette>(defaultPalette());
  const [typography, setTypography] = useState<ThemeTypography>(defaultTypography());
  const [elements, setElements] = useState<ThemeElement[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [dragRect, setDragRect] = useState<(Rect & { id: string }) | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [rotationDrag, setRotationDrag] = useState<{ id: string; deg: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [deleteError, setDeleteError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  function openNew() {
    const blank = blankTheme();
    setEditing('new');
    setName(blank.name);
    setCategory(blank.category);
    setAspectRatio(blank.aspectRatio ?? '16:9');
    setPalette(blank.palette);
    setTypography(blank.typography);
    setElements(blank.elements);
    setSelectedElementId(null);
  }
  function openEdit(theme: Theme) {
    setEditing(theme);
    setName(theme.name);
    setCategory(theme.category);
    setAspectRatio(theme.aspectRatio);
    setPalette(theme.palette);
    setTypography(theme.typography);
    setElements(theme.elements);
    setSelectedElementId(null);
  }

  const createMut = useMutation({
    mutationFn: () => themesApi.create({ name, category, aspectRatio, palette, typography, elements }),
    onSuccess: (created) => {
      logAction({ resourceType: 'THEME', resourceName: created.name, action: 'CREATE', userName: user?.name ?? '', userEmail: user?.email ?? '' });
      void qc.invalidateQueries({ queryKey: ['themes'] });
      setEditing(null);
    },
  });
  const updateMut = useMutation({
    mutationFn: () => themesApi.update((editing as Theme).id, { name, category, aspectRatio, palette, typography, elements }),
    onSuccess: (updated) => {
      logAction({ resourceType: 'THEME', resourceName: updated.name, action: 'UPDATE', userName: user?.name ?? '', userEmail: user?.email ?? '' });
      void qc.invalidateQueries({ queryKey: ['themes'] });
      setEditing(null);
    },
  });
  const removeMut = useMutation({
    mutationFn: (theme: Theme) => themesApi.remove(theme.id),
    onSuccess: (_data, theme) => {
      setDeleteError('');
      logAction({ resourceType: 'THEME', resourceName: theme.name, action: 'DELETE', userName: user?.name ?? '', userEmail: user?.email ?? '' });
      qc.setQueryData<Theme[]>(['themes'], old => old?.filter(th => th.id !== theme.id));
      void qc.invalidateQueries({ queryKey: ['themes'] });
    },
    onError: (e: Error) => setDeleteError(e.message),
  });
  const renameMut = useMutation({
    mutationFn: ({ theme, name: newName }: { theme: Theme; name: string }) => themesApi.update(theme.id, { ...themeToInput(theme), name: newName }),
    onSuccess: (updated, { theme }) => {
      logAction({ resourceType: 'THEME', resourceName: theme.name, action: 'UPDATE', userName: user?.name ?? '', userEmail: user?.email ?? '', detail: ta('detailRenamedTo', { name: updated.name }) });
      void qc.invalidateQueries({ queryKey: ['themes'] });
      setRenamingId(null);
    },
  });
  const duplicateMut = useMutation({
    mutationFn: (theme: Theme) => themesApi.duplicate(theme.id),
    onSuccess: (created, theme) => {
      logAction({ resourceType: 'THEME', resourceName: created.name, action: 'CREATE', userName: user?.name ?? '', userEmail: user?.email ?? '', detail: ta('detailDuplicatedFrom', { name: theme.name }) });
      void qc.invalidateQueries({ queryKey: ['themes'] });
      return created;
    },
    onError: (e: Error) => setDeleteError(e.message),
  });

  function applyPreset(theme: Theme) {
    // Local-only clone — no DB write happens until the user explicitly hits Save (createMut,
    // since editing === 'new'). Previously this called duplicateMut immediately, which
    // persisted a copy the moment "Customize" was clicked, so Cancel left an orphaned row.
    setEditing('new');
    setName(`${theme.name} (copy)`);
    setCategory(theme.category);
    setAspectRatio(theme.aspectRatio);
    setPalette({ ...theme.palette });
    setTypography({ ...theme.typography });
    setElements(theme.elements.map(el => ({ ...el })));
    setSelectedElementId(null);
  }

  function startRename(theme: Theme) {
    if (!canEditContent) return;
    setRenamingId(theme.id);
    setRenameValue(theme.name);
  }
  function commitRename(theme: Theme) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === theme.name) { setRenamingId(null); return; }
    renameMut.mutate({ theme, name: trimmed });
  }

  function updateElement(id: string, patch: Partial<Pick<ThemeElement, 'x' | 'y' | 'width' | 'height' | 'zIndex' | 'rotation' | 'label' | 'editable'>>) {
    setElements(prev => prev.map(el => (el.id === id ? { ...el, ...patch } : el)));
  }
  function updateElementKind(id: string, kind: ThemeElementKind) {
    setElements(prev => prev.map(el => (el.id === id ? ({ ...el, kind, content: defaultContentForKind(kind) } as ThemeElement) : el)));
  }
  function updateElementContent(id: string, patch: Record<string, unknown>) {
    setElements(prev => prev.map(el => (el.id === id ? ({ ...el, content: { ...el.content, ...patch } } as ThemeElement) : el)));
  }
  function updateElementStyle(id: string, patch: ThemeElementStyle) {
    setElements(prev => prev.map(el => (el.id === id ? { ...el, style: { ...el.style, ...patch } } : el)));
  }
  // Drag-to-rotate: the handle sits above the element's (unrotated) top-center. While dragging,
  // the element's rotation tracks the angle from its own center to the mouse, measured in the
  // canvas's own coordinate space so it works regardless of page scroll/zoom.
  function startRotate(e: React.MouseEvent, el: ThemeElement) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedElementId(el.id);
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const cx = (el.x + el.width / 2) / 100 * PREVIEW_W;
    const cy = (el.y + el.height / 2) / 100 * PREVIEW_H;

    function angleFor(clientX: number, clientY: number): number {
      const mx = clientX - canvasRect.left;
      const my = clientY - canvasRect.top;
      let deg = Math.atan2(my - cy, mx - cx) * (180 / Math.PI) + 90;
      deg = ((deg % 360) + 360) % 360;
      const nearest15 = Math.round(deg / 15) * 15;
      if (Math.abs(deg - nearest15) <= SNAP_DEG) deg = nearest15 % 360;
      return Math.round(deg);
    }

    function onMove(ev: MouseEvent) {
      setRotationDrag({ id: el.id, deg: angleFor(ev.clientX, ev.clientY) });
    }
    function onUp(ev: MouseEvent) {
      updateElement(el.id, { rotation: angleFor(ev.clientX, ev.clientY) });
      setRotationDrag(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function addElement() {
    setElements(prev => [...prev, { id: newElementId(), kind: 'TEXT', x: 20, y: 20, width: 40, height: 15, zIndex: prev.length, rotation: 0, editable: true, style: { color: 'palette.text' }, content: { text: 'New text' } }]);
  }
  function removeElement(id: string) {
    setElements(prev => prev.filter(el => el.id !== id));
  }

  const saving = createMut.isPending || updateMut.isPending;

  function renderPreviewElements(els: ThemeElement[], pal: ThemePalette, scaleW: number) {
    return [...els].sort((a, b) => a.zIndex - b.zIndex).map(el => {
      const bg = el.kind === 'SHAPE' ? (resolveColor(el.style.backgroundColor, pal) ?? KIND_COLORS.SHAPE + '55') : KIND_COLORS[el.kind] + '33';
      const border = KIND_COLORS[el.kind];
      return (
        <div key={el.id} style={{
          position: 'absolute', left: `${el.x}%`, top: `${el.y}%`, width: `${el.width}%`, height: `${el.height}%`,
          background: bg, border: `1px solid ${border}`, borderRadius: el.style.borderRadius, overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 2,
          transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        }}>
          {el.kind === 'TEXT' && (
            <span style={{
              fontSize: Math.max(6, Math.min(el.style.fontSizePx ?? 16, 40) * (scaleW / 400)),
              fontWeight: el.style.fontWeight as number | undefined,
              fontFamily: el.style.fontFamily === 'heading' || el.style.fontFamily === 'body' ? undefined : fontStack(el.style.fontFamily),
              color: resolveColor(el.style.color, pal) ?? pal.text,
              textAlign: el.style.textAlign ?? 'left',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%',
            }}>{el.content.text}</span>
          )}
          {el.kind !== 'TEXT' && el.kind !== 'SHAPE' && (
            <span style={{ fontSize: 8, color: border, fontWeight: 600, textAlign: 'center' }}>{el.label ?? el.kind}</span>
          )}
        </div>
      );
    });
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t('subtitle')}</p>
        </div>
        {canEditContent && !editing && (
          <button onClick={openNew}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
            <Plus className="w-4 h-4" /> {t('newTheme')}
          </button>
        )}
      </div>

      {/* Editor panel */}
      {editing && canEditContent && (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-6 mb-8 shadow-sm">
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <input value={name} onChange={e => setName(e.target.value)}
              className="text-lg font-semibold text-gray-900 dark:text-gray-100 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-indigo-500 focus:outline-none bg-transparent w-64"
              placeholder={t('themeName')} />
            <div className="flex gap-2 flex-wrap items-center">
              <select value={category} onChange={e => setCategory(e.target.value as ThemeCategory)}
                className="text-xs border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1.5 focus:outline-none">
                {CATEGORY_VALUES.map(c => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
              </select>
              <select value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}
                className="text-xs border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1.5 focus:outline-none">
                {ASPECT_RATIOS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-6 flex-wrap lg:flex-nowrap">
            {/* Left: canvas + palette + typography */}
            <div className="shrink-0 space-y-4" style={{ width: PREVIEW_W }}>
              <div>
                <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t('preview')}</div>
                <div
                  ref={canvasRef}
                  onMouseDown={e => { if (e.target === e.currentTarget) setSelectedElementId(null); }}
                  style={{ width: PREVIEW_W, height: PREVIEW_H, background: palette.background, position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(0,0,0,0.1)' }}>
                  {elements.map((el) => {
                    const isSelected = el.id === selectedElementId;
                    const rect = dragRect && dragRect.id === el.id
                      ? dragRect
                      : { x: (el.x / 100) * PREVIEW_W, y: (el.y / 100) * PREVIEW_H, width: (el.width / 100) * PREVIEW_W, height: (el.height / 100) * PREVIEW_H };
                    const liveRotation = rotationDrag && rotationDrag.id === el.id ? rotationDrag.deg : el.rotation;
                    return (
                      <Rnd
                        key={el.id}
                        bounds="parent"
                        minWidth={16}
                        minHeight={16}
                        disableDragging={!isSelected}
                        enableResizing={isSelected ? undefined : false}
                        cancel=".rotate-handle"
                        size={{ width: rect.width, height: rect.height }}
                        position={{ x: rect.x, y: rect.y }}
                        onMouseDown={() => setSelectedElementId(el.id)}
                        onDragStart={() => setSelectedElementId(el.id)}
                        onDrag={(_e, d) => {
                          const snapped = computeSnap({ x: d.x, y: d.y, width: rect.width, height: rect.height }, el.id, elements, PREVIEW_W, PREVIEW_H, 'drag');
                          setDragRect({ id: el.id, ...snapped.rect });
                          setGuides(snapped.guides);
                        }}
                        onDragStop={(_e, d) => {
                          const snapped = computeSnap({ x: d.x, y: d.y, width: rect.width, height: rect.height }, el.id, elements, PREVIEW_W, PREVIEW_H, 'drag');
                          updateElement(el.id, { x: clampPct(snapped.rect.x / PREVIEW_W * 100), y: clampPct(snapped.rect.y / PREVIEW_H * 100) });
                          setDragRect(null);
                          setGuides({ v: [], h: [] });
                        }}
                        onResize={(_e, _dir, ref, _delta, position) => {
                          const w = parseFloat(ref.style.width);
                          const h = parseFloat(ref.style.height);
                          const snapped = computeSnap({ x: position.x, y: position.y, width: w, height: h }, el.id, elements, PREVIEW_W, PREVIEW_H, 'resize');
                          setDragRect({ id: el.id, ...snapped.rect });
                          setGuides(snapped.guides);
                        }}
                        onResizeStop={(_e, _dir, ref, _delta, position) => {
                          const w = parseFloat(ref.style.width);
                          const h = parseFloat(ref.style.height);
                          const snapped = computeSnap({ x: position.x, y: position.y, width: w, height: h }, el.id, elements, PREVIEW_W, PREVIEW_H, 'resize');
                          updateElement(el.id, {
                            width: clampPct(snapped.rect.width / PREVIEW_W * 100),
                            height: clampPct(snapped.rect.height / PREVIEW_H * 100),
                            x: clampPct(snapped.rect.x / PREVIEW_W * 100),
                            y: clampPct(snapped.rect.y / PREVIEW_H * 100),
                          });
                          setDragRect(null);
                          setGuides({ v: [], h: [] });
                        }}
                        style={{ zIndex: el.zIndex, overflow: 'visible' }}>
                        {/* react-rnd/react-draggable owns the root node's own `transform` (it uses
                            translate() there for positioning) and will clobber a `rotate()` set
                            alongside it — so rotation lives on this separate inner wrapper instead. */}
                        <div style={{
                          width: '100%', height: '100%', position: 'relative',
                          background: el.kind === 'SHAPE' ? (resolveColor(el.style.backgroundColor, palette) ?? KIND_COLORS.SHAPE + '55') : KIND_COLORS[el.kind] + '33',
                          border: isSelected ? `2px solid ${KIND_COLORS[el.kind]}` : `1px dashed ${KIND_COLORS[el.kind]}99`,
                          boxShadow: isSelected ? `0 0 0 2px ${KIND_COLORS[el.kind]}55` : undefined,
                          cursor: isSelected ? 'move' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2,
                          transform: liveRotation ? `rotate(${liveRotation}deg)` : undefined,
                        }}>
                          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                            <span style={{ fontSize: 9, color: el.kind === 'SHAPE' ? KIND_COLORS.SHAPE : '#fff', fontWeight: 600, textAlign: 'center', padding: '0 2px' }}>
                              {el.label || (el.kind === 'TEXT' ? el.content.text : el.kind)}
                            </span>
                            <span style={{ opacity: 0.7, fontSize: 8, color: el.kind === 'SHAPE' ? KIND_COLORS.SHAPE : '#fff' }}>{t(`elementKinds.${el.kind}`)}</span>
                          </div>
                          {isSelected && (
                            <div
                              className="rotate-handle"
                              onMouseDown={e => startRotate(e, el)}
                              title={t('rotateHint')}
                              style={{
                                position: 'absolute', top: -22, left: '50%', transform: 'translateX(-50%)',
                                width: 14, height: 14, borderRadius: '50%',
                                background: KIND_COLORS[el.kind], border: '2px solid white',
                                cursor: 'grab', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
                              }}
                            />
                          )}
                          {isSelected && (
                            <div style={{ position: 'absolute', top: -22, left: '50%', width: 1, height: 22, background: KIND_COLORS[el.kind], transform: 'translateX(-50%)', pointerEvents: 'none' }} />
                          )}
                        </div>
                      </Rnd>
                    );
                  })}
                  {dragRect && guides.v.map(x => (
                    <div key={`v-${x}`} style={{ position: 'absolute', left: x, top: 0, width: 0, height: PREVIEW_H, borderLeft: '1px dashed #ec4899', pointerEvents: 'none' }} />
                  ))}
                  {dragRect && guides.h.map(y => (
                    <div key={`h-${y}`} style={{ position: 'absolute', top: y, left: 0, height: 0, width: PREVIEW_W, borderTop: '1px dashed #ec4899', pointerEvents: 'none' }} />
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('palette')}</div>
                <div className="grid grid-cols-4 gap-2">
                  {PALETTE_ROLES.map(role => (
                    <div key={role}>
                      <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5 truncate" title={t(`paletteRoles.${role}`)}>{t(`paletteRoles.${role}`)}</label>
                      <div className="flex items-center gap-1">
                        <input type="color" value={palette[role]} onChange={e => setPalette(prev => ({ ...prev, [role]: e.target.value }))}
                          className="flex-1 min-w-0 h-7 border border-gray-200 dark:border-gray-700 rounded cursor-pointer" />
                        <CopyHexButton value={palette[role]} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('typography')}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('headingFont')}</label>
                    <FontPicker value={typography.headingFont} onChange={f => setTypography(prev => ({ ...prev, headingFont: f }))} />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('bodyFont')}</label>
                    <FontPicker value={typography.bodyFont} onChange={f => setTypography(prev => ({ ...prev, bodyFont: f }))} />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('baseSize')}</label>
                    <input type="number" min={8} max={64} value={typography.baseSizePx} onChange={e => setTypography(prev => ({ ...prev, baseSizePx: parseInt(e.target.value, 10) || 16 }))}
                      className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('scale')}</label>
                    <input type="number" step={0.05} min={1} max={2} value={typography.scale} onChange={e => setTypography(prev => ({ ...prev, scale: parseFloat(e.target.value) || 1.25 }))}
                      className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none" />
                  </div>
                </div>
              </div>
            </div>

            {/* Right: element list */}
            <div className="flex-1 min-w-[320px] space-y-3 max-h-[640px] overflow-y-auto pe-1">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{t('elements')}</div>
              {elements.map(el => {
                const isSelected = el.id === selectedElementId;
                return (
                <div key={el.id}
                  onClick={() => setSelectedElementId(el.id)}
                  className={`border rounded-lg p-3 space-y-2 cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: KIND_COLORS[el.kind] }} />
                    <input value={el.label ?? ''} onChange={e => updateElement(el.id, { label: e.target.value })} placeholder={t('elementLabel')}
                      className="flex-1 min-w-0 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                    {isSelected && (
                      <span className="flex items-center gap-1 text-[9px] font-medium text-indigo-600 dark:text-indigo-400 shrink-0">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> {t('editingNow')}
                      </span>
                    )}
                    <select value={el.kind} onChange={e => updateElementKind(el.id, e.target.value as ThemeElementKind)}
                      className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none">
                      {ELEMENT_KIND_VALUES.map(k => <option key={k} value={k}>{t(`elementKinds.${k}`)}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 shrink-0" title={t('editableHint')}>
                      <input type="checkbox" checked={el.editable} onChange={e => updateElement(el.id, { editable: e.target.checked })} />
                      {t('editableShort')}
                    </label>
                    <button onClick={e => { e.stopPropagation(); removeElement(el.id); }} className="text-gray-400 dark:text-gray-500 hover:text-red-500 shrink-0"><X className="w-3.5 h-3.5" /></button>
                  </div>

                  {!isSelected && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 pl-4">{t('clickToEditHint')}</p>
                  )}

                  {isSelected && (
                  <>
                  <div className="grid grid-cols-6 gap-1">
                    {(['x', 'y', 'width', 'height', 'zIndex', 'rotation'] as const).map(field => (
                      <div key={field}>
                        <label className="text-[9px] text-gray-400 dark:text-gray-500 flex items-center gap-0.5">
                          {field === 'rotation' && <RotateCw className="w-2.5 h-2.5" />} {t(`field.${field}`)}
                        </label>
                        <input type="number"
                          min={field === 'zIndex' ? undefined : field === 'rotation' ? -360 : 0}
                          max={field === 'zIndex' ? undefined : field === 'rotation' ? 360 : 100}
                          value={el[field]} onChange={e => updateElement(el.id, { [field]: field === 'zIndex' || field === 'rotation' ? parseInt(e.target.value, 10) || 0 : parseFloat(e.target.value) || 0 })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                      </div>
                    ))}
                  </div>

                  {/* Content */}
                  <div className="bg-gray-50 dark:bg-gray-800/60 rounded p-2">
                    {el.kind === 'TEXT' && (
                      <div className="space-y-1.5">
                        <div>
                          <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('text')}</label>
                          <input value={el.content.text} onChange={e => updateElementContent(el.id, { text: e.target.value })}
                            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('translationAr')}</label>
                          <input dir="rtl" value={el.content.translations?.ar ?? ''} onChange={e => updateElementContent(el.id, { translations: { ...el.content.translations, ar: e.target.value } })}
                            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none" />
                        </div>
                      </div>
                    )}
                    {el.kind === 'IMAGE' && (
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('image')}</label>
                        <AssetPicker types={['IMAGE']} value={el.content.assetId} placeholder={t('noAsset')}
                          onChange={assetId => updateElementContent(el.id, { assetId })} />
                      </div>
                    )}
                    {el.kind === 'VIDEO' && (
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('video')}</label>
                        <AssetPicker types={['VIDEO']} value={el.content.assetId} placeholder={t('noAsset')}
                          onChange={assetId => updateElementContent(el.id, { assetId })} />
                      </div>
                    )}
                    {el.kind === 'PLAYLIST' && (
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('playlistContent')}</label>
                        <select value={el.content.playlistId ?? ''} onChange={e => updateElementContent(el.id, { playlistId: e.target.value || null })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none">
                          <option value="">{t('noPlaylist')}</option>
                          {playlists.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </div>
                    )}
                    {el.kind === 'SHAPE' && (
                      <p className="text-[10px] text-gray-400 dark:text-gray-500">{t('shapeHint')}</p>
                    )}
                    {el.kind === 'WIDGET' && (
                      <div className="space-y-1.5">
                        <div>
                          <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('widgetType')}</label>
                          <select value={el.content.widgetType} onChange={e => updateElementContent(el.id, { widgetType: e.target.value as ThemeWidgetType, widgetConfig: {} })}
                            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none">
                            {WIDGET_TYPE_VALUES.map(w => <option key={w} value={w}>{t(`widgetTypes.${w}`)}</option>)}
                          </select>
                        </div>
                        <WidgetConfigFields widgetType={el.content.widgetType} config={el.content.widgetConfig} onChange={cfg => updateElementContent(el.id, { widgetConfig: cfg })} />
                      </div>
                    )}
                  </div>

                  {/* Style — only fields the player renderer actually consumes for this kind */}
                  {el.kind === 'TEXT' && (
                    <div className="grid grid-cols-3 gap-2">
                      <ColorField label={t('color')} value={el.style.color} onChange={v => updateElementStyle(el.id, { color: v })} />
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('fontFamily')}</label>
                        <select
                          value={el.style.fontFamily === 'heading' || el.style.fontFamily === 'body' ? el.style.fontFamily : 'custom'}
                          onChange={e => updateElementStyle(el.id, { fontFamily: e.target.value === 'custom' ? DEFAULT_FONT_ID : e.target.value })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none mb-1">
                          <option value="heading">{t('fontFamilyHeadingOption')}</option>
                          <option value="body">{t('fontFamilyBodyOption')}</option>
                          <option value="custom">{t('fontFamilyCustomOption')}</option>
                        </select>
                        {el.style.fontFamily !== 'heading' && el.style.fontFamily !== 'body' && (
                          <FontPicker value={el.style.fontFamily} onChange={f => updateElementStyle(el.id, { fontFamily: f })} />
                        )}
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('fontSizePx')}</label>
                        <input type="number" min={8} max={200} value={el.style.fontSizePx ?? ''} onChange={e => updateElementStyle(el.id, { fontSizePx: parseInt(e.target.value, 10) || undefined })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('fontWeight')}</label>
                        <select value={String(el.style.fontWeight ?? 400)} onChange={e => updateElementStyle(el.id, { fontWeight: parseInt(e.target.value, 10) })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none">
                          {[400, 500, 600, 700, 800, 900].map(w => <option key={w} value={w}>{w}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('textAlign')}</label>
                        <select value={el.style.textAlign ?? 'left'} onChange={e => updateElementStyle(el.id, { textAlign: e.target.value as 'left' | 'center' | 'right' })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none">
                          <option value="left">{t('align.left')}</option>
                          <option value="center">{t('align.center')}</option>
                          <option value="right">{t('align.right')}</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('direction')}</label>
                        <select value={el.style.direction ?? 'auto'} onChange={e => updateElementStyle(el.id, { direction: e.target.value as 'ltr' | 'rtl' | 'auto' })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none">
                          <option value="auto">{t('direction_.auto')}</option>
                          <option value="ltr">{t('direction_.ltr')}</option>
                          <option value="rtl">{t('direction_.rtl')}</option>
                        </select>
                      </div>
                    </div>
                  )}
                  {(el.kind === 'IMAGE' || el.kind === 'VIDEO') && (
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('objectFit')}</label>
                        <select value={el.style.objectFit ?? 'contain'} onChange={e => updateElementStyle(el.id, { objectFit: e.target.value as 'contain' | 'cover' | 'fill' })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none">
                          <option value="contain">{t('fit.contain')}</option>
                          <option value="cover">{t('fit.cover')}</option>
                          <option value="fill">{t('fit.fill')}</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('borderRadius')}</label>
                        <input type="number" min={0} max={100} value={el.style.borderRadius ?? 0} onChange={e => updateElementStyle(el.id, { borderRadius: parseInt(e.target.value, 10) || 0 })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('opacity')}</label>
                        <input type="number" min={0} max={1} step={0.05} value={el.style.opacity ?? 1} onChange={e => updateElementStyle(el.id, { opacity: parseFloat(e.target.value) })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                      </div>
                    </div>
                  )}
                  {el.kind === 'PLAYLIST' && (
                    <div className="w-1/3">
                      <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('borderRadius')}</label>
                      <input type="number" min={0} max={100} value={el.style.borderRadius ?? 0} onChange={e => updateElementStyle(el.id, { borderRadius: parseInt(e.target.value, 10) || 0 })}
                        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                    </div>
                  )}
                  {el.kind === 'SHAPE' && (
                    <div className="grid grid-cols-3 gap-2">
                      <ColorField label={t('backgroundColor')} value={el.style.backgroundColor} onChange={v => updateElementStyle(el.id, { backgroundColor: v })} />
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('borderRadius')}</label>
                        <input type="number" min={0} max={100} value={el.style.borderRadius ?? 0} onChange={e => updateElementStyle(el.id, { borderRadius: parseInt(e.target.value, 10) || 0 })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('opacity')}</label>
                        <input type="number" min={0} max={1} step={0.05} value={el.style.opacity ?? 1} onChange={e => updateElementStyle(el.id, { opacity: parseFloat(e.target.value) })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                      </div>
                    </div>
                  )}
                  </>
                  )}
                </div>
              );
              })}
              <button onClick={addElement} className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                <Plus className="w-3 h-3" /> {t('addElement')}
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
            <button onClick={() => setEditing(null)}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
              {tc('cancel')}
            </button>
            <button onClick={() => (editing === 'new' ? createMut.mutate() : updateMut.mutate())}
              disabled={!name.trim() || elements.length === 0 || saving}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              <Check className="w-4 h-4" /> {saving ? t('saving') : t('saveTheme')}
            </button>
          </div>
        </div>
      )}

      {deleteError && <div className="mb-4 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-sm px-4 py-2 rounded-lg">{deleteError}</div>}

      {isLoading && <p className="text-sm text-gray-400">{t('loading')}</p>}

      {!isLoading && themes.length === 0 && !editing && (
        <div className="text-center py-16 text-gray-400">
          <Palette className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {!editing && presets.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-500" /> {t('presetsSection')}
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {presets.map(theme => (
              <div key={theme.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                <div className="flex items-center justify-between mb-3 gap-2">
                  <span className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">{theme.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 shrink-0">{t(`categories.${theme.category}`)}</span>
                </div>
                <div style={{ aspectRatio: '16/9', background: theme.palette.background, borderRadius: 4, overflow: 'hidden', marginBottom: 8, position: 'relative' }}>
                  {renderPreviewElements(theme.elements, theme.palette, CARD_SCALE_W)}
                </div>
                {canEditContent && (
                  <button onClick={() => applyPreset(theme)} disabled={duplicateMut.isPending}
                    title={t('customizeHint')}
                    className="w-full flex items-center justify-center gap-1.5 text-xs bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-lg py-1.5 hover:bg-indigo-100 dark:hover:bg-indigo-900 disabled:opacity-50">
                    <Pencil className="w-3.5 h-3.5" /> {t('customize')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!editing && (ownThemes.length > 0 || presets.length === 0) && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('yourThemes')}</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {ownThemes.map(theme => (
              <div key={theme.id} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-4">
                <div className="flex items-center justify-between mb-3 gap-2">
                  {renamingId === theme.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(theme)}
                      onKeyDown={e => { if (e.key === 'Enter') commitRename(theme); if (e.key === 'Escape') setRenamingId(null); }}
                      disabled={renameMut.isPending}
                      className="font-medium text-sm text-gray-900 dark:text-gray-100 dark:bg-gray-800 border border-indigo-300 dark:border-indigo-700 rounded px-1 -mx-1 min-w-0 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                  ) : (
                    <span onClick={() => startRename(theme)} title={canEditContent ? tc('clickToRename') : undefined}
                      className={`font-medium text-gray-900 dark:text-gray-100 text-sm truncate ${canEditContent ? 'cursor-text hover:text-indigo-600 dark:hover:text-indigo-400' : ''}`}>
                      {theme.name}
                    </span>
                  )}
                  {canEditContent && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => duplicateMut.mutate(theme)} disabled={duplicateMut.isPending}
                        title={t('duplicate')} className="p-1 text-gray-400 dark:text-gray-500 hover:text-indigo-600 disabled:opacity-50"><Copy className="w-3.5 h-3.5" /></button>
                      <button onClick={() => { if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(theme); }}
                        className="p-1 text-gray-400 dark:text-gray-500 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>

                <button onClick={() => canEditContent && openEdit(theme)} disabled={!canEditContent}
                  title={canEditContent ? t('clickToEdit') : undefined}
                  className="group relative w-full block disabled:cursor-default"
                  style={{ aspectRatio: '16/9', background: theme.palette.background, borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                  {renderPreviewElements(theme.elements, theme.palette, CARD_SCALE_W)}
                  {canEditContent && (
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all">
                      <span className="flex items-center gap-1.5 text-white text-xs font-medium">
                        <Pencil className="w-3.5 h-3.5" /> {t('editTheme')}
                      </span>
                    </div>
                  )}
                </button>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300">{t(`categories.${theme.category}`)}</span>
                  {theme._count && theme._count.screens > 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">{t('screenCount', { count: theme._count.screens })}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
