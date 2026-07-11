'use client';
import { useCallback, useState } from 'react';

export type TimeFormat = '24h' | '12h';
const STORAGE_KEY = 'lumina_time_format';

export function useTimeFormat() {
  // Lazy initializer — see useSidebarCollapsed for why this matters.
  const [format, setFormatState] = useState<TimeFormat>(() => {
    if (typeof window === 'undefined') return '24h';
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === '12h' || stored === '24h' ? stored : '24h';
  });

  const setFormat = useCallback((f: TimeFormat) => {
    setFormatState(f);
    localStorage.setItem(STORAGE_KEY, f);
  }, []);

  return { format, setFormat };
}

/** Converts a "HH:MM" 24-hour string to the given display format. */
export function formatTime(hhmm: string, format: TimeFormat): string {
  if (format === '24h') return hhmm;
  const [hStr, m] = hhmm.split(':');
  let h = parseInt(hStr ?? '0', 10);
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${period}`;
}
