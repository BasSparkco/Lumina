'use client';
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Rnd } from 'react-rnd';
import {
  Plus,
  Pencil,
  Copy,
  Trash2,
  Lock,
  LockOpen,
  ArrowUpToLine,
  ArrowDownToLine,
  Wand2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Palette,
  Pipette,
  Brush,
  Eraser,
  PaintBucket,
  Feather,
  Highlighter,
  Droplet,
  PencilLine,
  type LucideIcon,
} from 'lucide-react';
import {
  type Asset,
  type Theme,
  type ThemeElement,
  type ThemeBrushPoint,
  type ThemePalette,
  type ThemeTypography,
} from '@/lib/api';
import { ContextMenu, type ContextMenuState, type ContextMenuAction } from '@/components/ContextMenu';
import { removeAssetBackground } from '@/lib/backgroundRemoval';
import { useRequireSelectToEdit } from '@/hooks/useRequireSelectToEdit';
import { useRotateHandleStyle } from '@/hooks/useRotateHandleStyle';
import { ZoneRotateHandle } from '@/components/ZoneRotateHandle';
import { TickerTextPreview } from '@/components/TickerTextPreview';
import { fontStack } from '@/components/FontPicker';
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
import { shapeClipStyle, mediaCropStyle, brushPolylinePoints, resolveThemeColor } from '@lumina/types';
import { ShapeOutline } from '@lumina/ui';
import {
  type BrushType,
  type PaintTool,
  type RasterPoint,
  BRUSH_TYPES,
  PAINT_TOOLS,
  paintLayerResolution,
  loadImage,
  strokeSegment,
  eraseSegment,
  floodFill,
  isEyeDropperSupported,
  pickColorFromScreen,
} from '@/lib/paintEngine';
import { ZOOM_STEP, clampPct, clampZoom } from '@/lib/editorZoom';
import { KIND_COLORS, PALETTE_ROLES, newElementId } from './ThemesSection';

// Live preview canvas default size in px — mirrors ThemesSection's own PREVIEW_W/PREVIEW_H
// (the actual editor canvas is responsive, see previewSize below).
const PREVIEW_W = 640;
const PREVIEW_H = 360;
const MIN_ELEMENT_PX = 16;
// Rotation drag snaps to the nearest 15° once within this many degrees.
const SNAP_DEG = 4;

// Flat preview sizes for an asset-backed TEXT element on the bounded editor canvas — mirrors the
// Assets page's own "New Text" modal preview (FONT_SIZE_PREVIEW).
const TEXT_ASSET_PREVIEW_SIZE: Record<string, string> = {
  SMALL: '0.9rem',
  MEDIUM: '1.3rem',
  LARGE: '1.7rem',
  XLARGE: '2.1rem',
};

const PAINT_TOOL_ICONS: Record<PaintTool, LucideIcon> = {
  brush: Brush,
  eraser: Eraser,
  fill: PaintBucket,
};
const BRUSH_TYPE_ICONS: Record<BrushType, LucideIcon> = {
  brush: Brush,
  calligraphy: Feather,
  marker: Highlighter,
  crayon: PencilLine,
  oil: Droplet,
};

interface ThemeCanvasPanelProps {
  editing: Theme | 'new' | null;
  aspectRatio: string;
  palette: ThemePalette;
  typography: ThemeTypography;
  elements: ThemeElement[];
  setElements: Dispatch<SetStateAction<ThemeElement[]>>;
  assets: Asset[];
  selectedElementId: string | null;
  onSelectElement: (id: string | null) => void;
  updateElement: (
    id: string,
    patch: Partial<
      Pick<ThemeElement, 'x' | 'y' | 'width' | 'height' | 'zIndex' | 'rotation' | 'label' | 'editable'>
    >,
  ) => void;
  updateElementContent: (id: string, patch: Record<string, unknown>) => void;
  commit: (mutator: () => void) => void;
  captureForHistory: () => void;
  commitCaptured: () => void;
  duplicateElement: (id: string) => void;
  removeElement: (id: string) => void;
  bringElementToFront: (id: string) => void;
  sendElementToBack: (id: string) => void;
  onOpenAddPanel: () => void;
  brushArmed: boolean;
  setBrushArmed: (armed: boolean | ((prev: boolean) => boolean)) => void;
  brushRedrawId: string | null;
  setBrushRedrawId: (id: string | null) => void;
  brushColor: string | undefined;
  setBrushColor: (color: string | undefined) => void;
  brushSize: number;
  setBrushSize: (size: number) => void;
  setBgRemoveError: (msg: string) => void;
}

