'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary: replaces the root layout when it crashes, so it
 * carries its own <html> and plain styles.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
    void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error));
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem 1.5rem', maxWidth: 420 }}>
        <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
        <p style={{ color: '#555', lineHeight: 1.5 }}>
          We&apos;ve been told about it. Try again, and if it keeps happening, come back in a few
          minutes.
        </p>
        {error.digest && <p style={{ color: '#888', fontSize: 12 }}>Reference: {error.digest}</p>}
        <button type="button" onClick={reset} style={{ marginTop: 16, padding: '8px 16px' }}>
          Try again
        </button>
      </body>
    </html>
  );
}
