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
});
