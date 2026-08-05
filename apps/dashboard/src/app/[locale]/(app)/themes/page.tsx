'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Rnd } from 'react-rnd';
import {
  Palette,
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
  Copy,
  Sparkles,
  RotateCw,
  Undo2,
  Redo2,
  Lock,
  LockOpen,
  Type,
  Image,
  Video,
  FileText,
  ListVideo,
  Shapes,
  Brush,
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
import {
  assetsApi,
  themesApi,
  playlistsApi,
  type Theme,
  type ThemeInput,
  type ThemeElement,
  type ThemeElementKind,
  type ThemeElementStyle,
  type ThemeCategory,
  type ThemePalette,
  type ThemeTypography,
  type ThemeWidgetType,
  type ElementShape,
  type ThemeBrushPoint,
} from '@/lib/api';
import { EditorAddSidebar } from '@/components/EditorAddSidebar';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { useRequireSelectToEdit } from '@/hooks/useRequireSelectToEdit';
import { useRotateHandleStyle } from '@/hooks/useRotateHandleStyle';
import { ZoneRotateHandle } from '@/components/ZoneRotateHandle';
import { useAuth } from '@/context/AuthContext';
import { useEditorDirty } from '@/context/EditorDirtyContext';
import { useAuditLog } from '@/hooks/useAuditLog';
import { useEditorHistory } from '@/hooks/useEditorHistory';
import { AssetPicker } from '@/components/AssetPicker';
import { ImagePicker } from '@/components/ImagePicker';
import { CropEditor, type MediaCrop } from '@/components/CropEditor';
import { FontPicker, fontStack } from '@/components/FontPicker';
import { WidgetConfigFields } from '@/components/WidgetConfigFields';
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
import { DEFAULT_FONT_ID, shapeClipStyle, shapeOutlineGeometry, brushPolylinePoints, mediaCropStyle } from '@lumina/types';

// Live preview canvas default size in px — the actual editor canvas is responsive (see
// previewSize below) and takes up the full width of the panel, like the layout editor's.
const PREVIEW_W = 640;
const PREVIEW_H = 360;
const MIN_ELEMENT_PX = 16;
// Grid thumbnails scale text relative to this reference width rather than PREVIEW_W (the
// editor canvas), since thumbnail cards render much narrower than the full editor.
const CARD_SCALE_W = 400;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.25;

const clampPct = (v: number) => Math.min(100, Math.max(0, Math.round(v * 10) / 10));
const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

const CATEGORY_VALUES: ThemeCategory[] = [
  'RESTAURANT_MENU',
  'RETAIL_PROMO',
  'HOTEL_LOBBY',
  'CLINIC_WAITING',
  'MOSQUE',
  'GENERIC',
];
const ASPECT_RATIOS = ['16:9', '9:16', '4:3', '1:1'] as const;
const ELEMENT_KIND_VALUES: ThemeElementKind[] = [
  'TEXT',
  'IMAGE',
  'VIDEO',
  'DOCUMENT',
  'PLAYLIST',
  'SHAPE',
  'BRUSH',
  'WIDGET',
];
const ELEMENT_SHAPES: ElementShape[] = ['rectangle', 'rounded', 'circle', 'triangle', 'pentagon', 'hexagon', 'octagon', 'star', 'arrow'];
const WIDGET_TYPE_VALUES: ThemeWidgetType[] = [
  'PRAYER',
  'WEATHER',
  'CURRENCY',
  'TICKER',
  'TIME',
  'DATE',
  'QR',
];
const PALETTE_ROLES: (keyof ThemePalette)[] = [
  'primary',
  'secondary',
  'background',
  'surface',
  'text',
  'textMuted',
  'accent',
];
const ELEMENT_KIND_ICONS: Record<Exclude<ThemeElementKind, 'WIDGET'>, LucideIcon> = {
  TEXT: Type,
  IMAGE: Image,
  VIDEO: Video,
  DOCUMENT: FileText,
  PLAYLIST: ListVideo,
  SHAPE: Shapes,
  BRUSH: Brush,
};
const WIDGET_TYPE_ICONS: Record<ThemeWidgetType, LucideIcon> = {
  PRAYER: MoonStar,
  WEATHER: CloudSun,
  CURRENCY: DollarSign,
  TICKER: Rss,
  TIME: Clock,
  DATE: Calendar,
  QR: QrCode,
};

const KIND_COLORS: Record<ThemeElementKind, string> = {
  TEXT: '#6366f1',
  IMAGE: '#0ea5e9',
  VIDEO: '#8b5cf6',
  DOCUMENT: '#ef4444',
  PLAYLIST: '#10b981',
  SHAPE: '#64748b',
  BRUSH: '#14b8a6',
  WIDGET: '#f59e0b',
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
  return {
    primary: '#6366f1',
    secondary: '#111827',
    background: '#111111',
    surface: '#1e293b',
    text: '#f8fafc',
    textMuted: '#94a3b8',
    accent: '#f59e0b',
  };
}
function defaultTypography(): ThemeTypography {
  return { headingFont: DEFAULT_FONT_ID, bodyFont: DEFAULT_FONT_ID, baseSizePx: 16, scale: 1.25 };
}
function defaultContentForKind(kind: ThemeElementKind): ThemeElement['content'] {
  switch (kind) {
    case 'TEXT':
      return { text: 'New text' };
    case 'IMAGE':
      return { assetId: null };
    case 'VIDEO':
      return { assetId: null };
    case 'DOCUMENT':
      return { assetId: null, secondsPerPage: 10 };
    case 'PLAYLIST':
      return { playlistId: null };
    case 'SHAPE':
      return {};
    case 'BRUSH':
      return { points: [] };
    case 'WIDGET':
      return { widgetType: 'PRAYER', widgetConfig: {} };
  }
}
function newElementId() {
  return `el_${Math.random().toString(36).slice(2, 9)}`;
}
function blankTheme(): ThemeInput {
  return {
    name: 'New Theme',
    category: 'GENERIC',
    aspectRatio: '16:9',
    palette: defaultPalette(),
    typography: defaultTypography(),
    elements: [
      {
        id: newElementId(),
        kind: 'TEXT',
        x: 5,
        y: 8,
        width: 60,
        height: 15,
        zIndex: 1,
        rotation: 0,
        editable: true,
        label: 'Title',
        style: { fontFamily: 'heading', fontSizePx: 36, fontWeight: 700, color: 'palette.text' },
        content: { text: 'New Theme' },
      },
    ],
  };
}
function themeToInput(theme: Theme): ThemeInput {
  return {
    name: theme.name,
    category: theme.category,
    aspectRatio: theme.aspectRatio,
    palette: theme.palette,
    typography: theme.typography,
    elements: theme.elements,
  };
}

// Renders `shapeFill: 'outline'` as a stroked ring/silhouette instead of a solid fill — a plain
// CSS `border` on a clip-path'd box only follows the box's rectangular edge, not an arbitrary
// polygon, so arrow/star/pentagon/etc. need a real SVG stroke to look like a clean outline.
function ShapeOutline({ shape, color, strokeWidthPx, opacity }: {
  shape: ElementShape | undefined;
  color: string;
  strokeWidthPx: number | undefined;
  opacity?: number;
}) {
  const geo = shapeOutlineGeometry(shape);
  const sw = strokeWidthPx ?? 4;
  const inset = sw / 2;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block', opacity }}>
      {geo.kind === 'rect' && (
        <rect x={inset} y={inset} width={100 - sw} height={100 - sw} rx={geo.rx} fill="none" stroke={color} strokeWidth={sw} />
      )}
      {geo.kind === 'ellipse' && (
        <ellipse cx={50} cy={50} rx={50 - inset} ry={50 - inset} fill="none" stroke={color} strokeWidth={sw} />
      )}
      {geo.kind === 'polygon' && (
        <polygon points={geo.points} fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" />
      )}
    </svg>
  );
}

