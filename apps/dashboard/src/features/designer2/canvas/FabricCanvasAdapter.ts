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
import { ActiveSelection, Canvas, runningAnimations, Textbox, type FabricObject } from 'fabric';
import { ANIMATION_MOTION, resolveEasing, type AnimationMotion, type DesignElement, type DesignScene, type ElementAnimation, type VideoElement } from '@lumina/design-schema';
import { fontStack } from '@lumina/types';
import { createFabricObject, type ResolveAssetUrl } from './FabricObjectFactory';
import {
  bindContextMenuEvents,
  bindDoubleClickEvents,
  bindLiveTransformEvents,
  bindModifiedEvents,
  bindSelectionEvents,
  type DesignerFabricObject,
  type ElementGeometryPatch,
  type Guides,
} from './FabricEventBridge';

// Not exported from @lumina/design-schema (AnimationStepSchema/EmphasisAnimationStepSchema are
// module-local) — derived the same way packages/types/theme.ts derives its own step types.
type AnimationStep = NonNullable<ElementAnimation['enter']>;
type EmphasisStep = NonNullable<ElementAnimation['emphasis']>;

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
  onGuidesChange: (guides: Guides) => void;
  onContextMenu: (elementId: string | null, clientX: number, clientY: number) => void;
  // Fires whenever the effective zoom changes for any reason, including fitToViewport's own
  // resize-triggered rescale — without this, a caller that only updates its own zoom state from
  // the wheel-zoom handler (Phase 1's original wiring) drifts out of sync with the canvas's
  // actual zoom the first time the window/container resizes.
  onZoomChange: (zoom: number) => void;
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
  private canvas: Canvas;
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
  // designer.md Phase 8 amendment — Fabric's Textbox has no real bidi/RTL shaping, so text
  // elements paint transparent on canvas (FabricObjectFactory) and their actual visible glyphs
  // are these DOM overlay divs instead, positioned by syncTextOverlays() on every render. One per
  // text element, keyed by element id, appended into the container CanvasViewport provides.
  private textOverlayContainer: HTMLDivElement;
  private textOverlays = new Map<string, HTMLDivElement>();
  // designer.md Phase 9 — same hybrid idea as text, one HTMLVideoElement per video element,
  // synced by the same after:render hook. Sits in a container CanvasViewport positions *below*
  // the canvas (see that file's Phase 9 comments) — the canvas itself no longer paints a
  // background color (moved to a DOM layer below even this), so it's fully transparent and a
  // video positioned beneath it is actually visible through it.
  private videoOverlayContainer: HTMLDivElement;
  private videoOverlays = new Map<string, HTMLVideoElement>();
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
    textOverlayContainer: HTMLDivElement,
    videoOverlayContainer: HTMLDivElement,
    callbacks: CanvasAdapterCallbacks,
  ) {
    this.callbacks = callbacks;
    this.textOverlayContainer = textOverlayContainer;
    this.videoOverlayContainer = videoOverlayContainer;
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
    this.unbindDoubleClick = bindDoubleClickEvents(this.canvas, callbacks.onEmptyDoubleClick);
    const onAfterRender = () => {
      this.syncTextOverlays();
      this.syncVideoOverlays();
    };
    this.canvas.on('after:render', onAfterRender);
    this.unbindAfterRender = () => this.canvas.off('after:render', onAfterRender);
  }

  async loadScene(scene: DesignScene): Promise<void> {
    this.clear();
    // designer.md Phase 9 — scene background rendering moved entirely to CanvasViewport as a DOM
    // layer (color fill below the video overlay layer; image/video background types still a
    // documented no-op there, unchanged). This canvas never paints a background of its own.
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
    // Immediate cleanup of any in-flight enter/emphasis tweens on rebuild — belt-and-suspenders
    // alongside playEmphasisLoop's own natural self-stop (it re-checks `this.objects.get(id)`
    // against its captured object reference before every iteration).
    runningAnimations.cancelByCanvas(this.canvas);
    this.suppressSelectionEvents = true;
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
    const obj = (await createFabricObject(element, this.callbacks.resolveAssetUrl)) as DesignerFabricObject;
    this.objects.set(element.id, obj);
    this.restingScale.set(element.id, { x: obj.scaleX ?? 1, y: obj.scaleY ?? 1 });
    this.canvas.add(obj);
    if (element.type === 'text') this.textOverlays.set(element.id, this.createTextOverlay(element));
    if (element.type === 'video' && element.assetId) this.videoOverlays.set(element.id, this.createVideoOverlay(element));
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
    // designer.md Phase 8 — fontSize wasn't mapped here before (a pre-existing gap:
    // PropertiesPanel's font-size slider called this via its "live" path but nothing on the
    // Fabric object ever changed until the next full commit-triggered rebuild). Needed now for
    // real: the text overlay's own font-size sync reads this object's live `fontSize`.
    const fontSizePatch = (patch as Partial<Extract<DesignElement, { type: 'text' }>>).fontSize;
    if (fontSizePatch !== undefined && obj instanceof Textbox) next.fontSize = fontSizePatch;
    obj.set(next);
    obj.setCoords();
    this.canvas.requestRenderAll();
  }

  removeElement(id: string): void {
    const obj = this.objects.get(id);
    if (!obj) return;
    this.canvas.remove(obj);
    this.objects.delete(id);
    this.textOverlays.get(id)?.remove();
    this.textOverlays.delete(id);
    const video = this.videoOverlays.get(id);
    if (video) disposeVideoOverlay(video);
    this.videoOverlays.delete(id);
  }

  // designer.md Phase 8 — the DOM overlay's static content: everything that only ever changes via
  // a full loadScene rebuild (which recreates this div from scratch), not via a live in-place
  // update. `dir` is the whole point — native browser bidi/RTL layout, which Fabric's Textbox
  // can't do. `pointer-events: none` since this is purely visual; selection/hit-testing stays on
  // the (invisible) Fabric Textbox underneath, and PropertiesPanel's Text field is the only way
  // to edit content (no in-canvas double-click editing is wired for designer2 text at all).
  private createTextOverlay(element: Extract<DesignElement, { type: 'text' }>): HTMLDivElement {
    const div = document.createElement('div');
    div.dir = element.direction;
    div.textContent = element.text;
    Object.assign(div.style, {
      position: 'absolute',
      pointerEvents: 'none',
      whiteSpace: 'pre-wrap',
      overflow: 'visible',
      transformOrigin: 'center center',
      fontFamily: fontStack(element.fontFamily),
      fontWeight: String(element.fontWeight),
      fontStyle: element.fontStyle ?? 'normal',
      color: element.fill,
      textAlign: element.textAlign,
      lineHeight: element.lineHeight !== undefined ? String(element.lineHeight) : '',
      letterSpacing: element.charSpacing ? `${element.charSpacing / 1000}em` : '',
    });
    this.textOverlayContainer.appendChild(div);
    return div;
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
    const startSec = element.startOffsetMs / 1000;
    const endSec = element.endOffsetMs !== undefined ? element.endOffsetMs / 1000 : undefined;
    video.addEventListener('loadedmetadata', () => {
      if (startSec > 0) video.currentTime = startSec;
    });
    if (endSec !== undefined) {
      video.addEventListener('timeupdate', () => {
        if (video.currentTime < endSec) return;
        if (element.loop) video.currentTime = startSec;
        else video.pause();
      });
    }
    const url = element.assetId ? this.callbacks.resolveAssetUrl(element.assetId) : undefined;
    if (url) video.src = url;
    this.videoOverlayContainer.appendChild(video);
    return video;
  }

  // designer.md Phase 8/9 — recomputes one overlay's CSS position/size/transform from its Fabric
  // hit-box's current geometry. Shared by text and video overlays (syncTextOverlays/
  // syncVideoOverlays below) — both are plain HTMLElements needing identical position mirroring,
  // on every canvas render (drag, resize, rotate, zoom, Phase 7 animation ticks — `after:render`
  // fires after all of them uniformly). Pure position mirroring, not a full transform-matrix
  // conversion: every element here uses originX/originY 'left'/'top' (see FabricObjectFactory),
  // so left/top already give the *scaled* box's unrotated top-left corner directly (Fabric anchors
  // left/top to whichever edge/corner a resize handle drag did *not* move) — the CSS box therefore
  // has to be sized at the final scaled dimensions (width*scaleX, height*scaleY), not the
  // pre-scale width/height with a separate CSS `scale()` layered on top. A `scale()` transform
  // pivots around the CSS box's own center by default (`transformOrigin` is only ever set to
  // 'center center', see createVideoOverlay), which matches Fabric only when the resize itself was
  // anchored at the center — for every edge/corner-handle drag it isn't, so during a live resize
  // the overlay visibly grew from the box's center instead of the handle's fixed opposite edge
  // (e.g. dragging the bottom handle down made the video appear to grow upward too). Only rotation
  // still needs a CSS transform — Fabric rotates around the object's own center exactly like CSS
  // `rotate()` does, so that part was never wrong.
  private applyOverlayGeometry(el: HTMLElement, obj: DesignerFabricObject, zoom: number): void {
    el.style.display = obj.visible === false ? 'none' : 'block';
    const scaleX = obj.scaleX ?? 1;
    const scaleY = obj.scaleY ?? 1;
    el.style.left = `${(obj.left ?? 0) * zoom}px`;
    el.style.top = `${(obj.top ?? 0) * zoom}px`;
    el.style.width = `${(obj.width ?? 0) * scaleX * zoom}px`;
    el.style.height = `${(obj.height ?? 0) * scaleY * zoom}px`;
    el.style.opacity = String(obj.opacity ?? 1);
    const angle = obj.angle ?? 0;
    el.style.transform = angle === 0 ? '' : `rotate(${angle}deg)`;
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
      div.style.fontSize = `${obj.fontSize * zoom}px`;
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

  // designer.md Phase 6 amendment — captures exactly what's currently rendered (whatever scene
  // this adapter has loaded), for the SceneStrip thumbnail of the active scene. Not a general
  // export: no fixed output resolution, no scene-not-loaded fallback (designer.md §28 full
  // export remains unimplemented).
  async exportSceneSnapshot(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.getElement().toBlob((blob) => {
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
    return { left: element.x, top: element.y, opacity: element.opacity, scaleX: scale.x, scaleY: scale.y };
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
