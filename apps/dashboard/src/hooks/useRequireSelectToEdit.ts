'use client';
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'lumina_require_select_to_edit';

/** Gates the Themes/Layouts canvas editors: when true (the default), an element/zone must be
 * clicked once to select it before it can be dragged, resized, or rotated — a guard rail against
 * accidentally moving something while just clicking around. Off restores immediate drag/resize,
 * same as before this setting existed. */
export function useRequireSelectToEdit() {
  // Lazy initializer — see useSidebarCollapsed for why this matters.
  const [enabled, setEnabledState] = useState(() => {
    if (typeof window === 'undefined') return true;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  });

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    localStorage.setItem(STORAGE_KEY, String(v));
  }, []);

  return { enabled, setEnabled };
}
