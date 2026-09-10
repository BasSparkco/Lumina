import { afterEach, describe, expect, it } from 'vitest';
import { buildBlankDesignDocument, type DesignDocument, type DesignElement } from '@lumina/design-schema';
import { useDesignerStore } from '../designer.store';

function el(id: string): DesignElement {
  return {
    id, name: id, type: 'shape', shape: 'rectangle', x: 0, y: 0, width: 100, height: 100,
    rotation: 0, opacity: 1, visible: true, zIndex: 0, editable: true,
    selectable: true, movable: true, resizable: true, deletable: true,
  };
}

function twoSceneDoc(): DesignDocument {
  const doc = buildBlankDesignDocument('Test');
  doc.scenes[0]!.elements.push(el('a1'), el('a2'));
  doc.scenes.push({
    id: 'scene_2', name: 'Scene 2', durationMs: 10000,
    background: { type: 'color', color: '#000000' }, elements: [el('b1'), el('b2')],
  });
  return doc;
}

afterEach(() => {
  useDesignerStore.setState({ document: null, activeSceneId: null, selectedElementIds: [], clipboard: [] });
});

describe('designer.store — restoreSnapshot (M6)', () => {
  it('preserves the active scene and selection when both still exist in the restored document', () => {
    const doc = twoSceneDoc();
    useDesignerStore.getState().loadDocument(doc);
    useDesignerStore.getState().setActiveScene('scene_2');
    useDesignerStore.getState().setSelection(['b1']);

    // Restoring a variant of the same document (e.g. an undo/redo snapshot) that still has
    // scene_2 and element b1 — both must be preserved, not reset to scene 1 / empty selection.
    const restored = { ...doc, scenes: doc.scenes.map((s) => s.id === 'scene_2' ? { ...s, elements: [el('b1'), el('b2'), el('b3')] } : s) };
    useDesignerStore.getState().restoreSnapshot(restored);

    const state = useDesignerStore.getState();
    expect(state.activeSceneId).toBe('scene_2');
    expect(state.selectedElementIds).toEqual(['b1']);
    expect(state.document).toBe(restored);
  });

  it('falls back to the first scene and drops the selection when the active scene no longer exists', () => {
    const doc = twoSceneDoc();
    useDesignerStore.getState().loadDocument(doc);
    useDesignerStore.getState().setActiveScene('scene_2');
    useDesignerStore.getState().setSelection(['b1']);

    // The restored document no longer has scene_2 (e.g. undone past a scene-add, or the scene was
    // deleted) — must fall back to scene 0, not silently keep pointing at a scene that's gone.
    const restored = { ...doc, scenes: [doc.scenes[0]!] };
    useDesignerStore.getState().restoreSnapshot(restored);

    const state = useDesignerStore.getState();
    expect(state.activeSceneId).toBe(doc.scenes[0]!.id);
    expect(state.selectedElementIds).toEqual([]);
  });

  it('drops only the selected elements that no longer exist on the active scene, keeping the rest', () => {
    const doc = twoSceneDoc();
    useDesignerStore.getState().loadDocument(doc);
    useDesignerStore.getState().setActiveScene('scene_2');
    useDesignerStore.getState().setSelection(['b1', 'b2']);

    // b2 was deleted by the undone/redone edit; b1 remains — selection should narrow to just b1,
    // not reset entirely (a multi-select where only one member was removed keeps the rest).
    const restored = { ...doc, scenes: doc.scenes.map((s) => s.id === 'scene_2' ? { ...s, elements: [el('b1')] } : s) };
    useDesignerStore.getState().restoreSnapshot(restored);

    expect(useDesignerStore.getState().selectedElementIds).toEqual(['b1']);
  });

  it('unlike restoreSnapshot, loadDocument always resets to the first scene and clears selection', () => {
    const doc = twoSceneDoc();
    useDesignerStore.getState().loadDocument(doc);
    useDesignerStore.getState().setActiveScene('scene_2');
    useDesignerStore.getState().setSelection(['b1']);

    useDesignerStore.getState().loadDocument(doc);

    const state = useDesignerStore.getState();
    expect(state.activeSceneId).toBe(doc.scenes[0]!.id);
    expect(state.selectedElementIds).toEqual([]);
  });
});
