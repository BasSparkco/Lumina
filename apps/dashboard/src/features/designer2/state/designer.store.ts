import { create } from 'zustand';
import type { DesignDocument, DesignElement } from '@lumina/design-schema';
import { bringToFront, nextLayerZIndex, reindexLayers, sendToBack } from '@/lib/layers';

interface DesignerState {
  document: DesignDocument | null;
  activeSceneId: string | null;
  selectedElementIds: string[];
  zoom: number;
  clipboard: DesignElement[];

  loadDocument: (doc: DesignDocument) => void;
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
  setZoom: (zoom: number) => void;
  setActiveScene: (sceneId: string) => void;

  addElement: (element: DesignElement) => void;
  updateElement: (id: string, patch: Partial<DesignElement>) => void;
  removeElements: (ids: string[]) => void;
  duplicateElements: (ids: string[]) => void;
  reorderElement: (id: string, direction: 'front' | 'back' | 'forward' | 'backward') => void;
  reorderAll: (orderedIdsFrontToBack: string[]) => void;
  copySelection: () => void;
  pasteClipboard: () => void;
}

// Applies `updater` to the active scene's element list, returning a new document (new scene
// array, new scene object) so React/Zustand consumers see a changed reference — CanvasViewport's
// effect (keyed on [document, activeSceneId]) relies on this to know when to re-render the canvas.
function withActiveSceneElements(
  document: DesignDocument,
  activeSceneId: string | null,
  updater: (elements: DesignElement[]) => DesignElement[],
): DesignDocument {
  return {
    ...document,
    scenes: document.scenes.map((scene) =>
      scene.id === activeSceneId ? { ...scene, elements: updater(scene.elements) } : scene,
    ),
  };
}

function cloneWithNewId(element: DesignElement, offset: number): DesignElement {
  return { ...element, id: `el_${crypto.randomUUID()}`, x: element.x + offset, y: element.y + offset };
}

