'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Rnd } from 'react-rnd';
import {
  Palette, Plus, Trash2, Pencil, X, Check, Copy, Sparkles, RotateCw, Undo2, Redo2,
  Lock, LockOpen,
} from 'lucide-react';
import {
  themesApi, playlistsApi,
  type Theme, type ThemeInput, type ThemeElement, type ThemeElementKind, type ThemeElementStyle,
  type ThemeCategory, type ThemePalette, type ThemeTypography, type ThemeWidgetType, type ElementShape,
} from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useRequireSelectToEdit } from '@/hooks/useRequireSelectToEdit';
import { useAuth } from '@/context/AuthContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useEditorHistory } from '@/hooks/useEditorHistory';
import { AssetPicker } from '@/components/AssetPicker';
import { FontPicker, fontStack } from '@/components/FontPicker';
import { WidgetConfigFields } from '@/components/WidgetConfigFields';
import { type Box, clampBox, computeAlignTargets, resolveResize, snapDragAxis } from '@/lib/canvasSnap';
import {
  RESIZE_HANDLES, RESIZE_HANDLE_AXIS, resizeHandleStyle, rotatedResizeAnchor, rotatedResizeBox,
  type ResizeHandle,
} from '@/lib/rotatedResize';
import { DEFAULT_FONT_ID, shapeClipStyle } from '@lumina/types';

// Live preview canvas default size in px — the actual editor canvas is responsive (see
// previewSize below) and takes up the full width of the panel, like the layout editor's.
const PREVIEW_W = 640;
const PREVIEW_H = 360;
const MIN_ELEMENT_PX = 16;
// Grid thumbnails scale text relative to this reference width rather than PREVIEW_W (the
// editor canvas), since thumbnail cards render much narrower than the full editor.
const CARD_SCALE_W = 400;

const clampPct = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));

const CATEGORY_VALUES: ThemeCategory[] = ['RESTAURANT_MENU', 'RETAIL_PROMO', 'HOTEL_LOBBY', 'CLINIC_WAITING', 'MOSQUE', 'GENERIC'];
const ASPECT_RATIOS = ['16:9', '9:16', '4:3', '1:1'] as const;
const ELEMENT_KIND_VALUES: ThemeElementKind[] = ['TEXT', 'IMAGE', 'VIDEO', 'PLAYLIST', 'SHAPE', 'WIDGET'];
const ELEMENT_SHAPES: ElementShape[] = ['rectangle', 'rounded', 'circle', 'triangle'];
const WIDGET_TYPE_VALUES: ThemeWidgetType[] = ['PRAYER', 'WEATHER', 'CURRENCY', 'TICKER', 'TIME', 'DATE'];
const PALETTE_ROLES: (keyof ThemePalette)[] = ['primary', 'secondary', 'background', 'surface', 'text', 'textMuted', 'accent'];

const KIND_COLORS: Record<ThemeElementKind, string> = {
  TEXT: '#6366f1', IMAGE: '#0ea5e9', VIDEO: '#8b5cf6', PLAYLIST: '#10b981', SHAPE: '#64748b', WIDGET: '#f59e0b',
};

// Rotation drag snaps to the nearest 15° once within this many degrees — mirrors the layout
// editor's rotation handle, so square/45°/diagonal placements are easy to hit exactly.
const SNAP_DEG = 4;

// `aspectRatio` is stored as e.g. "16:9" — parsed to a ratio so the responsive canvas below can
// derive its height from its rendered width for any of the theme's supported aspect ratios.
function parseAspectRatio(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number);
  return w && h && w > 0 && h > 0 ? w / h : 16 / 9;
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

