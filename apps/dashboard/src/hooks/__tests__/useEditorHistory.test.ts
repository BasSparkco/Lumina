import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useEditorHistory } from '../useEditorHistory';

describe('useEditorHistory — cap and discardCaptured (M6)', () => {
  function useCounter(options?: { maxHistory?: number }) {
    const [value, setValue] = useState(0);
    const history = useEditorHistory<number>('session', () => value, setValue, options);
    return { value, set: setValue, ...history };
  }

  it('caps past at the default of 100 entries, dropping the oldest beyond the cap', () => {
    const { result } = renderHook(() => useCounter());
    for (let i = 1; i <= 105; i++) {
      act(() => result.current.commit(() => result.current.set(i)));
    }
    // 105 commits made; each captures the value *before* that commit, so `past` holds
    // [0,1,...,104] before capping and [5,6,...,104] after (the oldest 5 entries dropped).
    // Undoing 100 times consumes all of them, landing on the oldest surviving entry, 5.
    for (let i = 0; i < 100; i++) act(() => result.current.undo());
    expect(result.current.value).toBe(5);
    expect(result.current.canUndo).toBe(false);
  });

  it('caps past at a custom maxHistory', () => {
    const { result } = renderHook(() => useCounter({ maxHistory: 3 }));
    for (let i = 1; i <= 5; i++) {
      act(() => result.current.commit(() => result.current.set(i)));
    }
    // Only the last 3 commits are undoable — undoing 3 times lands on the value the 3rd-to-last
    // commit replaced (value 2, since commits pushed 1,2,3,4,5 and only 3,4,5's "before" states —
    // 2,3,4 — survive the cap), and a 4th undo is a no-op.
    act(() => result.current.undo());
    act(() => result.current.undo());
    act(() => result.current.undo());
    expect(result.current.value).toBe(2);
    expect(result.current.canUndo).toBe(false);
  });

  it('discardCaptured drops a pending capture without pushing it to history', () => {
    const { result } = renderHook(() => useEditorHistory<number>('session', () => 0, () => {}));
    act(() => result.current.captureForHistory());
    act(() => result.current.discardCaptured());
    // commitCaptured immediately after should be a no-op (nothing pending) — canUndo stays false.
    act(() => result.current.commitCaptured());
    expect(result.current.canUndo).toBe(false);
  });

  it('a legacy 3-arg call site (no options) keeps working exactly as before', () => {
    const { result } = renderHook(() => useEditorHistory<number>('session', () => 0, () => {}));
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(typeof result.current.commit).toBe('function');
    expect(typeof result.current.discardCaptured).toBe('function');
  });
});

// M6 — a lightweight smoke test reproducing the exact 3-arg calling shape the legacy Theme/Layout
// editors use (local useState for the editor's own fields, no `options` 4th arg), the pattern
// LayoutsSection.tsx/ThemesSection.tsx actually call (`useEditorHistory<EditorSnapshot>(editing, ()
// => ({name, zones}), (s) => { setName(s.name); setZones(s.zones); })`). Mounting the full,
// heavyweight editor sections themselves would require mocking a large, unrelated surface (assets/
// playlists/mutations); this exercises the actual shared mechanism those editors depend on —
// commit/undo/redo over local component state — without that unrelated setup. Not a substitute for
// full coverage of those editors (out of scope for M6), just the regression net proportionate to
// M6 modifying the one hook they depend on with zero prior coverage.
describe('useEditorHistory — legacy editor calling shape (LayoutsSection/ThemesSection pattern)', () => {
  interface EditorSnapshot { name: string; zones: number[]; }

  function useLegacyStyleEditor() {
    const [editing, setEditing] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [zones, setZones] = useState<number[]>([]);
    const history = useEditorHistory<EditorSnapshot>(
      editing,
      () => ({ name, zones }),
      (s) => { setName(s.name); setZones(s.zones); },
    );
    return { editing, setEditing, name, setName, zones, setZones, ...history };
  }

  it('commit/undo/redo round-trips a name edit exactly like the legacy editors rely on', () => {
    const { result } = renderHook(() => useLegacyStyleEditor());
    act(() => result.current.setEditing('layout_1'));
    act(() => result.current.commit(() => result.current.setName('Original')));
    expect(result.current.name).toBe('Original');

    act(() => result.current.commit(() => result.current.setName('Renamed')));
    expect(result.current.name).toBe('Renamed');
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.name).toBe('Original');
    expect(result.current.canRedo).toBe(true);

    act(() => result.current.redo());
    expect(result.current.name).toBe('Renamed');
  });

  it('captureForHistory/commitCaptured bracket a continuous edit into one undo step', () => {
    const { result } = renderHook(() => useLegacyStyleEditor());
    act(() => result.current.setEditing('layout_1'));
    act(() => result.current.commit(() => result.current.setName('Start')));

    act(() => result.current.captureForHistory());
    act(() => result.current.setName('mid-typing-1'));
    act(() => result.current.setName('mid-typing-2'));
    act(() => result.current.setName('Final'));
    act(() => result.current.commitCaptured());

    expect(result.current.name).toBe('Final');
    act(() => result.current.undo());
    expect(result.current.name).toBe('Start'); // one undo step, not three
    expect(result.current.canUndo).toBe(true); // still one more step back to the initial commit ('')
    act(() => result.current.undo());
    expect(result.current.name).toBe('');
  });

  it('switching sessionKey (editing a different layout) resets history, matching pre-M6 behavior', () => {
    const { result } = renderHook(() => useLegacyStyleEditor());
    act(() => result.current.setEditing('layout_1'));
    act(() => result.current.commit(() => result.current.setName('A')));
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.setEditing('layout_2'));
    expect(result.current.canUndo).toBe(false);
  });
});
