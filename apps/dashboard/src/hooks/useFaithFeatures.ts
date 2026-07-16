'use client';
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'lumina_faith_features_enabled';

/** Gates prayer-time UI (the Layouts "Mosque" preset + PRAYER zone type, and the Screens
 * "Configure faith settings" panel) — off by default since most orgs on this worldwide
 * product never touch it, and it only needs to surface for the ones that do. */
export function useFaithFeatures() {
  // Lazy initializer — see useSidebarCollapsed for why this matters.
  const [enabled, setEnabledState] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'true',
  );

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v);
    localStorage.setItem(STORAGE_KEY, String(v));
  }, []);

  return { enabled, setEnabled };
}