// Quick-add panel for the Shape item in EditorAddSidebar — picks shape/fill/color before the
// element exists at all, instead of dropping in a default rectangle and sending the user down to
// the element cards to fix it up. Local state only; nothing is added until "Add shape" fires.
function ShapeQuickAddPanel({ palette, onAdd }: {
  palette: ThemePalette;
  onAdd: (style: Partial<ThemeElementStyle>) => void;
}) {
  const t = useTranslations('themes');
  const [shape, setShape] = useState<ElementShape>('rectangle');
  const [fill, setFill] = useState<'solid' | 'outline'>('solid');
  const [color, setColor] = useState<string | undefined>(undefined);
  const isCustomColor = color !== undefined && !color.startsWith('palette.');

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-5 gap-1">
        {ELEMENT_SHAPES.map((s) => (
          <button
            key={s}
            type="button"
            title={t(`shapeTypes.${s}`)}
            onClick={() => setShape(s)}
            className={`flex h-7 w-7 items-center justify-center rounded border ${
              shape === s
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
                : 'border-gray-200 dark:border-gray-700'
            }`}
          >
            {fill === 'outline' ? (
              <span style={{ width: 14, height: 14, display: 'block' }}>
                <ShapeOutline shape={s} color="#94a3b8" strokeWidthPx={2.5} />
              </span>
            ) : (
              <span style={{ width: 14, height: 14, display: 'block', background: '#94a3b8', ...shapeClipStyle(s) }} />
            )}
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        {(['solid', 'outline'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFill(f)}
            className={`flex-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              fill === f
                ? 'bg-indigo-600 text-white'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
            }`}
          >
            {f === 'solid' ? t('fillStyleSolid') : t('fillStyleOutline')}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {PALETTE_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            title={r}
            onClick={() => setColor(`palette.${r}`)}
            style={{ background: palette[r] }}
            className={`h-5 w-5 rounded-full border-2 ${
              color === `palette.${r}` ? 'border-indigo-500' : 'border-transparent'
            }`}
          />
        ))}
        <label
          title={t('customColor')}
          style={{ background: isCustomColor ? color : undefined }}
          className={`relative flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 ${
            isCustomColor ? 'border-indigo-500' : 'border-gray-300 dark:border-gray-600'
          } ${isCustomColor ? '' : 'bg-[conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)]'}`}
        >
          <input
            type="color"
            value={isCustomColor ? color : '#ff0000'}
            onChange={(e) => setColor(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={() => onAdd({ shape, shapeFill: fill, backgroundColor: color })}
        className="mt-1 rounded-md bg-indigo-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700"
      >
        {t('quickAddShape')}
      </button>
    </div>
  );
}

// Quick-add panel for the Text item — lets the user type the actual copy (and its Arabic
// translation) before the element lands on the canvas, instead of dropping in "New text" and
// sending them to the card below to fix it up.
function TextQuickAddPanel({ onAdd }: { onAdd: (content: { text: string; translations?: { ar: string } }) => void }) {
  const t = useTranslations('themes');
  const [text, setText] = useState('');
  const [ar, setAr] = useState('');

  return (
    <div className="flex flex-col gap-1.5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('text')}
        className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
      />
      <input
        dir="rtl"
        value={ar}
        onChange={(e) => setAr(e.target.value)}
        placeholder={t('translationAr')}
        className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
      />
      <button
        type="button"
        onClick={() => onAdd({ text: text.trim() || 'New text', translations: ar.trim() ? { ar: ar.trim() } : undefined })}
        className="mt-1 rounded-md bg-indigo-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700"
      >
        {t('quickAdd')}
      </button>
    </div>
  );
}

// Quick-add panel for the Image item — the same existing/upload/paste picker as the element card
// uses, just fired before the element exists yet: picking (or finishing an upload/paste) creates
// the element immediately with that asset already attached, no separate confirm click needed.
function ImageQuickAddPanel({ onAdd }: { onAdd: (assetId: string) => void }) {
  const t = useTranslations('themes');
  const [assetId, setAssetId] = useState<string | null>(null);

  return (
    <ImagePicker
      value={assetId}
      placeholder={t('noAsset')}
      onChange={(id) => {
        setAssetId(id);
        if (id) onAdd(id);
      }}
      labels={{
        existing: t('imageSourceExisting'),
        upload: t('imageSourceUpload'),
        paste: t('imageSourcePaste'),
        uploading: t('uploadingImage'),
        uploadFailed: t('uploadImageFailed'),
        pasteHint: t('pasteImageHint'),
        pasteError: t('pasteImageError'),
      }}
    />
  );
}

// Quick-add panel for Video/Document — same plain asset dropdown as those elements' cards use
// (neither offers upload/paste there, so the quick panel doesn't invent options the card lacks).
// Picking an asset creates the element immediately, same auto-confirm behavior as the image panel.
function AssetQuickAddPanel({
  types,
  placeholder,
  onAdd,
}: {
  types: ('IMAGE' | 'VIDEO' | 'DOCUMENT')[];
  placeholder: string;
  onAdd: (assetId: string) => void;
}) {
  return (
    <AssetPicker
      types={types}
      value={null}
      placeholder={placeholder}
      onChange={(id) => {
        if (id) onAdd(id);
      }}
    />
  );
}

// Quick-add panel for Playlist — mirrors the card's playlist dropdown; selecting one creates the
// element immediately.
function PlaylistQuickAddPanel({
  playlists,
  placeholder,
  onAdd,
}: {
  playlists: { id: string; name: string }[];
  placeholder: string;
  onAdd: (playlistId: string) => void;
}) {
  return (
    <select
      value=""
      onChange={(e) => {
        if (e.target.value) onAdd(e.target.value);
      }}
      className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
    >
      <option value="">{placeholder}</option>
      {playlists.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}

// Quick-add panel for live-widget items (Weather, Currency, Ticker, Time, Date, Prayer, QR) — the
// same per-type config fields the element card uses, configured up front instead of defaults +
// a trip down to the card. Local state only; nothing is added until the confirm button fires.
function WidgetQuickAddPanel({
  widgetType,
  onAdd,
}: {
  widgetType: ThemeWidgetType;
  onAdd: (config: Record<string, unknown>) => void;
}) {
  const t = useTranslations('themes');
  const [config, setConfig] = useState<Record<string, unknown>>({});

  return (
    <div className="flex flex-col gap-2">
      <WidgetConfigFields
        widgetType={widgetType}
        config={config}
        onChange={setConfig}
        onChangeCommitted={setConfig}
        onFocusField={() => {}}
        onBlurField={() => {}}
      />
      <button
        type="button"
        onClick={() => onAdd(config)}
        className="rounded-md bg-indigo-600 px-2 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700"
      >
        {t('quickAdd')}
      </button>
    </div>
  );
}

function CopyHexButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
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
      className="shrink-0 p-1 text-gray-400 hover:text-indigo-600 dark:text-gray-500 dark:hover:text-indigo-400"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

interface ColorFieldProps {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  // Brackets the raw color-picker drag into a single undo step (like every other continuous
  // input in this editor) — the select below is a one-shot discrete pick, so its own onChange
  // is left for the caller to wrap in commit() instead.
  onFocusField?: () => void;
  onBlurField?: () => void;
}
function ColorField({ label, value, onChange, onFocusField, onBlurField }: ColorFieldProps) {
  const isPaletteRef = value?.startsWith('palette.') ?? false;
  return (
    <div>
      <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">{label}</label>
      <div className="flex items-center gap-1">
        <select
          value={isPaletteRef ? value!.slice(8) : value ? 'custom' : ''}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) onChange(undefined);
            else if (v === 'custom') onChange(value && !isPaletteRef ? value : '#000000');
            else onChange(`palette.${v}`);
          }}
          className="min-w-0 flex-1 rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        >
          <option value="">—</option>
          {PALETTE_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {!isPaletteRef && value && (
          <>
            <input
              type="color"
              value={value}
              onFocus={onFocusField}
              onBlur={onBlurField}
              onChange={(e) => onChange(e.target.value)}
              className="h-7 w-7 shrink-0 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
            />
            <span className="shrink-0 font-mono text-[9px] text-gray-400 dark:text-gray-500">
              {value}
            </span>
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
  const tCrop = useTranslations('cropEditor');

  const { data: themes = [], isLoading } = useQuery({
    queryKey: ['themes'],
    queryFn: themesApi.list,
  });
  const { data: playlists = [] } = useQuery({
    queryKey: ['playlists'],
    queryFn: playlistsApi.list,
  });
  // Same query key AssetPicker uses, so this just reads react-query's existing cache instead of
  // firing a second request — needed here so the canvas can render the actual selected asset's
  // thumbnail instead of always showing a flat placeholder box.
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });

  const presets = themes.filter((th) => th.organizationId === null);
  const ownThemes = themes.filter((th) => th.organizationId !== null);

  const [editing, setEditing] = useState<Theme | 'new' | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ThemeCategory>('GENERIC');
  const [aspectRatio, setAspectRatio] = useState<string>('16:9');
  const [palette, setPalette] = useState<ThemePalette>(defaultPalette());
  const [typography, setTypography] = useState<ThemeTypography>(defaultTypography());
  const [elements, setElements] = useState<ThemeElement[]>([]);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [croppingElementId, setCroppingElementId] = useState<string | null>(null);
  const [dragBox, setDragBox] = useState<({ id: string } & Box) | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [rotationDrag, setRotationDrag] = useState<{ id: string; deg: number } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [search, setSearch] = useState('');
  const filteredPresets = presets.filter((th) => th.name.toLowerCase().includes(search.toLowerCase()));
  const filteredOwnThemes = ownThemes.filter((th) => th.name.toLowerCase().includes(search.toLowerCase()));
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
  // Double-clicking a TEXT element on the canvas edits its content in place instead of forcing a
  // trip down to the element card — mirrors how the card's own text field captures history.
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const { enabled: requireSelectToEdit } = useRequireSelectToEdit();
  const { style: rotateHandleStyle } = useRotateHandleStyle();
  // Brush drawing mode: armed by the sidebar's Brush item, then a single pointer drag on the
  // canvas records a stroke and turns it into a new BRUSH element on release. `points` are in
  // canvas-relative percent (0–100) while drawing; they get re-normalized to the new element's
  // own bounding box once the stroke is finished, matching how every other element's content is
  // stored relative to itself rather than the canvas.
  const [brushArmed, setBrushArmed] = useState(false);
  const [brushDraft, setBrushDraft] = useState<ThemeBrushPoint[] | null>(null);
  // Set by an existing BRUSH element's "Redraw" button — the next stroke replaces that element's
  // points/box in place instead of creating a new element.
  const [brushRedrawId, setBrushRedrawId] = useState<string | null>(null);
  // Color/width picked in the draw-mode hint bar, applied to the next stroke that's committed.
  // Persist across strokes (not reset on finish) so drawing several strokes in a row keeps using
  // the same brush instead of falling back to a default each time.
  const [brushColor, setBrushColor] = useState<string | undefined>('palette.primary');
  const [brushSize, setBrushSize] = useState(4);

  interface EditorSnapshot {
    name: string;
    category: ThemeCategory;
    aspectRatio: string;
    palette: ThemePalette;
    typography: ThemeTypography;
    elements: ThemeElement[];
  }
  const { canUndo, canRedo, undo, redo, commit, captureForHistory, commitCaptured } =
    useEditorHistory<EditorSnapshot>(
      editing,
      () => ({ name, category, aspectRatio, palette, typography, elements }),
      (s) => {
        setName(s.name);
        setCategory(s.category);
        setAspectRatio(s.aspectRatio);
        setPalette(s.palette);
        setTypography(s.typography);
        setElements(s.elements);
      },
    );

  // Lets the app shell warn before navigating away mid-edit — canUndo already tracks "at least
  // one change committed since this session opened" so it doubles as the dirty flag for free.
  const { setDirty } = useEditorDirty();
  useEffect(() => {
    setDirty(editing !== null && canUndo);
  }, [editing, canUndo, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  // Live preview canvas size in px — kept in sync with its actual rendered width (like the
  // layout editor's) so the preview takes up the full panel width instead of a fixed small box.
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: PREVIEW_W, height: PREVIEW_H });

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () =>
      setPreviewSize({
        width: el.clientWidth,
        height: el.clientWidth / parseAspectRatio(aspectRatio),
      });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing, aspectRatio]);

  // Canvas zoom: previewRef's own box is deliberately resized (not CSS-transform-scaled), so every
  // existing bit of pointer math above — which already works purely off previewSize/getBoundingClientRect
  // of the real rendered box — keeps working unchanged at any zoom level. zoomViewportRef measures the
  // *unzoomed* available width so the scroll window's size stays stable while only its content grows.
  const [zoom, setZoom] = useState(1);
  const zoomViewportRef = useRef<HTMLDivElement>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);

  // Resets zoom when switching which theme is open for editing — not a cascading-render risk,
  // since zoom only affects this component's own canvas sizing and nothing downstream reacts to it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    mutationFn: () =>
      themesApi.create({ name, category, aspectRatio, palette, typography, elements }),
    onSuccess: (created) => {
      logAction({
        resourceType: 'THEME',
        resourceName: created.name,
        action: 'CREATE',
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['themes'] });
      setEditing(null);
    },
  });
  const updateMut = useMutation({
    mutationFn: () =>
      themesApi.update((editing as Theme).id, {
        name,
        category,
        aspectRatio,
        palette,
        typography,
        elements,
      }),
    onSuccess: (updated) => {
      logAction({
        resourceType: 'THEME',
        resourceName: updated.name,
        action: 'UPDATE',
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
      });
      void qc.invalidateQueries({ queryKey: ['themes'] });
      setEditing(null);
    },
  });
  const removeMut = useMutation({
    mutationFn: (theme: Theme) => themesApi.remove(theme.id),
    onSuccess: (_data, theme) => {
      setDeleteError('');
      logAction({
        resourceType: 'THEME',
        resourceName: theme.name,
        action: 'DELETE',
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
      });
      qc.setQueryData<Theme[]>(['themes'], (old) => old?.filter((th) => th.id !== theme.id));
      void qc.invalidateQueries({ queryKey: ['themes'] });
    },
    onError: (e: Error) => setDeleteError(e.message),
  });
  const renameMut = useMutation({
    mutationFn: ({ theme, name: newName }: { theme: Theme; name: string }) =>
      themesApi.update(theme.id, { ...themeToInput(theme), name: newName }),
    onSuccess: (updated, { theme }) => {
      logAction({
        resourceType: 'THEME',
        resourceName: theme.name,
        action: 'UPDATE',
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
        detail: ta('detailRenamedTo', { name: updated.name }),
      });
      void qc.invalidateQueries({ queryKey: ['themes'] });
      setRenamingId(null);
    },
  });
  const duplicateMut = useMutation({
    mutationFn: (theme: Theme) => themesApi.duplicate(theme.id),
    onSuccess: (created, theme) => {
      logAction({
        resourceType: 'THEME',
        resourceName: created.name,
        action: 'CREATE',
        userName: user?.name ?? '',
        userEmail: user?.email ?? '',
        detail: ta('detailDuplicatedFrom', { name: theme.name }),
      });
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
    setElements(theme.elements.map((el) => ({ ...el })));
    setSelectedElementId(null);
  }

  function startRename(theme: Theme) {
    if (!canEditContent) return;
    setRenamingId(theme.id);
    setRenameValue(theme.name);
  }
  function commitRename(theme: Theme) {
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === theme.name) {
      setRenamingId(null);
      return;
    }
    renameMut.mutate({ theme, name: trimmed });
  }

  function updateElement(
    id: string,
    patch: Partial<
      Pick<
        ThemeElement,
        'x' | 'y' | 'width' | 'height' | 'zIndex' | 'rotation' | 'label' | 'editable'
      >
    >,
  ) {
    setElements((prev) => prev.map((el) => (el.id === id ? { ...el, ...patch } : el)));
  }
  function updateElementKind(id: string, kind: ThemeElementKind) {
    setElements((prev) =>
      prev.map((el) =>
        el.id === id ? ({ ...el, kind, content: defaultContentForKind(kind) } as ThemeElement) : el,
      ),
    );
  }
  function updateElementContent(id: string, patch: Record<string, unknown>) {
    setElements((prev) =>
      prev.map((el) =>
        el.id === id ? ({ ...el, content: { ...el.content, ...patch } } as ThemeElement) : el,
      ),
    );
  }
  function updateElementStyle(id: string, patch: ThemeElementStyle) {
    setElements((prev) =>
      prev.map((el) => (el.id === id ? { ...el, style: { ...el.style, ...patch } } : el)),
    );
  }
  // A zone must be selected (single click) before it can be dragged/resized/rotated — unless
  // requireSelectToEdit is off, or the element is locked (editable: false), which always wins.
  const getBoxPx = useCallback(
    (el: ThemeElement): Box => ({
      left: (el.x / 100) * previewSize.width,
      top: (el.y / 100) * previewSize.height,
      width: (el.width / 100) * previewSize.width,
      height: (el.height / 100) * previewSize.height,
    }),
    [previewSize],
  );

  // Alignment guides only make sense against another element's actual visible edges — a rotated
  // element's unrotated left/top/width/height box doesn't correspond to anything on screen, so
  // it's excluded both as a snap target for others and (in handleDrag below) as something that
  // itself snaps while being dragged.
  const computeTargets = useCallback(
    (excludeId: string) => {
      const otherBoxes = elements
        .filter((el) => el.id !== excludeId && !(el.rotation ?? 0))
        .map(getBoxPx);
      return computeAlignTargets(previewSize.width, previewSize.height, otherBoxes);
    },
    [elements, previewSize, getBoxPx],
  );

  const clampToCanvas = useCallback(
    (box: Box): Box => clampBox(box, previewSize.width, previewSize.height),
    [previewSize],
  );

  function handleDrag(el: ThemeElement, x: number, y: number) {
    const box = getBoxPx(el);
    if (el.rotation) {
      setDragBox({
        id: el.id,
        ...clampToCanvas({ left: x, top: y, width: box.width, height: box.height }),
      });
      setGuides({ v: [], h: [] });
      return;
    }
    const { xs, ys } = computeTargets(el.id);
    const snapX = snapDragAxis(x, box.width, xs);
    const snapY = snapDragAxis(y, box.height, ys);
    const next = clampToCanvas({
      left: snapX.pos,
      top: snapY.pos,
      width: box.width,
      height: box.height,
    });
    setDragBox({ id: el.id, ...next });
    setGuides({
      v: snapX.guide !== null ? [snapX.guide] : [],
      h: snapY.guide !== null ? [snapY.guide] : [],
    });
  }

  function handleDragStop(el: ThemeElement, x: number, y: number) {
    const box = getBoxPx(el);
    if (el.rotation) {
      const next = clampToCanvas({ left: x, top: y, width: box.width, height: box.height });
      commit(() =>
        updateElement(el.id, {
          x: clampPct((next.left / previewSize.width) * 100),
          y: clampPct((next.top / previewSize.height) * 100),
        }),
      );
      setDragBox(null);
      setGuides({ v: [], h: [] });
      return;
    }
    const { xs, ys } = computeTargets(el.id);
    const snapX = snapDragAxis(x, box.width, xs);
    const snapY = snapDragAxis(y, box.height, ys);
    const next = clampToCanvas({
      left: snapX.pos,
      top: snapY.pos,
      width: box.width,
      height: box.height,
    });
    commit(() =>
      updateElement(el.id, {
        x: clampPct((next.left / previewSize.width) * 100),
        y: clampPct((next.top / previewSize.height) * 100),
      }),
    );
    setDragBox(null);
    setGuides({ v: [], h: [] });
  }

  function handleResize(
    el: ThemeElement,
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
      computeTargets(el.id),
      MIN_ELEMENT_PX,
      previewSize.width,
      previewSize.height,
    );
    setDragBox({ id: el.id, ...next });
    setGuides(guides);
  }

  function handleResizeStop(
    el: ThemeElement,
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
      computeTargets(el.id),
      MIN_ELEMENT_PX,
      previewSize.width,
      previewSize.height,
    );
    commit(() =>
      updateElement(el.id, {
        x: clampPct((next.left / previewSize.width) * 100),
        y: clampPct((next.top / previewSize.height) * 100),
        width: clampPct((next.width / previewSize.width) * 100),
        height: clampPct((next.height / previewSize.height) * 100),
      }),
    );
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

    function rawAngleFor(clientX: number, clientY: number): number {
      const mx = clientX - canvasRect.left;
      const my = clientY - canvasRect.top;
      let deg = Math.atan2(my - cy, mx - cx) * (180 / Math.PI) + 90;
      return ((deg % 360) + 360) % 360;
    }

    // The corner handles sit well off the element's own top-center reference point, so the
    // mouse's raw angle at drag start doesn't equal the element's current rotation (e.g. grabbing
    // the "ne" handle starts ~45-135° off, depending on aspect ratio) — using it directly would
    // snap the rotation to wherever that handle happens to sit the instant the drag begins.
    // Capturing that gap once and holding it constant for the drag makes rotation track the
    // mouse's angular movement from whichever point was actually grabbed, continuing smoothly
    // from the current rotation instead of jumping to it.
    const startOffset = rawAngleFor(e.clientX, e.clientY) - (el.rotation ?? 0);

    function angleFor(clientX: number, clientY: number): number {
      let deg = rawAngleFor(clientX, clientY) - startOffset;
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
      commit(() =>
        updateElement(el.id, {
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

  // Shared by the generic "Add element" button in the card list and the type-specific entries in
  // the right-side add sidebar — selects the new element immediately so its card is ready to edit.
  function addElementOfKind(
    kind: ThemeElementKind,
    widgetType?: ThemeWidgetType,
    styleOverrides?: Partial<ThemeElementStyle>,
    contentOverride?: Record<string, unknown>,
  ) {
    const id = newElementId();
    const baseContent =
      kind === 'WIDGET' && widgetType
        ? { widgetType, widgetConfig: {} }
        : defaultContentForKind(kind);
    const content = { ...baseContent, ...contentOverride };
    const element = {
      id,
      kind,
      x: 20,
      y: 20,
      width: 40,
      height: 15,
      zIndex: elements.length,
      rotation: 0,
      editable: true,
      style: { ...(kind === 'TEXT' ? { color: 'palette.text' } : {}), ...styleOverrides },
      content,
    } as ThemeElement;
    commit(() => setElements((prev) => [...prev, element]));
    setSelectedElementId(id);
  }
  function addElement() {
    addElementOfKind('TEXT');
  }
  function removeElement(id: string) {
    commit(() => setElements((prev) => prev.filter((el) => el.id !== id)));
  }

  // Converts a pointer event's page position to canvas-relative percent (0–100), clamped to the
  // canvas bounds — same conversion startRotate/startResizeElement use, just percent instead of px.
  function canvasPointPct(clientX: number, clientY: number): ThemeBrushPoint | null {
    const canvas = previewRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100)),
    };
  }
  function startBrushStroke(e: React.PointerEvent) {
    if (!brushArmed) return;
    e.preventDefault();
    e.stopPropagation();
    const pt = canvasPointPct(e.clientX, e.clientY);
    if (!pt) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setBrushDraft([pt]);
  }
  function moveBrushStroke(e: React.PointerEvent) {
    if (!brushDraft) return;
    // A second button (almost always right-click) going down mid-stroke reports as a
    // pointermove with an updated `buttons` mask rather than a new pointerdown/pointerup —
    // it's virtually always an accidental chord, so cancel outright instead of drawing with it.
    if (e.buttons !== 1) {
      cancelBrushStroke();
      return;
    }
    const pt = canvasPointPct(e.clientX, e.clientY);
    if (!pt) return;
    setBrushDraft((prev) => {
      if (!prev) return prev;
      const last = prev[prev.length - 1];
      // Skip points that barely moved so a slow stroke doesn't bloat the saved array.
      if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 0.5) return prev;
      return [...prev, pt];
    });
  }
  function cancelBrushStroke() {
    const redrawId = brushRedrawId;
    setBrushDraft(null);
    setBrushRedrawId(null);
    // Mirrors finishBrushStroke's disarm rule: a redraw is a one-shot action either way.
    if (redrawId) setBrushArmed(false);
  }
  // Shared by the live draw-mode preview and the finished element so both render the exact same
  // geometry: a stroke's points/box are stored relative to its own tight bounding box (like every
  // other element), not the full canvas, so the preview has to use that same local space while
  // still drawing — otherwise a raw strokeWidth number means a different pixel width in each.
  function brushBounds(points: ThemeBrushPoint[]) {
    const pad = 1.5;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.max(0, Math.min(...xs) - pad);
    const maxX = Math.min(100, Math.max(...xs) + pad);
    const minY = Math.max(0, Math.min(...ys) - pad);
    const maxY = Math.min(100, Math.max(...ys) + pad);
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const relative = points.map((p) => ({
      x: clampPct(((p.x - minX) / width) * 100),
      y: clampPct(((p.y - minY) / height) * 100),
    }));
    const box = { x: clampPct(minX), y: clampPct(minY), width: clampPct(width), height: clampPct(height) };
    return { box, relative };
  }
  function finishBrushStroke() {
    const points = brushDraft;
    const redrawId = brushRedrawId;
    setBrushDraft(null);
    setBrushRedrawId(null);
    // Redraw only ever targets one specific element, so it's a one-shot action — disarm once it
    // lands. A fresh stroke stays armed (brushArmed untouched) so the brush can be used several
    // times in a row without having to be re-selected from the sidebar each time.
    if (redrawId) setBrushArmed(false);
    if (!points || points.length < 2) return;
    const { box, relative } = brushBounds(points);
    if (redrawId) {
      commit(() =>
        setElements((prev) =>
          prev.map((el) =>
            el.id === redrawId && el.kind === 'BRUSH'
              ? { ...el, ...box, content: { points: relative } }
              : el,
          ),
        ),
      );
      setSelectedElementId(redrawId);
      return;
    }
    const id = newElementId();
    const element: ThemeElement = {
      id,
      kind: 'BRUSH',
      ...box,
      zIndex: elements.length,
      rotation: 0,
      editable: true,
      style: { backgroundColor: brushColor, strokeWidthPx: brushSize },
      content: { points: relative },
    };
    commit(() => setElements((prev) => [...prev, element]));
    setSelectedElementId(id);
  }

  const saving = createMut.isPending || updateMut.isPending;

  function renderPreviewElements(els: ThemeElement[], pal: ThemePalette, scaleW: number) {
    return [...els]
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((el) => {
        const isOutlineShape = el.kind === 'SHAPE' && el.style.shapeFill === 'outline';
        const isBrush = el.kind === 'BRUSH';
        const bg =
          el.kind === 'SHAPE'
            ? (isOutlineShape ? 'transparent' : (resolveColor(el.style.backgroundColor, pal) ?? KIND_COLORS.SHAPE + '55'))
            : isBrush
              ? 'transparent'
              : KIND_COLORS[el.kind] + '33';
        const border = KIND_COLORS[el.kind];
        return (
          <div
            key={el.id}
            style={{
              position: 'absolute',
              left: `${el.x}%`,
              top: `${el.y}%`,
              width: `${el.width}%`,
              height: `${el.height}%`,
              background: bg,
              border: `1px solid ${border}`,
              borderRadius: el.style.borderRadius,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 2,
              transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
              ...(isOutlineShape ? {} : shapeClipStyle(el.style.shape)),
            }}
          >
            {isOutlineShape && (
              <div style={{ position: 'absolute', inset: 0 }}>
                <ShapeOutline
                  shape={el.style.shape}
                  color={resolveColor(el.style.backgroundColor, pal) ?? pal.text}
                  strokeWidthPx={el.style.strokeWidthPx}
                />
              </div>
            )}
            {isBrush && (
              <div style={{ position: 'absolute', inset: 0 }}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
                  <polyline
                    points={brushPolylinePoints(el.content.points)}
                    fill="none"
                    stroke={resolveColor(el.style.backgroundColor, pal) ?? pal.text}
                    strokeWidth={el.style.strokeWidthPx ?? 4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            )}
            {el.kind === 'TEXT' && (
              <span
                style={{
                  fontSize: Math.max(6, Math.min(el.style.fontSizePx ?? 16, 40) * (scaleW / 400)),
                  fontWeight: el.style.fontWeight as number | undefined,
                  fontFamily:
                    el.style.fontFamily === 'heading' || el.style.fontFamily === 'body'
                      ? undefined
                      : fontStack(el.style.fontFamily),
                  color: resolveColor(el.style.color, pal) ?? pal.text,
                  textAlign: el.style.textAlign ?? 'left',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%',
                }}
              >
                {el.content.text}
              </span>
            )}
            {el.kind !== 'TEXT' && el.kind !== 'SHAPE' && el.kind !== 'BRUSH' && (
              <span style={{ fontSize: 8, color: border, fontWeight: 600, textAlign: 'center' }}>
                {el.label ?? el.kind}
              </span>
            )}
          </div>
        );
      });
  }

  return (
    // Wider cap while editing, but only at the breakpoint where EditorAddSidebar's persistent
    // rail actually shows (see its own comment) — that rail reserves space via `pe-72` on the
    // editor panel below, and widening the page cap to match keeps the editing area at least as
    // big as its normal (no-sidebar) size instead of just eating into the original max-w-7xl.
    <div className={`mx-auto max-w-7xl p-8 ${editing ? 'min-[1920px]:max-w-[2200px]' : ''}`}>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t('subtitle')}</p>
        </div>
        {canEditContent && !editing && (
          <button
            onClick={openNew}
            className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4" /> {t('newTheme')}
          </button>
        )}
      </div>

      {/* Editor panel */}
      {editing && canEditContent && (
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm min-[1920px]:pe-72 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onFocus={captureForHistory}
              onBlur={commitCaptured}
              className="w-64 border-b border-transparent bg-transparent text-lg font-semibold text-gray-900 hover:border-gray-300 focus:border-indigo-500 focus:outline-none dark:text-gray-100 dark:hover:border-gray-600"
              placeholder={t('themeName')}
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={category}
                onChange={(e) => commit(() => setCategory(e.target.value as ThemeCategory))}
                className="rounded border border-gray-200 px-2 py-1.5 text-xs focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                {CATEGORY_VALUES.map((c) => (
                  <option key={c} value={c}>
                    {t(`categories.${c}`)}
                  </option>
                ))}
              </select>
              <select
                value={aspectRatio}
                onChange={(e) => commit(() => setAspectRatio(e.target.value))}
                className="rounded border border-gray-200 px-2 py-1.5 text-xs focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                {ASPECT_RATIOS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Visual preview, full-width, with element settings stacked below — mirrors the
              layout editor's shell so both editors share the same overall structure. The floating
              EditorAddSidebar (rendered after this panel, outside its layout flow entirely) is
              the primary way to add new elements, so the element cards can focus on editing what
              already exists — the generic "Add element" button in the card list still works too. */}
          <div className="flex flex-col gap-6">
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
              {brushArmed && (
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-xs text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>{t('brushDrawHint')}</span>
                    <div className="flex items-center gap-1">
                      {PALETTE_ROLES.map((r) => (
                        <button
                          key={r}
                          type="button"
                          title={r}
                          onClick={() => setBrushColor(`palette.${r}`)}
                          style={{ background: palette[r] }}
                          className={`h-4 w-4 rounded-full border-2 ${
                            brushColor === `palette.${r}`
                              ? 'border-teal-600 dark:border-teal-300'
                              : 'border-transparent'
                          }`}
                        />
                      ))}
                      <label
                        title={t('customColor')}
                        style={{
                          background:
                            brushColor && !brushColor.startsWith('palette.') ? brushColor : undefined,
                        }}
                        className={`relative flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full border-2 ${
                          brushColor && !brushColor.startsWith('palette.')
                            ? 'border-teal-600 dark:border-teal-300'
                            : 'border-white/60 bg-[conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)]'
                        }`}
                      >
                        <input
                          type="color"
                          value={brushColor && !brushColor.startsWith('palette.') ? brushColor : '#14b8a6'}
                          onChange={(e) => setBrushColor(e.target.value)}
                          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                        />
                      </label>
                    </div>
                    <label className="flex items-center gap-1" title={t('strokeWidth')}>
                      <Brush className="h-3 w-3" />
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={brushSize}
                        onChange={(e) => setBrushSize(Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                        className="w-10 rounded border border-teal-300 bg-white px-1 py-0.5 text-[10px] text-teal-700 focus:outline-none dark:border-teal-800 dark:bg-gray-900 dark:text-teal-300"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setBrushArmed(false);
                      setBrushDraft(null);
                      setBrushRedrawId(null);
                    }}
                    className="font-medium underline"
                  >
                    {tc('cancel')}
                  </button>
                </div>
              )}
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
                style={{
                  width: '100%',
                  aspectRatio: aspectRatio.replace(':', ' / '),
                  overflow: zoom > 1 ? 'auto' : 'visible',
                  borderRadius: 6,
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: naturalWidth ? naturalWidth * zoom : '100%',
                    aspectRatio: aspectRatio.replace(':', ' / '),
                  }}
                >
                <div
                  ref={previewRef}
                  onMouseDown={(e) => {
                    if (e.target === e.currentTarget) setSelectedElementId(null);
                  }}
                  // Clipped to the frame — a rotated element's fill must never visually spill onto
                  // the rest of the editor once its rotated footprint exceeds the canvas rect. The
                  // rotate grip and the custom rotation-aware resize handles are rendered
                  // separately, in the unclipped overlay just below (same box/rotation math), so
                  // they stay reachable even where they'd otherwise land outside the frame.
                  style={{
                    width: '100%',
                    aspectRatio: aspectRatio.replace(':', ' / '),
                    background: palette.background,
                    position: 'relative',
                    // Contains each element's own `zIndex` style (set below) within this frame's
                    // stacking context, so no element can paint above the unclipped resize-handle
                    // overlay rendered as this div's sibling further down.
                    isolation: 'isolate',
                    borderRadius: 6,
                    overflow: 'hidden',
                    border: '1px solid rgba(0,0,0,0.1)',
                  }}
                >
                  {previewSize.width > 0 &&
                    elements.map((el) => {
                      const isSelected = el.id === selectedElementId;
                      const isHovered = el.id === hoveredElementId;
                      const interactive = elementIsInteractive(el, isSelected);
                      const box = dragBox && dragBox.id === el.id ? dragBox : getBoxPx(el);
                      const liveRotation =
                        rotationDrag && rotationDrag.id === el.id ? rotationDrag.deg : el.rotation;
                      const rotation = el.rotation ?? 0;
                      const assetId =
                        el.kind === 'IMAGE' || el.kind === 'VIDEO' || el.kind === 'DOCUMENT' ? el.content.assetId : null;
                      const asset = assetId ? assets.find((a) => a.id === assetId) : undefined;
                      // IMAGE previews immediately off the raw url — the file is already stored
                      // the moment upload finishes, only thumbnail generation is still async — so
                      // there's no need to wait on `status === 'READY'` before showing it. VIDEO
                      // still waits: its "thumb" is a poster frame that only exists once
                      // processing completes, and the raw asset url is a video file an <img> can't
                      // render at all.
                      const thumb = !asset
                        ? null
                        : el.kind === 'IMAGE' || asset.status === 'READY'
                          ? (asset.thumbnailUrl ?? asset.url)
                          : null;
                      const isCanvasOutlineShape = el.kind === 'SHAPE' && el.style.shapeFill === 'outline';
                      const isCanvasBrush = el.kind === 'BRUSH';
                      return (
                        <Rnd
                          key={el.id}
                          bounds="parent"
                          minWidth={MIN_ELEMENT_PX}
                          minHeight={MIN_ELEMENT_PX}
                          disableDragging={!interactive || editingTextId === el.id}
                          // react-rnd's own resize handles are anchored to the unrotated box, which no
                          // longer matches the visible (rotated) shape — once rotated, use the custom
                          // rotation-aware handles rendered below instead.
                          enableResizing={interactive && rotation === 0 ? undefined : false}
                          cancel=".rotate-handle, .resize-handle, .inline-text-edit"
                          size={{ width: box.width, height: box.height }}
                          position={{ x: box.left, y: box.top }}
                          onMouseDown={() => setSelectedElementId(el.id)}
                          onDragStart={() => setSelectedElementId(el.id)}
                          onDrag={(_e, d) => handleDrag(el, d.x, d.y)}
                          onDragStop={(_e, d) => handleDragStop(el, d.x, d.y)}
                          onResize={(_e, dir, ref, _delta, position) =>
                            handleResize(el, dir, ref, position)
                          }
                          onResizeStop={(_e, dir, ref, _delta, position) =>
                            handleResizeStop(el, dir, ref, position)
                          }
                          style={{ zIndex: el.zIndex, overflow: 'visible' }}
                        >
                          {/* react-rnd/react-draggable owns the root node's own `transform` (it uses
                            translate() there for positioning) and will clobber a `rotate()` set
                            alongside it — so rotation lives on this separate inner wrapper instead. */}
                          <div
                            onMouseEnter={() => setHoveredElementId(el.id)}
                            onMouseLeave={() =>
                              setHoveredElementId((id) => (id === el.id ? null : id))
                            }
                            style={{
                              width: '100%',
                              height: '100%',
                              position: 'relative',
                              cursor: isSelected ? 'move' : 'pointer',
                              transform: liveRotation ? `rotate(${liveRotation}deg)` : undefined,
                            }}
                          >
                            {/* Shape-clipped fill — the true rectangular bounding box only shows on
                              hover/select (below), since a circle/triangle shape would otherwise
                              look like it has an invisible rectangular halo. */}
                            <div
                              style={{
                                position: 'absolute',
                                inset: 0,
                                background: thumb
                                  ? '#000'
                                  : el.kind === 'SHAPE'
                                    ? (isCanvasOutlineShape ? 'transparent' : (resolveColor(el.style.backgroundColor, palette) ??
                                      KIND_COLORS.SHAPE + '55'))
                                    : isCanvasBrush
                                      ? 'transparent'
                                      : el.kind === 'TEXT'
                                        ? 'transparent'
                                        : KIND_COLORS[el.kind] + '33',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexDirection: 'column',
                                gap: 2,
                                overflow: 'hidden',
                                ...(isCanvasOutlineShape || isCanvasBrush ? {} : shapeClipStyle(el.style.shape)),
                              }}
                            >
                              {isCanvasOutlineShape && (
                                <ShapeOutline
                                  shape={el.style.shape}
                                  color={resolveColor(el.style.backgroundColor, palette) ?? palette.text}
                                  strokeWidthPx={el.style.strokeWidthPx}
                                />
                              )}
                              {isCanvasBrush && (
                                <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
                                  <polyline
                                    points={brushPolylinePoints(el.content.points)}
                                    fill="none"
                                    stroke={resolveColor(el.style.backgroundColor, palette) ?? palette.text}
                                    strokeWidth={el.style.strokeWidthPx ?? 4}
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    vectorEffect="non-scaling-stroke"
                                  />
                                </svg>
                              )}
                              {/* TEXT renders exactly like the player (real font/color/align), not a
                                  wireframe placeholder — themes are finished designs, so what's on the
                                  canvas here is what viewers actually see. The wireframe label+kind
                                  badge below only exists for kinds with no static "final" frame
                                  (playlists rotate, widgets are live data). */}
                              {el.kind === 'TEXT' ? (
                                editingTextId === el.id ? (
                                  <textarea
                                    autoFocus
                                    className="inline-text-edit"
                                    dir={el.style.direction ?? 'auto'}
                                    value={el.content.text}
                                    onFocus={(e) => {
                                      captureForHistory();
                                      const len = e.target.value.length;
                                      e.target.setSelectionRange(len, len);
                                    }}
                                    onChange={(e) =>
                                      updateElementContent(el.id, { text: e.target.value })
                                    }
                                    onBlur={() => {
                                      commitCaptured();
                                      setEditingTextId(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
                                        e.preventDefault();
                                        e.currentTarget.blur();
                                      }
                                    }}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    style={{
                                      width: '100%',
                                      height: '100%',
                                      display: 'block',
                                      resize: 'none',
                                      border: 'none',
                                      outline: 'none',
                                      padding: 0,
                                      margin: 0,
                                      background: 'transparent',
                                      textAlign: el.style.textAlign ?? 'left',
                                      color: resolveColor(el.style.color, palette) ?? palette.text,
                                      fontFamily:
                                        el.style.fontFamily === 'heading'
                                          ? fontStack(typography.headingFont)
                                          : el.style.fontFamily === 'body'
                                            ? fontStack(typography.bodyFont)
                                            : fontStack(el.style.fontFamily ?? typography.bodyFont),
                                      fontSize: el.style.fontSizePx
                                        ? `${el.style.fontSizePx * (previewSize.width / PREVIEW_W)}px`
                                        : undefined,
                                      fontWeight: el.style.fontWeight,
                                      opacity: el.style.opacity,
                                    }}
                                  />
                                ) : (
                                  <div
                                    dir={el.style.direction ?? 'auto'}
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      setSelectedElementId(el.id);
                                      setEditingTextId(el.id);
                                    }}
                                    title={t('editTextHint')}
                                    style={{
                                      width: '100%',
                                      height: '100%',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent:
                                        el.style.textAlign === 'center'
                                          ? 'center'
                                          : el.style.textAlign === 'right'
                                            ? 'flex-end'
                                            : 'flex-start',
                                      textAlign: el.style.textAlign ?? 'left',
                                      color: resolveColor(el.style.color, palette) ?? palette.text,
                                      fontFamily:
                                        el.style.fontFamily === 'heading'
                                          ? fontStack(typography.headingFont)
                                          : el.style.fontFamily === 'body'
                                            ? fontStack(typography.bodyFont)
                                            : fontStack(el.style.fontFamily ?? typography.bodyFont),
                                      fontSize: el.style.fontSizePx
                                        ? `${el.style.fontSizePx * (previewSize.width / PREVIEW_W)}px`
                                        : undefined,
                                      fontWeight: el.style.fontWeight,
                                      opacity: el.style.opacity,
                                      overflow: 'hidden',
                                    }}
                                  >
                                    {el.content.text}
                                  </div>
                                )
                              ) : thumb ? (
                                // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote asset URL, not a static/local image
                                <img
                                  src={thumb}
                                  alt={el.label || el.kind}
                                  draggable={false}
                                  style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: el.style.objectFit ?? (el.kind === 'IMAGE' ? 'fill' : 'contain'),
                                    ...mediaCropStyle(el.style),
                                  }}
                                />
                              ) : !isCanvasOutlineShape && !isCanvasBrush ? (
                                <>
                                  <span
                                    style={{
                                      fontSize: 9,
                                      color: el.kind === 'SHAPE' ? KIND_COLORS.SHAPE : '#fff',
                                      fontWeight: 600,
                                      textAlign: 'center',
                                      padding: '0 2px',
                                    }}
                                  >
                                    {el.label || el.kind}
                                  </span>
                                  <span
                                    style={{
                                      opacity: 0.7,
                                      fontSize: 8,
                                      color: el.kind === 'SHAPE' ? KIND_COLORS.SHAPE : '#fff',
                                    }}
                                  >
                                    {t(`elementKinds.${el.kind}`)}
                                  </span>
                                </>
                              ) : null}
                            </div>
                            {(isHovered || isSelected) && (
                              <div
                                style={{
                                  position: 'absolute',
                                  inset: 0,
                                  pointerEvents: 'none',
                                  border: isSelected
                                    ? `2px solid ${KIND_COLORS[el.kind]}`
                                    : `1px dashed ${KIND_COLORS[el.kind]}99`,
                                  boxShadow: isSelected
                                    ? `0 0 0 2px ${KIND_COLORS[el.kind]}55`
                                    : undefined,
                                }}
                              />
                            )}
                            {el.editable === false && (
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
                  {/* Brush drawing overlay — armed by the sidebar's Brush item, captures the whole
                      canvas so a stroke can be drawn over existing elements too. Sits above every
                      Rnd element (they carry their own el.zIndex) and above the align guides. */}
                  {brushArmed && (
                    <div
                      onPointerDown={startBrushStroke}
                      onPointerMove={moveBrushStroke}
                      onPointerUp={finishBrushStroke}
                      onPointerCancel={cancelBrushStroke}
                      onContextMenu={(e) => e.preventDefault()}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 1000,
                        cursor: 'crosshair',
                        touchAction: 'none',
                      }}
                    >
                      {brushDraft && brushDraft.length > 1 && (() => {
                        // Render in the stroke's own tight bounding box, exactly like the finished
                        // element will (see brushBounds/finishBrushStroke) — not the full canvas —
                        // so strokeWidth means the same pixel width here as it will once committed.
                        const { box, relative } = brushBounds(brushDraft);
                        return (
                          <div
                            style={{
                              position: 'absolute',
                              left: `${box.x}%`,
                              top: `${box.y}%`,
                              width: `${box.width}%`,
                              height: `${box.height}%`,
                            }}
                          >
                            <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
                              <polyline
                                points={brushPolylinePoints(relative)}
                                fill="none"
                                stroke={resolveColor(brushColor, palette) ?? '#6366f1'}
                                strokeWidth={brushSize}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                vectorEffect="non-scaling-stroke"
                              />
                            </svg>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
                {/* Unclipped overlay for the rotate grip + rotation-aware resize handles — sits
                    outside the frame's overflow:hidden clip above so they stay grabbable even when
                    a rotated element's box would put them past the frame edge. Absolutely
                    positioned over the exact same rect as the frame; only individual handles accept
                    pointer events, the rest passes clicks through to the frame beneath. */}
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    overflow: 'visible',
                    pointerEvents: 'none',
                  }}
                >
                  {previewSize.width > 0 &&
                    elements.map((el) => {
                      const isSelected = el.id === selectedElementId;
                      const interactive = elementIsInteractive(el, isSelected);
                      const box = dragBox && dragBox.id === el.id ? dragBox : getBoxPx(el);
                      const liveRotation =
                        rotationDrag && rotationDrag.id === el.id ? rotationDrag.deg : el.rotation;
                      const rotation = el.rotation ?? 0;
                      if (!interactive) return null;
                      return (
                        <div
                          key={el.id}
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
                                onMouseDown={(e) => startResizeElement(e, el, h)}
                                title={t('resizeHint')}
                                style={{
                                  ...resizeHandleStyle(h),
                                  width: 8,
                                  height: 8,
                                  borderRadius: 2,
                                  background: KIND_COLORS[el.kind],
                                  border: '1.5px solid white',
                                  cursor: RESIZE_HANDLE_AXIS[h].cursor,
                                  boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
                                  pointerEvents: 'auto',
                                }}
                              />
                            ))}
                          <ZoneRotateHandle
                            style={rotateHandleStyle}
                            color={KIND_COLORS[el.kind]}
                            hint={t('rotateHint')}
                            onStartRotate={(e) => startRotate(e, el)}
                          />
                        </div>
                      );
                    })}
                </div>
              </div>
              </div>
            </div>

            {/* Palette + typography — theme-only settings that sit between the preview and the
                element cards below, unlike the layout editor which has neither. */}
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t('palette')}
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {PALETTE_ROLES.map((role) => (
                    <div key={role}>
                      <label
                        className="mb-0.5 block truncate text-[10px] text-gray-400 dark:text-gray-500"
                        title={t(`paletteRoles.${role}`)}
                      >
                        {t(`paletteRoles.${role}`)}
                      </label>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={palette[role]}
                          onFocus={captureForHistory}
                          onChange={(e) =>
                            setPalette((prev) => ({ ...prev, [role]: e.target.value }))
                          }
                          onBlur={commitCaptured}
                          className="h-7 min-w-0 flex-1 cursor-pointer rounded border border-gray-200 dark:border-gray-700"
                        />
                        <CopyHexButton value={palette[role]} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">
                  {t('typography')}
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                      {t('headingFont')}
                    </label>
                    <FontPicker
                      value={typography.headingFont}
                      onChange={(f) =>
                        commit(() => setTypography((prev) => ({ ...prev, headingFont: f })))
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                      {t('bodyFont')}
                    </label>
                    <FontPicker
                      value={typography.bodyFont}
                      onChange={(f) =>
                        commit(() => setTypography((prev) => ({ ...prev, bodyFont: f })))
                      }
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                      {t('baseSize')}
                    </label>
                    <input
                      type="number"
                      min={8}
                      max={64}
                      value={typography.baseSizePx}
                      onFocus={captureForHistory}
                      onBlur={commitCaptured}
                      onChange={(e) =>
                        setTypography((prev) => ({
                          ...prev,
                          baseSizePx: parseInt(e.target.value, 10) || 16,
                        }))
                      }
                      className="w-full rounded border border-gray-200 px-2 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                      {t('scale')}
                    </label>
                    <input
                      type="number"
                      step={0.05}
                      min={1}
                      max={2}
                      value={typography.scale}
                      onFocus={captureForHistory}
                      onBlur={commitCaptured}
                      onChange={(e) =>
                        setTypography((prev) => ({
                          ...prev,
                          scale: parseFloat(e.target.value) || 1.25,
                        }))
                      }
                      className="w-full rounded border border-gray-200 px-2 py-1 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Element cards — one per element, mirroring the layout editor's zone cards. */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs text-gray-400 dark:text-gray-500">{t('elements')}</div>
                <button
                  onClick={addElement}
                  className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700"
                >
                  <Plus className="h-3 w-3" /> {t('addElement')}
                </button>
              </div>
              <div className="grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {elements.map((el) => {
                  const isSelected = el.id === selectedElementId;
                  return (
                    <div
                      key={el.id}
                      onClick={() => setSelectedElementId(el.id)}
                      className={`flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-white p-3 transition-colors dark:bg-gray-900 ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50/50 ring-1 ring-indigo-500 dark:bg-indigo-950/20'
                          : 'border-gray-200 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-600'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: KIND_COLORS[el.kind] }}
                        />
                        <input
                          value={el.label ?? ''}
                          onChange={(e) => updateElement(el.id, { label: e.target.value })}
                          onFocus={captureForHistory}
                          onBlur={commitCaptured}
                          placeholder={t('elementLabel')}
                          className="min-w-0 flex-1 rounded border border-transparent px-1.5 py-1 text-sm font-medium hover:border-gray-200 focus:border-indigo-500 focus:outline-none dark:bg-gray-800 dark:text-gray-100 dark:hover:border-gray-700"
                        />
                        <label
                          className="flex shrink-0 cursor-pointer items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500"
                          title={t('editableHint')}
                        >
                          <input
                            type="checkbox"
                            checked={el.editable}
                            onChange={(e) =>
                              commit(() => updateElement(el.id, { editable: e.target.checked }))
                            }
                          />
                          {el.editable ? (
                            <LockOpen className="h-3 w-3" />
                          ) : (
                            <Lock className="h-3 w-3" />
                          )}
                        </label>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeElement(el.id);
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
                            value={el.kind}
                            onChange={(e) =>
                              commit(() =>
                                updateElementKind(el.id, e.target.value as ThemeElementKind),
                              )
                            }
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          >
                            {ELEMENT_KIND_VALUES.map((k) => (
                              <option key={k} value={k}>
                                {t(`elementKinds.${k}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs text-gray-400 dark:text-gray-500">
                            {t('shape')}
                          </label>
                          <select
                            value={el.style.shape ?? 'rectangle'}
                            onChange={(e) =>
                              commit(() =>
                                updateElementStyle(el.id, {
                                  shape: e.target.value as ElementShape,
                                }),
                              )
                            }
                            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                          >
                            {ELEMENT_SHAPES.map((s) => (
                              <option key={s} value={s}>
                                {t(`shapeTypes.${s}`)}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {!isSelected && (
                        <p className="text-[10px] text-gray-400 dark:text-gray-500">
                          {t('clickToEditHint')}
                        </p>
                      )}

                      {isSelected && (
                        <>
                          <div className="grid grid-cols-6 gap-1">
                            {(['x', 'y', 'width', 'height', 'zIndex', 'rotation'] as const).map(
                              (field) => (
                                <div key={field}>
                                  <label className="flex items-center gap-0.5 text-[9px] text-gray-400 dark:text-gray-500">
                                    {field === 'rotation' && <RotateCw className="h-2.5 w-2.5" />}{' '}
                                    {t(`field.${field}`)}
                                  </label>
                                  <input
                                    type="number"
                                    min={
                                      field === 'zIndex'
                                        ? undefined
                                        : field === 'rotation'
                                          ? -360
                                          : 0
                                    }
                                    max={
                                      field === 'zIndex'
                                        ? undefined
                                        : field === 'rotation'
                                          ? 360
                                          : 100
                                    }
                                    value={el[field]}
                                    onFocus={captureForHistory}
                                    onBlur={commitCaptured}
                                    onChange={(e) =>
                                      updateElement(el.id, {
                                        [field]:
                                          field === 'zIndex' || field === 'rotation'
                                            ? parseInt(e.target.value, 10) || 0
                                            : parseFloat(e.target.value) || 0,
                                      })
                                    }
                                    className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                  />
                                </div>
                              ),
                            )}
                          </div>

                          {/* Content */}
                          <div className="rounded bg-gray-50 p-2 dark:bg-gray-800/60">
                            {el.kind === 'TEXT' && (
                              <div className="space-y-1.5">
                                <div>
                                  <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                    {t('text')}
                                  </label>
                                  <input
                                    value={el.content.text}
                                    onFocus={captureForHistory}
                                    onBlur={commitCaptured}
                                    onChange={(e) =>
                                      updateElementContent(el.id, { text: e.target.value })
                                    }
                                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                  />
                                </div>
                                <div>
                                  <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                    {t('translationAr')}
                                  </label>
                                  <input
                                    dir="rtl"
                                    value={el.content.translations?.ar ?? ''}
                                    onFocus={captureForHistory}
                                    onBlur={commitCaptured}
                                    onChange={(e) =>
                                      updateElementContent(el.id, {
                                        translations: {
                                          ...el.content.translations,
                                          ar: e.target.value,
                                        },
                                      })
                                    }
                                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                  />
                                </div>
                              </div>
                            )}
                            {el.kind === 'IMAGE' && (
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('image')}
                                </label>
                                <ImagePicker
                                  value={el.content.assetId}
                                  placeholder={t('noAsset')}
                                  onChange={(assetId) =>
                                    commit(() => updateElementContent(el.id, { assetId }))
                                  }
                                  labels={{
                                    existing: t('imageSourceExisting'),
                                    upload: t('imageSourceUpload'),
                                    paste: t('imageSourcePaste'),
                                    uploading: t('uploadingImage'),
                                    uploadFailed: t('uploadImageFailed'),
                                    pasteHint: t('pasteImageHint'),
                                    pasteError: t('pasteImageError'),
                                  }}
                                />
                              </div>
                            )}
                            {el.kind === 'VIDEO' && (
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('video')}
                                </label>
                                <AssetPicker
                                  types={['VIDEO']}
                                  value={el.content.assetId}
                                  placeholder={t('noAsset')}
                                  onChange={(assetId) =>
                                    commit(() => updateElementContent(el.id, { assetId }))
                                  }
                                />
                              </div>
                            )}
                            {el.kind === 'DOCUMENT' && (
                              <div className="space-y-2">
                                <div>
                                  <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                    {t('document')}
                                  </label>
                                  <AssetPicker
                                    types={['DOCUMENT']}
                                    value={el.content.assetId}
                                    placeholder={t('noAsset')}
                                    onChange={(assetId) =>
                                      commit(() => updateElementContent(el.id, { assetId }))
                                    }
                                  />
                                </div>
                                <div>
                                  <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                    {t('secondsPerPage')}
                                  </label>
                                  <input
                                    type="number"
                                    min={1}
                                    value={el.content.secondsPerPage}
                                    onFocus={captureForHistory}
                                    onBlur={commitCaptured}
                                    onChange={(e) =>
                                      updateElementContent(el.id, {
                                        secondsPerPage: Math.max(1, parseInt(e.target.value, 10) || 1),
                                      })
                                    }
                                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                  />
                                </div>
                              </div>
                            )}
                            {el.kind === 'PLAYLIST' && (
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('playlistContent')}
                                </label>
                                <select
                                  value={el.content.playlistId ?? ''}
                                  onChange={(e) =>
                                    commit(() =>
                                      updateElementContent(el.id, {
                                        playlistId: e.target.value || null,
                                      }),
                                    )
                                  }
                                  className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                >
                                  <option value="">{t('noPlaylist')}</option>
                                  {playlists.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.name}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {el.kind === 'SHAPE' && (
                              <p className="text-[10px] text-gray-400 dark:text-gray-500">
                                {t('shapeHint')}
                              </p>
                            )}
                            {el.kind === 'BRUSH' && (
                              <div className="space-y-1.5">
                                <p className="text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('brushHint')}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedElementId(el.id);
                                    setBrushRedrawId(el.id);
                                    setBrushColor(el.style.backgroundColor);
                                    setBrushSize(el.style.strokeWidthPx ?? 4);
                                    setBrushArmed(true);
                                  }}
                                  className="flex items-center gap-1 rounded border border-gray-200 px-2 py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                                >
                                  <Brush className="h-3 w-3" /> {t('brushRedraw')}
                                </button>
                              </div>
                            )}
                            {el.kind === 'WIDGET' && (
                              <div className="space-y-1.5">
                                <div>
                                  <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                    {t('widgetType')}
                                  </label>
                                  <select
                                    value={el.content.widgetType}
                                    onChange={(e) =>
                                      commit(() =>
                                        updateElementContent(el.id, {
                                          widgetType: e.target.value as ThemeWidgetType,
                                          widgetConfig: {},
                                        }),
                                      )
                                    }
                                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                  >
                                    {WIDGET_TYPE_VALUES.map((w) => (
                                      <option key={w} value={w}>
                                        {t(`widgetTypes.${w}`)}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <WidgetConfigFields
                                  widgetType={el.content.widgetType}
                                  config={el.content.widgetConfig}
                                  onChange={(cfg) =>
                                    updateElementContent(el.id, { widgetConfig: cfg })
                                  }
                                  onChangeCommitted={(cfg) =>
                                    commit(() => updateElementContent(el.id, { widgetConfig: cfg }))
                                  }
                                  onFocusField={captureForHistory}
                                  onBlurField={commitCaptured}
                                />
                              </div>
                            )}
                          </div>

                          {/* Style — only fields the player renderer actually consumes for this kind */}
                          {el.kind === 'TEXT' && (
                            <div className="grid grid-cols-3 gap-2">
                              <ColorField
                                label={t('color')}
                                value={el.style.color}
                                onFocusField={captureForHistory}
                                onBlurField={commitCaptured}
                                onChange={(v) => updateElementStyle(el.id, { color: v })}
                              />
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('fontFamily')}
                                </label>
                                <select
                                  value={
                                    el.style.fontFamily === 'heading' ||
                                    el.style.fontFamily === 'body'
                                      ? el.style.fontFamily
                                      : 'custom'
                                  }
                                  onChange={(e) =>
                                    commit(() =>
                                      updateElementStyle(el.id, {
                                        fontFamily:
                                          e.target.value === 'custom'
                                            ? DEFAULT_FONT_ID
                                            : e.target.value,
                                      }),
                                    )
                                  }
                                  className="mb-1 w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                >
                                  <option value="heading">{t('fontFamilyHeadingOption')}</option>
                                  <option value="body">{t('fontFamilyBodyOption')}</option>
                                  <option value="custom">{t('fontFamilyCustomOption')}</option>
                                </select>
                                {el.style.fontFamily !== 'heading' &&
                                  el.style.fontFamily !== 'body' && (
                                    <FontPicker
                                      value={el.style.fontFamily}
                                      onChange={(f) =>
                                        commit(() => updateElementStyle(el.id, { fontFamily: f }))
                                      }
                                    />
                                  )}
                              </div>
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('fontSizePx')}
                                </label>
                                <input
                                  type="number"
                                  min={8}
                                  max={200}
                                  value={el.style.fontSizePx ?? ''}
                                  onFocus={captureForHistory}
                                  onBlur={commitCaptured}
                                  onChange={(e) =>
                                    updateElementStyle(el.id, {
                                      fontSizePx: parseInt(e.target.value, 10) || undefined,
                                    })
                                  }
                                  className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                />
                              </div>
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('fontWeight')}
                                </label>
                                <select
                                  value={String(el.style.fontWeight ?? 400)}
                                  onChange={(e) =>
                                    commit(() =>
                                      updateElementStyle(el.id, {
                                        fontWeight: parseInt(e.target.value, 10),
                                      }),
                                    )
                                  }
                                  className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                >
                                  {[400, 500, 600, 700, 800, 900].map((w) => (
                                    <option key={w} value={w}>
                                      {w}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('textAlign')}
                                </label>
                                <select
                                  value={el.style.textAlign ?? 'left'}
                                  onChange={(e) =>
                                    commit(() =>
                                      updateElementStyle(el.id, {
                                        textAlign: e.target.value as 'left' | 'center' | 'right',
                                      }),
                                    )
                                  }
                                  className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                >
                                  <option value="left">{t('align.left')}</option>
                                  <option value="center">{t('align.center')}</option>
                                  <option value="right">{t('align.right')}</option>
                                </select>
                              </div>
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('direction')}
                                </label>
                                <select
                                  value={el.style.direction ?? 'auto'}
                                  onChange={(e) =>
                                    commit(() =>
                                      updateElementStyle(el.id, {
                                        direction: e.target.value as 'ltr' | 'rtl' | 'auto',
                                      }),
                                    )
                                  }
                                  className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                >
                                  <option value="auto">{t('direction_.auto')}</option>
                                  <option value="ltr">{t('direction_.ltr')}</option>
                                  <option value="rtl">{t('direction_.rtl')}</option>
                                </select>
                              </div>
                            </div>
                          )}
                          {(el.kind === 'IMAGE' || el.kind === 'VIDEO' || el.kind === 'DOCUMENT') && (
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('objectFit')}
                                </label>
                                <select
                                  value={el.style.objectFit ?? (el.kind === 'IMAGE' ? 'fill' : 'contain')}
                                  onChange={(e) =>
                                    commit(() =>
                                      updateElementStyle(el.id, {
                                        objectFit: e.target.value as 'contain' | 'cover' | 'fill',
                                      }),
                                    )
                                  }
                                  className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                >
                                  <option value="contain">{t('fit.contain')}</option>
                                  <option value="cover">{t('fit.cover')}</option>
                                  <option value="fill">{t('fit.fill')}</option>
                                </select>
                              </div>
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('borderRadius')}
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={el.style.borderRadius ?? 0}
                                  onFocus={captureForHistory}
                                  onBlur={commitCaptured}
                                  onChange={(e) =>
                                    updateElementStyle(el.id, {
                                      borderRadius: parseInt(e.target.value, 10) || 0,
                                    })
                                  }
                                  className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                />
                              </div>
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('opacity')}
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={el.style.opacity ?? 1}
                                  onFocus={captureForHistory}
                                  onBlur={commitCaptured}
                                  onChange={(e) =>
                                    updateElementStyle(el.id, {
                                      opacity: parseFloat(e.target.value),
                                    })
                                  }
                                  className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                />
                              </div>
                            </div>
                          )}
                          {(el.kind === 'IMAGE' || el.kind === 'VIDEO') && el.content.assetId && (
                            <button
                              onClick={() => setCroppingElementId(el.id)}
                              className="flex w-full items-center justify-center gap-1.5 rounded border border-gray-200 py-1 text-[10px] font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                            >
                              <Crop className="h-3 w-3" /> {tCrop('editCrop')}
                            </button>
                          )}
                          {el.kind === 'PLAYLIST' && (
                            <div className="w-1/3">
                              <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                {t('borderRadius')}
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={el.style.borderRadius ?? 0}
                                onFocus={captureForHistory}
                                onBlur={commitCaptured}
                                onChange={(e) =>
                                  updateElementStyle(el.id, {
                                    borderRadius: parseInt(e.target.value, 10) || 0,
                                  })
                                }
                                className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                              />
                            </div>
                          )}
                          {el.kind === 'SHAPE' && (
                            <div className="space-y-2">
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('fillStyle')}
                                </label>
                                <select
                                  value={el.style.shapeFill ?? 'solid'}
                                  onChange={(e) =>
                                    commit(() =>
                                      updateElementStyle(el.id, {
                                        shapeFill: e.target.value as 'solid' | 'outline',
                                      }),
                                    )
                                  }
                                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                >
                                  <option value="solid">{t('fillStyleSolid')}</option>
                                  <option value="outline">{t('fillStyleOutline')}</option>
                                </select>
                              </div>
                              <div className="grid grid-cols-3 gap-2">
                              <ColorField
                                label={el.style.shapeFill === 'outline' ? t('outlineColor') : t('backgroundColor')}
                                value={el.style.backgroundColor}
                                onFocusField={captureForHistory}
                                onBlurField={commitCaptured}
                                onChange={(v) => updateElementStyle(el.id, { backgroundColor: v })}
                              />
                              {el.style.shapeFill === 'outline' ? (
                                <div>
                                  <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                    {t('strokeWidth')}
                                  </label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={el.style.strokeWidthPx ?? 4}
                                    onFocus={captureForHistory}
                                    onBlur={commitCaptured}
                                    onChange={(e) =>
                                      updateElementStyle(el.id, {
                                        strokeWidthPx: parseInt(e.target.value, 10) || 1,
                                      })
                                    }
                                    className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                  />
                                </div>
                              ) : (
                                <div>
                                  <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                    {t('borderRadius')}
                                  </label>
                                  <input
                                    type="number"
                                    min={0}
                                    max={100}
                                    value={el.style.borderRadius ?? 0}
                                    onFocus={captureForHistory}
                                    onBlur={commitCaptured}
                                    onChange={(e) =>
                                      updateElementStyle(el.id, {
                                        borderRadius: parseInt(e.target.value, 10) || 0,
                                      })
                                    }
                                    className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                  />
                                </div>
                              )}
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('opacity')}
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={el.style.opacity ?? 1}
                                  onFocus={captureForHistory}
                                  onBlur={commitCaptured}
                                  onChange={(e) =>
                                    updateElementStyle(el.id, {
                                      opacity: parseFloat(e.target.value),
                                    })
                                  }
                                  className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                />
                              </div>
                              </div>
                            </div>
                          )}
                          {el.kind === 'BRUSH' && (
                            <div className="grid grid-cols-3 gap-2">
                              <ColorField
                                label={t('strokeColor')}
                                value={el.style.backgroundColor}
                                onFocusField={captureForHistory}
                                onBlurField={commitCaptured}
                                onChange={(v) => updateElementStyle(el.id, { backgroundColor: v })}
                              />
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('strokeWidth')}
                                </label>
                                <input
                                  type="number"
                                  min={1}
                                  max={50}
                                  value={el.style.strokeWidthPx ?? 4}
                                  onFocus={captureForHistory}
                                  onBlur={commitCaptured}
                                  onChange={(e) =>
                                    updateElementStyle(el.id, {
                                      strokeWidthPx: parseInt(e.target.value, 10) || 1,
                                    })
                                  }
                                  className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                />
                              </div>
                              <div>
                                <label className="mb-0.5 block text-[10px] text-gray-400 dark:text-gray-500">
                                  {t('opacity')}
                                </label>
                                <input
                                  type="number"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={el.style.opacity ?? 1}
                                  onFocus={captureForHistory}
                                  onBlur={commitCaptured}
                                  onChange={(e) =>
                                    updateElementStyle(el.id, {
                                      opacity: parseFloat(e.target.value),
                                    })
                                  }
                                  className="w-full rounded border border-gray-200 px-1 py-1 text-[10px] focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                                />
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

          <EditorAddSidebar
            title={t('addElement')}
            openLabel={tc('openAddPanel')}
            closeLabel={tc('closeAddPanel')}
            sections={[
              {
                heading: t('addGroups.basic'),
                items: [
                  {
                    key: 'TEXT',
                    label: t('elementKinds.TEXT'),
                    icon: ELEMENT_KIND_ICONS.TEXT,
                    panel: (close) => (
                      <TextQuickAddPanel
                        onAdd={(content) => {
                          addElementOfKind('TEXT', undefined, undefined, content);
                          close();
                        }}
                      />
                    ),
                  },
                  {
                    key: 'SHAPE',
                    label: t('elementKinds.SHAPE'),
                    icon: ELEMENT_KIND_ICONS.SHAPE,
                    panel: (close) => (
                      <ShapeQuickAddPanel
                        palette={palette}
                        onAdd={(style) => {
                          addElementOfKind('SHAPE', undefined, style);
                          close();
                        }}
                      />
                    ),
                  },
                  {
                    key: 'BRUSH',
                    label: t('elementKinds.BRUSH'),
                    icon: ELEMENT_KIND_ICONS.BRUSH,
                    // No panel — arms drawing mode instead, the element itself is created from the
                    // stroke the user then drags out on the canvas (see finishBrushStroke).
                    onClick: () => {
                      setBrushRedrawId(null);
                      setBrushArmed(true);
                    },
                  },
                ],
              },
              {
                heading: t('addGroups.media'),
                items: [
                  {
                    key: 'IMAGE',
                    label: t('elementKinds.IMAGE'),
                    icon: ELEMENT_KIND_ICONS.IMAGE,
                    panel: (close) => (
                      <ImageQuickAddPanel
                        onAdd={(assetId) => {
                          addElementOfKind('IMAGE', undefined, undefined, { assetId });
                          close();
                        }}
                      />
                    ),
                  },
                  {
                    key: 'VIDEO',
                    label: t('elementKinds.VIDEO'),
                    icon: ELEMENT_KIND_ICONS.VIDEO,
                    panel: (close) => (
                      <AssetQuickAddPanel
                        types={['VIDEO']}
                        placeholder={t('noAsset')}
                        onAdd={(assetId) => {
                          addElementOfKind('VIDEO', undefined, undefined, { assetId });
                          close();
                        }}
                      />
                    ),
                  },
                  {
                    key: 'DOCUMENT',
                    label: t('elementKinds.DOCUMENT'),
                    icon: ELEMENT_KIND_ICONS.DOCUMENT,
                    panel: (close) => (
                      <AssetQuickAddPanel
                        types={['DOCUMENT']}
                        placeholder={t('noAsset')}
                        onAdd={(assetId) => {
                          addElementOfKind('DOCUMENT', undefined, undefined, { assetId });
                          close();
                        }}
                      />
                    ),
                  },
                  {
                    key: 'PLAYLIST',
                    label: t('elementKinds.PLAYLIST'),
                    icon: ELEMENT_KIND_ICONS.PLAYLIST,
                    panel: (close) => (
                      <PlaylistQuickAddPanel
                        playlists={playlists}
                        placeholder={t('noPlaylist')}
                        onAdd={(playlistId) => {
                          addElementOfKind('PLAYLIST', undefined, undefined, { playlistId });
                          close();
                        }}
                      />
                    ),
                  },
                ],
              },
              {
                heading: t('addGroups.dataFeeds'),
                items: (['WEATHER', 'CURRENCY', 'TICKER'] as ThemeWidgetType[]).map((w) => ({
                  key: w,
                  label: t(`widgetTypes.${w}`),
                  icon: WIDGET_TYPE_ICONS[w],
                  panel: (close) => (
                    <WidgetQuickAddPanel
                      widgetType={w}
                      onAdd={(config) => {
                        addElementOfKind('WIDGET', w, undefined, { widgetConfig: config });
                        close();
                      }}
                    />
                  ),
                })),
              },
              {
                heading: t('addGroups.timeDate'),
                items: (['TIME', 'DATE'] as ThemeWidgetType[]).map((w) => ({
                  key: w,
                  label: t(`widgetTypes.${w}`),
                  icon: WIDGET_TYPE_ICONS[w],
                  panel: (close) => (
                    <WidgetQuickAddPanel
                      widgetType={w}
                      onAdd={(config) => {
                        addElementOfKind('WIDGET', w, undefined, { widgetConfig: config });
                        close();
                      }}
                    />
                  ),
                })),
              },
              {
                heading: t('addGroups.faith'),
                items: [
                  {
                    key: 'PRAYER',
                    label: t('widgetTypes.PRAYER'),
                    icon: WIDGET_TYPE_ICONS.PRAYER,
                    panel: (close) => (
                      <WidgetQuickAddPanel
                        widgetType="PRAYER"
                        onAdd={(config) => {
                          addElementOfKind('WIDGET', 'PRAYER', undefined, { widgetConfig: config });
                          close();
                        }}
                      />
                    ),
                  },
                ],
              },
              {
                heading: t('addGroups.interactive'),
                items: [
                  {
                    key: 'QR',
                    label: t('widgetTypes.QR'),
                    icon: WIDGET_TYPE_ICONS.QR,
                    panel: (close) => (
                      <WidgetQuickAddPanel
                        widgetType="QR"
                        onAdd={(config) => {
                          addElementOfKind('WIDGET', 'QR', undefined, { widgetConfig: config });
                          close();
                        }}
                      />
                    ),
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
              disabled={!name.trim() || elements.length === 0 || saving}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <Check className="h-4 w-4" /> {saving ? t('saving') : t('saveTheme')}
            </button>
          </div>
        </div>
      )}

      {editing && croppingElementId && (() => {
        const el = elements.find((e) => e.id === croppingElementId);
        if (!el || (el.kind !== 'IMAGE' && el.kind !== 'VIDEO')) return null;
        const asset = el.content.assetId ? assets.find((a) => a.id === el.content.assetId) : undefined;
        const mediaUrl = asset?.url;
        if (!mediaUrl) return null;
        return (
          <CropEditor
            mediaUrl={mediaUrl}
            mediaType={el.kind}
            name={el.label || el.kind}
            shape={el.style.shape}
            aspectRatio={(el.width / el.height) * parseAspectRatio(aspectRatio)}
            initialCrop={{
              cropZoom: el.style.cropZoom ?? null,
              cropOffsetX: el.style.cropOffsetX ?? null,
              cropOffsetY: el.style.cropOffsetY ?? null,
            }}
            onClose={() => setCroppingElementId(null)}
            onSave={(crop) => {
              commit(() =>
                updateElementStyle(el.id, {
                  cropZoom: crop.cropZoom ?? undefined,
                  cropOffsetX: crop.cropOffsetX ?? undefined,
                  cropOffsetY: crop.cropOffsetY ?? undefined,
                }),
              );
              setCroppingElementId(null);
            }}
          />
        );
      })()}

      {deleteError && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          {deleteError}
        </div>
      )}

      {!editing && themes.length > 0 && (
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

      {!isLoading && themes.length === 0 && !editing && (
        <div className="py-16 text-center text-gray-400">
          <Palette className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      )}

      {!isLoading && !editing && themes.length > 0 && filteredPresets.length === 0 && filteredOwnThemes.length === 0 && (
        <div className="py-16 text-center text-gray-400">
          <Search className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm">{tc('noMatches')}</p>
        </div>
      )}

      {!editing && filteredPresets.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-gray-300">
            <Sparkles className="h-4 w-4 text-indigo-500" /> {t('presetsSection')}
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {filteredPresets.map((theme) => (
              <div
                key={theme.id}
                className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                    {theme.name}
                  </span>
                  <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                    {t(`categories.${theme.category}`)}
                  </span>
                </div>
                <div
                  style={{
                    aspectRatio: '16/9',
                    background: theme.palette.background,
                    borderRadius: 4,
                    overflow: 'hidden',
                    marginBottom: 8,
                    position: 'relative',
                  }}
                >
                  {renderPreviewElements(theme.elements, theme.palette, CARD_SCALE_W)}
                </div>
                {canEditContent && (
                  <button
                    onClick={() => applyPreset(theme)}
                    disabled={duplicateMut.isPending}
                    title={t('customizeHint')}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-50 py-1.5 text-xs text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:bg-indigo-950 dark:text-indigo-300 dark:hover:bg-indigo-900"
                  >
                    <Pencil className="h-3.5 w-3.5" /> {t('customize')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!editing && filteredOwnThemes.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t('yourThemes')}
          </h2>
          <div className="grid gap-5 sm:grid-cols-2">
            {filteredOwnThemes.map((theme) => (
              <div
                key={theme.id}
                className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  {renamingId === theme.id ? (
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(theme)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(theme);
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      disabled={renameMut.isPending}
                      className="-mx-1 min-w-0 rounded border border-indigo-300 px-1 text-sm font-medium text-gray-900 focus:ring-1 focus:ring-indigo-500 focus:outline-none dark:border-indigo-700 dark:bg-gray-800 dark:text-gray-100"
                    />
                  ) : (
                    <span
                      onClick={() => startRename(theme)}
                      title={canEditContent ? tc('clickToRename') : undefined}
                      className={`truncate text-sm font-medium text-gray-900 dark:text-gray-100 ${canEditContent ? 'cursor-text hover:text-indigo-600 dark:hover:text-indigo-400' : ''}`}
                    >
                      {theme.name}
                    </span>
                  )}
                  {canEditContent && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => duplicateMut.mutate(theme)}
                        disabled={duplicateMut.isPending}
                        title={t('duplicate')}
                        className="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-50 dark:text-gray-500"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (confirmDelete(t('deleteConfirm'))) removeMut.mutate(theme);
                        }}
                        className="p-1 text-gray-400 hover:text-red-500 dark:text-gray-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <button
                  onClick={() => canEditContent && openEdit(theme)}
                  disabled={!canEditContent}
                  title={canEditContent ? t('clickToEdit') : undefined}
                  className="group relative block w-full disabled:cursor-default"
                  style={{
                    aspectRatio: '16/9',
                    background: theme.palette.background,
                    borderRadius: 4,
                    overflow: 'hidden',
                    marginBottom: 8,
                  }}
                >
                  {renderPreviewElements(theme.elements, theme.palette, CARD_SCALE_W)}
                  {canEditContent && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
                      <span className="flex items-center gap-1.5 text-xs font-medium text-white">
                        <Pencil className="h-3.5 w-3.5" /> {t('editTheme')}
                      </span>
                    </div>
                  )}
                </button>

                <div className="flex items-center gap-2">
                  <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                    {t(`categories.${theme.category}`)}
                  </span>
                  {theme._count && theme._count.screens > 0 && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      {t('screenCount', { count: theme._count.screens })}
                    </span>
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
