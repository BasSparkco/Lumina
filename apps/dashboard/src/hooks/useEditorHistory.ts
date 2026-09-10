import { useEffect, useRef, useState } from 'react';

interface HistoryState<T> { past: T[]; future: T[]; }

// Shared undo/redo for the layout and theme editors — scoped to the current edit session
// (reset whenever `sessionKey` changes, e.g. a different item or a new one is opened). Snapshots
// are full copies of the editor's state rather than diffs: simplest correct thing for state this
// small, and both editors fully replace their record on save anyway.
//
// `captureForHistory`/`commitCaptured` bracket a continuous edit (typing in a field, dragging a
// slider) into a single undo step: captured once on focus/mousedown, consumed once on blur/release.
// `commit` wraps a discrete action (add/delete, dropdown pick, drag/resize stop) in one shot.
//
// designer_modernization_plan.md M5 considered adding a no-op suppression here (compare the
// captured "before" snapshot against a fresh `getSnapshot()` call right after `mutator()` runs,
// skip the history push if unchanged) as a safety net behind each caller's own dedup. Deliberately
// NOT done: `getSnapshot` closes over React state (both designer2's Zustand-selected `document`
// and the Theme/Layout editors' local `useState` values) that is only current as of the last
// render — calling it again synchronously right after `mutator()` (before React has re-rendered)
// returns the *same pre-mutation* value, not the actual post-mutation state, so a same-tick
// before/after compare is always trivially "equal" and would silently suppress every real commit,
// not just no-ops (caught by MediaInsertion.test.tsx's undo assertion during M5 development).
// No-op suppression instead lives at each call site that can cheaply know its own before/after
// value without an external re-read — e.g. designer2's useEditSession (dirty-tracking + baseline
// comparison, self-contained in local state) and PropertiesPanel's own inline blur-value checks.
export function useEditorHistory<T>(sessionKey: unknown, getSnapshot: () => T, applySnapshot: (s: T) => void) {
  const [history, setHistory] = useState<HistoryState<T>>({ past: [], future: [] });
  const pendingCaptureRef = useRef<T | null>(null);

  // Resets history when the session changes, without the extra render an effect would cost —
  // the "adjust state during render" pattern React recommends for this exact case. The ref
  // can't join this (refs may not be touched during render), so it's reset in an effect below —
  // same as before, just split from the state reset.
  const [prevSessionKey, setPrevSessionKey] = useState(sessionKey);
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey);
    setHistory({ past: [], future: [] });
  }
  useEffect(() => {
    pendingCaptureRef.current = null;
  }, [sessionKey]);

  function captureForHistory() {
    if (pendingCaptureRef.current === null) pendingCaptureRef.current = getSnapshot();
  }
  function commitCaptured() {
    const captured = pendingCaptureRef.current;
    pendingCaptureRef.current = null;
    if (!captured) return;
    setHistory(h => ({ past: [...h.past, captured], future: [] }));
  }
  function commit(mutator: () => void) {
    captureForHistory();
    mutator();
    commitCaptured();
  }
  function undo() {
    const previous = history.past[history.past.length - 1];
    if (!previous) return;
    setHistory({ past: history.past.slice(0, -1), future: [getSnapshot(), ...history.future] });
    applySnapshot(previous);
  }
  function redo() {
    const next = history.future[0];
    if (!next) return;
    setHistory({ past: [...history.past, getSnapshot()], future: history.future.slice(1) });
    applySnapshot(next);
  }

  // Stable keydown listener (only resubscribes when the session starts/ends) that still always
  // calls the latest undo/redo — avoids either a stale closure or resubscribing on every change.
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  useEffect(() => {
    undoRef.current = undo;
    redoRef.current = redo;
  }, [undo, redo]);

  useEffect(() => {
    if (!sessionKey) return;
    function onKeyDown(e: KeyboardEvent) {
      // Don't fight the browser's own per-field undo while someone's mid-edit of a text input.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoRef.current(); else undoRef.current();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessionKey]);

  return {
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undo, redo, commit, captureForHistory, commitCaptured,
  };
}
