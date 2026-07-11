'use client';
import { useCallback, useState } from 'react';

const STORAGE_KEY = 'lumina_default_item_duration';
const FALLBACK = 10;

export function useDefaultItemDuration() {
  // Lazy initializer — see useSidebarCollapsed for why this matters.
  const [duration, setDurationState] = useState(() => {
    if (typeof window === 'undefined') return FALLBACK;
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    return stored > 0 ? stored : FALLBACK;
  });

  const setDuration = useCallback((v: number) => {
    setDurationState(v);
    localStorage.setItem(STORAGE_KEY, String(v));
  }, []);

  return { duration, setDuration };
}
