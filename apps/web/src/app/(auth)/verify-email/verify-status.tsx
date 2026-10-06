'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/stores/auth';

type State = { kind: 'working' } | { kind: 'done' } | { kind: 'failed'; message: string };

export function VerifyStatus() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<State>(
    token ? { kind: 'working' } : { kind: 'failed', message: 'This link is incomplete.' },
  );
  const signedIn = useAuth((s) => s.status === 'authenticated');
  const queryClient = useQueryClient();
  const ran = useRef(false); // links are single-use; StrictMode's double effect must not spend it twice

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    api('/auth/verify-email', { method: 'POST', body: { token }, retryOn401: false })
      .then(() => {
        setState({ kind: 'done' });
        void queryClient.invalidateQueries({ queryKey: ['me'] });
      })
      .catch((err: unknown) =>
        setState({
          kind: 'failed',
          message: err instanceof ApiError ? err.message : 'Network problem — reload to try again.',
        }),
      );
  }, [token, queryClient]);

  if (state.kind === 'working') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin" /> Confirming your email…
      </p>
    );
  }

  const ok = state.kind === 'done';
  const Icon = ok ? CircleCheck : CircleX;
  return (
    <div className="animate-rise-in">
      <Icon
        className={ok ? 'size-10 text-primary' : 'size-10 text-destructive'}
        strokeWidth={1.5}
      />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {ok ? 'Email confirmed' : "We couldn't confirm that link"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {ok
          ? 'You can now post listings and pay through escrow.'
          : `${state.message} Links work once and expire after 24 hours.`}
      </p>
      <Button asChild className="mt-8">
        <Link href={signedIn ? '/feed' : '/login'}>{signedIn ? 'Start exploring' : 'Log in'}</Link>
      </Button>
    </div>
  );
}
