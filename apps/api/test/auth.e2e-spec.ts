import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.module';
import { cookiesFrom, createApp, resetRateLimits, uniqueEmail } from './helpers';

const PASSWORD = 'correct horse battery';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  const http = () => request(app.getHttpServer());

  async function register(email = uniqueEmail('user')) {
    const res = await http().post('/auth/register').send({ email, password: PASSWORD }).expect(201);
    return { email, body: res.body, cookies: cookiesFrom(res) };
  }

  const refresh = (c: Record<string, string>, csrf = c.mh_csrf) =>
    http()
      .post('/auth/refresh')
      .set('Cookie', [`mh_rt=${c.mh_rt}`, `mh_csrf=${c.mh_csrf}`])
      .set('x-csrf-token', csrf ?? '');

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
  });
  beforeEach(resetRateLimits);
  afterAll(() => app.close());

  describe('POST /auth/register', () => {
    it('creates a buyer, returns an access token, sets refresh + csrf cookies, audits', async () => {
      const { email, body, cookies } = await register();
      expect(body.user).toMatchObject({
        email,
        role: 'buyer',
        isEmailVerified: false,
        hasProfile: false,
      });
      expect(body.accessToken.split('.')).toHaveLength(3);
      expect(body.accessTokenExpiresIn).toBe(900);
      expect(JSON.stringify(body)).not.toMatch(/passwordHash|refreshToken/);
      expect(cookies.mh_rt).toBeDefined();
      expect(cookies.mh_csrf).toBeDefined();

      const audit = await db.auditLog.findFirst({
        where: { entityId: body.user.id, action: 'user.register' },
      });
      expect(audit).not.toBeNull();
    });

    it('refresh cookie is HttpOnly + SameSite=Strict; csrf cookie is readable', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ email: uniqueEmail('ck'), password: PASSWORD });
      const raw = (res.headers['set-cookie'] as unknown as string[]).join('\n');
      expect(raw).toMatch(/mh_rt=[^;]+;.*HttpOnly.*SameSite=Strict/);
      expect(raw).not.toMatch(/mh_csrf=[^;]+;[^\n]*HttpOnly/);
    });

    it('409 on duplicate email, case-insensitively', async () => {
      const { email } = await register();
      await http()
        .post('/auth/register')
        .send({ email: email.toUpperCase(), password: PASSWORD })
        .expect(409);
    });

    it('400 with field errors; cannot self-register as admin', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ email: 'nope', password: 'short' })
        .expect(400);
      expect(Object.keys(res.body.fields).sort()).toEqual(['email', 'password']);
      await http()
        .post('/auth/register')
        .send({ email: uniqueEmail('adm'), password: PASSWORD, role: 'admin' })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('200 with tokens and updates lastLoginAt', async () => {
      const { email } = await register();
      const res = await http().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
      expect(res.body.user.email).toBe(email);
      expect(cookiesFrom(res).mh_rt).toBeDefined();
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      expect(user.lastLoginAt).not.toBeNull();
    });

    it('same 401 for wrong password and unknown email (no enumeration)', async () => {
      const { email } = await register();
      const wrong = await http()
        .post('/auth/login')
        .send({ email, password: 'wrong password!' })
        .expect(401);
      const unknown = await http()
        .post('/auth/login')
        .send({ email: uniqueEmail('ghost'), password: PASSWORD })
        .expect(401);
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('403 for banned users, but only after a correct password', async () => {
      const { email } = await register();
      await db.user.update({ where: { email }, data: { isBanned: true } });
      await http().post('/auth/login').send({ email, password: 'wrong password!' }).expect(401);
      await http().post('/auth/login').send({ email, password: PASSWORD }).expect(403);
    });

    it('429 after 10 attempts per minute (§9)', async () => {
      const attempt = () =>
        http().post('/auth/login').send({ email: 'x@test.local', password: 'whatever!' });
      for (let i = 0; i < 10; i++) await attempt();
      await attempt().expect(429);
    });
  });

  describe('POST /auth/refresh', () => {
    it('rotates the refresh cookie and returns a fresh access token', async () => {
      const { cookies } = await register();
      const res = await refresh(cookies).expect(200);
      const next = cookiesFrom(res);
      expect(next.mh_rt).toBeDefined();
      expect(next.mh_rt).not.toBe(cookies.mh_rt);
      expect(res.body.accessToken).toBeDefined();
    });

    it('403 without a matching CSRF header', async () => {
      const { cookies } = await register();
      await refresh(cookies, '').expect(403);
      await refresh(cookies, 'x'.repeat(cookies.mh_csrf!.length)).expect(403);
    });

    it('401 and cookies cleared when a spent token is replayed', async () => {
      const { cookies } = await register();
      await refresh(cookies).expect(200);
      const replay = await refresh(cookies).expect(401);
      expect(cookiesFrom(replay).mh_rt).toBe('');
    });

    it('401 for a user banned mid-session', async () => {
      const { email, cookies } = await register();
      await db.user.update({ where: { email }, data: { isBanned: true } });
      await refresh(cookies).expect(401);
    });

    it('401 with no refresh cookie', async () => {
      await http()
        .post('/auth/refresh')
        .set('Cookie', 'mh_csrf=a')
        .set('x-csrf-token', 'a')
        .expect(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('204, clears cookies, and the old refresh token stops working', async () => {
      const { cookies } = await register();
      const res = await http()
        .post('/auth/logout')
        .set('Cookie', [`mh_rt=${cookies.mh_rt}`, `mh_csrf=${cookies.mh_csrf}`])
        .set('x-csrf-token', cookies.mh_csrf!)
        .expect(204);
      expect(cookiesFrom(res).mh_rt).toBe('');
      await refresh(cookies).expect(401);
    });

    it('403 without CSRF', async () => {
      const { cookies } = await register();
      await http().post('/auth/logout').set('Cookie', `mh_rt=${cookies.mh_rt}`).expect(403);
    });
  });
});
