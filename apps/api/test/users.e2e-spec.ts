import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, resetRateLimits, uniqueEmail } from './helpers';

describe('Profile (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  const http = () => request(app.getHttpServer());
  const handle = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  async function signUp() {
    const res = await http()
      .post('/auth/register')
      .send({ email: uniqueEmail('me'), password: 'correct horse battery' })
      .expect(201);
    return { auth: `Bearer ${res.body.accessToken}`, userId: res.body.user.id as string };
  }

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
  });
  beforeEach(resetRateLimits);
  afterAll(() => app.close());

  describe('GET /me', () => {
    it('401 without a token', () => http().get('/me').expect(401));

    it('returns the user with profile=null before onboarding', async () => {
      const { auth, userId } = await signUp();
      const res = await http().get('/me').set('Authorization', auth).expect(200);
      expect(res.body).toEqual({
        user: expect.objectContaining({ id: userId, hasProfile: false }),
        profile: null,
        phone: null,
      });
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    });
  });

  describe('PATCH /me', () => {
    it('first call needs displayName + username', async () => {
      const { auth } = await signUp();
      const res = await http()
        .patch('/me')
        .set('Authorization', auth)
        .send({ bio: 'hi' })
        .expect(400);
      expect(Object.keys(res.body.fields).sort()).toEqual(['displayName', 'username']);
    });

    it('creates then updates the profile; empty website clears it', async () => {
      const { auth } = await signUp();
      const username = handle();
      const created = await http()
        .patch('/me')
        .set('Authorization', auth)
        .send({
          displayName: 'Amina Wanjiru',
          username: username.toUpperCase(),
          country: 'ke',
          city: 'Nairobi',
          website: 'https://amina.dev',
        })
        .expect(200);
      expect(created.body.user.hasProfile).toBe(true);
      expect(created.body.profile).toMatchObject({
        username, // normalised to lower case
        displayName: 'Amina Wanjiru',
        country: 'KE',
        website: 'https://amina.dev',
        ratingAvg: 0,
        idVerified: false,
      });

      const patched = await http()
        .patch('/me')
        .set('Authorization', auth)
        .send({ bio: 'Phones & laptops, Nairobi CBD', website: '' })
        .expect(200);
      expect(patched.body.profile).toMatchObject({
        bio: 'Phones & laptops, Nairobi CBD',
        website: null,
        displayName: 'Amina Wanjiru',
      });
    });

    it('409 when the username is taken (case-insensitive)', async () => {
      const a = await signUp();
      const b = await signUp();
      const username = handle();
      await http()
        .patch('/me')
        .set('Authorization', a.auth)
        .send({ displayName: 'A', username })
        .expect(200);
      const res = await http()
        .patch('/me')
        .set('Authorization', b.auth)
        .send({ displayName: 'B', username: username.toUpperCase() })
        .expect(409);
      expect(res.body.fields).toEqual({ username: ['Taken'] });
    });

    it('cannot set verification, ratings, or admin role (strict schema)', async () => {
      const { auth } = await signUp();
      await http().patch('/me').set('Authorization', auth).send({ idVerified: true }).expect(400);
      await http().patch('/me').set('Authorization', auth).send({ ratingAvg: 5 }).expect(400);
      await http().patch('/me').set('Authorization', auth).send({ role: 'admin' }).expect(400);
      await http()
        .patch('/me')
        .set('Authorization', auth)
        .send({ displayName: 'X', username: 'support' })
        .expect(400);
    });

    it('role change is audited; new phone resets phone verification', async () => {
      const { auth, userId } = await signUp();
      await db.user.update({
        where: { id: userId },
        data: { phone: '+254700000001', isPhoneVerified: true },
      });

      const res = await http()
        .patch('/me')
        .set('Authorization', auth)
        .send({ role: 'seller', phone: '+254711111111' })
        .expect(200);
      expect(res.body.user).toMatchObject({ role: 'seller', isPhoneVerified: false });
      expect(res.body.phone).toBe('+254711111111');
      const audit = await db.auditLog.findFirstOrThrow({
        where: { entityId: userId, action: 'user.role_changed' },
      });
      expect(audit.metadata).toEqual({ from: 'buyer', to: 'seller' });
    });
  });

  describe('GET /users/:username', () => {
    it('public, no auth needed; never exposes email or phone', async () => {
      const { auth } = await signUp();
      const username = handle();
      await http()
        .patch('/me')
        .set('Authorization', auth)
        .send({ displayName: 'Public Pat', username, phone: '+254722222222' });

      const res = await http().get(`/users/${username.toUpperCase()}`).expect(200);
      expect(res.body).toMatchObject({ username, displayName: 'Public Pat' });
      expect(res.body.memberSince).toEqual(expect.any(String));
      expect(JSON.stringify(res.body)).not.toMatch(/@test\.local|\+2547/);
    });

    it('404 for unknown and for banned users', async () => {
      await http().get('/users/nobody_here_123').expect(404);

      const { auth, userId } = await signUp();
      const username = handle();
      await http().patch('/me').set('Authorization', auth).send({ displayName: 'Gone', username });
      await db.user.update({ where: { id: userId }, data: { isBanned: true } });
      await http().get(`/users/${username}`).expect(404);
    });
  });
});
