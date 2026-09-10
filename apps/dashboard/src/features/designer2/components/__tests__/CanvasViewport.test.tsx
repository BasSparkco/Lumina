import { act, cleanup, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlankDesignDocument } from '@lumina/design-schema';
import { CanvasViewport } from '../CanvasViewport';
import { useDesignerStore } from '../../state/designer.store';
import { createShapeElement } from '../../lib/defaultElements';

const mock = vi.hoisted(() => ({
  assets: [],
  callbacks: null as null | { onElementModified: (id: string, patch: { x: number }) => void },
  initialize: vi.fn(), clear: vi.fn(), syncScene: vi.fn(async () => true),
  fitToViewport: vi.fn(), resizeViewport: vi.fn(), selectElements: vi.fn(),
  setDesignSize: vi.fn(), setZoom: vi.fn(), dispose: vi.fn(),
  playSceneEnterAnimations: vi.fn(), setPanModeActive: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mock.assets }) }));
vi.mock('@/components/ContextMenu', () => ({ ContextMenu: () => null }));
vi.mock('@/hooks/useConfirmBeforeDelete', () => ({ useConfirmBeforeDelete: () => ({ confirmDelete: () => true }) }));
vi.mock('../../canvas/FabricCanvasAdapter', () => ({
  FabricCanvasAdapter: class {
    constructor(_canvas: unknown, _stack: unknown, callbacks: typeof mock.callbacks) {
      mock.initialize();
      mock.callbacks = callbacks;
      Object.assign(this, mock);
    }
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  useDesignerStore.getState().loadDocument(buildBlankDesignDocument('Test'));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount() {
  const commit = vi.fn((mutator: () => void) => mutator());
  render(<CanvasViewport commit={commit} onAdapterReady={() => {}} onResetViewReady={() => {}} panToolActive={false} />);
  return commit;
}

describe('persistent viewport synchronization', () => {
  it('initializes the replacement adapter after Strict Mode cleanup', async () => {
    render(<StrictMode><CanvasViewport commit={(mutator) => mutator()} onAdapterReady={() => {}} onResetViewReady={() => {}} panToolActive={false} /></StrictMode>);
    await waitFor(() => expect(mock.syncScene).toHaveBeenCalledTimes(2));
    expect(mock.initialize).toHaveBeenCalledTimes(2);
    expect(mock.dispose).toHaveBeenCalledTimes(1);
    expect(mock.clear).toHaveBeenCalledTimes(2);
    expect(mock.fitToViewport).toHaveBeenCalledTimes(2);
    await act(async () => { useDesignerStore.getState().renameDocument('Still editing'); });
    expect(mock.syncScene).toHaveBeenCalledTimes(2);
  });

  it('does not reconstruct or refit for a transform commit, selection or document rename', async () => {
    const state = useDesignerStore.getState();
    const element = createShapeElement('rectangle', state.document!.canvas, []);
    state.addElement(element);
    const commit = mount();
    await waitFor(() => expect(mock.syncScene).toHaveBeenCalledTimes(1));
    await act(async () => { mock.callbacks!.onElementModified(element.id, { x: 50 }); });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(mock.syncScene).toHaveBeenCalledTimes(2);
    expect(mock.initialize).toHaveBeenCalledTimes(1);
    expect(mock.clear).toHaveBeenCalledTimes(1);
    expect(mock.fitToViewport).toHaveBeenCalledTimes(1);
    await act(async () => {
      useDesignerStore.getState().renameDocument('New name');
      useDesignerStore.getState().setSelection([element.id]);
    });
    expect(mock.syncScene).toHaveBeenCalledTimes(2);
    expect(mock.selectElements).toHaveBeenLastCalledWith([element.id]);
  });

  it('synchronizes top-bar zoom without loading a scene and clears only on scene identity change', async () => {
    mount();
    await waitFor(() => expect(mock.syncScene).toHaveBeenCalledTimes(1));
    await act(async () => { useDesignerStore.getState().setZoom(0.75); });
    expect(mock.setZoom).toHaveBeenLastCalledWith(0.75);
    expect(mock.syncScene).toHaveBeenCalledTimes(1);
    await act(async () => {
      const scene = useDesignerStore.getState().document!.scenes[0]!;
      useDesignerStore.getState().addScene({ ...scene, id: 'second' });
    });
    expect(mock.syncScene).toHaveBeenCalledTimes(2);
    expect(mock.clear).toHaveBeenCalledTimes(2);
    expect(mock.initialize).toHaveBeenCalledTimes(1);
    expect(mock.fitToViewport).toHaveBeenCalledTimes(1);
  });

  // M6 — restoreSnapshot (undo/redo, VersionsPanel restore) must not force a scene switch when the
  // restored document still has the currently-active scene; only loadDocument (a genuine fresh
  // load) resets to scene 0. This is what stops an undo on a non-first scene from fully
  // reconstructing the canvas (adapter.clear() + rebuild + restarted scene-enter animations) purely
  // because the old `loadDocument`-based restore unconditionally reset activeSceneId.
  it('restoreSnapshot does not reconstruct the canvas when the restored document keeps the active scene', async () => {
    const state = useDesignerStore.getState();
    const scene1 = state.document!.scenes[0]!;
    state.addScene({ ...scene1, id: 'scene_2', elements: [] });
    state.setActiveScene('scene_2');
    mount();
    await waitFor(() => expect(mock.syncScene).toHaveBeenCalledTimes(1));
    const clearCalls = mock.clear.mock.calls.length;
    const syncCalls = mock.syncScene.mock.calls.length;

    await act(async () => {
      const doc = useDesignerStore.getState().document!;
      const restoredElement = createShapeElement('rectangle', doc.canvas, []);
      // A realistic undo/redo restore: the active scene's *content* changed (an element was
      // added/removed by the undone edit), producing a new scene object at the same id — not a
      // no-op restore.
      useDesignerStore.getState().restoreSnapshot({
        ...doc,
        scenes: doc.scenes.map((s) => s.id === 'scene_2' ? { ...s, elements: [restoredElement] } : s),
      });
    });

    expect(useDesignerStore.getState().activeSceneId).toBe('scene_2');
    expect(mock.clear).toHaveBeenCalledTimes(clearCalls); // no extra clear — same scene
    expect(mock.syncScene.mock.calls.length).toBeGreaterThan(syncCalls); // content still reconciled
  });

  it('restoreSnapshot does reconstruct when the restored document no longer has the active scene', async () => {
    const state = useDesignerStore.getState();
    const scene1 = state.document!.scenes[0]!;
    state.addScene({ ...scene1, id: 'scene_2', elements: [] });
    state.setActiveScene('scene_2');
    mount();
    await waitFor(() => expect(mock.syncScene).toHaveBeenCalledTimes(1));
    const clearCalls = mock.clear.mock.calls.length;

    await act(async () => {
      const doc = useDesignerStore.getState().document!;
      // scene_2 no longer present — restoreSnapshot's own fallback lands on scenes[0], which is a
      // genuine scene-identity change CanvasViewport must still treat as one.
      useDesignerStore.getState().restoreSnapshot({ ...doc, scenes: [doc.scenes[0]!] });
    });

    expect(useDesignerStore.getState().activeSceneId).toBe(scene1.id);
    expect(mock.clear.mock.calls.length).toBeGreaterThan(clearCalls);
  });
});
