'use client';
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'lumina_confirm_before_delete';

export function useConfirmBeforeDelete() {
  // Lazy initializer — see useSidebarCollapsed for why this matters (this hook's
  // consumers live inside the [locale]-scoped tree, which remounts on locale switch).
  const [enabled, setEnabledState] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  });

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    localStorage.setItem(STORAGE_KEY, String(v));
  }, []);

  const confirmDelete = useCallback((message: string) => (!enabled ? true : window.confirm(message)), [enabled]);

  return { enabled, setEnabled, confirmDelete };
}
