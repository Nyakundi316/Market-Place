import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { Request, Response } from 'express';

export const REFRESH_COOKIE = 'mh_rt';
export const CSRF_COOKIE = 'mh_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/**
 * Refresh token: httpOnly so JS can't read it. CSRF token: readable so the
 * web app can echo it in a header — the double-submit pattern (§9). Both are
 * SameSite=Strict; the web app reaches the API through a same-origin proxy.
 */
export function setSessionCookies(
  res: Response,
  refreshToken: string,
  maxAgeSec: number,
  secure: boolean,
) {
  const base = { sameSite: 'strict' as const, secure, path: '/', maxAge: maxAgeSec * 1000 };
  res.cookie(REFRESH_COOKIE, refreshToken, { ...base, httpOnly: true });
  res.cookie(CSRF_COOKIE, randomBytes(24).toString('base64url'), { ...base, httpOnly: false });
}

export function clearSessionCookies(res: Response, secure: boolean) {
  const base = { sameSite: 'strict' as const, secure, path: '/' };
  res.clearCookie(REFRESH_COOKIE, { ...base, httpOnly: true });
  res.clearCookie(CSRF_COOKIE, base);
}

export function assertCsrf(req: Request) {
  const cookie: unknown = req.cookies?.[CSRF_COOKIE];
  const header = req.header(CSRF_HEADER);
  const ok =
    typeof cookie === 'string' &&
    typeof header === 'string' &&
    cookie.length === header.length &&
    timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
  if (!ok) throw new ForbiddenException('CSRF token missing or invalid');
}

export const readRefreshCookie = (req: Request): string | undefined => {
  const value: unknown = req.cookies?.[REFRESH_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};
