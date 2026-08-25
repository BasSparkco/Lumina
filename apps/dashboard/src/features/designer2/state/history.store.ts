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
  const loadDocument = useDesignerStore((s) => s.loadDocument);

  return useEditorHistory(
    document?.id ?? null,
    () => document,
    (snapshot) => {
      if (snapshot) loadDocument(snapshot);
    },
  );
}
