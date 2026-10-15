/** Next.js server start hook: Sentry for server-rendered pages, when configured. */
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || process.env.NEXT_RUNTIME !== 'nodejs') return;
  const [Sentry, { sentryOptions }] = await Promise.all([
    import('@sentry/nextjs'),
    import('./lib/sentry'),
  ]);
  Sentry.init(sentryOptions(dsn));
}
