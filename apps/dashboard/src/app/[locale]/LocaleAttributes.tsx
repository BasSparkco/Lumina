'use client';
import { useEffect } from 'react';

/** Keeps <html lang>/<dir> in sync with the current locale, imperatively — since
 * <html> itself is now rendered once in the non-locale-scoped root layout (see
 * app/layout.tsx) and must never remount just because the locale segment changed. */
export function LocaleAttributes({ locale, dir }: { locale: string; dir: 'ltr' | 'rtl' }) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir;
  }, [locale, dir]);

  return null;
}
