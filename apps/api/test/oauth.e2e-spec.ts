import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadEnv } from '../src/config/env.validation';
import {
  OAUTH_CLIENTS,
  type OAuthClient,
  type OAuthIdentity,
} from '../src/modules/auth/oauth/oauth-clients';
import { PrismaService } from '../src/prisma/prisma.module';
import { cookiesFrom, resetRateLimits, uniqueEmail } from './helpers';

/** Stands in for Google: `code` picks which identity the "provider" returns. */
const identities = new Map<string, OAuthIdentity>();
const fakeGoogle: OAuthClient = {
  authorizationUrl: (state) => new URL(`https://accounts.example/auth?state=${state}`),
  exchange: async (code) => {
    const id = identities.get(code);
    if (!id) throw new Error('provider rejected code');
    return id;
  },
};

describe('OAuth (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  const http = () => request(app.getHttpServer());

  function identity(overrides: Partial<OAuthIdentity> = {}): string {
    const code = `code-${Math.random().toString(36).slice(2)}`;
    identities.set(code, {
      providerUid: `g-${Math.random().toString(36).slice(2)}`,
      email: uniqueEmail('oauth'),
      emailVerified: true,
      name: 'Amina W.',
      avatarUrl: null,
      ...overrides,
    });
    return code;
  }

  /** start → callback, carrying the state cookie like a browser would */
  async function signIn(code: string, tamper?: (state: string) => string) {
    const start = await http().get('/auth/oauth/google').expect(302);
    const state = new URL(start.headers.location!).searchParams.get('state')!;
    const stateCookie = cookiesFrom(start).mh_oauth!;
    return http()
      .get(`/auth/oauth/google/callback?code=${code}&state=${tamper ? tamper(state) : state}`)
      .set('Cookie', `mh_oauth=${stateCookie}`)
      .expect(302);
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OAUTH_CLIENTS)
      .useValue({ google: fakeGoogle }) // github deliberately not configured
      .compile();
    app = configureApp(moduleRef.createNestApplication(), loadEnv());
    await app.init();
    db = app.get(PrismaService);
  });
  beforeEach(resetRateLimits);
  afterAll(() => app.close());

  it('start: redirects to the provider and sets an httpOnly, SameSite=Lax state cookie', async () => {
    const res = await http().get('/auth/oauth/google').expect(302);
    expect(res.headers.location).toMatch(/^https:\/\/accounts\.example\/auth\?state=/);
    const raw = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(raw).toMatch(/mh_oauth=.*HttpOnly.*SameSite=Lax/);
  });

  it('new user: created verified with no password, session cookie set, sent to onboarding', async () => {
    const code = identity();
    const { email, providerUid } = identities.get(code)!;
    const res = await signIn(code);

    expect(res.headers.location).toBe('http://localhost:3000/auth/callback?next=%2Fonboarding');
    expect(cookiesFrom(res).mh_rt).toBeDefined();
    const user = await db.user.findUniqueOrThrow({
      where: { email: email! },
      include: { oauthAccounts: true },
    });
    expect(user).toMatchObject({ isEmailVerified: true, passwordHash: null, role: 'buyer' });
    expect(user.oauthAccounts).toEqual([
      expect.objectContaining({ provider: 'google', providerUid, tokens: null }),
    ]);
  });

  it('returning user: same account, no duplicate', async () => {
    const code = identity();
    await signIn(code);
    await signIn(code);
    const { providerUid } = identities.get(code)!;
    expect(await db.oAuthAccount.count({ where: { providerUid } })).toBe(1);
  });

  it('links to an existing password account when the provider verifies the same email', async () => {
    const email = uniqueEmail('linkme');
    const reg = await http()
      .post('/auth/register')
      .send({ email, password: 'correct horse battery' });
    await signIn(identity({ email }));

    const user = await db.user.findUniqueOrThrow({
      where: { email },
      include: { oauthAccounts: true },
    });
    expect(user.oauthAccounts).toHaveLength(1);
    expect(user.isEmailVerified).toBe(true);
    expect(
      await db.auditLog.count({
        where: { entityId: reg.body.user.id, action: 'user.oauth_linked' },
      }),
    ).toBe(1);
  });

  it('refuses an unverified provider email (no account takeover by email)', async () => {
    const email = uniqueEmail('victim');
    await http().post('/auth/register').send({ email, password: 'correct horse battery' });
    const res = await signIn(identity({ email, emailVerified: false }));

    expect(res.headers.location).toBe('http://localhost:3000/login?error=oauth_no_verified_email');
    expect(await db.oAuthAccount.count({ where: { user: { email } } })).toBe(0);
  });

  it('rejects a forged state or a missing state cookie', async () => {
    const forged = await signIn(identity(), (s) => `${s.slice(0, -1)}x`);
    expect(forged.headers.location).toBe('http://localhost:3000/login?error=oauth_failed');

    const noCookie = await http()
      .get(`/auth/oauth/google/callback?code=${identity()}&state=abc`)
      .expect(302);
    expect(noCookie.headers.location).toBe('http://localhost:3000/login?error=oauth_failed');
  });

  it('banned users are bounced with account_suspended', async () => {
    const code = identity();
    await signIn(code);
    await db.user.update({
      where: { email: identities.get(code)!.email! },
      data: { isBanned: true },
    });
    const res = await signIn(code);
    expect(res.headers.location).toBe('http://localhost:3000/login?error=account_suspended');
    expect(cookiesFrom(res).mh_rt).toBeUndefined();
  });

  it('provider failure during code exchange → oauth_failed', async () => {
    const res = await signIn('code-the-provider-rejects');
    expect(res.headers.location).toBe('http://localhost:3000/login?error=oauth_failed');
  });

  it('unconfigured provider → 404, unknown provider → 400', async () => {
    await http().get('/auth/oauth/github').expect(404);
    await http().get('/auth/oauth/facebook').expect(400);
  });
});
