/** Persistent Fabric projection of the Lumina scene. Ordinary edits reconcile by element ID. */
import { ActiveSelection, Group, runningAnimations, Textbox, type FabricObject } from 'fabric';
import { applyElementPosition, fabricPositionForElement, readElementGeometry } from './geometryContract';
import {
  ANIMATION_MOTION,
  resolveEasing,
  type AnimationMotion,
  type DesignElement,
  type DesignScene,
  type ElementAnimation,
  type ImageElement,
  type ShapeElement,
  type TextElement,
  type VideoElement,
} from '@lumina/design-schema';
import { LayeredCanvas } from './LayeredCanvas';
import { fontStack } from '@lumina/types';
import { createFabricObject, applyImageStylePatch as patchImageStyle, type ResolveAssetUrl } from './FabricObjectFactory';
import { waitForFont } from '../lib/fontReady';
import {
  bindContextMenuEvents,
  bindDoubleClickEvents,
  bindLiveTransformEvents,
  bindModifiedEvents,
  bindSelectionEvents,
  type DesignerFabricObject,
  type ElementGeometryPatch,
  type ElementGeometryUpdate,
  type Guides,
} from './FabricEventBridge';

// Not exported from @lumina/design-schema (AnimationStepSchema/EmphasisAnimationStepSchema are
// module-local) — derived the same way packages/types/theme.ts derives its own step types.
type AnimationStep = NonNullable<ElementAnimation['enter']>;
type EmphasisStep = NonNullable<ElementAnimation['emphasis']>;

export interface CanvasAdapter {
  loadScene(scene: DesignScene): Promise<void>;
  // `rawScene` (M5) — the unresolved (pre-variable-substitution) counterpart of `scene`, used only
  // to keep an authored-text cache for the inline canvas editor (see `editText`/`rawTextElements`)
  // so it never pre-fills or commits a resolved binding value over the authored token/fallback.
  // Defaults to `scene` itself, so every existing caller/test with no bindings is unaffected.
  syncScene(scene: DesignScene, rawScene?: DesignScene): Promise<boolean>;
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

  // designer2 pan feature — suspends Fabric's own object interaction (selection + drag) while
  // Space is held or a middle-mouse pan is in flight, and reflects that in the cursor. The actual
  // translate/pan math lives in CanvasViewport (a DOM-level transform outside Fabric's own
  // viewportTransform); this only needs to stop Fabric from treating the same mousedown as an
  // object interaction.
  setPanModeActive(active: boolean): void;
  setCursor(cursor: string): void;

  exportSceneSnapshot(): Promise<Blob>;

  // designer.md Phase 7 — see the amendment under Phase 7 for why these are Fabric-native tweens
  // rather than CSS (no DOM node per canvas element to attach CSS `animation-*` to).
  playEnter(id: string, step: AnimationStep, element: DesignElement): void;
  playExit(id: string, step: AnimationStep, element: DesignElement): void;
  playEmphasisOnce(id: string, step: EmphasisStep, element: DesignElement, onDone?: () => void): void;
  playEmphasisLoop(id: string, step: EmphasisStep, element: DesignElement): void;
  playSceneEnterAnimations(scene: DesignScene): void;
}

// designer.md §28 (Export/Preview) full export (static PNG button, worker-rendered previews) is
// still out of scope — exportSceneSnapshot below only serves Phase 6's scene-thumbnail need.

export interface CanvasAdapterCallbacks {
  onSelectionChange: (ids: string[]) => void;
  onElementModified: (id: string, patch: ElementGeometryPatch) => void;
  // A multi-select ActiveSelection drag/resize/rotate commits all its members through this one
  // call instead of N calls to onElementModified, so the caller can wrap them in a single undo
  // step (see bindModifiedEvents in FabricEventBridge.ts).
  onElementsModified: (updates: ElementGeometryUpdate[]) => void;
  onTextChanged: (id: string, text: string) => void;
  onGuidesChange: (guides: Guides) => void;
  onContextMenu: (elementId: string | null, clientX: number, clientY: number) => void;
  // Fires whenever the effective zoom changes for any reason, including fitToViewport's own
  // resize-triggered rescale — without this, a caller that only updates its own zoom state from
  // the wheel-zoom handler (Phase 1's original wiring) drifts out of sync with the canvas's
  // actual zoom the first time the window/container resizes.
  onZoomChange: (zoom: number) => void;
  getViewportRect?: () => DOMRect | undefined;
  // designer2 pan feature — double-click on empty canvas resets the view (see
  // bindDoubleClickEvents). Never fires for a double-click on an actual element.
  onEmptyDoubleClick: () => void;
  // designer.md Phase 4 — Image elements store an `assetId`, not a URL (designer.md §9); resolving
  // that to a real, signed/CDN URL means querying the tenant's media list, which is exactly the
  // kind of "SaaS authorization"/data concern designer.md §4.1 keeps out of this adapter. The
  // caller (CanvasViewport) owns the assets query and hands down a synchronous lookup instead.
  resolveAssetUrl: ResolveAssetUrl;
}

// designer.md Phase 9 — releases decode/network resources immediately rather than waiting on GC
// of a detached-but-still-referenced element; removing a <video> from the DOM alone doesn't
// reliably stop an in-flight decode/buffer in every browser.
function disposeVideoOverlay(video: HTMLVideoElement): void {
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.remove();
}

