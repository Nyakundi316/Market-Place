'use client';

import { useEffect } from 'react';

/** Browser-side Sentry, loaded only when NEXT_PUBLIC_SENTRY_DSN was set at build. */
export function SentryClient() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn) return;
    void Promise.all([import('@sentry/nextjs'), import('@/lib/sentry')]).then(
      ([Sentry, { sentryOptions }]) => Sentry.init(sentryOptions(dsn)),
    );
  }, []);
  return null;
}
