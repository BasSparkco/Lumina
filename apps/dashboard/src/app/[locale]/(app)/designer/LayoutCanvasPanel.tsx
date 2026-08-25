'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Canvas,
  FabricImage,
  FabricText,
  FixedLayout,
  Group,
  LayoutManager,
  Rect,
  type FabricObject,
  type TPointerEvent,
} from 'fabric';
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
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Asset, ZoneInput, Layout } from '@/lib/api';
import { ContextMenu, type ContextMenuState, type ContextMenuAction } from '@/components/ContextMenu';
import { useRequireSelectToEdit } from '@/hooks/useRequireSelectToEdit';
import { type Box, clampBox, computeAlignTargets, resolveResize, snapDragAxis } from '@/lib/canvasSnap';
import { ZOOM_STEP, clampPct, clampZoom } from '@/lib/editorZoom';
import { buildShapeClipPath, fitMediaInBox } from '@/lib/fabricShapes';
import { getCachedImageElement, loadImageElement } from '@/lib/fabricImageCache';
import { ZONE_COLORS } from './LayoutsSection';

const PREVIEW_W = 400;
const PREVIEW_H = 225;
const MIN_ZONE_PX = 20;
// Corner-drag names fabric reports on object:scaling -> the same substrings
// canvasSnap's resolveResize() matches against (top/bottom/left/right).
const CORNER_DIRECTION: Record<string, string> = {
  tl: 'top-left',
  tr: 'top-right',
  bl: 'bottom-left',
  br: 'bottom-right',
  ml: 'left',
  mr: 'right',
  mt: 'top',
  mb: 'bottom',
};

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
  // Hands the parent a function that rasterizes the live fabric canvas to a PNG data URL, for
  // "Save as Asset" — replaces the old DOM-node ref html2canvas used to rasterize from outside.
  exportRef?: (getPngDataUrl: (() => string) | null) => void;
}

type ZoneGroup = Group & {
  zoneKey: string;
  _hovered?: boolean;
  _selected?: boolean;
};

function zoneKeyOf(z: ZoneInput, i: number): string {
  return z._localId ?? String(i);
}

function updateOutlineVisibility(group: ZoneGroup) {
  const outline = group.getObjects().find((o) => (o as FabricObject & { _role?: string })._role === 'outline');
  if (outline) outline.set('visible', !!(group._hovered || group._selected));
}