export class FabricCanvasAdapter implements CanvasAdapter {
  private canvas: LayeredCanvas;
  private generation = 0;
  private pendingSync: AbortController | null = null;
  private disposed = false;
  private fitMode = true;
  private applied = new Map<string, { element: DesignElement; resource: string }>();
  private objects = new Map<string, DesignerFabricObject>();
  // Captured once per object at construction time (addElement), before any animation ever touches
  // it — the authoritative "resting" scale baseline for playEnter/playExit/playEmphasisOnce,
  // since scaleX/scaleY isn't itself a DesignElement field (shapes/text are ~always 1, images are
  // whatever createFabricObject fit them to) and re-deriving it from element.width/height would
  // mean duplicating FabricObjectFactory's image-fit math here.
  private restingScale = new Map<string, { x: number; y: number }>();
  private designWidth = 1920;
  private designHeight = 1080;
  private callbacks: CanvasAdapterCallbacks;
  // Native text preserves browser Arabic/bidi shaping. All visible elements share this stack.
  private sceneLayerContainer: HTMLDivElement;
  private textOverlays = new Map<string, HTMLDivElement>();
  private videoOverlays = new Map<string, HTMLVideoElement>();
  private paintedLayers: HTMLCanvasElement[] = [];
  private textElements = new Map<string, Extract<DesignElement, { type: 'text' }>>();
  // M5 — the unresolved (authored) counterpart of `textElements`, sourced from `syncScene`'s
  // optional `rawScene` param. `editText` reads from here (not `textElements`, which holds
  // variable-*resolved* values) so double-clicking a bound text element never pre-fills or commits
  // today's resolved value over the authored token/fallback. Falls back to the resolved element
  // itself for plain (unbound) text, where the two are identical anyway.
  private rawTextElements = new Map<string, Extract<DesignElement, { type: 'text' }>>();
  private textEditor: HTMLTextAreaElement | null = null;
  private finishTextEditing: ((save: boolean) => void) | null = null;
  private unbindAfterRender: () => void;
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
  private unbindDoubleClick: () => void;

  constructor(
    canvasEl: HTMLCanvasElement,
    sceneLayerContainer: HTMLDivElement,
    callbacks: CanvasAdapterCallbacks,
  ) {
    this.callbacks = callbacks;
    this.sceneLayerContainer = sceneLayerContainer;
    this.canvas = new LayeredCanvas(canvasEl, {
      // Marquee + shift-click multi-select (designer.md §7, Phase 3).
      selection: true,
      preserveObjectStacking: true,
    });
    this.canvas.renderLayers = (ctx, objects) => this.renderLayers(ctx, objects);
    this.unbindSelection = bindSelectionEvents(this.canvas, (ids) => {
      if (this.suppressSelectionEvents) return;
      callbacks.onSelectionChange(ids);
    });
    this.unbindModified = bindModifiedEvents(this.canvas, callbacks.onElementModified, callbacks.onElementsModified);
    this.unbindLiveTransform = bindLiveTransformEvents(
      this.canvas,
      () => this.objects,
      () => ({ width: this.designWidth, height: this.designHeight }),
      callbacks.onGuidesChange,
    );
    this.unbindContextMenu = bindContextMenuEvents(this.canvas, callbacks.onContextMenu);
    this.unbindDoubleClick = bindDoubleClickEvents(this.canvas, callbacks.onEmptyDoubleClick, (id) => this.editText(id));
    const onAfterRender = () => {
      this.syncTextOverlays();
      this.syncVideoOverlays();
    };
    this.canvas.on('after:render', onAfterRender);
    this.unbindAfterRender = () => this.canvas.off('after:render', onAfterRender);
  }

  async loadScene(scene: DesignScene): Promise<void> {
    this.clear();
    await this.syncScene(scene);
  }

