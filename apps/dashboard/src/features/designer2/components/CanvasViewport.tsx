'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { assetsApi, orgApi } from '@/lib/api';
import {
  ArrowUpToLine,
  ArrowDownToLine,
  ChevronUp,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Trash2,
} from 'lucide-react';
import { ContextMenu, type ContextMenuState } from '@/components/ContextMenu';
import { useConfirmBeforeDelete } from '@/hooks/useConfirmBeforeDelete';
import { FabricCanvasAdapter } from '../canvas/FabricCanvasAdapter';
import type { ElementGeometryPatch, Guides } from '../canvas/FabricEventBridge';
import { useDesignerStore } from '../state/designer.store';
import { resolveElementBindings, type VariableMap } from '@lumina/design-schema';

interface CanvasViewportProps {
  // Commit-wrapped by the caller (DesignerShell owns useDesignerHistory) so finishing a
  // drag/resize/rotate is one undo step — same convention as every other mutation here.
  commit: (mutator: () => void) => void;
  // Hands the parent the live adapter instance so PropertiesPanel can call
  // adapter.updateElement() directly for live-feedback edits (designer.md §8 amendment) without
  // this component needing to know anything about property-panel UI.
  onAdapterReady: (adapter: FabricCanvasAdapter | null) => void;
  // Hands the parent an imperative resetView() so the top bar's "Fit to Screen" button can
  // trigger it — same callback-prop convention as onAdapterReady, since pan offset is local
  // interaction state owned by this component (not the designer store).
  onResetViewReady: (fn: (() => void) | null) => void;
}

