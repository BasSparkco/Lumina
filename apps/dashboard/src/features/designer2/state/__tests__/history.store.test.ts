import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { buildBlankDesignDocument } from '@lumina/design-schema';
import { useDesignerStore } from '../designer.store';
import { useDesignerHistory } from '../history.store';

afterEach(() => {
  useDesignerStore.setState({ document: null, activeSceneId: null, selectedElementIds: [], clipboard: [] });
});

describe('history.store — commit no-op suppression (M6)', () => {
  it('does not push history when the mutator changes nothing (e.g. pasteClipboard with an empty clipboard)', () => {
    const doc = buildBlankDesignDocument('Test');
    useDesignerStore.getState().loadDocument(doc);
    const { result } = renderHook(() => useDesignerHistory());

    act(() => result.current.commit(() => useDesignerStore.getState().pasteClipboard()));

    expect(result.current.canUndo).toBe(false);
  });

  it('pushes exactly one history entry for a real mutation', () => {
    const doc = buildBlankDesignDocument('Test');
    useDesignerStore.getState().loadDocument(doc);
    const { result } = renderHook(() => useDesignerHistory());

    act(() => result.current.commit(() => useDesignerStore.getState().renameDocument('Renamed')));

    expect(useDesignerStore.getState().document?.name).toBe('Renamed');
    expect(result.current.canUndo).toBe(true);
  });

  it('undo restores via restoreSnapshot, preserving the active scene rather than resetting it', () => {
    const doc = buildBlankDesignDocument('Test');
    doc.scenes.push({ id: 'scene_2', name: 'Scene 2', durationMs: 10000, background: { type: 'color', color: '#000' }, elements: [] });
    useDesignerStore.getState().loadDocument(doc);
    useDesignerStore.getState().setActiveScene('scene_2');
    const { result } = renderHook(() => useDesignerHistory());

    act(() => result.current.commit(() => useDesignerStore.getState().renameDocument('Renamed')));
    expect(useDesignerStore.getState().activeSceneId).toBe('scene_2');

    act(() => result.current.undo());

    expect(useDesignerStore.getState().document?.name).toBe('Test');
    expect(useDesignerStore.getState().activeSceneId).toBe('scene_2'); // not reset to scene 1
  });
});