  // Prepare async resources before mutating the visible scene. Only the latest request may
  // install its results; discarded image/QR decodes must release their Fabric caches too.
  async syncScene(scene: DesignScene, rawScene: DesignScene = scene): Promise<boolean> {
    if (this.disposed) return false;
    const generation = ++this.generation;
    this.pendingSync?.abort();
    const controller = new AbortController();
    this.pendingSync = controller;
    const ordered = [...scene.elements].sort((a, b) => a.zIndex - b.zIndex);
    const rawById = new Map(rawScene.elements.map((el) => [el.id, el]));
    const resourceFor = (el: DesignElement) =>
      (el.type === 'image' || el.type === 'video') && el.assetId
        ? this.callbacks.resolveAssetUrl(el.assetId) ?? '' : '';
    const contentKey = (el: DesignElement) => {
      const { x, y, width, height, rotation, opacity, visible, zIndex, name,
        selectable, movable, resizable, deletable, editable, animation, templatePolicy,
        ...content } = el;
      // These fields are handled in-place or have no visual representation.
      void [x, y, width, height, rotation, opacity, visible, zIndex, name, selectable,
        movable, resizable, deletable, editable, animation, templatePolicy];
      // designer_modernization_plan.md M5 — image narrowed to `{type, assetId}`, mirroring
      // designs.service.ts's own CONTENT_PROPS_BY_TYPE.image: fit/crop/adjustments/flip/
      // borderRadius are *style*, not content, and now patch in place via applyImageStylePatch
      // below instead of forcing a full Fabric object recreate on every crop/adjust edit (the M5
      // root cause). Narrowing only changes this editor's own reconciliation strategy — nothing
      // about what's read from or written to saved JSON — so no migration is needed for existing
      // saved designs (same reasoning M3's coordinate-contract change already used).
      return JSON.stringify(el.type === 'video' ? { type: el.type, assetId: el.assetId }
        : el.type === 'text' ? { type: el.type }
        : el.type === 'shape' ? { type: el.type, shape: el.shape }
        : el.type === 'image' ? { type: el.type, assetId: el.assetId } : content);
    };
    const results = await Promise.allSettled(ordered.map(async (element) => {
      const resource = resourceFor(element);
      const previous = this.applied.get(element.id);
      const replace = !previous || previous.resource !== resource || contentKey(previous.element) !== contentKey(element);
      const object = replace ? await createFabricObject(element, () => resource, controller.signal) as DesignerFabricObject : null;
      return { element, resource, object };
    }));
    const prepared = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure || generation !== this.generation || this.disposed) {
      for (const entry of prepared) entry.object?.dispose();
      if (failure && generation === this.generation && !this.disposed) throw failure.reason;
      return false;
    }
    this.suppressSelectionEvents = true;
    try {
      const ids = new Set(ordered.map((el) => el.id));
      for (const id of this.objects.keys()) if (!ids.has(id)) this.removeElement(id);
      for (const [index, { element, resource, object }] of prepared.entries()) {
        if (object) {
          this.removeElement(element.id);
          this.installElement(element, object, rawById.get(element.id));
        } else {
          const previous = this.applied.get(element.id)!.element;
          const obj = this.objects.get(element.id)!;
          const geometryChanged = element.x !== previous.x || element.y !== previous.y ||
            element.width !== previous.width || element.height !== previous.height ||
            element.rotation !== previous.rotation;
          const patch: Record<string, unknown> = {};
          if (element.width !== previous.width) patch.scaleX = element.width / (obj.width || 1);
          if (element.height !== previous.height) patch.scaleY = element.height / (obj.height || 1);
          if (element.rotation !== previous.rotation) patch.angle = element.rotation;
          if (element.opacity !== previous.opacity) patch.opacity = element.opacity;
          patch.visible = element.visible;
          patch.selectable = element.selectable;
          patch.evented = element.selectable && element.visible;
          patch.lockMovementX = patch.lockMovementY = !element.movable;
          patch.lockScalingX = patch.lockScalingY = patch.lockRotation = !element.resizable;
          obj.set(patch);
          // Reposition after scale/angle above — see geometryContract.ts; patching left/top
          // independently from x/y is only correct at rotation 0.
          if (geometryChanged) applyElementPosition(obj, element);
          obj.setCoords();
          this.restingScale.set(element.id, { x: obj.scaleX, y: obj.scaleY });
          if (element.type === 'text' && obj instanceof Textbox) {
            this.textElements.set(element.id, element);
            const raw = rawById.get(element.id);
            this.rawTextElements.set(element.id, raw?.type === 'text' ? raw : element);
            // Full element passed as the "patch" — every text-style field is re-applied on every
            // commit rather than diffed against `previous`. That trades a few redundant (but
            // idempotent) Fabric `.set()` calls per commit for one shared code path with the live
            // preview below (applyTextStylePatch) — commits aren't a per-frame hot path, so the
            // cost is negligible.
            this.applyTextStylePatch(element.id, obj, element);
          }
          if (element.type === 'shape' && previous.type === 'shape') {
            this.applyShapeStylePatch(obj, element);
          }
          if (element.type === 'image' && obj instanceof Group) {
            this.applyImageStylePatch(element.id, obj, element);
          }
          obj.setCoords();
          if (element.type === 'video' && previous.type === 'video' && this.videoOverlays.has(element.id)) {
            const videoPatch: Partial<VideoElement> = {
              muted: element.muted, volume: element.volume, loop: element.loop,
              autoplay: element.autoplay, fit: element.fit, posterAssetId: element.posterAssetId,
            };
            if (element.startOffsetMs !== previous.startOffsetMs) videoPatch.startOffsetMs = element.startOffsetMs;
            this.applyVideoLivePatch(element.id, videoPatch);
          }
        }
        this.applied.set(element.id, { element, resource });
        this.canvas.moveObjectTo(this.objects.get(element.id)!, index);
      }
    } finally {
      this.suppressSelectionEvents = false;
    }
    this.canvas.requestRenderAll();
    return true;
  }

  getInsertionBounds(): { x: number; y: number; width: number; height: number } {
    const fallback = { x: 0, y: 0, width: this.designWidth, height: this.designHeight };
    const viewport = this.callbacks.getViewportRect?.();
    const canvas = this.canvas.getElement().getBoundingClientRect();
    if (!viewport || canvas.width <= 0 || canvas.height <= 0) return fallback;
    const zoom = this.canvas.getZoom();
    const x = Math.max(0, (viewport.left - canvas.left) / zoom);
    const y = Math.max(0, (viewport.top - canvas.top) / zoom);
    const right = Math.min(this.designWidth, (viewport.right - canvas.left) / zoom);
    const bottom = Math.min(this.designHeight, (viewport.bottom - canvas.top) / zoom);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : fallback;
  }

  setDesignSize(width: number, height: number): void {
    this.designWidth = width;
    this.designHeight = height;
  }

  clear(): void {
    ++this.generation;
    this.pendingSync?.abort();
    this.pendingSync = null;
    this.applied.clear();
    this.finishTextEditing?.(false);
    this.textElements.clear();
    this.rawTextElements.clear();
    for (const layer of this.paintedLayers) layer.remove();
    this.paintedLayers = [];
    // Immediate cleanup of any in-flight enter/emphasis tweens on rebuild — belt-and-suspenders
    // alongside playEmphasisLoop's own natural self-stop (it re-checks `this.objects.get(id)`
    // against its captured object reference before every iteration).
    runningAnimations.cancelByCanvas(this.canvas);
    this.suppressSelectionEvents = true;
    for (const object of this.objects.values()) object.dispose();
    this.canvas.clear();
    this.suppressSelectionEvents = false;
    this.objects.clear();
    this.restingScale.clear();
    for (const div of this.textOverlays.values()) div.remove();
    this.textOverlays.clear();
    for (const video of this.videoOverlays.values()) disposeVideoOverlay(video);
    this.videoOverlays.clear();
  }

  async addElement(element: DesignElement): Promise<void> {
    const generation = this.generation;
    const obj = (await createFabricObject(element, this.callbacks.resolveAssetUrl)) as DesignerFabricObject;
    if (this.disposed || generation !== this.generation) { obj.dispose(); return; }
    this.installElement(element, obj);
  }

  private installElement(element: DesignElement, obj: DesignerFabricObject, rawElement?: DesignElement): void {
    this.objects.set(element.id, obj);
    this.restingScale.set(element.id, { x: obj.scaleX ?? 1, y: obj.scaleY ?? 1 });
    this.canvas.add(obj);
    if (element.type === 'text') {
      this.textElements.set(element.id, element);
      this.rawTextElements.set(element.id, rawElement?.type === 'text' ? rawElement : element);
      this.textOverlays.set(element.id, this.createTextOverlay(element));
    }
    if (element.type === 'video' && element.assetId) this.videoOverlays.set(element.id, this.createVideoOverlay(element));
    const resource = (element.type === 'video' || element.type === 'image') && element.assetId
      ? this.callbacks.resolveAssetUrl(element.assetId) ?? '' : '';
    this.applied.set(element.id, { element, resource });
  }

  updateElement(id: string, patch: Partial<DesignElement>): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    // Geometry fields (see geometryContract.ts) must be repositioned together, not patched
    // independently: Fabric's left/top only equal x/y at rotation 0, so a patch that only sets
    // e.g. rotation still needs x/y — read here before scale/angle change below — to compute the
    // correct left/top for the new angle.
    const geometryPatched = patch.x !== undefined || patch.y !== undefined ||
      patch.width !== undefined || patch.height !== undefined || patch.rotation !== undefined;
    const current = geometryPatched ? readElementGeometry(obj) : null;
    const next: Record<string, unknown> = {};
    if (patch.width !== undefined) next.scaleX = patch.width / (obj.width || 1);
    if (patch.height !== undefined) next.scaleY = patch.height / (obj.height || 1);
    if (patch.rotation !== undefined) next.angle = patch.rotation;
    if (patch.opacity !== undefined) next.opacity = patch.opacity;
    if (patch.visible !== undefined) next.visible = patch.visible;
    if (Object.keys(next).length > 0) obj.set(next);
    if (current) {
      applyElementPosition(obj, {
        x: patch.x ?? current.x,
        y: patch.y ?? current.y,
        width: patch.width ?? current.width,
        height: patch.height ?? current.height,
      });
    }

    // designer_modernization_plan.md M5 — the rest of the property surface (font/color/stroke/
    // radius/fit/crop/adjustments/flip/video playback) dispatches to one shared style-patch method
    // per element type, also used by syncScene's commit-settle path above, so live preview and
    // committed appearance can never visually disagree. Dispatched by the *cached* (last-applied)
    // element's type, not `patch.type` — a patch never carries `type`.
    const cachedType = this.applied.get(id)?.element.type;
    if (cachedType === 'text' && obj instanceof Textbox) {
      this.applyTextStylePatch(id, obj, patch as Partial<TextElement>);
    } else if (cachedType === 'shape') {
      this.applyShapeStylePatch(obj, patch as Partial<ShapeElement>);
    } else if (cachedType === 'image' && obj instanceof Group) {
      this.applyImageStylePatch(id, obj, patch as Partial<ImageElement>);
    } else if (cachedType === 'video') {
      this.applyVideoLivePatch(id, patch as Partial<VideoElement>);
    }

    obj.setCoords();
    this.canvas.requestRenderAll();
  }

  // --- M5 shared style-patch appliers — see updateElement/syncScene above for the two call sites.

  private applyShapeStylePatch(obj: FabricObject, patch: Partial<ShapeElement>): void {
    const next: Record<string, unknown> = {};
    // `?? 0` matches FabricObjectFactory.createShapeObject's own creation-time default — the
    // previous inline syncScene patch used `?? 1` here, a stale mismatch from before that object's
    // strokeWidth default was fixed; consolidating onto one shared method corrects it.
    if (patch.fill !== undefined) next.fill = patch.fill ?? 'transparent';
    if (patch.stroke !== undefined) next.stroke = patch.stroke ?? null;
    if (patch.strokeWidth !== undefined) next.strokeWidth = patch.strokeWidth ?? 0;
    if (patch.radius !== undefined) { next.rx = patch.radius ?? 12; next.ry = patch.radius ?? 12; }
    if (Object.keys(next).length > 0) obj.set(next);
  }

  private applyTextStylePatch(id: string, obj: Textbox, patch: Partial<TextElement>): void {
    const next: Record<string, unknown> = {};
    if (patch.text !== undefined) next.text = patch.text;
    if (patch.fontSize !== undefined) next.fontSize = patch.fontSize;
    if (patch.fontFamily !== undefined) next.fontFamily = fontStack(patch.fontFamily);
    if (patch.fontWeight !== undefined) next.fontWeight = patch.fontWeight;
    if (patch.fontStyle !== undefined) next.fontStyle = patch.fontStyle;
    if (patch.textAlign !== undefined) next.textAlign = patch.textAlign;
    if (patch.lineHeight !== undefined) next.lineHeight = patch.lineHeight;
    if (patch.charSpacing !== undefined) next.charSpacing = patch.charSpacing;
    if (Object.keys(next).length > 0) obj.set(next);

    // The DOM overlay is the only place `fill`/`direction` are ever visible (the Fabric object
    // itself stays permanently transparent — see FabricObjectFactory's Phase 8 comment), so it
    // always needs the *merged* current element, not just the fields this particular patch touched.
    const overlay = this.textOverlays.get(id);
    const cached = this.applied.get(id)?.element;
    if (overlay && cached?.type === 'text') {
      this.styleTextOverlay(overlay, { ...cached, ...patch } as TextElement);
    }

    // M5 — re-measure once the real webfont is actually usable, so a live font-family preview
    // doesn't leave the Fabric hit-box measured against a fallback font indefinitely. Never
    // touches the store/history — a silent geometry correction, not a user-visible edit.
    if (patch.fontFamily !== undefined) {
      const family = fontStack(patch.fontFamily);
      void waitForFont(family).then(() => {
        if (this.objects.get(id) !== obj) return;
        obj.initDimensions();
        this.canvas.requestRenderAll();
      });
    }
  }

  private applyImageStylePatch(id: string, group: Group, patch: Partial<ImageElement>): void {
    const cached = this.applied.get(id)?.element;
    if (cached?.type !== 'image') return;
    patchImageStyle(group, { ...cached, ...patch });
  }

  private applyVideoLivePatch(id: string, patch: Partial<VideoElement>): void {
    const video = this.videoOverlays.get(id);
    if (!video) return;
    if (patch.volume !== undefined) video.volume = Math.min(1, Math.max(0, patch.volume));
    if (patch.muted !== undefined) video.muted = patch.muted;
    if (patch.loop !== undefined) video.loop = patch.loop;
    if (patch.autoplay !== undefined) {
      const wasAutoplay = video.autoplay;
      video.autoplay = patch.autoplay;
      if (!patch.autoplay && wasAutoplay) video.pause();
    }
    if (patch.fit !== undefined) video.style.objectFit = patch.fit;
    // `Object.hasOwn` (not `!== undefined`) — `posterAssetId` is optional, so "no poster" is a
    // meaningful `undefined` *value* on a present key, distinct from the key being absent because
    // this particular patch never touched it (e.g. a live volume-only preview tick).
    if (Object.hasOwn(patch, 'posterAssetId')) {
      const poster = patch.posterAssetId ? this.callbacks.resolveAssetUrl(patch.posterAssetId) : undefined;
      if (poster) video.poster = poster;
      else video.removeAttribute('poster');
    }
    if (patch.startOffsetMs !== undefined && video.readyState >= 1) {
      video.currentTime = patch.startOffsetMs / 1000;
    }
  }

  removeElement(id: string): void {
    if (this.textEditor?.dataset.elementId === id) this.finishTextEditing?.(false);
    const obj = this.objects.get(id);
    if (!obj) return;
    this.canvas.remove(obj);
    this.objects.delete(id);
    this.applied.delete(id);
    this.restingScale.delete(id);
    obj.dispose();
    this.textOverlays.get(id)?.remove();
    this.textOverlays.delete(id);
    this.textElements.delete(id);
    this.rawTextElements.delete(id);
    const video = this.videoOverlays.get(id);
    if (video) disposeVideoOverlay(video);
    this.videoOverlays.delete(id);
  }

  // Static styles and browser-native text layout; Fabric remains responsible for hit testing.
  private createTextOverlay(element: Extract<DesignElement, { type: 'text' }>): HTMLDivElement {
    const div = document.createElement('div');
    this.styleTextOverlay(div, element);
    this.sceneLayerContainer.appendChild(div);
    return div;
  }

  private styleTextOverlay(div: HTMLDivElement, element: Extract<DesignElement, { type: 'text' }>): void {
    div.dir = element.direction;
    div.textContent = element.text;
    Object.assign(div.style, {
      position: 'absolute',
      pointerEvents: 'none',
      whiteSpace: 'pre-wrap',
      overflow: 'visible',
      fontFamily: fontStack(element.fontFamily),
      fontWeight: String(element.fontWeight),
      fontStyle: element.fontStyle ?? 'normal',
      color: element.fill,
      textAlign: element.textAlign,
      lineHeight: element.lineHeight !== undefined ? String(element.lineHeight) : '',
      letterSpacing: element.charSpacing ? `${element.charSpacing / 1000}em` : '',
    });
  }

  private editText(id: string): void {
    const element = this.textElements.get(id);
    const raw = this.rawTextElements.get(id) ?? element;
    const overlay = this.textOverlays.get(id);
    const obj = this.objects.get(id);
    if (!element || !raw || !overlay || !obj || !element.editable || !element.selectable) return;
    // designer_modernization_plan.md M5 — a text element bound to a dynamic variable is read-only
    // here: editing belongs to the explicit Variable/Fallback fields in the Properties panel
    // (DynamicBindingField), not this generic inline editor, which previously pre-filled and could
    // silently commit today's *resolved* value over the authored token/fallback.
    if (raw.dynamicBindings?.some((binding) => binding.property === 'text')) return;
    this.finishTextEditing?.(true);
    this.selectElement(id);
    const editor = document.createElement('textarea');
    editor.dataset.elementId = id;
    editor.setAttribute('aria-label', element.name);
    editor.value = raw.text;
    editor.dir = element.direction;
    editor.style.cssText = overlay.style.cssText;
    Object.assign(editor.style, {
      pointerEvents: 'auto', resize: 'none', border: '0', padding: '0', margin: '0',
      background: 'transparent', outline: '1px solid #818cf8', zIndex: '1',
      boxSizing: 'border-box', overflow: 'auto',
    });
    this.textEditor = editor;
    this.applyOverlayGeometry(editor, obj, this.canvas.getZoom());
    overlay.style.visibility = 'hidden';
    this.canvas.wrapperEl.appendChild(editor);
    const finish = (save: boolean) => {
      if (this.textEditor !== editor) return;
      this.textEditor = null;
      this.finishTextEditing = null;
      const text = editor.value;
      editor.remove();
      overlay.style.visibility = '';
      if (save && text !== raw.text) this.callbacks.onTextChanged(id, text);
    };
    this.finishTextEditing = finish;
    editor.addEventListener('blur', () => finish(true));
    editor.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.isComposing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        finish(true);
      }
    });
    editor.focus();
    editor.select();
  }

  private renderLayers(source: CanvasRenderingContext2D, objects: FabricObject[]): void {
    let layerCount = 0;
    let ctx: CanvasRenderingContext2D | null = null;
    const lower = this.canvas.getElement();
    for (const [index, object] of objects.entries()) {
      const id = (object as DesignerFabricObject).elementId;
      const overlay = id ? this.textOverlays.get(id) ?? this.videoOverlays.get(id) : undefined;
      if (overlay) {
        overlay.style.zIndex = String(index);
        ctx = null;
        continue;
      }
      if (!ctx) {
        let layer = this.paintedLayers[layerCount];
        if (!layer) {
          layer = document.createElement('canvas');
          Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
          this.sceneLayerContainer.appendChild(layer);
          this.paintedLayers.push(layer);
        }
        layerCount++;
        if (layer.width !== lower.width) layer.width = lower.width;
        if (layer.height !== lower.height) layer.height = lower.height;
        layer.style.width = `${this.canvas.width}px`;
        layer.style.height = `${this.canvas.height}px`;
        layer.style.zIndex = String(index);
        ctx = layer.getContext('2d');
        if (!ctx) continue;
        ctx.resetTransform();
        ctx.clearRect(0, 0, layer.width, layer.height);
        ctx.setTransform(source.getTransform());
        ctx.imageSmoothingEnabled = source.imageSmoothingEnabled;
      }
      object.render(ctx);
    }
    for (const layer of this.paintedLayers.splice(layerCount)) layer.remove();
  }

  // designer.md Phase 9 — the visible video frame; the Fabric-side object (FabricObjectFactory)
  // is a fully transparent hit-box. `element.muted`/`autoplay` are passed through as authored —
  // if an author sets `muted:false` with `autoplay:true`, browsers may silently block autoplay
  // (a standard browser policy, not a bug to work around here). `resolveAssetUrl` is the same
  // tenant-scoped lookup CanvasViewport already threads through for images (§4.1 keeps that
  // data/auth concern out of this class otherwise) — only called here, never at
  // FabricObjectFactory's hit-box-only video case.
  private createVideoOverlay(element: VideoElement): HTMLVideoElement {
    const video = document.createElement('video');
    video.muted = element.muted;
    video.loop = element.loop;
    video.autoplay = element.autoplay;
    video.playsInline = true;
    video.volume = element.volume;
    const posterUrl = element.posterAssetId ? this.callbacks.resolveAssetUrl(element.posterAssetId) : undefined;
    if (posterUrl) video.poster = posterUrl;
    Object.assign(video.style, {
      position: 'absolute',
      objectFit: element.fit,
      transformOrigin: 'center center',
    });
    const current = () => {
      const latest = this.applied.get(element.id)?.element;
      return latest?.type === 'video' ? latest : element;
    };
    video.addEventListener('loadedmetadata', () => {
      const startSec = current().startOffsetMs / 1000;
      if (startSec > 0) video.currentTime = startSec;
    });
    video.addEventListener('timeupdate', () => {
      const settings = current();
      if (settings.endOffsetMs === undefined || video.currentTime < settings.endOffsetMs / 1000) return;
      if (settings.loop) video.currentTime = settings.startOffsetMs / 1000;
      else video.pause();
    });
    const url = element.assetId ? this.callbacks.resolveAssetUrl(element.assetId) : undefined;
    if (url) video.src = url;
    this.sceneLayerContainer.appendChild(video);
    return video;
  }

  // Use the complete Fabric transform, including active multi-selection, rotation, and scale.
  private applyOverlayGeometry(el: HTMLElement, obj: DesignerFabricObject, zoom: number): void {
    el.style.display = obj.visible === false ? 'none' : 'block';
    const matrix = obj.calcTransformMatrix();
    el.style.left = '0';
    el.style.top = '0';
    el.style.width = `${obj.width}px`;
    el.style.height = `${obj.height}px`;
    el.style.opacity = String(obj.getObjectOpacity());
    el.style.transformOrigin = '0 0';
    const [a, b, c, d, e, f] = matrix.map((value) => value * zoom);
    el.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f}) translate(-50%, -50%)`;
  }

  // Static content (text/font-family/color/align/direction) is set once at creation
  // (createTextOverlay) — it never changes without a full loadScene rebuild, which recreates the
  // overlay fresh, so re-writing it every render would be wasted work. `fontSize` is the one
  // exception: a real live property on the Textbox, so it's read fresh every time (Phase 8's
  // updateElement fontSize fix keeps it current for live Properties Panel edits).
  private syncTextOverlays(): void {
    if (this.textOverlays.size === 0) return;
    const zoom = this.canvas.getZoom();
    for (const [id, div] of this.textOverlays) {
      const obj = this.objects.get(id);
      if (!obj || !(obj instanceof Textbox)) continue;
      this.applyOverlayGeometry(div, obj, zoom);
      div.style.fontSize = `${obj.fontSize}px`;
      if (this.textEditor?.dataset.elementId === id) {
        this.applyOverlayGeometry(this.textEditor, obj, zoom);
        this.textEditor.style.fontSize = div.style.fontSize;
      }
    }
  }

  // designer.md Phase 9 — same idea, for the DOM <video> overlays. Also pauses playback whenever
  // the element is hidden (§15 "pause hidden/off-scene videos") — off-scene videos never exist
  // here at all (only the active scene is ever loaded, designer.md §29), so this only needs to
  // handle the in-scene visible:false case.
  private syncVideoOverlays(): void {
    if (this.videoOverlays.size === 0) return;
    const zoom = this.canvas.getZoom();
    for (const [id, video] of this.videoOverlays) {
      const obj = this.objects.get(id);
      if (!obj) continue;
      this.applyOverlayGeometry(video, obj, zoom);
      if (obj.visible === false) {
        if (!video.paused) video.pause();
      } else if (video.autoplay && video.paused) {
        void video.play().catch(() => {});
      }
    }
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

    // Layer management (rename, reorder, toggle visibility/lock) must keep working for a
    // hidden/locked element — the store's own selectedElementIds is untouched by this filter, so
    // the Properties panel still shows it. Only the *canvas's* interactive active-selection
    // visualization is suppressed: a hidden element has no visible box to draw handles around,
    // and `selectable: false` already means Fabric shouldn't treat it as an interaction target.
    const targets = ids
      .map((id) => this.objects.get(id))
      .filter((o): o is DesignerFabricObject => o !== undefined)
      .filter((o) => o.visible !== false && o.selectable !== false);
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
    if (value === this.canvas.getZoom() && this.canvas.width === this.designWidth * value && this.canvas.height === this.designHeight * value) return;
    this.fitMode = false;
    this.canvas.setDimensions({ width: this.designWidth * value, height: this.designHeight * value });
    this.canvas.setZoom(value);
    this.canvas.requestRenderAll();
    this.callbacks.onZoomChange(value);
  }

  setPanModeActive(active: boolean): void {
    this.canvas.selection = !active;
    this.canvas.skipTargetFind = active;
    this.canvas.defaultCursor = active ? 'grab' : 'default';
    this.canvas.hoverCursor = active ? 'grab' : 'move';
    this.canvas.upperCanvasEl.style.cursor = active ? 'grab' : '';
  }

  setCursor(cursor: string): void {
    this.canvas.upperCanvasEl.style.cursor = cursor;
  }

  resizeViewport(width: number, height: number): void {
    if (this.fitMode) this.fitToViewport(width, height);
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
    this.fitMode = true;
  }

  // designer.md Phase 6 amendment — captures exactly what's currently rendered (whatever scene
  // this adapter has loaded), for the SceneStrip thumbnail of the active scene. Not a general
  // export: no fixed output resolution, no scene-not-loaded fallback (designer.md §28 full
  // export remains unimplemented).
  async exportSceneSnapshot(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const snapshot = document.createElement('canvas');
      snapshot.width = this.canvas.getElement().width;
      snapshot.height = this.canvas.getElement().height;
      const ctx = snapshot.getContext('2d');
      if (!ctx) { reject(new Error('Scene snapshot failed')); return; }
      ctx.scale(this.canvas.getRetinaScaling(), this.canvas.getRetinaScaling());
      this.canvas.renderCanvas(ctx, this.canvas.getObjects());
      snapshot.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Scene snapshot failed'));
      }, 'image/png');
    });
  }

  // The authoritative resting state for animation — element.x/y/opacity (never drifted by a
  // mid-animation object) plus the scale captured at construction time. Deliberately not read
  // from the live Fabric object's current props, which could be mid-tween or left at a previous
  // preview's "away" state (e.g. re-clicking "Preview exit" must always animate from true rest,
  // not from wherever the last preview left the object).
  private restingProps(element: DesignElement) {
    const scale = this.restingScale.get(element.id) ?? { x: 1, y: 1 };
    // `element.x/y` is the unrotated content box's top-left (see geometryContract.ts) — not a
    // valid Fabric left/top for a rotated object.
    const position = fabricPositionForElement(element, element.rotation);
    return { ...position, opacity: element.opacity, scaleX: scale.x, scaleY: scale.y };
  }

  private awayProps(resting: ReturnType<FabricCanvasAdapter['restingProps']>, motion: AnimationMotion) {
    return {
      left: resting.left + (motion.dx ?? 0),
      top: resting.top + (motion.dy ?? 0),
      opacity: motion.opacityAway ?? resting.opacity,
      scaleX: resting.scaleX * (motion.scaleAway ?? 1),
      scaleY: resting.scaleY * (motion.scaleAway ?? 1),
    };
  }

  private rerender = () => this.canvas.requestRenderAll();

  playEnter(id: string, step: AnimationStep, element: DesignElement): void {
    const obj = this.objects.get(id);
    if (!obj || step.preset === 'none') return;
    const resting = this.restingProps(element);
    const away = this.awayProps(resting, ANIMATION_MOTION[step.preset]);
    obj.set(away);
    obj.setCoords();
    if (step.durationMs <= 0) {
      obj.set(resting);
      obj.setCoords();
      this.rerender();
      return;
    }
    obj.animate(resting, { duration: step.durationMs, delay: step.delayMs, easing: resolveEasing(step.easing), onChange: this.rerender });
  }

  playExit(id: string, step: AnimationStep, element: DesignElement): void {
    const obj = this.objects.get(id);
    if (!obj || step.preset === 'none') return;
    const resting = this.restingProps(element);
    // Always start from true rest — a repeated manual "Preview exit" click must not animate from
    // wherever the previous preview left the object (e.g. already faded out).
    obj.set(resting);
    obj.setCoords();
    const away = this.awayProps(resting, ANIMATION_MOTION[step.preset]);
    if (step.durationMs <= 0) {
      obj.set(away);
      obj.setCoords();
      this.rerender();
      return;
    }
    obj.animate(away, { duration: step.durationMs, delay: step.delayMs, easing: resolveEasing(step.easing), onChange: this.rerender });
  }

  // One pulse cycle: resting -> away -> resting. Building block for both the manual Preview
  // button (one tap, one pulse) and playEmphasisLoop below (repeated calls).
  playEmphasisOnce(id: string, step: EmphasisStep, element: DesignElement, onDone?: () => void): void {
    const obj = this.objects.get(id);
    if (!obj || step.preset === 'none') {
      onDone?.();
      return;
    }
    const resting = this.restingProps(element);
    obj.set(resting);
    obj.setCoords();
    const away = this.awayProps(resting, ANIMATION_MOTION[step.preset]);
    const half = Math.max(1, step.durationMs / 2);
    const easing = resolveEasing(step.easing);
    // object.animate()'s options are shared across every property key being animated in one call
    // (left/top/opacity/scaleX/scaleY here), so onComplete can fire once per key rather than once
    // overall — guard so the return-leg only ever starts once.
    let awayLegDone = false;
    obj.animate(away, {
      duration: half,
      easing,
      onChange: this.rerender,
      onComplete: () => {
        if (awayLegDone) return;
        awayLegDone = true;
        let restLegDone = false;
        obj.animate(resting, {
          duration: half,
          easing,
          onChange: this.rerender,
          onComplete: () => {
            if (restLegDone) return;
            restLegDone = true;
            onDone?.();
          },
        });
      },
    });
  }

  // Auto-triggered on genuine scene activation (see playSceneEnterAnimations / CanvasViewport's
  // scene-changed check) — repeats step.repeat times if set, else loops indefinitely. Stops
  // naturally with no abort bookkeeping: each iteration re-checks that `id` still maps to the
  // exact object instance captured at the start, which becomes false the moment a scene rebuild
  // (loadScene's clear()) replaces it.
  playEmphasisLoop(id: string, step: EmphasisStep, element: DesignElement): void {
    const obj = this.objects.get(id);
    if (!obj || step.preset === 'none') return;
    let remaining = step.repeat;
    const tick = () => {
      if (this.objects.get(id) !== obj) return;
      if (remaining !== undefined) {
        if (remaining <= 0) return;
        remaining -= 1;
      }
      this.playEmphasisOnce(id, step, element, () => {
        setTimeout(tick, 0);
      });
    };
    setTimeout(tick, step.delayMs);
  }

  playSceneEnterAnimations(scene: DesignScene): void {
    for (const element of scene.elements) {
      if (element.animation?.enter) this.playEnter(element.id, element.animation.enter, element);
      if (element.animation?.emphasis) this.playEmphasisLoop(element.id, element.animation.emphasis, element);
    }
  }

  dispose(): void {
    this.disposed = true;
    ++this.generation;
    this.pendingSync?.abort();
    this.pendingSync = null;
    this.applied.clear();
    this.finishTextEditing?.(false);
    for (const layer of this.paintedLayers) layer.remove();
    this.paintedLayers = [];
    this.textElements.clear();
    this.rawTextElements.clear();
    this.unbindSelection();
    this.unbindModified();
    this.unbindLiveTransform();
    this.unbindContextMenu();
    this.unbindDoubleClick();
    this.unbindAfterRender();
    for (const div of this.textOverlays.values()) div.remove();
    this.textOverlays.clear();
    for (const video of this.videoOverlays.values()) disposeVideoOverlay(video);
    this.videoOverlays.clear();
    void this.canvas.dispose();
  }
}