// Owns everything about the visual preview canvas — zoom, drag/resize/rotate-in-progress state,
// the raster paint/brush layer, inline text editing, hover/right-click, and the alignment-guide/
// rotate-handle overlays. Split out of ThemesSection (H7) so that a mousemove tick during a drag
// or a paint stroke only re-renders this component, not the palette editor or element-card list
// sitting below it. brushArmed/brushRedrawId/brushColor/brushSize stay lifted in ThemesSection
// since an element card's "Redraw" button and the EditorAddSidebar's Brush item both arm/prime
// them from outside this component.
export function ThemeCanvasPanel({
  editing,
  aspectRatio,
  palette,
  typography,
  elements,
  setElements,
  assets,
  selectedElementId,
  onSelectElement,
  updateElement,
  updateElementContent,
  commit,
  captureForHistory,
  commitCaptured,
  duplicateElement,
  removeElement,
  bringElementToFront,
  sendElementToBack,
  onOpenAddPanel,
  brushArmed,
  setBrushArmed,
  brushRedrawId,
  setBrushRedrawId,
  brushColor,
  setBrushColor,
  brushSize,
  setBrushSize,
  setBgRemoveError,
}: ThemeCanvasPanelProps) {
  const qc = useQueryClient();
  const t = useTranslations('themes');
  const tc = useTranslations('common');
  const { enabled: requireSelectToEdit } = useRequireSelectToEdit();
  const { style: rotateHandleStyle } = useRotateHandleStyle();

  const previewRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: PREVIEW_W, height: PREVIEW_H });
  const [dragBox, setDragBox] = useState<({ id: string } & Box) | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [rotationDrag, setRotationDrag] = useState<{ id: string; deg: number } | null>(null);
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [bgRemovingElementId, setBgRemovingElementId] = useState<string | null>(null);
  // Double-clicking a TEXT element on the canvas edits its content in place instead of forcing a
  // trip down to the element card.
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const update = () =>
      setPreviewSize({
        width: el.clientWidth,
        height: el.clientWidth / parseAspectRatioLocal(aspectRatio),
      });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing, aspectRatio]);

  const [zoom, setZoom] = useState(1);
  const zoomViewportRef = useRef<HTMLDivElement>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);

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
  // selection or the requireSelectToEdit setting.
  function elementIsInteractive(el: ThemeElement, isSelected: boolean) {
    if (el.editable === false) return false;
    return !requireSelectToEdit || isSelected;
  }

  const getBoxPx = useCallback(
    (el: ThemeElement): Box => ({
      left: (el.x / 100) * previewSize.width,
      top: (el.y / 100) * previewSize.height,
      width: (el.width / 100) * previewSize.width,
      height: (el.height / 100) * previewSize.height,
    }),
    [previewSize],
  );

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
  // the element's rotation tracks the angle from its own center to the mouse.
  function startRotate(e: React.MouseEvent, el: ThemeElement) {
    e.preventDefault();
    e.stopPropagation();
    onSelectElement(el.id);
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

  // Custom resize handles for rotated elements — react-rnd's own resize handles stay anchored to
  // the element's unrotated bounding box, so once rotated they end up nowhere near its visible
  // corners/edges.
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

  // Right-click "Edit" — the element card's full field set is only rendered once selected, so
  // selecting IS expanding; this just also scrolls it into view since it may be off-screen below
  // the canvas.
  function editElementFromContextMenu(id: string) {
    onSelectElement(id);
    requestAnimationFrame(() => {
      document.getElementById(`theme-el-card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }
  function scrollToPaletteSection() {
    document.getElementById('theme-palette-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  // Right-click shortcut for the same client-side background removal ImagePicker's own button
  // offers — acts on whatever asset the element already has, without a trip through its settings.
  async function hideElementBackground(id: string) {
    if (bgRemovingElementId) return;
    const el = elements.find((e) => e.id === id);
    if (!el || el.kind !== 'IMAGE' || !el.content.assetId) return;
    const asset = assets.find((a) => a.id === el.content.assetId);
    if (!asset) return;
    setBgRemoveError('');
    setBgRemovingElementId(id);
    try {
      const newAsset = await removeAssetBackground(asset);
      void qc.invalidateQueries({ queryKey: ['assets'] });
      commit(() => updateElementContent(id, { assetId: newAsset.id }));
    } catch (e) {
      setBgRemoveError(e instanceof Error ? e.message : 'Background removal failed');
    } finally {
      setBgRemovingElementId(null);
    }
  }
  function elementContextMenuActions(el: ThemeElement): ContextMenuAction[] {
    const locked = el.editable === false;
    return [
      { key: 'edit', label: tc('edit'), icon: Pencil, onClick: () => editElementFromContextMenu(el.id) },
      { key: 'duplicate', label: tc('duplicate'), icon: Copy, onClick: () => duplicateElement(el.id) },
      { key: 'front', label: tc('bringToFront'), icon: ArrowUpToLine, onClick: () => bringElementToFront(el.id) },
      { key: 'back', label: tc('sendToBack'), icon: ArrowDownToLine, onClick: () => sendElementToBack(el.id) },
      {
        key: 'lock',
        label: locked ? tc('unlock') : tc('lock'),
        icon: locked ? LockOpen : Lock,
        onClick: () => commit(() => updateElement(el.id, { editable: locked })),
      },
      ...(el.kind === 'IMAGE' && el.content.assetId
        ? [{ key: 'hideBg', label: tc('hideBackground'), icon: Wand2, onClick: () => void hideElementBackground(el.id) }]
        : []),
      {
        key: 'delete',
        label: tc('delete'),
        icon: Trash2,
        danger: true,
        separator: true,
        onClick: () => removeElement(el.id),
      },
    ];
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
  const [brushDraft, setBrushDraft] = useState<ThemeBrushPoint[] | null>(null);
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
      if (last && Math.hypot(pt.x - last.x, pt.y - last.y) < 0.5) return prev;
      return [...prev, pt];
    });
  }
  function cancelBrushStroke() {
    const redrawId = brushRedrawId;
    setBrushDraft(null);
    setBrushRedrawId(null);
    if (redrawId) setBrushArmed(false);
  }
  // Shared by the live draw-mode preview and the finished element so both render the exact same
  // geometry: a stroke's points/box are stored relative to its own tight bounding box, not the
  // full canvas.
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
      onSelectElement(redrawId);
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
    onSelectElement(id);
  }

  // The paint layer: a single full-canvas BRUSH element carrying a raster bitmap that the new
  // brush/eraser/fill/eyedropper toolbar all read and write. At most one should ever exist —
  // found by content.raster rather than by id so it survives theme reloads with no bookkeeping.
  function isPaintLayer(el: ThemeElement): el is Extract<ThemeElement, { kind: 'BRUSH' }> {
    return el.kind === 'BRUSH' && !!el.content.raster;
  }
  const paintLayerEl = elements.find(isPaintLayer);
  const isPaintLayerLive = brushArmed && !brushRedrawId;

  const paintCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const paintLastPointRef = useRef<RasterPoint | null>(null);
  const [paintTool, setPaintTool] = useState<PaintTool>('brush');
  const [paintBrushType, setPaintBrushType] = useState<BrushType>('brush');
  const [paintSize, setPaintSize] = useState(24);
  const [paintOpacity, setPaintOpacity] = useState(1);

  function canvasPointRasterPx(clientX: number, clientY: number): RasterPoint | null {
    const canvas = previewRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const { width, height } = paintLayerResolution(aspectRatio);
    return {
      x: Math.min(width, Math.max(0, ((clientX - rect.left) / rect.width) * width)),
      y: Math.min(height, Math.max(0, ((clientY - rect.top) / rect.height) * height)),
    };
  }

  const paintLayerRasterUrl = paintLayerEl?.content.raster?.dataUrl;
  useEffect(() => {
    if (!isPaintLayerLive) return;
    const canvas = paintCanvasRef.current;
    if (!canvas) return;
    const { width, height } = paintLayerResolution(aspectRatio);
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (paintLayerRasterUrl) {
      loadImage(paintLayerRasterUrl)
        .then((img) => ctx.drawImage(img, 0, 0, width, height))
        .catch((err: unknown) => console.error('Failed to load paint layer raster', err));
    }
  }, [isPaintLayerLive, aspectRatio, paintLayerRasterUrl]);

  function paintStrokeOptions() {
    return { type: paintBrushType, color: resolveThemeColor(brushColor, palette) ?? '#6366f1', size: paintSize, opacity: paintOpacity };
  }

  function startPaintStroke(e: React.PointerEvent) {
    if (!isPaintLayerLive) return;
    e.preventDefault();
    e.stopPropagation();
    const pt = canvasPointRasterPx(e.clientX, e.clientY);
    const ctx = paintCanvasRef.current?.getContext('2d');
    if (!pt || !ctx) return;
    if (paintTool === 'fill') {
      const { width, height } = paintLayerResolution(aspectRatio);
      floodFill(ctx, width, height, pt.x, pt.y, resolveThemeColor(brushColor, palette) ?? '#6366f1', paintOpacity);
      commitPaintLayer();
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    paintLastPointRef.current = pt;
    if (paintTool === 'eraser') eraseSegment(ctx, pt, pt, paintSize);
    else strokeSegment(ctx, pt, pt, paintStrokeOptions());
  }
  function movePaintStroke(e: React.PointerEvent) {
    if (!paintLastPointRef.current) return;
    if (e.buttons !== 1) {
      paintLastPointRef.current = null;
      return;
    }
    const pt = canvasPointRasterPx(e.clientX, e.clientY);
    const ctx = paintCanvasRef.current?.getContext('2d');
    if (!pt || !ctx) return;
    if (paintTool === 'eraser') eraseSegment(ctx, paintLastPointRef.current, pt, paintSize);
    else strokeSegment(ctx, paintLastPointRef.current, pt, paintStrokeOptions());
    paintLastPointRef.current = pt;
  }
  function finishPaintStroke() {
    if (!paintLastPointRef.current) return;
    paintLastPointRef.current = null;
    commitPaintLayer();
  }
  // Single commit per finished action (one stroke, or one fill click) — mirrors the legacy
  // brush's one-commit-per-stroke discipline so undo steps stay one gesture each, not one per
  // pointermove. Reads the live canvas back out as the new source of truth for the element.
  function commitPaintLayer() {
    const canvas = paintCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const { width, height } = paintLayerResolution(aspectRatio);
    commit(() =>
      setElements((prev) => {
        if (prev.some(isPaintLayer)) {
          return prev.map((el) => (isPaintLayer(el) ? { ...el, content: { ...el.content, raster: { dataUrl, width, height } } } : el));
        }
        const id = newElementId();
        const layer: ThemeElement = {
          id,
          kind: 'BRUSH',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: prev.length,
          rotation: 0,
          editable: true,
          style: {},
          content: { points: [], raster: { dataUrl, width, height } },
        };
        return [...prev, layer];
      }),
    );
  }
  function clearPaintLayer() {
    const canvas = paintCanvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    commitPaintLayer();
  }
  async function handleEyedropper() {
    const hex = await pickColorFromScreen();
    if (hex) setBrushColor(hex);
  }

  return (
    <div>
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
      {brushArmed && brushRedrawId && (
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
      {isPaintLayerLive && (
        <div className="mb-2 flex flex-col gap-2 rounded-lg border border-teal-200 bg-teal-50 p-2 text-xs text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300">
          <div className="flex flex-wrap items-center gap-3">
            {/* Tool: brush / eraser / fill bucket */}
            <div className="flex items-center gap-0.5 rounded-md bg-white/70 p-0.5 dark:bg-black/20">
              {PAINT_TOOLS.map((toolKey) => {
                const Icon = PAINT_TOOL_ICONS[toolKey];
                return (
                  <button
                    key={toolKey}
                    type="button"
                    title={t(`paintToolbar.tools.${toolKey}`)}
                    onClick={() => setPaintTool(toolKey)}
                    className={`rounded px-1.5 py-1 ${
                      paintTool === toolKey
                        ? 'bg-teal-600 text-white'
                        : 'text-teal-700 hover:bg-teal-100 dark:text-teal-300 dark:hover:bg-teal-900/50'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              title={isEyeDropperSupported() ? t('paintToolbar.tools.eyedropper') : t('paintToolbar.eyedropperUnsupported')}
              disabled={!isEyeDropperSupported()}
              onClick={() => { void handleEyedropper(); }}
              className="rounded p-1 text-teal-700 hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-40 dark:text-teal-300 dark:hover:bg-teal-900/50"
            >
              <Pipette className="h-3.5 w-3.5" />
            </button>

            {/* Brush type — only meaningful when painting, not while erasing/filling */}
            {paintTool === 'brush' && (
              <div className="flex items-center gap-0.5 rounded-md bg-white/70 p-0.5 dark:bg-black/20">
                {BRUSH_TYPES.map((typeKey) => {
                  const Icon = BRUSH_TYPE_ICONS[typeKey];
                  return (
                    <button
                      key={typeKey}
                      type="button"
                      title={t(`brushTypes.${typeKey}`)}
                      onClick={() => setPaintBrushType(typeKey)}
                      className={`rounded px-1.5 py-1 ${
                        paintBrushType === typeKey
                          ? 'bg-teal-600 text-white'
                          : 'text-teal-700 hover:bg-teal-100 dark:text-teal-300 dark:hover:bg-teal-900/50'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  );
                })}
              </div>
            )}

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

            <button
              type="button"
              title={t('paintToolbar.clear')}
              onClick={clearPaintLayer}
              className="flex items-center gap-1 rounded px-1.5 py-1 text-teal-700 hover:bg-teal-100 dark:text-teal-300 dark:hover:bg-teal-900/50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>

            <div className="ms-auto flex items-center gap-3">
              <label className="flex items-center gap-1.5" title={t('paintToolbar.size')}>
                <span className="text-[10px]">{t('paintToolbar.size')}</span>
                <input
                  type="range"
                  min={2}
                  max={200}
                  value={paintSize}
                  onChange={(e) => setPaintSize(Number(e.target.value))}
                  className="w-20 accent-teal-600"
                />
                <span className="w-7 text-[10px] tabular-nums">{paintSize}</span>
              </label>
              <label className="flex items-center gap-1.5" title={t('opacity')}>
                <span className="text-[10px]">{t('opacity')}</span>
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={Math.round(paintOpacity * 100)}
                  onChange={(e) => setPaintOpacity(Number(e.target.value) / 100)}
                  className="w-20 accent-teal-600"
                />
                <span className="w-8 text-[10px] tabular-nums">{Math.round(paintOpacity * 100)}%</span>
              </label>
              <button
                type="button"
                onClick={() => setBrushArmed(false)}
                className="font-medium underline"
              >
                {t('paintToolbar.done')}
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        ref={zoomViewportRef}
        onWheel={(e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * 0.0015)));
        }}
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
            if (e.target === e.currentTarget) onSelectElement(null);
          }}
          onContextMenu={(e) => {
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            onSelectElement(null);
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              actions: [
                { key: 'add', label: t('addElement'), icon: Plus, onClick: onOpenAddPanel },
                { key: 'bg', label: t('palette'), icon: Palette, onClick: scrollToPaletteSection },
              ],
            });
          }}
          style={{
            width: '100%',
            aspectRatio: aspectRatio.replace(':', ' / '),
            background: palette.background,
            position: 'relative',
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
                  enableResizing={interactive && rotation === 0 ? undefined : false}
                  cancel=".rotate-handle, .resize-handle, .inline-text-edit"
                  size={{ width: box.width, height: box.height }}
                  position={{ x: box.left, y: box.top }}
                  onMouseDown={() => onSelectElement(el.id)}
                  onDragStart={() => onSelectElement(el.id)}
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
                  <div
                    onMouseEnter={() => setHoveredElementId(el.id)}
                    onMouseLeave={() =>
                      setHoveredElementId((id) => (id === el.id ? null : id))
                    }
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelectElement(el.id);
                      setContextMenu({ x: e.clientX, y: e.clientY, actions: elementContextMenuActions(el) });
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      position: 'relative',
                      cursor: isSelected ? 'move' : 'pointer',
                      transform: liveRotation ? `rotate(${liveRotation}deg)` : undefined,
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: thumb
                          ? '#000'
                          : el.kind === 'SHAPE'
                            ? (isCanvasOutlineShape ? 'transparent' : (resolveThemeColor(el.style.backgroundColor, palette) ??
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
                          color={resolveThemeColor(el.style.backgroundColor, palette) ?? palette.text}
                          strokeWidthPx={el.style.strokeWidthPx}
                        />
                      )}
                      {isCanvasBrush && !(isPaintLayerLive && paintLayerEl?.id === el.id) && (
                        el.content.raster ? (
                          // eslint-disable-next-line @next/next/no-img-element -- data URL, not a static/local image
                          <img
                            src={el.content.raster.dataUrl}
                            alt=""
                            style={{ width: '100%', height: '100%', objectFit: 'fill', display: 'block' }}
                          />
                        ) : (
                          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
                            <polyline
                              points={brushPolylinePoints(el.content.points)}
                              fill="none"
                              stroke={resolveThemeColor(el.style.backgroundColor, palette) ?? palette.text}
                              strokeWidth={el.style.strokeWidthPx ?? 4}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              vectorEffect="non-scaling-stroke"
                            />
                          </svg>
                        )
                      )}
                      {el.kind === 'TEXT' ? (
                        el.content.assetId ? (
                          (() => {
                            const textAsset = assets.find((a) => a.id === el.content.assetId);
                            if (!textAsset) {
                              return (
                                <span style={{ fontSize: 9, color: '#fff', fontWeight: 600 }}>
                                  {t('noTextAsset')}
                                </span>
                              );
                            }
                            return textAsset.textTickerEnabled ? (
                              <TickerTextPreview
                                text={textAsset.textContent ?? ''}
                                color={textAsset.textColor ?? '#fff'}
                                fontFamily={fontStack(textAsset.textFontFamily)}
                                fontSize={TEXT_ASSET_PREVIEW_SIZE[textAsset.textSize ?? 'MEDIUM'] ?? TEXT_ASSET_PREVIEW_SIZE.MEDIUM!}
                                direction={textAsset.textTickerDirection}
                                speedPx={textAsset.textTickerSpeed ?? 80}
                                crossPosition={textAsset.textTickerCrossOffset ?? 50}
                              />
                            ) : (
                              <div
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  padding: '5%',
                                  boxSizing: 'border-box',
                                  backgroundColor: textAsset.textBackgroundColor ?? undefined,
                                }}
                              >
                                <p
                                  style={{
                                    color: textAsset.textColor ?? '#fff',
                                    fontFamily: fontStack(textAsset.textFontFamily),
                                    fontSize: TEXT_ASSET_PREVIEW_SIZE[textAsset.textSize ?? 'MEDIUM'],
                                    textAlign: 'center',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-word',
                                    margin: 0,
                                  }}
                                >
                                  {textAsset.textContent}
                                </p>
                              </div>
                            );
                          })()
                        ) : editingTextId === el.id ? (
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
                              color: resolveThemeColor(el.style.color, palette) ?? palette.text,
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
                              onSelectElement(el.id);
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
                              color: resolveThemeColor(el.style.color, palette) ?? palette.text,
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
                    {bgRemovingElementId === el.id && (
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 4,
                          background: 'rgba(0,0,0,0.55)',
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 500,
                        }}
                      >
                        <RefreshCw className="h-3 w-3 animate-spin" />
                        {tc('removingBackgroundHint')}
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
          {/* Legacy per-stroke redraw overlay — only for the old vector-polyline BRUSH
              elements a theme saved before the paint layer existed. */}
          {brushArmed && brushRedrawId && (
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
                        stroke={resolveThemeColor(brushColor, palette) ?? '#6366f1'}
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
          {/* Paint layer overlay — the new brush/eraser/fill toolbar. paintCanvasRef is the
              live working bitmap (kept in sync with the committed element by the
              isPaintLayerLive effect above); it both renders the current paint layer and
              captures pointer input, so it needs to sit above every other element the way
              the legacy overlay above does. */}
          {isPaintLayerLive && (
            <div
              onPointerDown={startPaintStroke}
              onPointerMove={movePaintStroke}
              onPointerUp={finishPaintStroke}
              onPointerCancel={finishPaintStroke}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 1000,
                cursor: paintTool === 'fill' ? 'copy' : 'crosshair',
                touchAction: 'none',
              }}
            >
              <canvas
                ref={paintCanvasRef}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }}
              />
            </div>
          )}
        </div>
        {/* Unclipped overlay for the rotate grip + rotation-aware resize handles — sits
            outside the frame's overflow:hidden clip above so they stay grabbable even when
            a rotated element's box would put them past the frame edge. */}
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
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}

// `aspectRatio` is stored as e.g. "16:9" — parsed to a ratio purely to derive the responsive
// canvas's height from its rendered width. Kept local (not imported from ThemesSection) since
// it's a trivial one-liner used only here.
function parseAspectRatioLocal(aspect: string): number {
  const [w, h] = aspect.split(':').map(Number);
  return w && h && w > 0 && h > 0 ? w / h : 16 / 9;
}