// Module-level store (no Provider) — Phase 1 never mounts more than one designer2 instance at
// once, so per-instance isolation isn't needed yet. Revisit if that changes.
export const useDesignerStore = create<DesignerState>((set, get) => ({
  document: null,
  activeSceneId: null,
  selectedElementIds: [],
  zoom: 1,
  clipboard: [],

  loadDocument: (doc) => set({ document: doc, activeSceneId: doc.scenes[0]?.id ?? null, selectedElementIds: [] }),
  setSelection: (ids) => set({ selectedElementIds: ids }),
  clearSelection: () => set({ selectedElementIds: [] }),
  setZoom: (zoom) => set({ zoom }),
  setActiveScene: (sceneId) => set({ activeSceneId: sceneId, selectedElementIds: [] }),

  addElement: (element) => {
    const { document, activeSceneId } = get();
    if (!document) return;
    set({
      document: withActiveSceneElements(document, activeSceneId, (elements) => [...elements, element]),
      selectedElementIds: [element.id],
    });
  },

  updateElement: (id, patch) => {
    const { document, activeSceneId } = get();
    if (!document) return;
    set({
      document: withActiveSceneElements(document, activeSceneId, (elements) =>
        elements.map((el) => (el.id === id ? ({ ...el, ...patch } as DesignElement) : el)),
      ),
    });
  },

  removeElements: (ids) => {
    const { document, activeSceneId } = get();
    if (!document) return;
    const scene = document.scenes.find((s) => s.id === activeSceneId);
    if (!scene) return;
    // Enforced here, not just in the UI — designer.md §7's "backend must still validate" applied
    // at the state layer: an element with deletable:false cannot be removed even if some caller
    // tries to, e.g. a stale keyboard shortcut fired before the UI re-disabled itself.
    const deletableIds = new Set(scene.elements.filter((el) => el.deletable).map((el) => el.id));
    const idSet = new Set(ids.filter((id) => deletableIds.has(id)));
    if (idSet.size === 0) return;
    set({
      document: withActiveSceneElements(document, activeSceneId, (elements) => elements.filter((el) => !idSet.has(el.id))),
      selectedElementIds: get().selectedElementIds.filter((id) => !idSet.has(id)),
    });
  },

  duplicateElements: (ids) => {
    const { document, activeSceneId } = get();
    if (!document) return;
    const scene = document.scenes.find((s) => s.id === activeSceneId);
    if (!scene) return;
    const idSet = new Set(ids);
    const toDuplicate = scene.elements.filter((el) => idSet.has(el.id));
    if (toDuplicate.length === 0) return;
    let runningElements = scene.elements;
    const clones = toDuplicate.map((el) => {
      const clone = { ...cloneWithNewId(el, 20), zIndex: nextLayerZIndex(runningElements) } as DesignElement;
      runningElements = [...runningElements, clone];
      return clone;
    });
    set({
      document: withActiveSceneElements(document, activeSceneId, (elements) => [...elements, ...clones]),
      selectedElementIds: clones.map((c) => c.id),
    });
  },

  reorderElement: (id, direction) => {
    const { document, activeSceneId } = get();
    if (!document) return;
    const scene = document.scenes.find((s) => s.id === activeSceneId);
    if (!scene) return;

    if (direction === 'front' || direction === 'back') {
      const compute = direction === 'front' ? bringToFront : sendToBack;
      set({
        document: withActiveSceneElements(document, activeSceneId, (elements) =>
          elements.map((el) => (el.id === id ? { ...el, zIndex: compute(elements, el.zIndex) } : el)),
        ),
      });
      return;
    }

    // forward/backward: swap zIndex with the adjacent element in ascending z-order.
    const ascending = [...scene.elements].sort((a, b) => a.zIndex - b.zIndex);
    const idx = ascending.findIndex((el) => el.id === id);
    const neighborIdx = direction === 'forward' ? idx + 1 : idx - 1;
    if (idx < 0 || neighborIdx < 0 || neighborIdx >= ascending.length) return;
    const current = ascending[idx]!;
    const neighbor = ascending[neighborIdx]!;
    set({
      document: withActiveSceneElements(document, activeSceneId, (elements) =>
        elements.map((el) => {
          if (el.id === current.id) return { ...el, zIndex: neighbor.zIndex };
          if (el.id === neighbor.id) return { ...el, zIndex: current.zIndex };
          return el;
        }),
      ),
    });
  },

  reorderAll: (orderedIdsFrontToBack) => {
    const { document, activeSceneId } = get();
    if (!document) return;
    set({
      document: withActiveSceneElements(document, activeSceneId, (elements) => {
        const byId = new Map(elements.map((el) => [el.id, el]));
        const ordered = orderedIdsFrontToBack.map((id) => byId.get(id)).filter((el): el is DesignElement => Boolean(el));
        const reindexed = reindexLayers(ordered, (el, zIndex) => ({ ...el, zIndex }));
        const reindexedById = new Map(reindexed.map((el) => [el.id, el]));
        return elements.map((el) => reindexedById.get(el.id) ?? el);
      }),
    });
  },

  copySelection: () => {
    const { document, activeSceneId, selectedElementIds } = get();
    if (!document) return;
    const scene = document.scenes.find((s) => s.id === activeSceneId);
    if (!scene) return;
    const idSet = new Set(selectedElementIds);
    const toCopy = scene.elements.filter((el) => idSet.has(el.id));
    if (toCopy.length > 0) set({ clipboard: toCopy });
  },

  pasteClipboard: () => {
    const { document, activeSceneId, clipboard } = get();
    if (!document || clipboard.length === 0) return;
    const scene = document.scenes.find((s) => s.id === activeSceneId);
    if (!scene) return;
    let runningElements = scene.elements;
    const pasted = clipboard.map((el) => {
      const clone = { ...cloneWithNewId(el, 20), zIndex: nextLayerZIndex(runningElements) } as DesignElement;
      runningElements = [...runningElements, clone];
      return clone;
    });
    set({
      document: withActiveSceneElements(document, activeSceneId, (elements) => [...elements, ...pasted]),
      selectedElementIds: pasted.map((p) => p.id),
    });
  },
}));
