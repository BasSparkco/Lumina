'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
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
} from 'lucide-react';
import { shapeClipStyle, mediaCropStyle } from '@lumina/types';
import type { Asset, ZoneInput, Layout } from '@/lib/api';
import { ContextMenu, type ContextMenuState, type ContextMenuAction } from '@/components/ContextMenu';
import { useRequireSelectToEdit } from '@/hooks/useRequireSelectToEdit';
import { useRotateHandleStyle } from '@/hooks/useRotateHandleStyle';
import { ZoneRotateHandle } from '@/components/ZoneRotateHandle';
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
import { ZOOM_STEP, clampPct, clampZoom } from '@/lib/editorZoom';
import { ZONE_COLORS } from './LayoutsSection';

const PREVIEW_W = 400;
const PREVIEW_H = 225;
const MIN_ZONE_PX = 20;
// Rotation drag snaps to the nearest 15° once within this many degrees.
const SNAP_DEG = 4;

interface LayoutCanvasPanelProps {
  editing: Layout | 'new' | null;
  zones: ZoneInput[];
  assets: Asset[];
  selectedZoneId: string | null;
  onSelectZone: (id: string | null) => void;
  updateZone: (i: number, patch: Partial<ZoneInput>) => void;
  commit: (mutator: () => void) => void;
  duplicateZone: (i: number) => void;
  removeZone: (i: number) => void;
  bringZoneToFront: (i: number) => void;
  sendZoneToBack: (i: number) => void;
  editZoneFromContextMenu: (key: string) => void;
  hideZoneBackground: (i: number, key: string) => void;
  bgRemovingZoneKey: string | null;
  onOpenAddPanel: () => void;
}

// Owns everything about the visual preview canvas — zoom, drag/resize/rotate-in-progress state,
// hover/right-click, and the alignment-guide/rotate-handle overlays. Split out of LayoutsSection
// (H7) so that a mousemove tick during a drag only re-renders this component, not the zone-card
// list or the add-zone sidebar sitting next to it.
export function LayoutCanvasPanel({
  editing,
  zones,
  assets,
  selectedZoneId,
  onSelectZone,
  updateZone,
  commit,
  duplicateZone,
  removeZone,
  bringZoneToFront,
  sendZoneToBack,
  editZoneFromContextMenu,
  hideZoneBackground,
  bgRemovingZoneKey,
  onOpenAddPanel,
}: LayoutCanvasPanelProps) {
  const t = useTranslations('layouts');
  const tc = useTranslations('common');
  const { enabled: requireSelectToEdit } = useRequireSelectToEdit();
  const { style: rotateHandleStyle } = useRotateHandleStyle();

  const previewRef = useRef<HTMLDivElement>(null);
  const [previewSize, setPreviewSize] = useState({ width: PREVIEW_W, height: PREVIEW_H });
  // The zone currently being dragged/resized, tracked outside `zones` state so interaction
  // frames don't re-render the settings list below the preview — only committed on drop.
  const [dragBox, setDragBox] = useState<({ index: number } & Box) | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [rotationDrag, setRotationDrag] = useState<{ index: number; deg: number } | null>(null);
  const [hoveredZoneId, setHoveredZoneId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

  // Resets zoom/drag/hover/menu state whenever a different layout (or 'new') is opened — the
  // layout list stays visible while editing, so switching which layout is open re-renders this
  // component in place rather than remounting it, and this state must not leak across that
  // switch. Adjusted during render rather than in an effect, so there's no flash of the previous
  // zoom before the reset lands.
  const [prevEditing, setPrevEditing] = useState(editing);
  if (editing !== prevEditing) {
    setPrevEditing(editing);
    setZoom(1);
    setDragBox(null);
    setGuides({ v: [], h: [] });
    setRotationDrag(null);
    setHoveredZoneId(null);
    setContextMenu(null);
  }

  useEffect(() => {
    const el = zoomViewportRef.current;
    if (!el) return;
    const update = () => setNaturalWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing]);

  // A locked zone (editable: false) can never be dragged/resized/rotated, regardless of
  // selection or the requireSelectToEdit setting. Otherwise interaction is gated on selection
  // only when that setting is on — off restores immediate drag/resize on first touch.
  function zoneIsInteractive(z: ZoneInput, isSelected: boolean) {
    if (z.editable === false) return false;
    return !requireSelectToEdit || isSelected;
  }

  function zoneContextMenuActions(i: number, key: string, z: ZoneInput): ContextMenuAction[] {
    const locked = z.editable === false;
    const asset = z.assetId ? assets.find((a) => a.id === z.assetId) : undefined;
    return [
      { key: 'edit', label: tc('edit'), icon: Pencil, onClick: () => editZoneFromContextMenu(key) },
      { key: 'duplicate', label: tc('duplicate'), icon: Copy, onClick: () => duplicateZone(i) },
      { key: 'front', label: tc('bringToFront'), icon: ArrowUpToLine, onClick: () => bringZoneToFront(i) },
      { key: 'back', label: tc('sendToBack'), icon: ArrowDownToLine, onClick: () => sendZoneToBack(i) },
      {
        key: 'lock',
        label: locked ? tc('unlock') : tc('lock'),
        icon: locked ? LockOpen : Lock,
        onClick: () => commit(() => updateZone(i, { editable: locked })),
      },
      ...(asset?.type === 'IMAGE'
        ? [{ key: 'hideBg', label: tc('hideBackground'), icon: Wand2, onClick: () => hideZoneBackground(i, key) }]
        : []),
      {
        key: 'delete',
        label: tc('delete'),
        icon: Trash2,
        danger: true,
        separator: true,
        onClick: () => removeZone(i),
      },
    ];
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

  return (
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
            if (e.target === e.currentTarget) onSelectZone(null);
          }}
          onContextMenu={(e) => {
            if (e.target !== e.currentTarget) return;
            e.preventDefault();
            onSelectZone(null);
            setContextMenu({
              x: e.clientX,
              y: e.clientY,
              actions: [{ key: 'add', label: t('addZone'), icon: Plus, onClick: onOpenAddPanel }],
            });
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
                  onMouseDown={() => onSelectZone(key)}
                  onDragStart={() => onSelectZone(key)}
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
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onSelectZone(key);
                      setContextMenu({ x: e.clientX, y: e.clientY, actions: zoneContextMenuActions(i, key, z) });
                    }}
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
                    {bgRemovingZoneKey === key && (
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
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}
