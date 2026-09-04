/**
 * Wires Fabric canvas events to designer2's Zustand store. Kept separate from
 * FabricCanvasAdapter so the adapter's imperative CanvasAdapter interface (designer.md §4.2)
 * stays testable independent of store wiring.
 */
import { ActiveSelection, type Canvas, type FabricObject, type TPointerEvent } from 'fabric';
import { computeAlignTargets, snapDragAxis, type Box } from '@/lib/canvasSnap';

export type DesignerFabricObject = FabricObject & { elementId?: string };

export interface ElementGeometryPatch {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface Guides {
  v: number[];
  h: number[];
}

export function bindSelectionEvents(canvas: Canvas, onSelectionChange: (ids: string[]) => void): () => void {
  const idsFromSelection = (objects: FabricObject[] | undefined): string[] =>
    (objects ?? [])
      .map((o) => (o as DesignerFabricObject).elementId)
      .filter((id): id is string => Boolean(id));

  const onCreated = (e: { selected: FabricObject[] }) => onSelectionChange(idsFromSelection(e.selected));
  const onUpdated = (e: { selected: FabricObject[] }) => onSelectionChange(idsFromSelection(e.selected));
  const onCleared = () => onSelectionChange([]);

  canvas.on('selection:created', onCreated);
  canvas.on('selection:updated', onUpdated);
  canvas.on('selection:cleared', onCleared);

  return () => {
    canvas.off('selection:created', onCreated);
    canvas.off('selection:updated', onUpdated);
    canvas.off('selection:cleared', onCleared);
  };
}

// Fires once per drag/resize/rotate gesture (on mouse-up), not per frame — matches
// LayoutCanvasPanel.tsx's own object:modified convention. Every Phase 2 object is built with
// originX/originY: 'left'/'top' (see FabricObjectFactory), so left/top map directly to design
// x/y with no center-point conversion needed.
export function bindModifiedEvents(
  canvas: Canvas,
  onElementModified: (id: string, patch: ElementGeometryPatch) => void,
): () => void {
  const onModified = (e: { target: FabricObject }) => {
    const obj = e.target as DesignerFabricObject;
    if (!obj.elementId) return;
    onElementModified(obj.elementId, {
      x: obj.left ?? 0,
      y: obj.top ?? 0,
      width: obj.getScaledWidth(),
      height: obj.getScaledHeight(),
      rotation: obj.angle ?? 0,
    });
  };

  canvas.on('object:modified', onModified);
  return () => canvas.off('object:modified', onModified);
}

// Phase 3 — Figma-style snap guides while dragging a single element (reuses
// apps/dashboard/src/lib/canvasSnap.ts, the same math LayoutCanvasPanel.tsx uses, in the same
// unit space here — design px, no percent conversion needed). Skipped for a multi-select
// ActiveSelection drag — snapping a moving *group* against its own members would need different
// math and isn't worth the complexity for this phase (see designer2 Phase 3 plan's scope trims).
export function bindLiveTransformEvents(
  canvas: Canvas,
  getObjects: () => Map<string, DesignerFabricObject>,
  getDesignSize: () => { width: number; height: number },
  onGuidesChange: (guides: Guides) => void,
): () => void {
  const onMoving = (e: { target: FabricObject }) => {
    const target = e.target;
    if (target instanceof ActiveSelection) return;
    const obj = target as DesignerFabricObject;
    if (!obj.elementId) return;

    const others: Box[] = [];
    for (const [id, o] of getObjects()) {
      if (id === obj.elementId) continue;
      others.push({ left: o.left ?? 0, top: o.top ?? 0, width: o.getScaledWidth(), height: o.getScaledHeight() });
    }
    const { width: canvasW, height: canvasH } = getDesignSize();
    const targets = computeAlignTargets(canvasW, canvasH, others);
    const w = obj.getScaledWidth();
    const h = obj.getScaledHeight();
    const snapX = snapDragAxis(obj.left ?? 0, w, targets.xs);
    const snapY = snapDragAxis(obj.top ?? 0, h, targets.ys);
    obj.set({ left: snapX.pos, top: snapY.pos });
    obj.setCoords();
    onGuidesChange({ v: snapX.guide !== null ? [snapX.guide] : [], h: snapY.guide !== null ? [snapY.guide] : [] });
  };
  const onCleared = () => onGuidesChange({ v: [], h: [] });

  canvas.on('object:moving', onMoving);
  canvas.on('object:modified', onCleared);
  canvas.on('selection:cleared', onCleared);

  return () => {
    canvas.off('object:moving', onMoving);
    canvas.off('object:modified', onCleared);
    canvas.off('selection:cleared', onCleared);
  };
}

// Right-click on canvas — same native-listener pattern LayoutCanvasPanel.tsx uses
// (canvas.upperCanvasEl 'contextmenu' + canvas.findTarget()) rather than Fabric's own object
// events, since we need to detect a right-click on *empty* canvas too (elementId: null).
export function bindContextMenuEvents(
  canvas: Canvas,
  onContextMenu: (elementId: string | null, clientX: number, clientY: number) => void,
): () => void {
  const upperEl = canvas.upperCanvasEl;
  const handler = (ev: MouseEvent) => {
    ev.preventDefault();
    const target = canvas.findTarget(ev as TPointerEvent).target as DesignerFabricObject | undefined;
    onContextMenu(target?.elementId ?? null, ev.clientX, ev.clientY);
  };
  upperEl.addEventListener('contextmenu', handler);
  return () => upperEl.removeEventListener('contextmenu', handler);
}

// Double-click on empty canvas — Reset View (pan/zoom feature). Same findTarget-on-upperCanvasEl
// pattern as bindContextMenuEvents, since detecting "empty canvas" needs the same target lookup;
// double-clicking an actual element is left alone (no in-canvas double-click editing exists yet
// for designer2, so this only ever needs to distinguish empty-vs-not).
export function bindDoubleClickEvents(canvas: Canvas, onEmptyDoubleClick: () => void): () => void {
  const upperEl = canvas.upperCanvasEl;
  const handler = (ev: MouseEvent) => {
    const target = canvas.findTarget(ev as TPointerEvent).target as DesignerFabricObject | undefined;
    if (!target) onEmptyDoubleClick();
  };
  upperEl.addEventListener('dblclick', handler);
  return () => upperEl.removeEventListener('dblclick', handler);
}
