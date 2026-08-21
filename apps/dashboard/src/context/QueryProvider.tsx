'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

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
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
