'use client';

import type { OAuthProvider } from '@markethub/shared';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const LABEL: Record<OAuthProvider, string> = { google: 'Google', github: 'GitHub' };

function ProviderMark({ provider }: { provider: OAuthProvider }) {
  return provider === 'google' ? (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.3 12 2.3 6.6 2.3 2.3 6.6 2.3 12s4.3 9.7 9.7 9.7c5.6 0 9.3-3.9 9.3-9.5 0-.6-.1-1.1-.2-1.6H12z"
      />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="currentColor"
        d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.5 2.4 1.1 2.9.8.1-.7.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.3 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z"
      />
    </svg>
  );
}

/** Renders nothing until we know which providers the API has enabled — no dead buttons. */
export function OAuthButtons({ verb }: { verb: 'Continue' | 'Sign up' }) {
  const { data } = useQuery({
    queryKey: ['oauth-providers'],
    queryFn: () => api<{ providers: OAuthProvider[] }>('/auth/oauth', { retryOn401: false }),
    staleTime: Infinity,
  });
  if (!data?.providers.length) return null;

  return (
    <div className="space-y-4">
      <div className={cn('grid gap-2', data.providers.length > 1 && 'sm:grid-cols-2')}>
        {data.providers.map((p) => (
          <Button key={p} asChild variant="outline" className="gap-2 bg-card">
            {/* full navigation, not fetch: the provider round-trip needs real redirects */}
            <a href={`/api/auth/oauth/${p}`}>
              <ProviderMark provider={p} /> {verb} with {LABEL[p]}
            </a>
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" /> or with email{' '}
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
