import { createHash } from 'node:crypto';
import type { OAuthProvider } from '@markethub/shared';

/** What we keep from a provider: identity only, never their access tokens. */
export interface OAuthIdentity {
  providerUid: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
}

export interface OAuthClient {
  /** `verifier` is the PKCE code_verifier; providers without PKCE ignore it. */
  authorizationUrl(state: string, verifier: string): URL;
  exchange(code: string, verifier: string): Promise<OAuthIdentity>;
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function exchangeCode(url: string, params: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(params),
  });
  const body = await json<{ access_token?: string; error?: string }>(res, 'Token exchange');
  if (!body.access_token) throw new Error(`Token exchange failed: ${body.error ?? 'no token'}`);
  return body.access_token;
}

export class GoogleClient implements OAuthClient {
  constructor(private readonly c: OAuthCredentials) {}

  authorizationUrl(state: string, verifier: string) {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.c.clientId,
      redirect_uri: this.c.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return url;
  }

  async exchange(code: string, verifier: string): Promise<OAuthIdentity> {
    const token = await exchangeCode('https://oauth2.googleapis.com/token', {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      client_id: this.c.clientId,
      client_secret: this.c.clientSecret,
      redirect_uri: this.c.redirectUri,
    });
    // userinfo over TLS with the fresh token, so no id_token signature handling needed.
    const me = await json<{
      sub: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    }>(
      await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      'Google userinfo',
    );
    return {
      providerUid: me.sub,
      email: me.email ?? null,
      emailVerified: me.email_verified === true,
      name: me.name ?? null,
      avatarUrl: me.picture ?? null,
    };
  }
}

export class GitHubClient implements OAuthClient {
  constructor(private readonly c: OAuthCredentials) {}

  authorizationUrl(state: string) {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.search = new URLSearchParams({
      client_id: this.c.clientId,
      redirect_uri: this.c.redirectUri,
      scope: 'read:user user:email',
      state,
      allow_signup: 'true',
    }).toString();
    return url;
  }

  async exchange(code: string): Promise<OAuthIdentity> {
    const token = await exchangeCode('https://github.com/login/oauth/access_token', {
      code,
      client_id: this.c.clientId,
      client_secret: this.c.clientSecret,
      redirect_uri: this.c.redirectUri,
    });
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'MarketHub',
    };
    const [user, emails] = await Promise.all([
      fetch('https://api.github.com/user', { headers }).then((r) =>
        json<{ id: number; login: string; name: string | null; avatar_url: string | null }>(
          r,
          'GitHub user',
        ),
      ),
      fetch('https://api.github.com/user/emails', { headers }).then((r) =>
        json<{ email: string; primary: boolean; verified: boolean }[]>(r, 'GitHub emails'),
      ),
    ]);
    // The public profile email can be unverified; only trust the verified primary.
    const primary = emails.find((e) => e.primary && e.verified);
    return {
      providerUid: String(user.id),
      email: primary?.email ?? null,
      emailVerified: Boolean(primary),
      name: user.name ?? user.login,
      avatarUrl: user.avatar_url,
    };
  }
}

export type OAuthClients = Partial<Record<OAuthProvider, OAuthClient>>;
export const OAUTH_CLIENTS = Symbol('OAUTH_CLIENTS');
