import { useEditorHistory } from '@/hooks/useEditorHistory';
import { useDesignerStore } from './designer.store';

// Reuses the same snapshot-based undo/redo the Layout and Theme editors already rely on
// (apps/dashboard/src/hooks/useEditorHistory.ts) rather than forking a new algorithm — adapted
// here to snapshot the designer2 Zustand store's `document` instead of local component state.
// useEditorHistory already binds its own global Ctrl/Cmd+Z / Shift+Ctrl/Cmd+Z listener, so
// useHotkeys.ts must not bind a second, competing one for the same combo.
//
// Phase 1 scope: wiring only. Undo/redo of "load empty document" is a no-op in practice — real
// history content starts mattering once Phase 2 allows element mutations.
export function useDesignerHistory() {
  const document = useDesignerStore((s) => s.document);
  const restoreSnapshot = useDesignerStore((s) => s.restoreSnapshot);

  // designer_modernization_plan.md M6 — undo/redo restore through `restoreSnapshot`, not
  // `loadDocument` (see designer.store.ts's comment on that action): preserves the active
  // scene/selection instead of forcing every undo back to scene 0.
  const base = useEditorHistory<typeof document>(
    document?.id ?? null,
    () => document,
    (snapshot) => {
      if (snapshot) restoreSnapshot(snapshot);
    },
  );

  // M6 — no-op suppression. `base.commit`'s own `getSnapshot`/`captureForHistory` reads the
  // Zustand-*selected* `document` above, which — like any React state — is only current as of
  // this render; reading it again synchronously right after `mutator()` runs would return that
  // same pre-mutation value (this is exactly the bug a prior session shipped and reverted, see
  // useEditorHistory.ts's own comment). `useDesignerStore.getState()` is different: a live
  // imperative accessor into the store's actual current state, unaffected by React's render
  // timing, so calling it immediately after `mutator()` returns the true post-mutation value.
  // Every designer2 store mutation that actually changes something produces a new `document`
  // object reference (the store's own immutable-update convention throughout designer.store.ts);
  // a mutator that changes nothing (e.g. `pasteClipboard()` with an empty clipboard, which already
  // returns early without calling `set`) leaves the reference identical, so reference equality is
  // a correct, cheap "did nothing happen" signal here.
  function commit(mutator: () => void) {
    const before = useDesignerStore.getState().document;
    base.captureForHistory();
    mutator();
    const after = useDesignerStore.getState().document;
    if (after === before) base.discardCaptured();
    else base.commitCaptured();
  }

  return { ...base, commit };
}
