'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

interface EditorDirtyCtx {
  isDirty: boolean;
  setDirty: (dirty: boolean) => void;
  // Runs `proceed` immediately when there's nothing unsaved; otherwise confirms with the user
  // first (via `message`) and only runs it — and clears the flag — if they accept discarding.
  guardNavigation: (message: string, proceed: () => void) => void;
}

const Ctx = createContext<EditorDirtyCtx | null>(null);

export function EditorDirtyProvider({ children }: { children: ReactNode }) {
  const [isDirty, setIsDirty] = useState(false);
  // Read inside the beforeunload/click handlers below without resubscribing them per change.
  const isDirtyRef = useRef(isDirty);
  useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const guardNavigation = useCallback((message: string, proceed: () => void) => {
    if (isDirtyRef.current && !window.confirm(message)) return;
    setIsDirty(false);
    proceed();
  }, []);

  // This wraps every editor page (see AppLayout) — without this, a fresh object literal here
  // re-renders the whole editor subtree whenever EditorDirtyProvider re-renders for any reason,
  // not just an actual isDirty change.
  const value = useMemo(() => ({ isDirty, setDirty: setIsDirty, guardNavigation }), [isDirty, guardNavigation]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEditorDirty() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useEditorDirty must be used within EditorDirtyProvider');
  return ctx;
}
