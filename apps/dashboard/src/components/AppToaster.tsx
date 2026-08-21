'use client';
import { Toaster } from 'sonner';
import { useTheme } from '@/context/ThemeContext';

// Split out from layout.tsx so it can read the app's own dark-mode state (localStorage/class
// toggle, not just OS preference) via useTheme() — sonner's Toaster needs to be inside
// ThemeProvider for that.
export function AppToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} richColors position="top-center" />;
}
