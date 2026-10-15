'use client';

import { useEffect } from 'react';

/** Registers /sw.js in production builds only; dev keeps hot reload uncached. */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      // Not fatal: the site works the same without it.
    });
  }, []);
  return null;
}
