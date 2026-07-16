'use client';
import { useCallback, useState } from 'react';

export type DateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY';
const STORAGE_KEY = 'lumina_date_format';
const DEFAULT_FORMAT: DateFormat = 'DD/MM/YYYY';

export function useDateFormat() {
  // Lazy initializer — see useSidebarCollapsed for why this matters.
  const [format, setFormatState] = useState<DateFormat>(() => {
    if (typeof window === 'undefined') return DEFAULT_FORMAT;
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'MM/DD/YYYY' || stored === 'DD/MM/YYYY' ? stored : DEFAULT_FORMAT;
  });

  const setFormat = useCallback((f: DateFormat) => {
    setFormatState(f);
    localStorage.setItem(STORAGE_KEY, f);
  }, []);

  return { format, setFormat };
}

/** Formats a date+time using the given date-part order; the time part stays locale-driven
 * (unrelated to this setting — see useTimeFormat for 12h/24h). */
export function formatDateTime(input: string | number | Date, format: DateFormat): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const datePart = format === 'DD/MM/YYYY' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
  return `${datePart}, ${d.toLocaleTimeString()}`;
}
