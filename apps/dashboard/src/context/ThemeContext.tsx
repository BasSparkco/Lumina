'use client';
import { createContext, useCallback, useContext, useLayoutEffect, useEffect, useMemo, useState, type ReactNode } from 'react';

// useLayoutEffect warns "does nothing on the server" when it's part of a component Next
// server-renders (true here, even though this file is 'use client' — SSR still renders client
// components for the initial HTML). Falling back to useEffect during SSR is a no-op there
// either way, so this just silences the warning without changing client behavior.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'lumina_theme';

interface ThemeCtx {
  theme: Theme;
  toggleTheme: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

// Runs before React hydrates so the correct theme class is on <html> from the
// very first paint — otherwise there'd be a flash of the wrong theme.
export const themeInitScript = `
(function () {
  try {
    var t = localStorage.getItem('${STORAGE_KEY}');
    if (!t) t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Starts at the server's deterministic default so the client's first render matches the
  // server-rendered HTML exactly (a lazy initializer reading `document` here — the previous
  // approach — returns 'light' on the server but the real persisted value on the client's first
  // render, which is a hydration mismatch for anything downstream that reads `theme`, not just
  // <html>'s class). themeInitScript above has already set the correct class on <html>
  // synchronously before hydration, so the *visual* background/etc. are right from first paint
  // regardless of this value; the layout effect below corrects the state itself before the
  // browser paints, so nothing that reads `theme` from this context flashes the wrong value
  // either — including on a remount (e.g. ThemeProvider living somewhere that re-executes on a
  // param change), since useLayoutEffect runs before paint every time, not just on the true
  // first mount.
  const [theme, setTheme] = useState<Theme>('light');

  useIsomorphicLayoutEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.toggle('dark', next === 'dark');
      localStorage.setItem(STORAGE_KEY, next);
      return next;
    });
  }, []);

  // Without this, every consumer re-renders whenever ThemeProvider re-renders for any reason
  // (not just an actual theme change) — a fresh object literal here would be a new reference the
  // context Provider treats as a change regardless of whether its contents actually differ.
  const value = useMemo(() => ({ theme, toggleTheme }), [theme, toggleTheme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be inside ThemeProvider');
  return ctx;
}
