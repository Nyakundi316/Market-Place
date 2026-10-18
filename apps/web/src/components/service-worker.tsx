'use client';

import { useEffect } from 'react';
import { claimPushDevice } from '@/lib/push';
import { useAuth } from '@/stores/auth';

/** Registers /sw.js in production builds only; dev keeps hot reload uncached. */
export function ServiceWorker() {
  const status = useAuth((s) => s.status);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Not fatal: the site works the same without it.
    });
  }, []);

  // Not on 'anonymous': a 5xx on refresh lands there too, and an API blip mustn't
  // unsubscribe everyone. Sign-out forgets the device explicitly (account menu).
  useEffect(() => {
    if (status === 'authenticated') void claimPushDevice();
  }, [status]);

  return null;
}
