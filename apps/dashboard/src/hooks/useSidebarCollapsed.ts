'use client';
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'lumina_sidebar_collapsed';

export function useSidebarCollapsed() {
  // Lazy initializer, not a useEffect correction — this hook is used inside the
  // [locale]-scoped app layout, which remounts on every language switch; reading
  // localStorage synchronously on first render avoids a one-tick flash back to
  // the default (expanded) state each time.
  const [collapsed, setCollapsedState] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true',
  );

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    localStorage.setItem(STORAGE_KEY, String(v));
  }, []);

  return { collapsed, setCollapsed };
}