// Owns everything about the visual preview canvas — a single fabric.Canvas instance persisted
// across renders, reconciled against the `zones` array. Zoom, live drag/resize/rotate, alignment
// snapping and rotation are all fabric-native; shape clipping, media crop, the lock badge and the
// background-removal indicator are drawn as plain canvas objects since fabric has no CSS
// clip-path/object-fit equivalent. Split out of LayoutsSection (H7) so interaction frames only
// touch this component, not the zone-card list or add-zone sidebar sitting next to it.
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
  exportRef,
}: LayoutCanvasPanelProps) {
  const t = useTranslations('layouts');
  const tc = useTranslations('common');
  const { enabled: requireSelectToEdit } = useRequireSelectToEdit();

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasElRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const groupsRef = useRef<Map<string, ZoneGroup>>(new Map());

  const [previewSize, setPreviewSize] = useState({ width: PREVIEW_W, height: PREVIEW_H });
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Latest props/state the stable (registered-once) fabric event handlers below need to read —
  // avoids re-registering canvas listeners on every render just to close over fresh values.
  const latest = useRef({
    zones,
    assets,
    previewSize,
    selectedZoneId,
    requireSelectToEdit,
    bgRemovingZoneKey,
    onSelectZone,
    updateZone,
    commit,
  });
  useEffect(() => {
    zoomRef.current = zoom;
    latest.current = {
      zones,
      assets,
      previewSize,
      selectedZoneId,
      requireSelectToEdit,
      bgRemovingZoneKey,
      onSelectZone,
      updateZone,
      commit,
    };
  });

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () =>
      setPreviewSize({ width: el.clientWidth, height: (el.clientWidth * 9) / 16 });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [editing]);

  // Resets zoom/guides/menu state whenever a different layout (or 'new') is opened — see
  // LayoutsSection for why this is done during render rather than in an effect.
  const [prevEditing, setPrevEditing] = useState(editing);
  if (editing !== prevEditing) {
    setPrevEditing(editing);
    setZoom(1);
    setGuides({ v: [], h: [] });
    setContextMenu(null);
  }

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z * Math.exp(-e.deltaY * 0.0015)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

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
  // zoneContextMenuActions needs `t`/`tc`/assets/handlers that change across renders, but it's
  // only invoked from the stable (registered-once) contextmenu listener below — bridge via a ref
  // instead of reinitializing the canvas on every render.
  const zoneContextMenuActionsRef = useRef(zoneContextMenuActions);
  useEffect(() => {
    zoneContextMenuActionsRef.current = zoneContextMenuActions;
  });

  function getBoxPxFor(z: ZoneInput, size: { width: number; height: number }): Box {
    return {
      left: (z.x / 100) * size.width,
      top: (z.y / 100) * size.height,
      width: (z.width / 100) * size.width,
      height: (z.height / 100) * size.height,
    };
  }

  // Per-zone-key counter guarding buildZoneGroup's async image-load callback against a since-
  // superseded rebuild (new asset, resize, etc.) inserting its now-stale image late.
  const contentGenRef = useRef<Map<string, number>>(new Map());
  // Points at the latest render's `syncZone` (defined below) — buildZoneGroup's async image-load
  // callback needs to call it well after this render has finished, so a plain reference to the
  // function wouldn't do; the ref is written by an effect right after syncZone is (re)declared.
  const syncZoneRef = useRef<(canvas: Canvas, key: string) => void>(() => {});

  // A fresh Group is constructed on every rebuild rather than mutating an existing one's children
  // (group.remove()+add()) — fabric's `Group.add()` treats an object's left/top as *canvas-plane*
  // coordinates and converts them into the group's local plane on entry (so the object's on-screen
  // position is preserved if you're moving it between groups); that conversion double-offsets
  // children that were already built in local coordinates, which is what every child below is.
  // Only the constructor path (`new Group(children, ...)`) takes local coordinates as-is.
  function buildZoneGroup(
    key: string,
    box: Box,
    opts: {
      shape: ZoneInput['shape'];
      color: string;
      thumb: string | null;
      name: string;
      zoneTypeLabel: string;
      assetType: Asset['type'] | undefined;
      crop: { cropZoom?: number | null; cropOffsetX?: number | null; cropOffsetY?: number | null };
      locked: boolean;
      lockedHint: string;
      bgRemoving: boolean;
      removingBackgroundHint: string;
    },
  ): ZoneGroup {
    const w = box.width;
    const h = box.height;

    const children: FabricObject[] = [];
    const bg = new Rect({
      left: -w / 2,
      top: -h / 2,
      width: w,
      height: h,
      originX: 'left',
      originY: 'top',
      fill: opts.thumb ? '#000' : opts.color + '55',
      stroke: opts.color,
      strokeWidth: 2,
      strokeUniform: true,
      selectable: false,
      evented: false,
    });
    children.push(bg);

    if (opts.thumb) {
      const cachedEl = getCachedImageElement(opts.thumb);
      const applyImage = (el: HTMLImageElement) => {
        const fit = opts.assetType === 'IMAGE' && !opts.crop.cropZoom ? 'fill' : opts.crop.cropZoom ? 'cover' : 'contain';
        const { left, top, scaleX, scaleY } = fitMediaInBox(w, h, el.naturalWidth, el.naturalHeight, fit, opts.crop);
        return new FabricImage(el, { left, top, scaleX, scaleY, originX: 'left', originY: 'top', selectable: false, evented: false });
      };
      if (cachedEl) {
        children.push(applyImage(cachedEl));
      } else {
        // Not cached yet — render the colorless placeholder for now and trigger a full re-sync
        // of this zone (by key) once the image resolves, unless a newer build for the same key
        // (new asset, etc.) has since superseded this one.
        const gen = (contentGenRef.current.get(key) ?? 0) + 1;
        contentGenRef.current.set(key, gen);
        loadImageElement(opts.thumb)
          .then(() => {
            if (contentGenRef.current.get(key) !== gen) return;
            const canvas = fabricRef.current;
            if (canvas) syncZoneRef.current(canvas, key);
          })
          .catch(() => {});
      }
    } else {
      const nameText = new FabricText(opts.name, {
        left: 0,
        top: -6,
        originX: 'center',
        originY: 'center',
        fontSize: 11,
        fontWeight: '600',
        fill: '#fff',
        textAlign: 'center',
        selectable: false,
        evented: false,
      });
      const typeText = new FabricText(opts.zoneTypeLabel, {
        left: 0,
        top: 8,
        originX: 'center',
        originY: 'center',
        fontSize: 10,
        opacity: 0.7,
        fill: '#fff',
        selectable: false,
        evented: false,
      });
      children.push(nameText, typeText);
    }

    const outline = new Rect({
      left: -w / 2 - 2,
      top: -h / 2 - 2,
      width: w + 4,
      height: h + 4,
      originX: 'left',
      originY: 'top',
      fill: 'transparent',
      stroke: opts.color,
      strokeWidth: 1,
      strokeDashArray: [4, 4],
      selectable: false,
      evented: false,
      visible: false,
    });
    (outline as FabricObject & { _role?: string })._role = 'outline';
    children.push(outline);

    if (opts.locked) {
      const badgeBg = new Rect({
        left: -w / 2 + 3,
        top: -h / 2 + 3,
        width: 14,
        height: 14,
        originX: 'left',
        originY: 'top',
        rx: 4,
        ry: 4,
        fill: 'rgba(0,0,0,0.5)',
        selectable: false,
        evented: false,
      });
      const badgeIcon = new FabricText('🔒', {
        left: -w / 2 + 10,
        top: -h / 2 + 10,
        originX: 'center',
        originY: 'center',
        fontSize: 8,
        selectable: false,
        evented: false,
      });
      children.push(badgeBg, badgeIcon);
    }

    if (opts.bgRemoving) {
      const overlay = new Rect({
        left: -w / 2,
        top: -h / 2,
        width: w,
        height: h,
        originX: 'left',
        originY: 'top',
        fill: 'rgba(0,0,0,0.55)',
        selectable: false,
        evented: false,
      });
      const overlayText = new FabricText(opts.removingBackgroundHint, {
        left: 0,
        top: 0,
        originX: 'center',
        originY: 'center',
        fontSize: 10,
        fontWeight: '500',
        fill: '#fff',
        selectable: false,
        evented: false,
      });
      children.push(overlay, overlayText);
    }

    const group = new Group(children, {
      width: w,
      height: h,
      originX: 'left',
      originY: 'top',
      layoutManager: new LayoutManager(new FixedLayout()),
      subTargetCheck: false,
      interactive: false,
      // Rebuilt from scratch on every content change (see comment above `buildZoneGroup`), so
      // there's no long-lived per-object cache worth keeping warm here.
      objectCaching: false,
    }) as ZoneGroup;
    group.clipPath = buildShapeClipPath(opts.shape, w, h);
    group.zoneKey = key;
    return group;
  }

  // Rebuilds and swaps in the fabric group for one zone (by key), applying its current
  // position/rotation/interactive state. Used both by the main per-render sync pass below and by
  // buildZoneGroup's async image-load callback, which needs to re-sync a single zone well after
  // that render has finished — hence pulling everything from `latest.current` rather than props.
  function syncZone(canvas: Canvas, key: string) {
    const { zones: zs, assets: as, selectedZoneId: sel, requireSelectToEdit: req, bgRemovingZoneKey: bgKey, previewSize: size } =
      latest.current;
    const i = zs.findIndex((z, idx) => zoneKeyOf(z, idx) === key);
    const z = zs[i];
    if (!z) return;

    const box = getBoxPxFor(z, size);
    const rotation = z.rotation ?? 0;
    const isSelected = sel === key;
    const interactive = z.editable === false ? false : !req || isSelected;
    const locked = z.editable === false;
    const color = ZONE_COLORS[i % ZONE_COLORS.length] ?? '#6366f1';
    const asset = z.assetId ? as.find((a) => a.id === z.assetId) : undefined;
    const thumb = asset && asset.status === 'READY' ? (asset.thumbnailUrl ?? asset.url) : null;
    const bgRemoving = bgKey === key;

    const prevGroup = groupsRef.current.get(key);
    const wasActive = !!prevGroup && canvas.getActiveObject() === prevGroup;
    const group = buildZoneGroup(key, box, {
      shape: z.shape,
      color,
      thumb,
      name: z.name,
      zoneTypeLabel: t(`zoneTypes.${z.zoneType ?? 'MEDIA'}`),
      assetType: asset?.type,
      crop: z,
      locked,
      lockedHint: t('lockedHint'),
      bgRemoving,
      removingBackgroundHint: tc('removingBackgroundHint'),
    });
    group._hovered = prevGroup?._hovered ?? false;
    group._selected = isSelected;

    if (prevGroup) canvas.remove(prevGroup);
    canvas.add(group);
    groupsRef.current.set(key, group);

    group.set({
      left: box.left,
      top: box.top,
      angle: rotation,
      selectable: true,
      evented: true,
      hasControls: interactive,
      lockMovementX: !interactive,
      lockMovementY: !interactive,
      lockScalingX: !interactive,
      lockScalingY: !interactive,
      lockRotation: !interactive,
      lockSkewingX: true,
      lockSkewingY: true,
      snapAngle: 15,
      snapThreshold: 4,
      hoverCursor: interactive ? 'move' : 'pointer',
      cornerColor: '#fff',
      cornerStrokeColor: color,
      borderColor: color,
      transparentCorners: false,
      cornerStyle: 'rect',
      cornerSize: 8,
      rotatingPointOffset: 22,
    });
    // `.set()` doesn't invalidate fabric's cached corner coordinates (aCoords) — only its first
    // computation gets cached automatically, e.g. at construction. Without this, hit-testing
    // (click-to-select, findTarget) and getBoundingRect() keep using wherever the group *used to*
    // be, not the position/rotation just applied above.
    group.setCoords();
    updateOutlineVisibility(group);

    if (isSelected || wasActive) canvas.setActiveObject(group);
  }
  useEffect(() => {
    syncZoneRef.current = syncZone;
  });

  // ---- fabric canvas lifecycle -------------------------------------------------------------

  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;
    const canvas = new Canvas(el, {
      selection: false, // no marquee multi-select — the designer stays single-select
      preserveObjectStacking: true,
      backgroundColor: '#111',
    });
    fabricRef.current = canvas;

    canvas.on('selection:created', (e) => {
      const obj = e.selected?.[0] as ZoneGroup | undefined;
      if (obj?.zoneKey) latest.current.onSelectZone(obj.zoneKey);
    });
    canvas.on('selection:updated', (e) => {
      const obj = e.selected?.[0] as ZoneGroup | undefined;
      if (obj?.zoneKey) latest.current.onSelectZone(obj.zoneKey);
    });
    canvas.on('selection:cleared', () => latest.current.onSelectZone(null));

    canvas.on('mouse:over', (e) => {
      const obj = e.target as ZoneGroup | undefined;
      if (!obj?.zoneKey) return;
      obj._hovered = true;
      updateOutlineVisibility(obj);
      canvas.requestRenderAll();
    });
    canvas.on('mouse:out', (e) => {
      const obj = e.target as ZoneGroup | undefined;
      if (!obj?.zoneKey) return;
      obj._hovered = false;
      updateOutlineVisibility(obj);
      canvas.requestRenderAll();
    });

    canvas.on('object:moving', (e) => {
      const obj = e.target as ZoneGroup;
      if (!obj.zoneKey) return;
      const { zones: zs, previewSize: size } = latest.current;
      const i = zs.findIndex((z, idx) => zoneKeyOf(z, idx) === obj.zoneKey);
      const z = zs[i];
      if (!z) return;
      const w = obj.width * obj.scaleX;
      const h = obj.height * obj.scaleY;
      if (z.rotation) {
        const box = clampBox({ left: obj.left ?? 0, top: obj.top ?? 0, width: w, height: h }, size.width, size.height);
        obj.set({ left: box.left, top: box.top });
        obj.setCoords();
        setGuides({ v: [], h: [] });
        return;
      }
      const others = zs.filter((oz, idx) => idx !== i && !(oz.rotation ?? 0)).map((oz) => getBoxPxFor(oz, size));
      const targets = computeAlignTargets(size.width, size.height, others);
      const snapX = snapDragAxis(obj.left ?? 0, w, targets.xs);
      const snapY = snapDragAxis(obj.top ?? 0, h, targets.ys);
      const box = clampBox({ left: snapX.pos, top: snapY.pos, width: w, height: h }, size.width, size.height);
      obj.set({ left: box.left, top: box.top });
      obj.setCoords();
      setGuides({
        v: snapX.guide !== null ? [snapX.guide * (zoomRef.current)] : [],
        h: snapY.guide !== null ? [snapY.guide * (zoomRef.current)] : [],
      });
    });

    canvas.on('object:scaling', (e) => {
      const obj = e.target as ZoneGroup;
      if (!obj.zoneKey) return;
      const { zones: zs, previewSize: size } = latest.current;
      const i = zs.findIndex((z, idx) => zoneKeyOf(z, idx) === obj.zoneKey);
      const z = zs[i];
      if (!z) return;
      const liveW = obj.width * obj.scaleX;
      const liveH = obj.height * obj.scaleY;
      if (z.rotation) {
        const w = Math.max(MIN_ZONE_PX, liveW);
        const h = Math.max(MIN_ZONE_PX, liveH);
        obj.set({ scaleX: w / obj.width, scaleY: h / obj.height });
        obj.setCoords();
        setGuides({ v: [], h: [] });
        return;
      }
      const corner = e.transform?.corner ?? '';
      const direction = CORNER_DIRECTION[corner] ?? '';
      const others = zs.filter((oz, idx) => idx !== i && !(oz.rotation ?? 0)).map((oz) => getBoxPxFor(oz, size));
      const targets = computeAlignTargets(size.width, size.height, others);
      const { box, guides: g } = resolveResize(
        direction,
        { left: obj.left ?? 0, top: obj.top ?? 0, width: liveW, height: liveH },
        targets,
        MIN_ZONE_PX,
        size.width,
        size.height,
      );
      obj.set({
        left: box.left,
        top: box.top,
        scaleX: box.width / obj.width,
        scaleY: box.height / obj.height,
      });
      obj.setCoords();
      setGuides({ v: g.v.map((x) => x * zoomRef.current), h: g.h.map((y) => y * zoomRef.current) });
    });

    canvas.on('object:modified', (e) => {
      const obj = e.target as ZoneGroup;
      if (!obj.zoneKey) return;
      setGuides({ v: [], h: [] });
      const { zones: zs, previewSize: size, updateZone: update, commit: doCommit } = latest.current;
      const i = zs.findIndex((z, idx) => zoneKeyOf(z, idx) === obj.zoneKey);
      if (i < 0) return;
      const center = obj.getCenterPoint();
      const w = obj.width * obj.scaleX;
      const h = obj.height * obj.scaleY;
      const left = center.x - w / 2;
      const top = center.y - h / 2;
      doCommit(() =>
        update(i, {
          x: clampPct((left / size.width) * 100),
          y: clampPct((top / size.height) * 100),
          width: clampPct((w / size.width) * 100),
          height: clampPct((h / size.height) * 100),
          rotation: Math.round(obj.angle),
        }),
      );
    });

    const upperEl = canvas.upperCanvasEl;
    const onContextMenu = (ev: MouseEvent) => {
      ev.preventDefault();
      const target = canvas.findTarget(ev as TPointerEvent).target as ZoneGroup | undefined;
      const { zones: zs } = latest.current;
      if (!target?.zoneKey) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        setContextMenu({
          x: ev.clientX,
          y: ev.clientY,
          actions: [{ key: 'add', label: t('addZone'), icon: Plus, onClick: onOpenAddPanel }],
        });
        return;
      }
      const i = zs.findIndex((z, idx) => zoneKeyOf(z, idx) === target.zoneKey);
      const z = zs[i];
      if (i < 0 || !z) return;
      canvas.setActiveObject(target);
      canvas.requestRenderAll();
      latest.current.onSelectZone(target.zoneKey);
      setContextMenu({ x: ev.clientX, y: ev.clientY, actions: zoneContextMenuActionsRef.current(i, target.zoneKey, z) });
    };
    upperEl.addEventListener('contextmenu', onContextMenu);

    return () => {
      upperEl.removeEventListener('contextmenu', onContextMenu);
      void canvas.dispose();
      fabricRef.current = null;
      groupsRef.current = new Map();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally initialized once; see `latest` ref above
  }, []);

  // ---- canvas sizing / zoom ------------------------------------------------------------------

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || previewSize.width <= 0) return;
    canvas.setDimensions({ width: previewSize.width * zoom, height: previewSize.height * zoom });
    canvas.setZoom(zoom);
    canvas.requestRenderAll();
  }, [previewSize, zoom]);

  // ---- zone content sync -----------------------------------------------------------------

  useEffect(() => {
    const canvas = fabricRef.current;
    if (!canvas || previewSize.width <= 0) return;

    const keysInOrder = zones.map((z, i) => zoneKeyOf(z, i));
    const keepSet = new Set(keysInOrder);
    for (const [key, group] of groupsRef.current) {
      if (!keepSet.has(key)) {
        canvas.remove(group);
        groupsRef.current.delete(key);
      }
    }

    zones.forEach((z, i) => syncZone(canvas, zoneKeyOf(z, i)));

    if (!selectedZoneId && canvas.getActiveObject()) {
      canvas.discardActiveObject();
    }

    // Re-establish stacking order to match zIndex (falls back to array order) — fixes bring-to-
    // front/send-to-back, which previously set `zIndex` without anything ever rendering it.
    const sorted = [...zones.entries()]
      .map(([i, z]) => ({ key: zoneKeyOf(z, i), zIndex: z.zIndex ?? 0, i }))
      .sort((a, b) => a.zIndex - b.zIndex || a.i - b.i);
    sorted.forEach(({ key }, idx) => {
      const g = groupsRef.current.get(key);
      if (g) canvas.moveObjectTo(g, idx);
    });

    canvas.requestRenderAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncZone reads fresh values via `latest.current` itself; these deps only need to trigger a re-run, not be captured by it
  }, [zones, assets, selectedZoneId, requireSelectToEdit, bgRemovingZoneKey, previewSize, t, tc]);

  useEffect(() => {
    // Self-contained rather than relying on the caller to clear React selection state first —
    // that would need a state update's effects (the content-sync effect above) to have already
    // flushed by the time this runs, which flushSync doesn't reliably guarantee across an effect
    // boundary. Deselecting the fabric canvas directly, synchronously, sidesteps that entirely.
    exportRef?.(() => {
      const canvas = fabricRef.current;
      if (!canvas) return '';
      const hadActive = !!canvas.getActiveObject();
      if (hadActive) canvas.discardActiveObject();
      const hovered = [...groupsRef.current.values()].filter((g) => g._hovered);
      hovered.forEach((g) => {
        g._hovered = false;
        updateOutlineVisibility(g);
      });
      canvas.requestRenderAll();
      const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 1 });
      hovered.forEach((g) => {
        g._hovered = true;
        updateOutlineVisibility(g);
      });
      const currentSelection = latest.current.selectedZoneId;
      if (hadActive && currentSelection) {
        const g = groupsRef.current.get(currentSelection);
        if (g) canvas.setActiveObject(g);
      }
      canvas.requestRenderAll();
      return dataUrl;
    });
    return () => exportRef?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- exportRef identity is stable per LayoutsSection render; re-running per zones/zoom change isn't needed since it reads fabricRef/groupsRef live
  }, []);

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
      <div
        ref={viewportRef}
        style={{ width: '100%', aspectRatio: '16 / 9', overflow: 'auto', borderRadius: 6, position: 'relative' }}
      >
        <div
          style={{
            position: 'relative',
            width: previewSize.width * zoom,
            height: previewSize.height * zoom,
          }}
        >
          <canvas ref={canvasElRef} style={{ borderRadius: 6 }} />
          <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
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
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}
