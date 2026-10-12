'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/stores/auth';

/**
 * Client-side gate for pages that need a session. The API enforces auth
 * regardless; this just avoids rendering a page full of 401s.
 * Returns true once the session is known to be valid.
 */
export function useRequireAuth() {
  const status = useAuth((s) => s.status);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    if (status !== 'anonymous') return;
    const here = search ? `${pathname}?${search}` : pathname;
    router.replace(`/login?next=${encodeURIComponent(here)}`);
  }, [status, pathname, search, router]);

  return status === 'authenticated';
}
