'use client';

import { LoaderCircle } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef } from 'react';
import { refreshSession } from '@/lib/api';
import { safeNext } from '@/lib/redirect';

/**
 * Landing spot after Google/GitHub. The API already set the refresh cookie;
 * trade it for an access token, then continue to `next`.
 */
function Callback() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void refreshSession().then((ok) => router.replace(ok ? next : '/login?error=oauth_failed'));
  }, [next, router]);

  return (
    <main className="grid min-h-dvh place-items-center">
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <LoaderCircle className="size-4 animate-spin" /> Signing you in…
      </p>
    </main>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense>
      <Callback />
    </Suspense>
  );
}
