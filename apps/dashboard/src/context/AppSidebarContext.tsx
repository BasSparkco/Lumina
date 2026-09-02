'use client';
import { createContext, useContext, type ReactNode } from 'react';

interface AppSidebarCtx {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const Ctx = createContext<AppSidebarCtx | null>(null);

// Bridges AppShell's (apps/dashboard/src/app/[locale]/(app)/layout.tsx) mobile-drawer state down
// to deeply nested page content — designer2's DesignerTopBar in particular, which renders its own
// hamburger trigger for the app-level nav sidebar instead of AppShell's floating one. A context
// rather than prop drilling: AppShell can't pass props through Next's opaque `{children}` to an
// arbitrary page tree several layers down.
export function AppSidebarProvider({ open, setOpen, children }: AppSidebarCtx & { children: ReactNode }) {
  return <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>;
}

// Returns null outside AppShell (there's currently no such place, but callers should treat it as
// optional rather than assume the provider is always mounted).
export function useAppSidebar() {
  return useContext(Ctx);
}
