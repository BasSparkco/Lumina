/**
 * designer.md §4.2 — the only place outside this canvas/ directory allowed to import `fabric`
 * directly. Fabric owns rendering/selection/transform/zoom/pan only; everything else (tenant
 * permissions, persistence, timeline, Player contract, dynamic variables) lives elsewhere and
 * never touches this class.
 *
 * Phase 2: full element CRUD via FabricObjectFactory. `loadScene` clears and rebuilds every
 * element sorted by zIndex ascending — a deliberate simplification over LayoutCanvasPanel's
 * per-object reconciliation (see docs/adr/designer-architecture.md addendum / Phase 2 plan):
 * simpler, no stale-scale bugs, and Phase 2's acceptance criteria don't require reconciliation
 * performance. Every store mutation replaces `document`, which re-triggers loadScene from
 * CanvasViewport — live drag/resize/rotate still feels smooth because fabric handles those
 * natively and only reports back on `object:modified` (mouse-up), not per frame.
 */
import { ActiveSelection, Canvas, type FabricObject } from 'fabric';
import type { DesignElement, DesignScene } from '@lumina/design-schema';
import { applySceneBackground, createFabricObject, type ResolveAssetUrl } from './FabricObjectFactory';
import {
  bindContextMenuEvents,
  bindLiveTransformEvents,
  bindModifiedEvents,
  bindSelectionEvents,
  type DesignerFabricObject,
  type ElementGeometryPatch,
  type Guides,
} from './FabricEventBridge';

export interface CanvasAdapter {
  loadScene(scene: DesignScene): Promise<void>;
  clear(): void;

  addElement(element: DesignElement): Promise<void>;
  updateElement(id: string, patch: Partial<DesignElement>): void;
  removeElement(id: string): void;

  selectElement(id: string): void;
  selectElements(ids: string[]): void;
  clearSelection(): void;

  bringForward(id: string): void;
  sendBackward(id: string): void;
  bringToFront(id: string): void;
  sendToBack(id: string): void;

  setZoom(value: number): void;
  fitToViewport(): void;

  exportSceneSnapshot(): Promise<Blob>;
}

// designer.md §28 (Export/Preview) — a separate concern from Phase 2's element model, not
// attempted yet.
const EXPORT_NOT_IMPLEMENTED = 'Not implemented — Export/Preview is designer.md §28';

export interface CanvasAdapterCallbacks {
  onSelectionChange: (ids: string[]) => void;
  onElementModified: (id: string, patch: ElementGeometryPatch) => void;
  onGuidesChange: (guides: Guides) => void;
  onContextMenu: (elementId: string | null, clientX: number, clientY: number) => void;
  // Fires whenever the effective zoom changes for any reason, including fitToViewport's own
  // resize-triggered rescale — without this, a caller that only updates its own zoom state from
  // the wheel-zoom handler (Phase 1's original wiring) drifts out of sync with the canvas's
  // actual zoom the first time the window/container resizes.
  onZoomChange: (zoom: number) => void;
  // designer.md Phase 4 — Image elements store an `assetId`, not a URL (designer.md §9); resolving
  // that to a real, signed/CDN URL means querying the tenant's media list, which is exactly the
  // kind of "SaaS authorization"/data concern designer.md §4.1 keeps out of this adapter. The
  // caller (CanvasViewport) owns the assets query and hands down a synchronous lookup instead.
  resolveAssetUrl: ResolveAssetUrl;
}

export class FabricCanvasAdapter implements CanvasAdapter {
  private canvas: Canvas;
  private objects = new Map<string, DesignerFabricObject>();
  private designWidth = 1920;
  private designHeight = 1080;
  private callbacks: CanvasAdapterCallbacks;
  // fabric's own Canvas.clear() internally calls discardActiveObject(), which fires a real
  // 'selection:cleared' event — an implementation detail of tearing the canvas down for a
  // rebuild, not a user-driven deselection. Left unguarded, every loadScene() (i.e. every
  // committed mutation, since CanvasViewport reacts to `document` changes by calling loadScene)
  // would bounce a spurious empty selection back into the store via onSelectionChange, wiping
  // out whatever selection the mutation itself had just set (e.g. duplicateElements selecting
  // its new clone) before the rebuild's own re-selection call ever runs.
  private suppressSelectionEvents = false;
  private unbindSelection: () => void;
  private unbindModified: () => void;
  private unbindLiveTransform: () => void;
  private unbindContextMenu: () => void;

  constructor(canvasEl: HTMLCanvasElement, callbacks: CanvasAdapterCallbacks) {
    this.callbacks = callbacks;
    this.canvas = new Canvas(canvasEl, {
      // Marquee + shift-click multi-select (designer.md §7, Phase 3).
      selection: true,
      preserveObjectStacking: true,
    });
    this.unbindSelection = bindSelectionEvents(this.canvas, (ids) => {
      if (this.suppressSelectionEvents) return;
      callbacks.onSelectionChange(ids);
    });
    this.unbindModified = bindModifiedEvents(this.canvas, callbacks.onElementModified);
    this.unbindLiveTransform = bindLiveTransformEvents(
      this.canvas,
      () => this.objects,
      () => ({ width: this.designWidth, height: this.designHeight }),
      callbacks.onGuidesChange,
    );
    this.unbindContextMenu = bindContextMenuEvents(this.canvas, callbacks.onContextMenu);
  }

