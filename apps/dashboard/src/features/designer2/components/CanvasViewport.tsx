'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { assetsApi } from '@/lib/api';
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

interface CanvasViewportProps {
  // Commit-wrapped by the caller (DesignerShell owns useDesignerHistory) so finishing a
  // drag/resize/rotate is one undo step — same convention as every other mutation here.
  commit: (mutator: () => void) => void;
  // Hands the parent the live adapter instance so PropertiesPanel can call
  // adapter.updateElement() directly for live-feedback edits (designer.md §8 amendment) without
  // this component needing to know anything about property-panel UI.
  onAdapterReady: (adapter: FabricCanvasAdapter | null) => void;
}

// Mounts the Fabric <canvas> and owns the adapter's lifecycle. This is the piece that must be
// lazy-loaded client-only (see designer2/page.tsx) — Fabric touches `window`/`document` at
// construction time and cannot run during SSR.
export function CanvasViewport({ commit, onAdapterReady }: CanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<FabricCanvasAdapter | null>(null);
  const [guides, setGuides] = useState<Guides>({ v: [], h: [] });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const { confirmDelete } = useConfirmBeforeDelete();
  // Same tenant-scoped assets list every asset picker/select in the dashboard queries (see
  // ImagePicker.tsx) — React Query dedupes against those by queryKey, so this doesn't add a
  // second network fetch. Image elements only ever store an assetId (designer.md §9); resolving
  // it to a real URL for Fabric to render is this component's job, not the canvas adapter's
  // (designer.md §4.1 keeps data/auth concerns out of the Fabric layer).
  const { data: assets = [] } = useQuery({ queryKey: ['assets'], queryFn: assetsApi.list });

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
    if (!host) return;
    const canvasEl = window.document.createElement('canvas');
    host.appendChild(canvasEl);
    const adapter = new FabricCanvasAdapter(canvasEl, {
      onSelectionChange: (ids) => latest.current.setSelection(ids),
      onElementModified: (id, patch: ElementGeometryPatch) =>
        latest.current.commit(() => latest.current.updateElement(id, patch)),
      onGuidesChange: setGuides,
      onContextMenu: (elementId, clientX, clientY) => {
        if (!elementId) return; // empty-canvas right-click: no menu (nothing to act on yet)
        setContextMenu({ x: clientX, y: clientY, actions: buildContextMenuActions(elementId) });
      },
      onZoomChange: (z) => latest.current.setZoom(z),
      resolveAssetUrl: (assetId) => latest.current.resolveAssetUrl(assetId),
    });
    adapterRef.current = adapter;
    onAdapterReady(adapter);
    return () => {
      adapterRef.current = null;
      onAdapterReady(null);
      adapter.dispose();
      canvasEl.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally initialized once; see `latest` ref above
  }, []);

  // Load the active scene whenever the document or active scene changes, then restore selection
  // (loadScene fully rebuilds every fabric object, so the previous selection is gone otherwise —
  // that would visually deselect an element the instant you finish dragging/resizing it, since
  // that also flows through this same effect via the store's `document` reference changing).
  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter || !document || !activeSceneId) return;
    const scene = document.scenes.find((s) => s.id === activeSceneId);
    if (!scene) return;
    adapter.setDesignSize(document.canvas.width, document.canvas.height);
    void adapter.loadScene(scene).then(() => {
      adapter.fitToViewport(containerRef.current?.clientWidth, containerRef.current?.clientHeight);
      adapter.selectElements(useDesignerStore.getState().selectedElementIds);
    });
    // `assets` is included so that an image element added just before its own asset finishes
    // uploading (still resolving to a placeholder at that instant) re-resolves to the real photo
    // the moment the assets list query refetches, without requiring another unrelated edit.
  }, [document, activeSceneId, assets]);

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

  const canvasPxWidth = (document?.canvas.width ?? 0) * zoom;
  const canvasPxHeight = (document?.canvas.height ?? 0) * zoom;

  return (
    <div ref={containerRef} className="relative flex h-full w-full items-center justify-center overflow-hidden bg-gray-100 dark:bg-gray-950">
      <div className="relative" style={{ width: canvasPxWidth, height: canvasPxHeight }}>
        <div ref={canvasHostRef} />
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
