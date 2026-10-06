/** Only same-site paths: rejects absolute URLs, `//evil.com` and the `/\evil.com` browser quirk. */
export function safeNext(next: string | null | undefined, fallback = '/feed'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback;
  }
  return next;
}

/** Where to land after signing in: unfinished profiles go through onboarding first. */
export const afterAuth = (hasProfile: boolean, next: string | null) =>
  hasProfile
    ? safeNext(next)
    : `/onboarding${next ? `?next=${encodeURIComponent(safeNext(next))}` : ''}`;
