import type { ApiErrorDto, AuthResponseDto } from '@markethub/shared';
import { useAuth } from '@/stores/auth';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
  }
}

const readCookie = (name: string) =>
  document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);

export const hasSessionCookie = () =>
  typeof document !== 'undefined' && Boolean(readCookie('mh_csrf'));

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) return body as T;
  const err = (body ?? {}) as Partial<ApiErrorDto>;
  throw new ApiError(res.status, err.message ?? res.statusText, err.fields);
}

let inflight: Promise<boolean> | null = null;

/**
 * Refresh tokens are single-use and replaying one revokes the session (§9),
 * so refreshes are serialised: one per tab via `inflight`, one across tabs via
 * a Web Lock. Inside the lock we re-read the cookie, which another tab may
 * have just rotated.
 */
export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    const run = async () => {
      const csrf = readCookie('mh_csrf');
      if (!csrf) return false;
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': decodeURIComponent(csrf) },
      });
      if (!res.ok) return false;
      useAuth.getState().setSession(await parse<AuthResponseDto>(res));
      return true;
    };
    try {
      const ok = navigator.locks ? await navigator.locks.request('mh-refresh', run) : await run();
      if (!ok) useAuth.getState().clear();
      return ok;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

interface Options extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** set false for endpoints that must not trigger a refresh loop */
  retryOn401?: boolean;
}

export async function api<T>(
  path: string,
  { body, retryOn401 = true, headers, ...init }: Options = {},
): Promise<T> {
  const send = () => {
    const token = useAuth.getState().accessToken;
    return fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: {
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };

  let res = await send();
  if (res.status === 401 && retryOn401 && (await refreshSession())) res = await send();
  return parse<T>(res);
}

/** Logout needs the CSRF header like refresh does. */
export async function logout() {
  const csrf = readCookie('mh_csrf');
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {},
  }).catch(() => undefined);
  useAuth.getState().clear();
}