// Mounts the Fabric <canvas> and owns the adapter's lifecycle. This is the piece that must be
// lazy-loaded client-only (see designer2/page.tsx) — Fabric touches `window`/`document` at
// construction time and cannot run during SSR.
export function CanvasViewport({ commit, onAdapterReady, onResetViewReady }: CanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasBoxRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const textOverlayContainerRef = useRef<HTMLDivElement>(null);
  const videoOverlayContainerRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<FabricCanvasAdapter | null>(null);
  const [guides, setGuides] = useState<Guides>({ v: [], h: [] });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  // Pan (Space+drag / middle-mouse-drag) — a DOM-level `transform: translate` applied directly to
  // canvasBoxRef, entirely outside Fabric's own viewportTransform/zoom. Kept in refs and mutated
  // imperatively (applyPanTransform) rather than React state so a drag can update every
  // mousemove at 60fps without round-tripping through a re-render.
  const panRef = useRef({ x: 0, y: 0 });
  const spaceHeldRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, offsetX: 0, offsetY: 0 });
  const resetTransitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { confirmDelete } = useConfirmBeforeDelete();
  // Same tenant-scoped assets list every asset picker/select in the dashboard queries (see
  // ImagePicker.tsx) — React Query dedupes against those by queryKey, so this doesn't add a
  // second network fetch. Image elements only ever store an assetId (designer.md §9); resolving
  // it to a real URL for Fabric to render is this component's job, not the canvas adapter's
  // (designer.md §4.1 keeps data/auth concerns out of the Fabric layer).
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });
  // designer.md §17.2 — `{{business.name}}`'s real backing. Same `['orgSettings']` query key
  // screens/page.tsx and settings/page.tsx already use, so React Query dedupes this rather than
  // firing a second request.
  const { data: orgSettings } = useQuery({ queryKey: ['orgSettings'], queryFn: orgApi.getSettings });

  const document = useDesignerStore((s) => s.document);
  const activeSceneId = useDesignerStore((s) => s.activeSceneId);
  const selectedElementIds = useDesignerStore((s) => s.selectedElementIds);
  const zoom = useDesignerStore((s) => s.zoom);
  const setSelection = useDesignerStore((s) => s.setSelection);
  const setZoom = useDesignerStore((s) => s.setZoom);
  const updateElement = useDesignerStore((s) => s.updateElement);
  const removeElements = useDesignerStore((s) => s.removeElements);
  const duplicateElements = useDesignerStore((s) => s.duplicateElements);
  const reorderElement = useDesignerStore((s) => s.reorderElement);

  // Stable refs so the fabric listeners (bound once, on mount) always call the latest
  // store action/prop without needing to re-bind — same pattern as LayoutCanvasPanel's `latest` ref.
  const latest = useRef({
    setSelection,
    updateElement,
    removeElements,
    duplicateElements,
    reorderElement,
    commit,
    setZoom,
    confirmDelete,
    resolveAssetUrl: (assetId: string) => assets.find((a) => a.id === assetId)?.url ?? undefined,
  });
  useEffect(() => {
    latest.current = {
      setSelection,
      updateElement,
      removeElements,
      duplicateElements,
      reorderElement,
      commit,
      setZoom,
      confirmDelete,
      resolveAssetUrl: (assetId: string) => assets.find((a) => a.id === assetId)?.url ?? undefined,
    };
  });

  // Reads fresh state imperatively rather than closing over `document`/`activeSceneId` props —
  // this is only ever called from the onContextMenu callback registered once at mount (see the
  // effect below), so a closure over those props would be stale after the first document change.
  function buildContextMenuActions(elementId: string) {
    const { document: doc, activeSceneId: sceneId } = useDesignerStore.getState();
    const scene = doc?.scenes.find((s) => s.id === sceneId);
    const element = scene?.elements.find((el) => el.id === elementId);
    if (!element) return [];
    const isLocked = !element.movable && !element.resizable;
    return [
      { key: 'front', label: 'Bring to Front', icon: ArrowUpToLine, onClick: () => latest.current.commit(() => latest.current.reorderElement(elementId, 'front')) },
      { key: 'forward', label: 'Bring Forward', icon: ChevronUp, onClick: () => latest.current.commit(() => latest.current.reorderElement(elementId, 'forward')) },
      { key: 'backward', label: 'Send Backward', icon: ChevronDown, onClick: () => latest.current.commit(() => latest.current.reorderElement(elementId, 'backward')) },
      { key: 'back', label: 'Send to Back', icon: ArrowDownToLine, onClick: () => latest.current.commit(() => latest.current.reorderElement(elementId, 'back')) },
      { key: 'duplicate', label: 'Duplicate', icon: Copy, onClick: () => latest.current.commit(() => latest.current.duplicateElements([elementId])), separator: true },
      {
        key: 'visibility',
        label: element.visible ? 'Hide' : 'Show',
        icon: element.visible ? EyeOff : Eye,
        onClick: () => latest.current.commit(() => latest.current.updateElement(elementId, { visible: !element.visible })),
      },
      {
        key: 'lock',
        label: isLocked ? 'Unlock Position' : 'Lock Position',
        icon: isLocked ? LockOpen : Lock,
        onClick: () => latest.current.commit(() => latest.current.updateElement(elementId, { movable: isLocked, resizable: isLocked })),
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: Trash2,
        danger: true,
        disabled: !element.deletable,
        separator: true,
        onClick: () => {
          if (!latest.current.confirmDelete('Delete this element?')) return;
          latest.current.commit(() => latest.current.removeElements([elementId]));
        },
      },
    ];
  }

  // Applies panRef's current offset to the DOM directly (no React re-render). `smooth: true` is
  // only for the brief animated snap-back in resetView — every live drag frame passes `false` so
  // dragging itself is instant with no transition lag.
  function applyPanTransform(smooth: boolean) {
    const el = canvasBoxRef.current;
    if (!el) return;
    el.style.transition = smooth ? 'transform 220ms ease-out' : 'none';
    el.style.transform = `translate3d(${panRef.current.x}px, ${panRef.current.y}px, 0)`;
  }

  // Reset View: re-centers a pan offset back to zero and re-fits zoom to the viewport. Wired to
  // both the top bar's "Fit to Screen" button (via onResetViewReady) and double-clicking empty
  // canvas (via the adapter's onEmptyDoubleClick callback below). Only reads/writes refs, so this
  // closure stays valid even though it's captured once at mount time by the effect below.
  function resetView() {
    panRef.current = { x: 0, y: 0 };
    applyPanTransform(true);
    if (resetTransitionTimeoutRef.current) clearTimeout(resetTransitionTimeoutRef.current);
    resetTransitionTimeoutRef.current = setTimeout(() => applyPanTransform(false), 220);
    const container = containerRef.current;
    adapterRef.current?.fitToViewport(container?.clientWidth, container?.clientHeight);
  }

  // fabric.Canvas.dispose() synchronously restores the DOM but only *defers* tearing down its
  // render context until any pending requestAnimationFrame-scheduled render fires — see
  // fabric's StaticCanvas.dispose()/destroy(). React 18 Strict Mode's dev-only synchronous
  // mount -> cleanup -> mount would otherwise construct a second Canvas on the same <canvas>
  // DOM node before the first's deferred teardown runs, and that deferred teardown can then
  // clobber the second instance's paint state (repros as: objects added to the fabric model
  // correctly, selection state correct, but nothing actually paints). The fix is to never reuse
  // the same DOM canvas element across mounts: create a brand new <canvas> element imperatively
  // on every mount and remove it on cleanup, so a disposing instance can never reach into a live
  // one's DOM node.
  useEffect(() => {
    const host = canvasHostRef.current;
    const overlayContainer = textOverlayContainerRef.current;
    const videoOverlayContainer = videoOverlayContainerRef.current;
    if (!host || !overlayContainer || !videoOverlayContainer) return;
    const canvasEl = window.document.createElement('canvas');
    host.appendChild(canvasEl);
    const adapter = new FabricCanvasAdapter(canvasEl, overlayContainer, videoOverlayContainer, {
      onSelectionChange: (ids) => latest.current.setSelection(ids),
      onElementModified: (id, patch: ElementGeometryPatch) =>
        latest.current.commit(() => latest.current.updateElement(id, patch)),
      onGuidesChange: setGuides,
      onContextMenu: (elementId, clientX, clientY) => {
        if (!elementId) return; // empty-canvas right-click: no menu (nothing to act on yet)
        setContextMenu({ x: clientX, y: clientY, actions: buildContextMenuActions(elementId) });
      },
      onZoomChange: (z) => latest.current.setZoom(z),
      onEmptyDoubleClick: () => resetView(),
      resolveAssetUrl: (assetId) => latest.current.resolveAssetUrl(assetId),
    });
    adapterRef.current = adapter;
    onAdapterReady(adapter);
    onResetViewReady(resetView);
    return () => {
      adapterRef.current = null;
      onAdapterReady(null);
      onResetViewReady(null);
      adapter.dispose();
      canvasEl.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally initialized once; see `latest` ref above
  }, []);

  // Tracks the previous activeSceneId so the effect below can tell "the scene actually changed"
  // apart from "the same scene's content was edited" — see the animation-trigger comment there.
  const prevSceneIdRef = useRef<string | null>(null);

  // Load the active scene whenever the document or active scene changes, then restore selection
  // (loadScene fully rebuilds every fabric object, so the previous selection is gone otherwise —
  // that would visually deselect an element the instant you finish dragging/resizing it, since
  // that also flows through this same effect via the store's `document` reference changing).
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !document || !activeSceneId) return;
    const scene = document.scenes.find((s) => s.id === activeSceneId);
    if (!scene) return;
    // designer.md §17.2 — V1 variable sources: the org's own name (real, if the only field that
    // exists for it), overridable by/merged with this document's own instance variables (the
    // VariablesPanel). CanvasViewport resolves bindings before the adapter ever sees an element —
    // per §4.1, Fabric/the adapter must never know about variables at all.
    const variables: VariableMap = { ...(orgSettings ? { 'business.name': orgSettings.name } : {}), ...document.variables };
    const resolvedScene = { ...scene, elements: scene.elements.map((el) => resolveElementBindings(el, variables)) };
    // designer.md Phase 7 — this effect re-runs on *every* document mutation (Phase 2's documented
    // always-rebuild strategy), not just real scene switches, so enter/emphasis animations can't
    // be triggered unconditionally here or editing one element would replay every other element's
    // enter animation on every unrelated edit. Only fire them on a genuine scene change — which
    // also means the Phase 6 preview loop's scene-to-scene stepping gets animation playback for
    // free, since it changes activeSceneId per scene.
    const sceneChanged = prevSceneIdRef.current !== activeSceneId;
    prevSceneIdRef.current = activeSceneId;
    adapter.setDesignSize(document.canvas.width, document.canvas.height);
    void adapter.loadScene(resolvedScene).then(() => {
      adapter.fitToViewport(containerRef.current?.clientWidth, containerRef.current?.clientHeight);
      adapter.selectElements(useDesignerStore.getState().selectedElementIds);
      if (sceneChanged) adapter.playSceneEnterAnimations(resolvedScene);
    });
    // `assets` is included so that an image element added just before its own asset finishes
    // uploading (still resolving to a placeholder at that instant) re-resolves to the real photo
    // the moment the assets list query refetches, without requiring another unrelated edit.
  }, [document, activeSceneId, assets, orgSettings]);

  // Store -> fabric selection sync (e.g. clicking a row in the Layers panel). Safe to fire
  // during an in-flight loadScene rebuild above — selectElements no-ops harmlessly if the
  // targeted object doesn't exist yet, and the rebuild's own .then() re-applies selection anyway.
  useEffect(() => {
    adapterRef.current?.selectElements(selectedElementIds);
  }, [selectedElementIds]);

  // Keep the canvas fit to its container on resize.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      adapterRef.current?.fitToViewport(container.clientWidth, container.clientHeight);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [document]);

  // Ctrl/Cmd+scroll zoom — same convention as LayoutCanvasPanel/ThemeCanvasPanel.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const next = Math.max(0.1, Math.min(4, zoom * Math.exp(-e.deltaY * 0.0015)));
      adapterRef.current?.setZoom(next); // onZoomChange callback updates the store
    };
    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [zoom]);

  // Space/Drag-to-Pan + middle-mouse-drag-to-pan. Space+drag pans regardless of what's under the
  // cursor (adapter.setPanModeActive suspends Fabric's own object interaction for the duration);
  // plain click-drag on blank canvas is left untouched, so Fabric's existing rubber-band marquee
  // multi-select keeps working exactly as before. mousemove/mouseup listeners for an in-flight
  // drag are attached only while panning and torn down the instant it ends, rather than living
  // for the component's whole lifetime — same "don't leak persistent global listeners" concern as
  // the wheel handler above, just scoped to the drag gesture instead of the mount.
  useEffect(() => {
    const containerEl = containerRef.current;
    if (!containerEl) return;
    // Function declarations below are hoisted, so TS can't carry the `!containerEl` narrowing
    // into them (it only narrows in the same control-flow path, not closures called later) —
    // this second binding is annotated non-null once instead of `!`-asserting on every use.
    const container: HTMLDivElement = containerEl;

    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    }

    function setSpaceHeld(held: boolean) {
      if (spaceHeldRef.current === held) return;
      spaceHeldRef.current = held;
      // Don't touch Fabric's interaction/cursor state mid-drag — endPan() re-syncs it from
      // spaceHeldRef once the drag actually finishes.
      if (isPanningRef.current) return;
      adapterRef.current?.setPanModeActive(held);
      container.style.cursor = held ? 'grab' : '';
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space' || e.repeat || isTypingTarget(e.target)) return;
      e.preventDefault(); // stop the page from scrolling on Space
      setSpaceHeld(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      setSpaceHeld(false);
    }

    function endPan() {
      isPanningRef.current = false;
      adapterRef.current?.setPanModeActive(spaceHeldRef.current);
      container.style.cursor = spaceHeldRef.current ? 'grab' : '';
      window.document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onPanMove, true);
      window.removeEventListener('mouseup', onPanUp, true);
      window.removeEventListener('blur', endPan);
    }

    function onPanMove(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      const dx = e.clientX - panStartRef.current.mouseX;
      const dy = e.clientY - panStartRef.current.mouseY;
      panRef.current = { x: panStartRef.current.offsetX + dx, y: panStartRef.current.offsetY + dy };
      applyPanTransform(false);
    }

    function onPanUp(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      endPan();
    }

    function startPan(e: MouseEvent) {
      // Captured before Fabric ever sees this mousedown (see onMouseDown below), so this
      // simultaneously satisfies spec item 3 (dragging an object doesn't pan unless Space is
      // held) and keeps blank-canvas marquee-select intact (this only runs for Space+drag or
      // middle-mouse, never a plain blank-canvas click).
      e.preventDefault();
      e.stopPropagation();
      isPanningRef.current = true;
      panStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, offsetX: panRef.current.x, offsetY: panRef.current.y };
      adapterRef.current?.setPanModeActive(true);
      adapterRef.current?.setCursor('grabbing');
      container.style.cursor = 'grabbing';
      window.document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onPanMove, true);
      window.addEventListener('mouseup', onPanUp, true);
      window.addEventListener('blur', endPan);
    }

    // Capture phase + stopPropagation so a pan-triggering mousedown never reaches Fabric's own
    // mousedown handling (bound on canvas.upperCanvasEl, a descendant of `container`) — Fabric
    // never sees the event at all rather than seeing it and being told to ignore it.
    function onMouseDown(e: MouseEvent) {
      if (isPanningRef.current) return;
      const isMiddleButton = e.button === 1;
      const isSpaceDrag = e.button === 0 && spaceHeldRef.current;
      if (isMiddleButton || isSpaceDrag) startPan(e);
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    container.addEventListener('mousedown', onMouseDown, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      container.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('mousemove', onPanMove, true);
      window.removeEventListener('mouseup', onPanUp, true);
      window.removeEventListener('blur', endPan);
      if (resetTransitionTimeoutRef.current) clearTimeout(resetTransitionTimeoutRef.current);
      container.style.cursor = '';
      window.document.body.style.userSelect = '';
    };
  }, []);

  const canvasPxWidth = (document?.canvas.width ?? 0) * zoom;
  const canvasPxHeight = (document?.canvas.height ?? 0) * zoom;
  const activeScene = document?.scenes.find((s) => s.id === activeSceneId);
  // designer.md Phase 9 — a color scene background is now a DOM layer, not `canvas.backgroundColor`
  // (see FabricCanvasAdapter's Phase 9 comments for why: an opaque Fabric-painted background would
  // sit on top of a video element positioned behind the canvas and hide it completely). Image/video
  // background types stay a documented no-op, unchanged from before this phase.
  const backgroundColor = activeScene?.background.type === 'color' ? activeScene.background.color : undefined;

  return (
    <div ref={containerRef} className="relative flex h-full w-full items-center justify-center overflow-hidden bg-gray-100 dark:bg-gray-950">
      <div ref={canvasBoxRef} className="relative" style={{ width: canvasPxWidth, height: canvasPxHeight, willChange: 'transform' }}>
        <div className="absolute inset-0" style={{ backgroundColor }} />
        {/* designer.md Phase 9 — video elements' actual playback (FabricCanvasAdapter
            populates/positions these; the Fabric hit-box underneath is fully transparent). Sits
            below the canvas so canvas-drawn Shape/Image/QR content can layer on top of video —
            see designer.md's Phase 9 amendment for the three-band stacking model and its limits. */}
        <div ref={videoOverlayContainerRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
        <div ref={canvasHostRef} />
        {/* designer.md Phase 8 — text elements' actual visible glyphs (FabricCanvasAdapter
            populates/positions these; the Fabric Textbox underneath paints transparent). Sits
            above the canvas but below guides/context-menu, and doesn't itself intercept pointer
            events — selection/hit-testing stays on the canvas. */}
        <div ref={textOverlayContainerRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
        <div className="pointer-events-none absolute inset-0">
          {guides.v.map((x) => (
            <div key={`v-${x}`} className="absolute top-0 bottom-0 w-px bg-pink-500" style={{ left: x * zoom }} />
          ))}
          {guides.h.map((y) => (
            <div key={`h-${y}`} className="absolute left-0 right-0 h-px bg-pink-500" style={{ top: y * zoom }} />
          ))}
        </div>
      </div>
      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}