interface ColorFieldProps {
  label: string; value: string | undefined; onChange: (v: string | undefined) => void;
  // Brackets the raw color-picker drag into a single undo step (like every other continuous
  // input in this editor) — the select below is a one-shot discrete pick, so its own onChange
  // is left for the caller to wrap in commit() instead.
  onFocusField?: () => void; onBlurField?: () => void;
}
function ColorField({ label, value, onChange, onFocusField, onBlurField }: ColorFieldProps) {
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
            <input type="color" value={value}
              onFocus={onFocusField} onBlur={onBlurField}
              onChange={e => onChange(e.target.value)}
              className="w-7 h-7 shrink-0 border border-gray-200 dark:border-gray-700 rounded cursor-pointer" />
            <span className="text-[9px] font-mono text-gray-400 dark:text-gray-500 shrink-0">{value}</span>
            <CopyHexButton value={value} />
          </>
        )}
      </div>
    </div>
  );
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
  const [dragBox, setDragBox] = useState<({ id: string } & Box) | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [rotationDrag, setRotationDrag] = useState<{ id: string; deg: number } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
  const { enabled: requireSelectToEdit } = useRequireSelectToEdit();

  interface EditorSnapshot { name: string; category: ThemeCategory; aspectRatio: string; palette: ThemePalette; typography: ThemeTypography; elements: ThemeElement[]; }
  const { canUndo, canRedo, undo, redo, commit, captureForHistory, commitCaptured } = useEditorHistory<EditorSnapshot>(
    editing,
    () => ({ name, category, aspectRatio, palette, typography, elements }),
    s => { setName(s.name); setCategory(s.category); setAspectRatio(s.aspectRatio); setPalette(s.palette); setTypography(s.typography); setElements(s.elements); },
  );

  // Live preview canvas size in px — kept in sync with its actual rendered width (like the
  // layout editor's) so the preview takes up the full panel width instead of a fixed small box.
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: PREVIEW_W, height: PREVIEW_H });

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () => setPreviewSize({ width: el.clientWidth, height: el.clientWidth / parseAspectRatio(aspectRatio) });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing, aspectRatio]);

  // A locked element (editable: false) can never be dragged/resized/rotated, regardless of
  // selection or the requireSelectToEdit setting — `editable` used to be set by this UI but
  // never actually gated anything in the canvas (see roadmap).
  function elementIsInteractive(el: ThemeElement, isSelected: boolean) {
    if (el.editable === false) return false;
    return !requireSelectToEdit || isSelected;
  }

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
  // A zone must be selected (single click) before it can be dragged/resized/rotated — unless
  // requireSelectToEdit is off, or the element is locked (editable: false), which always wins.
  const getBoxPx = useCallback((el: ThemeElement): Box => ({
    left: (el.x / 100) * previewSize.width,
    top: (el.y / 100) * previewSize.height,
    width: (el.width / 100) * previewSize.width,
    height: (el.height / 100) * previewSize.height,
  }), [previewSize]);

  // Alignment guides only make sense against another element's actual visible edges — a rotated
  // element's unrotated left/top/width/height box doesn't correspond to anything on screen, so
  // it's excluded both as a snap target for others and (in handleDrag below) as something that
  // itself snaps while being dragged.
  const computeTargets = useCallback((excludeId: string) => {
    const otherBoxes = elements
      .filter(el => el.id !== excludeId && !(el.rotation ?? 0))
      .map(getBoxPx);
    return computeAlignTargets(previewSize.width, previewSize.height, otherBoxes);
  }, [elements, previewSize, getBoxPx]);

  const clampToCanvas = useCallback((box: Box): Box => clampBox(box, previewSize.width, previewSize.height), [previewSize]);

  function handleDrag(el: ThemeElement, x: number, y: number) {
    const box = getBoxPx(el);
    if (el.rotation) {
      setDragBox({ id: el.id, ...clampToCanvas({ left: x, top: y, width: box.width, height: box.height }) });
      setGuides({ v: [], h: [] });
      return;
    }
    const { xs, ys } = computeTargets(el.id);
    const snapX = snapDragAxis(x, box.width, xs);
    const snapY = snapDragAxis(y, box.height, ys);
    const next = clampToCanvas({ left: snapX.pos, top: snapY.pos, width: box.width, height: box.height });
    setDragBox({ id: el.id, ...next });
    setGuides({ v: snapX.guide !== null ? [snapX.guide] : [], h: snapY.guide !== null ? [snapY.guide] : [] });
  }

  function handleDragStop(el: ThemeElement, x: number, y: number) {
    const box = getBoxPx(el);
    if (el.rotation) {
      const next = clampToCanvas({ left: x, top: y, width: box.width, height: box.height });
      commit(() => updateElement(el.id, {
        x: clampPct(next.left / previewSize.width * 100),
        y: clampPct(next.top / previewSize.height * 100),
      }));
      setDragBox(null);
      setGuides({ v: [], h: [] });
      return;
    }
    const { xs, ys } = computeTargets(el.id);
    const snapX = snapDragAxis(x, box.width, xs);
    const snapY = snapDragAxis(y, box.height, ys);
    const next = clampToCanvas({ left: snapX.pos, top: snapY.pos, width: box.width, height: box.height });
    commit(() => updateElement(el.id, {
      x: clampPct(next.left / previewSize.width * 100),
      y: clampPct(next.top / previewSize.height * 100),
    }));
    setDragBox(null);
    setGuides({ v: [], h: [] });
  }

  function handleResize(el: ThemeElement, direction: string, ref: HTMLElement, position: { x: number; y: number }) {
    const box: Box = { left: position.x, top: position.y, width: parseFloat(ref.style.width), height: parseFloat(ref.style.height) };
    const { box: next, guides } = resolveResize(direction, box, computeTargets(el.id), MIN_ELEMENT_PX, previewSize.width, previewSize.height);
    setDragBox({ id: el.id, ...next });
    setGuides(guides);
  }

  function handleResizeStop(el: ThemeElement, direction: string, ref: HTMLElement, position: { x: number; y: number }) {
    const box: Box = { left: position.x, top: position.y, width: parseFloat(ref.style.width), height: parseFloat(ref.style.height) };
    const { box: next } = resolveResize(direction, box, computeTargets(el.id), MIN_ELEMENT_PX, previewSize.width, previewSize.height);
    commit(() => updateElement(el.id, {
      x: clampPct(next.left / previewSize.width * 100),
      y: clampPct(next.top / previewSize.height * 100),
      width: clampPct(next.width / previewSize.width * 100),
      height: clampPct(next.height / previewSize.height * 100),
    }));
    setDragBox(null);
    setGuides({ v: [], h: [] });
  }

  // Drag-to-rotate: the handle sits above the element's (unrotated) top-center. While dragging,
  // the element's rotation tracks the angle from its own center to the mouse, measured in the
  // canvas's own coordinate space so it works regardless of page scroll/zoom.
  function startRotate(e: React.MouseEvent, el: ThemeElement) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedElementId(el.id);
    const canvas = previewRef.current;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const box = getBoxPx(el);
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;

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
      commit(() => updateElement(el.id, { rotation: angleFor(ev.clientX, ev.clientY) }));
      setRotationDrag(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // Custom resize handles for rotated elements — mirrors the layout editor's zone handling:
  // react-rnd's own resize handles stay anchored to the element's unrotated bounding box, so once
  // rotated they end up nowhere near its visible corners/edges. These are rendered inside the same
  // rotated wrapper as the shape, so they always sit at its true visual corners/edges.
  function startResizeElement(e: React.MouseEvent, el: ThemeElement, handle: ResizeHandle) {
    e.preventDefault();
    e.stopPropagation();
    const canvas = previewRef.current;
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const box = getBoxPx(el);
    const rotation = el.rotation ?? 0;
    const anchor = rotatedResizeAnchor(box, rotation, handle);

    function compute(clientX: number, clientY: number): Box {
      const mouse = { x: clientX - canvasRect.left, y: clientY - canvasRect.top };
      return clampToCanvas(rotatedResizeBox(rotation, handle, anchor, mouse, box, MIN_ELEMENT_PX));
    }

    function onMove(ev: MouseEvent) {
      setDragBox({ id: el.id, ...compute(ev.clientX, ev.clientY) });
    }
    function onUp(ev: MouseEvent) {
      const next = compute(ev.clientX, ev.clientY);
      commit(() => updateElement(el.id, {
        x: clampPct(next.left / previewSize.width * 100),
        y: clampPct(next.top / previewSize.height * 100),
        width: clampPct(next.width / previewSize.width * 100),
        height: clampPct(next.height / previewSize.height * 100),
      }));
      setDragBox(null);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function addElement() {
    commit(() => setElements(prev => [...prev, { id: newElementId(), kind: 'TEXT', x: 20, y: 20, width: 40, height: 15, zIndex: prev.length, rotation: 0, editable: true, style: { color: 'palette.text' }, content: { text: 'New text' } }]));
  }
  function removeElement(id: string) {
    commit(() => setElements(prev => prev.filter(el => el.id !== id)));
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
          ...shapeClipStyle(el.style.shape),
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
              onFocus={captureForHistory} onBlur={commitCaptured}
              className="text-lg font-semibold text-gray-900 dark:text-gray-100 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-indigo-500 focus:outline-none bg-transparent w-64"
              placeholder={t('themeName')} />
            <div className="flex gap-2 flex-wrap items-center">
              <select value={category} onChange={e => commit(() => setCategory(e.target.value as ThemeCategory))}
                className="text-xs border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1.5 focus:outline-none">
                {CATEGORY_VALUES.map(c => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
              </select>
              <select value={aspectRatio} onChange={e => commit(() => setAspectRatio(e.target.value))}
                className="text-xs border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1.5 focus:outline-none">
                {ASPECT_RATIOS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          {/* Visual preview, full-width, with element settings stacked below — mirrors the
              layout editor's shell so both editors share the same overall structure. */}
          <div className="flex flex-col gap-6">
            <div>
              <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">{t('preview')}</div>
              <div ref={previewRef}
                onMouseDown={e => { if (e.target === e.currentTarget) setSelectedElementId(null); }}
                // Deliberately not clipped: a rotated element's corners (and its resize handles)
                // can extend past the canvas rectangle once its bounding diagonal exceeds the
                // canvas size — clipping them here made those corners/handles invisible and
                // unreachable, which is what made resizing rotated elements feel broken.
                style={{ width: '100%', aspectRatio: aspectRatio.replace(':', ' / '), background: palette.background, position: 'relative', borderRadius: 6, overflow: 'visible', border: '1px solid rgba(0,0,0,0.1)' }}>
                {previewSize.width > 0 && elements.map((el) => {
                  const isSelected = el.id === selectedElementId;
                  const isHovered = el.id === hoveredElementId;
                  const interactive = elementIsInteractive(el, isSelected);
                  const box = dragBox && dragBox.id === el.id ? dragBox : getBoxPx(el);
                  const liveRotation = rotationDrag && rotationDrag.id === el.id ? rotationDrag.deg : el.rotation;
                  const rotation = el.rotation ?? 0;
                  return (
                    <Rnd
                      key={el.id}
                      bounds="parent"
                      minWidth={MIN_ELEMENT_PX}
                      minHeight={MIN_ELEMENT_PX}
                      disableDragging={!interactive}
                      // react-rnd's own resize handles are anchored to the unrotated box, which no
                      // longer matches the visible (rotated) shape — once rotated, use the custom
                      // rotation-aware handles rendered below instead.
                      enableResizing={interactive && rotation === 0 ? undefined : false}
                      cancel=".rotate-handle, .resize-handle"
                      size={{ width: box.width, height: box.height }}
                      position={{ x: box.left, y: box.top }}
                      onMouseDown={() => setSelectedElementId(el.id)}
                      onDragStart={() => setSelectedElementId(el.id)}
                      onDrag={(_e, d) => handleDrag(el, d.x, d.y)}
                      onDragStop={(_e, d) => handleDragStop(el, d.x, d.y)}
                      onResize={(_e, dir, ref, _delta, position) => handleResize(el, dir, ref, position)}
                      onResizeStop={(_e, dir, ref, _delta, position) => handleResizeStop(el, dir, ref, position)}
                      style={{ zIndex: el.zIndex, overflow: 'visible' }}>
                      {/* react-rnd/react-draggable owns the root node's own `transform` (it uses
                          translate() there for positioning) and will clobber a `rotate()` set
                          alongside it — so rotation lives on this separate inner wrapper instead. */}
                      <div
                        onMouseEnter={() => setHoveredElementId(el.id)}
                        onMouseLeave={() => setHoveredElementId(id => id === el.id ? null : id)}
                        style={{
                          width: '100%', height: '100%', position: 'relative',
                          cursor: isSelected ? 'move' : 'pointer',
                          transform: liveRotation ? `rotate(${liveRotation}deg)` : undefined,
                        }}>
                        {/* Shape-clipped fill — the true rectangular bounding box only shows on
                            hover/select (below), since a circle/triangle shape would otherwise
                            look like it has an invisible rectangular halo. */}
                        <div style={{
                          position: 'absolute', inset: 0,
                          background: el.kind === 'SHAPE' ? (resolveColor(el.style.backgroundColor, palette) ?? KIND_COLORS.SHAPE + '55') : KIND_COLORS[el.kind] + '33',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 2, overflow: 'hidden',
                          ...shapeClipStyle(el.style.shape),
                        }}>
                          <span style={{ fontSize: 9, color: el.kind === 'SHAPE' ? KIND_COLORS.SHAPE : '#fff', fontWeight: 600, textAlign: 'center', padding: '0 2px' }}>
                            {el.label || (el.kind === 'TEXT' ? el.content.text : el.kind)}
                          </span>
                          <span style={{ opacity: 0.7, fontSize: 8, color: el.kind === 'SHAPE' ? KIND_COLORS.SHAPE : '#fff' }}>{t(`elementKinds.${el.kind}`)}</span>
                        </div>
                        {(isHovered || isSelected) && (
                          <div style={{
                            position: 'absolute', inset: 0, pointerEvents: 'none',
                            border: isSelected ? `2px solid ${KIND_COLORS[el.kind]}` : `1px dashed ${KIND_COLORS[el.kind]}99`,
                            boxShadow: isSelected ? `0 0 0 2px ${KIND_COLORS[el.kind]}55` : undefined,
                          }} />
                        )}
                        {el.editable === false && (
                          <div title={t('lockedHint')} style={{ position: 'absolute', top: 3, insetInlineStart: 3, color: '#fff', background: 'rgba(0,0,0,0.5)', borderRadius: 4, padding: 2, lineHeight: 0 }}>
                            <Lock className="w-2.5 h-2.5" />
                          </div>
                        )}
                        {interactive && (
                          <>
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
                            <div style={{ position: 'absolute', top: -22, left: '50%', width: 1, height: 22, background: KIND_COLORS[el.kind], transform: 'translateX(-50%)', pointerEvents: 'none' }} />
                          </>
                        )}
                        {interactive && rotation !== 0 && RESIZE_HANDLES.map(h => (
                          <div
                            key={h}
                            className="resize-handle"
                            onMouseDown={e => startResizeElement(e, el, h)}
                            title={t('resizeHint')}
                            style={{
                              ...resizeHandleStyle(h),
                              width: 8, height: 8, borderRadius: 2,
                              background: KIND_COLORS[el.kind], border: '1.5px solid white',
                              cursor: RESIZE_HANDLE_AXIS[h].cursor, boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
                            }}
                          />
                        ))}
                      </div>
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

            {/* Palette + typography — theme-only settings that sit between the preview and the
                element cards below, unlike the layout editor which has neither. */}
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t('palette')}</div>
                <div className="grid grid-cols-4 gap-2">
                  {PALETTE_ROLES.map(role => (
                    <div key={role}>
                      <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5 truncate" title={t(`paletteRoles.${role}`)}>{t(`paletteRoles.${role}`)}</label>
                      <div className="flex items-center gap-1">
                        <input type="color" value={palette[role]}
                          onFocus={captureForHistory}
                          onChange={e => setPalette(prev => ({ ...prev, [role]: e.target.value }))}
                          onBlur={commitCaptured}
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
                    <FontPicker value={typography.headingFont} onChange={f => commit(() => setTypography(prev => ({ ...prev, headingFont: f })))} />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('bodyFont')}</label>
                    <FontPicker value={typography.bodyFont} onChange={f => commit(() => setTypography(prev => ({ ...prev, bodyFont: f })))} />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('baseSize')}</label>
                    <input type="number" min={8} max={64} value={typography.baseSizePx}
                      onFocus={captureForHistory} onBlur={commitCaptured}
                      onChange={e => setTypography(prev => ({ ...prev, baseSizePx: parseInt(e.target.value, 10) || 16 }))}
                      className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('scale')}</label>
                    <input type="number" step={0.05} min={1} max={2} value={typography.scale}
                      onFocus={captureForHistory} onBlur={commitCaptured}
                      onChange={e => setTypography(prev => ({ ...prev, scale: parseFloat(e.target.value) || 1.25 }))}
                      className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 focus:outline-none" />
                  </div>
                </div>
              </div>
            </div>

            {/* Element cards — one per element, mirroring the layout editor's zone cards. */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-gray-400 dark:text-gray-500">{t('elements')}</div>
                <button onClick={addElement} className="text-xs text-indigo-600 hover:text-indigo-700 flex items-center gap-1">
                  <Plus className="w-3 h-3" /> {t('addElement')}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 items-start">
              {elements.map(el => {
                const isSelected = el.id === selectedElementId;
                return (
                <div key={el.id}
                  onClick={() => setSelectedElementId(el.id)}
                  className={`bg-white dark:bg-gray-900 rounded-xl border p-3 flex flex-col gap-2.5 cursor-pointer transition-colors ${
                    isSelected
                      ? 'border-indigo-500 ring-1 ring-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/20'
                      : 'border-gray-200 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}>
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: KIND_COLORS[el.kind] }} />
                    <input value={el.label ?? ''} onChange={e => updateElement(el.id, { label: e.target.value })}
                      onFocus={captureForHistory} onBlur={commitCaptured}
                      placeholder={t('elementLabel')}
                      className="flex-1 min-w-0 font-medium text-sm border border-transparent hover:border-gray-200 dark:hover:border-gray-700 focus:border-indigo-500 dark:bg-gray-800 dark:text-gray-100 rounded px-1.5 py-1 focus:outline-none" />
                    <label className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 shrink-0 cursor-pointer" title={t('editableHint')}>
                      <input type="checkbox" checked={el.editable} onChange={e => commit(() => updateElement(el.id, { editable: e.target.checked }))} />
                      {el.editable ? <LockOpen className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    </label>
                    <button onClick={e => { e.stopPropagation(); removeElement(el.id); }} className="text-gray-400 dark:text-gray-500 hover:text-red-500 shrink-0"><X className="w-3.5 h-3.5" /></button>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <div>
                      <label className="text-xs text-gray-400 dark:text-gray-500 mb-1 block">{tc('type')}</label>
                      <select value={el.kind} onChange={e => commit(() => updateElementKind(el.id, e.target.value as ThemeElementKind))}
                        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500">
                        {ELEMENT_KIND_VALUES.map(k => <option key={k} value={k}>{t(`elementKinds.${k}`)}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-gray-400 dark:text-gray-500 mb-1 block">{t('shape')}</label>
                      <select value={el.style.shape ?? 'rectangle'}
                        onChange={e => commit(() => updateElementStyle(el.id, { shape: e.target.value as ElementShape }))}
                        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500">
                        {ELEMENT_SHAPES.map(s => <option key={s} value={s}>{t(`shapeTypes.${s}`)}</option>)}
                      </select>
                    </div>
                  </div>

                  {!isSelected && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-500">{t('clickToEditHint')}</p>
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
                          value={el[field]}
                          onFocus={captureForHistory} onBlur={commitCaptured}
                          onChange={e => updateElement(el.id, { [field]: field === 'zIndex' || field === 'rotation' ? parseInt(e.target.value, 10) || 0 : parseFloat(e.target.value) || 0 })}
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
                          <input value={el.content.text}
                            onFocus={captureForHistory} onBlur={commitCaptured}
                            onChange={e => updateElementContent(el.id, { text: e.target.value })}
                            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('translationAr')}</label>
                          <input dir="rtl" value={el.content.translations?.ar ?? ''}
                            onFocus={captureForHistory} onBlur={commitCaptured}
                            onChange={e => updateElementContent(el.id, { translations: { ...el.content.translations, ar: e.target.value } })}
                            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none" />
                        </div>
                      </div>
                    )}
                    {el.kind === 'IMAGE' && (
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('image')}</label>
                        <AssetPicker types={['IMAGE']} value={el.content.assetId} placeholder={t('noAsset')}
                          onChange={assetId => commit(() => updateElementContent(el.id, { assetId }))} />
                      </div>
                    )}
                    {el.kind === 'VIDEO' && (
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('video')}</label>
                        <AssetPicker types={['VIDEO']} value={el.content.assetId} placeholder={t('noAsset')}
                          onChange={assetId => commit(() => updateElementContent(el.id, { assetId }))} />
                      </div>
                    )}
                    {el.kind === 'PLAYLIST' && (
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('playlistContent')}</label>
                        <select value={el.content.playlistId ?? ''} onChange={e => commit(() => updateElementContent(el.id, { playlistId: e.target.value || null }))}
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
                          <select value={el.content.widgetType} onChange={e => commit(() => updateElementContent(el.id, { widgetType: e.target.value as ThemeWidgetType, widgetConfig: {} }))}
                            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-xs focus:outline-none">
                            {WIDGET_TYPE_VALUES.map(w => <option key={w} value={w}>{t(`widgetTypes.${w}`)}</option>)}
                          </select>
                        </div>
                        <WidgetConfigFields
                          widgetType={el.content.widgetType}
                          config={el.content.widgetConfig}
                          onChange={cfg => updateElementContent(el.id, { widgetConfig: cfg })}
                          onChangeCommitted={cfg => commit(() => updateElementContent(el.id, { widgetConfig: cfg }))}
                          onFocusField={captureForHistory}
                          onBlurField={commitCaptured}
                        />
                      </div>
                    )}
                  </div>

                  {/* Style — only fields the player renderer actually consumes for this kind */}
                  {el.kind === 'TEXT' && (
                    <div className="grid grid-cols-3 gap-2">
                      <ColorField label={t('color')} value={el.style.color}
                        onFocusField={captureForHistory} onBlurField={commitCaptured}
                        onChange={v => updateElementStyle(el.id, { color: v })} />
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('fontFamily')}</label>
                        <select
                          value={el.style.fontFamily === 'heading' || el.style.fontFamily === 'body' ? el.style.fontFamily : 'custom'}
                          onChange={e => commit(() => updateElementStyle(el.id, { fontFamily: e.target.value === 'custom' ? DEFAULT_FONT_ID : e.target.value }))}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none mb-1">
                          <option value="heading">{t('fontFamilyHeadingOption')}</option>
                          <option value="body">{t('fontFamilyBodyOption')}</option>
                          <option value="custom">{t('fontFamilyCustomOption')}</option>
                        </select>
                        {el.style.fontFamily !== 'heading' && el.style.fontFamily !== 'body' && (
                          <FontPicker value={el.style.fontFamily} onChange={f => commit(() => updateElementStyle(el.id, { fontFamily: f }))} />
                        )}
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('fontSizePx')}</label>
                        <input type="number" min={8} max={200} value={el.style.fontSizePx ?? ''}
                          onFocus={captureForHistory} onBlur={commitCaptured}
                          onChange={e => updateElementStyle(el.id, { fontSizePx: parseInt(e.target.value, 10) || undefined })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('fontWeight')}</label>
                        <select value={String(el.style.fontWeight ?? 400)} onChange={e => commit(() => updateElementStyle(el.id, { fontWeight: parseInt(e.target.value, 10) }))}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none">
                          {[400, 500, 600, 700, 800, 900].map(w => <option key={w} value={w}>{w}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('textAlign')}</label>
                        <select value={el.style.textAlign ?? 'left'} onChange={e => commit(() => updateElementStyle(el.id, { textAlign: e.target.value as 'left' | 'center' | 'right' }))}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none">
                          <option value="left">{t('align.left')}</option>
                          <option value="center">{t('align.center')}</option>
                          <option value="right">{t('align.right')}</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('direction')}</label>
                        <select value={el.style.direction ?? 'auto'} onChange={e => commit(() => updateElementStyle(el.id, { direction: e.target.value as 'ltr' | 'rtl' | 'auto' }))}
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
                        <select value={el.style.objectFit ?? 'contain'} onChange={e => commit(() => updateElementStyle(el.id, { objectFit: e.target.value as 'contain' | 'cover' | 'fill' }))}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none">
                          <option value="contain">{t('fit.contain')}</option>
                          <option value="cover">{t('fit.cover')}</option>
                          <option value="fill">{t('fit.fill')}</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('borderRadius')}</label>
                        <input type="number" min={0} max={100} value={el.style.borderRadius ?? 0}
                          onFocus={captureForHistory} onBlur={commitCaptured}
                          onChange={e => updateElementStyle(el.id, { borderRadius: parseInt(e.target.value, 10) || 0 })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('opacity')}</label>
                        <input type="number" min={0} max={1} step={0.05} value={el.style.opacity ?? 1}
                          onFocus={captureForHistory} onBlur={commitCaptured}
                          onChange={e => updateElementStyle(el.id, { opacity: parseFloat(e.target.value) })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                      </div>
                    </div>
                  )}
                  {el.kind === 'PLAYLIST' && (
                    <div className="w-1/3">
                      <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('borderRadius')}</label>
                      <input type="number" min={0} max={100} value={el.style.borderRadius ?? 0}
                        onFocus={captureForHistory} onBlur={commitCaptured}
                        onChange={e => updateElementStyle(el.id, { borderRadius: parseInt(e.target.value, 10) || 0 })}
                        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                    </div>
                  )}
                  {el.kind === 'SHAPE' && (
                    <div className="grid grid-cols-3 gap-2">
                      <ColorField label={t('backgroundColor')} value={el.style.backgroundColor}
                        onFocusField={captureForHistory} onBlurField={commitCaptured}
                        onChange={v => updateElementStyle(el.id, { backgroundColor: v })} />
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('borderRadius')}</label>
                        <input type="number" min={0} max={100} value={el.style.borderRadius ?? 0}
                          onFocus={captureForHistory} onBlur={commitCaptured}
                          onChange={e => updateElementStyle(el.id, { borderRadius: parseInt(e.target.value, 10) || 0 })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-400 dark:text-gray-500 block mb-0.5">{t('opacity')}</label>
                        <input type="number" min={0} max={1} step={0.05} value={el.style.opacity ?? 1}
                          onFocus={captureForHistory} onBlur={commitCaptured}
                          onChange={e => updateElementStyle(el.id, { opacity: parseFloat(e.target.value) })}
                          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded px-1 py-1 text-[10px] focus:outline-none" />
                      </div>
                    </div>
                  )}
                  </>
                  )}
                </div>
              );
              })}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
            <button onClick={undo} disabled={!canUndo} title={`${t('undo')} (Ctrl+Z)`}
              className="p-2 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30">
              <Undo2 className="w-4 h-4" />
            </button>
            <button onClick={redo} disabled={!canRedo} title={`${t('redo')} (Ctrl+Shift+Z)`}
              className="p-2 text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30 me-auto">
              <Redo2 className="w-4 h-4" />
            </button>
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
