'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

// Module-level, not a top-level `new QueryClient()` — that would be shared across every user's
// SSR render pass on the server (a real Next.js App Router pitfall for 'use client' components).
// This is only ever populated/cleared client-side (see the effect below), mirroring how
// getToken()/setToken() in lib/api.ts already work as plain module functions backed by an
// external store. Lets lib/api.ts's req() and useScreenSocket's auth-invalidated handler clear
// the cache from outside React on session invalidation — see
// docs/adr/tenant-isolation-and-shared-content.md §Dashboard identity and cache boundary.
let activeQueryClient: QueryClient | null = null;
export function getActiveQueryClient() {
  return activeQueryClient;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: 1 },
      // Fallback for the large majority of useMutation calls across the app that define no
      // onError of their own — a failed save/delete/reorder previously just resolved into the
      // void with no visible feedback at all. React Query merges these defaults with each
      // hook's own options rather than composing both, so a mutation with its own onError (e.g.
      // one that sets local error state next to a form) overrides this and isn't double-toasted.
      mutations: {
        onError: (error: unknown) => {
          toast.error(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
        },
      },
    },
  }));

  useEffect(() => {
    activeQueryClient = client;
    return () => {
      activeQueryClient = null;
    };
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
