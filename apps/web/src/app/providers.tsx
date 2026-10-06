'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { ApiError, hasSessionCookie, refreshSession } from '@/lib/api';
import { useAuth } from '@/stores/auth';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // A 4xx won't fix itself on retry; network blips might.
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/** Turns the httpOnly refresh cookie into an in-memory access token on first load. */
function SessionBootstrap() {
  useEffect(() => {
    if (useAuth.getState().status !== 'unknown') return;
    if (hasSessionCookie()) void refreshSession();
    else useAuth.getState().clear();
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionBootstrap />
      {children}
      <Toaster position="top-center" richColors closeButton />
    </QueryClientProvider>
  );
}
