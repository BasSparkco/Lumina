/**
 * Wires Fabric canvas events to designer2's Zustand store. Kept separate from
 * FabricCanvasAdapter so the adapter's imperative CanvasAdapter interface (designer.md §4.2)
 * stays testable independent of store wiring.
 */
import { ActiveSelection, Textbox, type Canvas, type FabricObject, type TPointerEvent } from 'fabric';
import { computeAlignTargets, snapDragAxis, type Box } from '@/lib/canvasSnap';
import { readElementGeometry, type ElementGeometry } from './geometryContract';

export type DesignerFabricObject = FabricObject & { elementId?: string };

export type ElementGeometryPatch = ElementGeometry;

export interface Guides {
  v: number[];
  h: number[];
}

export function bindSelectionEvents(canvas: Canvas, onSelectionChange: (ids: string[]) => void): () => void {
  const idsFromSelection = (objects: FabricObject[]): string[] =>
    objects
      .map((o) => (o as DesignerFabricObject).elementId)
      .filter((id): id is string => Boolean(id));

  // `selection:updated`'s own `e.selected` is only the newly-added delta (confirmed empirically:
  // shift-clicking to add one object to an existing two-object selection fires it with
  // `e.selected` containing just that one new object), not the full current selection — using it
  // directly would report the selection as shrinking to whatever was last clicked. Read the
  // authoritative full selection from the canvas itself instead, for both events.
  const onChanged = () => onSelectionChange(idsFromSelection(canvas.getActiveObjects()));
  const onCleared = () => onSelectionChange([]);

  canvas.on('selection:created', onChanged);
  canvas.on('selection:updated', onChanged);
  canvas.on('selection:cleared', onCleared);

  return () => {
    canvas.off('selection:created', onChanged);
    canvas.off('selection:updated', onChanged);
    canvas.off('selection:cleared', onCleared);
  };
}

export interface ElementGeometryUpdate {
  id: string;
  patch: ElementGeometryPatch;
}

// A Textbox's corner controls (`scalingEqually`) are the only Fabric-default action that leaves
// scaleX/scaleY non-1 on a Textbox — its side handles (`changeWidth`, ml/mr) resize `width`
// directly with reflow, never scale, and top/bottom handles (`scalingYOrSkewingX`, mt/mb) touch
// only scaleY. DesignElement never persists scaleX/scaleY (only x/y/width/height/rotation/
// fontSize), so leftover scale surviving only on the live Fabric object would silently vanish —
// and the font would visually "jump" back to its old size — the next time this element is
// recreated from JSON (undo, reload, scene switch). Fold it into fontSize/width here, at the
// Fabric boundary, so what's persisted is what's rendered.
//
// Only safe for a *standalone* object's own `object:modified`. A Textbox scaled as part of a
// multi-select ActiveSelection is a separate, deliberately unhandled case: Fabric does not push
// an ActiveSelection's composed scale down into a member's own scaleX/scaleY until the selection
// is later dissolved — a member's scaleX/scaleY still reads 1 here even mid-gesture (verified
// empirically), so there is nothing to normalize yet, and writing fontSize/width against a
// guessed effective scale now would double up once Fabric's own pushdown happens afterward.
function normalizeTextScale(obj: FabricObject): void {
  if (!(obj instanceof Textbox)) return;
  const scaleX = obj.scaleX ?? 1;
  const scaleY = obj.scaleY ?? 1;
  if (scaleX === 1 && scaleY === 1) return;
  obj.set({
    fontSize: (obj.fontSize ?? 1) * scaleY,
    width: (obj.width ?? 1) * scaleX,
    scaleX: 1,
    scaleY: 1,
  });
  obj.setCoords();
}

// Fires once per drag/resize/rotate gesture (on mouse-up), not per frame — matches
// LayoutCanvasPanel.tsx's own object:modified convention. Every Phase 2 object is built with
// originX/originY: 'left'/'top' (see FabricObjectFactory), so left/top equal design x/y only at
// rotation 0 — readElementGeometry converts through the object's center for any other angle (see
// geometryContract.ts). A multi-select `ActiveSelection` target has no elementId of its own
// (it's a synthetic container, not a design element) — batch its members instead, one call
// covering the whole gesture so undo restores it in a single step.
export function bindModifiedEvents(
  canvas: Canvas,
  onElementModified: (id: string, patch: ElementGeometryPatch) => void,
  onElementsModified: (updates: ElementGeometryUpdate[]) => void,
): () => void {
  const onModified = (e: { target: FabricObject }) => {
    const target = e.target as DesignerFabricObject;
    if (target instanceof ActiveSelection) {
      const updates = target.getObjects()
        .filter((member): member is DesignerFabricObject => Boolean((member as DesignerFabricObject).elementId))
        .map((member) => ({ id: member.elementId!, patch: readElementGeometry(member) }));
      if (updates.length > 0) onElementsModified(updates);
      return;
    }
    if (!target.elementId) return;
    normalizeTextScale(target);
    onElementModified(target.elementId, readElementGeometry(target));
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

// Use Fabric's front-most target so covered text cannot steal another layer's double-click.
export function bindDoubleClickEvents(canvas: Canvas, onEmptyDoubleClick: () => void, onElementDoubleClick?: (id: string) => void): () => void {
  const upperEl = canvas.upperCanvasEl;
  const handler = (ev: MouseEvent) => {
    const target = canvas.findTarget(ev as TPointerEvent).target as DesignerFabricObject | undefined;
    if (!target) onEmptyDoubleClick();
    else if (target.elementId) onElementDoubleClick?.(target.elementId);
  };
  upperEl.addEventListener('dblclick', handler);
  return () => upperEl.removeEventListener('dblclick', handler);
}
