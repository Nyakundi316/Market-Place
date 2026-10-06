import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.module';
import { cookiesFrom, createApp, mailTo, resetRateLimits, uniqueEmail } from './helpers';

const PASSWORD = 'correct horse battery';

describe('Email verification & password reset (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  const http = () => request(app.getHttpServer());

  async function register() {
    const email = uniqueEmail('mail');
    const res = await http().post('/auth/register').send({ email, password: PASSWORD }).expect(201);
    return { email, userId: res.body.user.id as string, cookies: cookiesFrom(res) };
  }

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
  });
  beforeEach(resetRateLimits);
  afterAll(() => app.close());

  describe('POST /auth/verify-email', () => {
    it('register sends a link; the token verifies the email once, and is audited', async () => {
      const { email, userId } = await register();
      const mail = await mailTo(email, /Confirm your MarketHub email/);
      expect(mail?.token).toBeDefined();

      await http()
        .post('/auth/verify-email')
        .send({ token: mail!.token })
        .expect(200, { verified: true });
      expect((await db.user.findUniqueOrThrow({ where: { id: userId } })).isEmailVerified).toBe(
        true,
      );
      expect(
        await db.auditLog.count({ where: { entityId: userId, action: 'user.email_verified' } }),
      ).toBe(1);

      // single-use
      await http().post('/auth/verify-email').send({ token: mail!.token }).expect(400);
    });

    it('400 for a made-up or expired token', async () => {
      await http()
        .post('/auth/verify-email')
        .send({ token: 'x'.repeat(43) })
        .expect(400);

      const { email, userId } = await register();
      const mail = await mailTo(email, /Confirm/);
      await db.authToken.updateMany({ where: { userId }, data: { expiresAt: new Date(0) } });
      const res = await http().post('/auth/verify-email').send({ token: mail!.token }).expect(400);
      expect(res.body.message).toBe('This link is invalid or has expired');
    });

    it('only the hash is stored', async () => {
      const { email, userId } = await register();
      const mail = await mailTo(email, /Confirm/);
      const row = await db.authToken.findFirstOrThrow({ where: { userId } });
      expect(row.tokenHash).not.toBe(mail!.token);
    });
  });

  describe('forgot + reset password', () => {
    it('202 with the same body for known and unknown emails', async () => {
      const { email } = await register();
      const known = await http().post('/auth/forgot-password').send({ email }).expect(202);
      const unknown = await http()
        .post('/auth/forgot-password')
        .send({ email: uniqueEmail('ghost') })
        .expect(202);
      expect(known.body).toEqual(unknown.body);
    });

    it('reset sets the new password, verifies email, signs out every session, audits', async () => {
      const { email, userId, cookies } = await register();
      await http().post('/auth/forgot-password').send({ email }).expect(202);
      const mail = await mailTo(email, /Reset your MarketHub password/);
      expect(mail?.token).toBeDefined();

      await http()
        .post('/auth/reset-password')
        .send({ token: mail!.token, password: 'a brand new password' })
        .expect(204);

      await http().post('/auth/login').send({ email, password: PASSWORD }).expect(401);
      await http()
        .post('/auth/login')
        .send({ email, password: 'a brand new password' })
        .expect(200);

      // the session from before the reset is dead
      await http()
        .post('/auth/refresh')
        .set('Cookie', [`mh_rt=${cookies.mh_rt}`, `mh_csrf=${cookies.mh_csrf}`])
        .set('x-csrf-token', cookies.mh_csrf!)
        .expect(401);

      const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
      expect(user.isEmailVerified).toBe(true);
      expect(
        await db.auditLog.count({ where: { entityId: userId, action: 'user.password_reset' } }),
      ).toBe(1);
    });

    it('a newer reset link supersedes the old one; links are single-use', async () => {
      const { email } = await register();
      await http().post('/auth/forgot-password').send({ email });
      const first = await mailTo(email, /Reset/);
      await http().post('/auth/forgot-password').send({ email });
      // wait for the second message (a different token)
      let second = first;
      for (let i = 0; i < 20 && second?.token === first?.token; i++) {
        second = await mailTo(email, /Reset/);
      }
      expect(second?.token).not.toBe(first?.token);

      await http()
        .post('/auth/reset-password')
        .send({ token: first!.token, password: 'another password!' })
        .expect(400);
      await http()
        .post('/auth/reset-password')
        .send({ token: second!.token, password: 'another password!' })
        .expect(204);
      await http()
        .post('/auth/reset-password')
        .send({ token: second!.token, password: 'yet another one!!' })
        .expect(400);
    });

    it('400 when the new password is too short', async () => {
      await http()
        .post('/auth/reset-password')
        .send({ token: 'x'.repeat(43), password: 'short' })
        .expect(400);
    });
  });
});
