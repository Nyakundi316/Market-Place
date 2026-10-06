import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/stores/auth';
import { api, ApiError, refreshSession } from './api';

const user = {
  id: 'u1',
  email: 'a@b.co',
  role: 'buyer',
  isEmailVerified: true,
  isPhoneVerified: false,
  hasProfile: true,
} as const;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'mh_csrf=csrf123';
  useAuth.setState({ accessToken: 'old', user, status: 'authenticated' });
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'mh_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

const authHeader = (call: unknown[]) => (call[1] as RequestInit).headers as Record<string, string>;

describe('api()', () => {
  it('calls /api with the bearer token and parses JSON', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: 1 }));
    await expect(api('/me')).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/me');
    expect(authHeader(fetchMock.mock.calls[0]!).Authorization).toBe('Bearer old');
  });

  it('on 401: refreshes with the CSRF header, then retries with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'expired' }))
      .mockResolvedValueOnce(json(200, { accessToken: 'new', accessTokenExpiresIn: 900, user }))
      .mockResolvedValueOnce(json(200, { ok: 1 }));

    await expect(api('/me')).resolves.toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/refresh');
    expect(authHeader(fetchMock.mock.calls[1]!)['x-csrf-token']).toBe('csrf123');
    expect(authHeader(fetchMock.mock.calls[2]!).Authorization).toBe('Bearer new');
  });

  it('concurrent 401s share ONE refresh (a second would replay a spent token)', async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url === '/api/auth/refresh')
        return json(200, { accessToken: 'new', accessTokenExpiresIn: 900, user });
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer new' ? json(200, { ok: 1 }) : json(401, {});
    });

    await Promise.all([api('/a'), api('/b'), api('/c')]);
    expect(fetchMock.mock.calls.filter(([u]) => u === '/api/auth/refresh')).toHaveLength(1);
  });

  it('failed refresh clears the session and surfaces the 401', async () => {
    fetchMock
      .mockResolvedValueOnce(json(401, { message: 'expired' }))
      .mockResolvedValueOnce(json(401, {}));
    await expect(api('/me')).rejects.toMatchObject({ status: 401 });
    expect(useAuth.getState()).toMatchObject({ status: 'anonymous', accessToken: null });
  });

  it('maps ApiErrorDto into ApiError with field errors', async () => {
    fetchMock.mockResolvedValueOnce(
      json(409, {
        statusCode: 409,
        message: 'That username is taken',
        fields: { username: ['Taken'] },
      }),
    );
    const err = await api('/me', { method: 'PATCH', body: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 409,
      message: 'That username is taken',
      fields: { username: ['Taken'] },
    });
  });

  it('returns undefined for 204', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(api('/x', { method: 'POST' })).resolves.toBeUndefined();
  });
});

describe('refreshSession()', () => {
  it('does not call the API without a session cookie', async () => {
    document.cookie = 'mh_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    await expect(refreshSession()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAuth.getState().status).toBe('anonymous');
  });
});