  async loadScene(scene: DesignScene): Promise<void> {
    this.clear();
    applySceneBackground(this.canvas, scene.background);
    for (const element of [...scene.elements].sort((a, b) => a.zIndex - b.zIndex)) {
      await this.addElement(element);
    }
    this.canvas.requestRenderAll();
  }

  setDesignSize(width: number, height: number): void {
    this.designWidth = width;
    this.designHeight = height;
  }

  clear(): void {
    this.suppressSelectionEvents = true;
    this.canvas.clear();
    this.suppressSelectionEvents = false;
    this.objects.clear();
  }

  async addElement(element: DesignElement): Promise<void> {
    const obj = (await createFabricObject(element, this.callbacks.resolveAssetUrl)) as DesignerFabricObject;
    this.objects.set(element.id, obj);
    this.canvas.add(obj);
  }

  updateElement(id: string, patch: Partial<DesignElement>): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    const next: Record<string, unknown> = {};
    if (patch.x !== undefined) next.left = patch.x;
    if (patch.y !== undefined) next.top = patch.y;
    if (patch.width !== undefined) next.width = patch.width;
    if (patch.height !== undefined) next.height = patch.height;
    if (patch.rotation !== undefined) next.angle = patch.rotation;
    if (patch.opacity !== undefined) next.opacity = patch.opacity;
    if (patch.visible !== undefined) next.visible = patch.visible;
    obj.set(next);
    obj.setCoords();
    this.canvas.requestRenderAll();
  }

  removeElement(id: string): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.canvas.remove(obj);
    this.objects.delete(id);
  }

  selectElement(id: string): void {
    this.selectElements([id]);
  }

  selectElements(ids: string[]): void {
    const currentIds = this.canvas
      .getActiveObjects()
      .map((o) => (o as DesignerFabricObject).elementId)
      .filter((id): id is string => Boolean(id));
    // Skip if already matching — selection is bidirectional (store <-> fabric) as of Phase 2,
    // and re-applying an identical selection would otherwise re-fire fabric's selection events,
    // feeding straight back into the store in a loop.
    if (currentIds.length === ids.length && currentIds.every((id) => ids.includes(id))) return;

    const targets = ids.map((id) => this.objects.get(id)).filter((o): o is DesignerFabricObject => Boolean(o));
    if (ids.length === 0) {
      this.clearSelection();
      return;
    }
    if (targets.length === 0) {
      // `ids` was non-empty but none of them exist in `this.objects` yet — a `loadScene` rebuild
      // is very likely still in flight (loadScene is async; this method can be called again with
      // the same ids from the store-selection-sync effect before the rebuild's own `.then()` has
      // applied the real selection). Do nothing rather than clearing: clearing here would fire a
      // real `selection:cleared` event, which feeds back into the store via `onSelectionChange`
      // and overwrites the very selection this call was trying to apply. A later call — either
      // this same effect re-running, or loadScene's `.then()` — will apply it correctly once the
      // objects exist.
      return;
    }
    if (targets.length === 1) {
      this.canvas.setActiveObject(targets[0] as FabricObject);
    } else {
      this.canvas.setActiveObject(new ActiveSelection(targets as FabricObject[], { canvas: this.canvas }));
    }
    this.canvas.requestRenderAll();
  }

  clearSelection(): void {
    if (this.canvas.getActiveObjects().length === 0) return;
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }

  bringForward(id: string): void {
    const obj = this.objects.get(id);
    if (obj) this.canvas.bringObjectForward(obj);
  }

  sendBackward(id: string): void {
    const obj = this.objects.get(id);
    if (obj) this.canvas.sendObjectBackwards(obj);
  }

  bringToFront(id: string): void {
    const obj = this.objects.get(id);
    if (obj) this.canvas.bringObjectToFront(obj);
  }

  sendToBack(id: string): void {
    const obj = this.objects.get(id);
    if (obj) this.canvas.sendObjectToBack(obj);
  }

  setZoom(value: number): void {
    this.canvas.setDimensions({ width: this.designWidth * value, height: this.designHeight * value });
    this.canvas.setZoom(value);
    this.canvas.requestRenderAll();
    this.callbacks.onZoomChange(value);
  }

  // designer.md §4.2 declares this with no parameters; the optional viewport size lets
  // CanvasViewport pass its ResizeObserver reading directly rather than the adapter having to
  // reach back into the DOM for its own container size.
  fitToViewport(viewportWidth?: number, viewportHeight?: number): void {
    const vw = viewportWidth ?? this.canvas.getElement().parentElement?.clientWidth ?? this.designWidth;
    const vh = viewportHeight ?? this.canvas.getElement().parentElement?.clientHeight ?? this.designHeight;
    if (vw <= 0 || vh <= 0) return;
    // "contain" fit, preserving aspect ratio, per designer.md §5.2 — never stretch.
    const scale = Math.min(vw / this.designWidth, vh / this.designHeight);
    this.setZoom(scale);
  }

  async exportSceneSnapshot(): Promise<Blob> {
    throw new Error(EXPORT_NOT_IMPLEMENTED);
  }

  dispose(): void {
    this.unbindSelection();
    this.unbindModified();
    this.unbindLiveTransform();
    this.unbindContextMenu();
    void this.canvas.dispose();
  }
}
