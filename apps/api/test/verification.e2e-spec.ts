import type { INestApplication } from '@nestjs/common';
import type Redis from 'ioredis';
import request from 'supertest';
import { smsOutboxKey } from '../src/modules/verification/sms.sender';
import { PrismaService } from '../src/prisma/prisma.module';
import { REDIS } from '../src/redis/redis.module';
import { createApp, makeUser, PNG, resetRateLimits, type TestUser } from './helpers';

describe('Verification (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let redis: Redis;
  let user: TestUser;
  let admin: TestUser;
  const http = () => request(app.getHttpServer());
  const phone = () => `+2547${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const lastCode = async (number: string) =>
    /(\d{6})/.exec((await redis.lindex(smsOutboxKey(number), 0)) ?? '')?.[1];

  /** Signs a private upload for `owner`, PUTs a PNG, returns the key. */
  async function document(owner: TestUser) {
    const signed = await http()
      .post('/images/sign')
      .set('Authorization', owner.auth)
      .send({ purpose: 'verification', contentType: 'image/png', size: PNG.length })
      .expect(201);
    expect(signed.body.publicUrl).toBeNull();
    const put = await fetch(signed.body.uploadUrl, {
      method: 'PUT',
      body: PNG,
      headers: { 'Content-Type': 'image/png' },
    });
    expect(put.ok).toBe(true);
    return signed.body.key as string;
  }
  const requestId = (owner: TestUser, documents: string[]) =>
    http()
      .post('/me/verification')
      .set('Authorization', owner.auth)
      .send({ kind: 'id', documents, details: { documentType: 'national_id' } });

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    redis = app.get(REDIS);
  });
  beforeEach(async () => {
    await resetRateLimits();
    [user, admin] = await Promise.all([makeUser(app), makeUser(app, { role: 'admin' })]);
  });
  afterAll(() => app.close());

  describe('phone', () => {
    it('sends a code and verifies with it; wrong codes count against the limit', async () => {
      const number = phone();
      await http()
        .post('/me/phone/send-code')
        .set('Authorization', user.auth)
        .send({ phone: number.replace(/(\d{3})(\d{3})$/, ' $1 $2') })
        .expect(200);
      const code = await lastCode(number);
      expect(code).toMatch(/^\d{6}$/);

      const wrong = code === '000000' ? '111111' : '000000';
      await http()
        .post('/me/phone/verify')
        .set('Authorization', user.auth)
        .send({ code: wrong })
        .expect(400);
      const ok = await http()
        .post('/me/phone/verify')
        .set('Authorization', user.auth)
        .send({ code })
        .expect(200);
      expect(ok.body.phone).toEqual({ number, verified: true, available: true });
      // Single use.
      await http()
        .post('/me/phone/verify')
        .set('Authorization', user.auth)
        .send({ code })
        .expect(400);
      expect(
        await db.auditLog.count({ where: { entityId: user.id, action: 'user.phone_verified' } }),
      ).toBe(1);
    });

    it('locks after five wrong tries and caps sends per window', async () => {
      const number = phone();
      const send = () =>
        http().post('/me/phone/send-code').set('Authorization', user.auth).send({ phone: number });
      await send().expect(200);
      const code = (await lastCode(number))!;
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/me/phone/verify')
          .set('Authorization', user.auth)
          .send({ code: wrong })
          .expect(400);
      }
      const locked = await http()
        .post('/me/phone/verify')
        .set('Authorization', user.auth)
        .send({ code })
        .expect(400);
      expect(locked.body.message).toMatch(/Too many tries/);

      await send().expect(200);
      await send().expect(200);
      await send().expect(429);
    });

    it('a number verified elsewhere can’t be claimed', async () => {
      const number = phone();
      await db.user.update({
        where: { id: admin.id },
        data: { phone: number, isPhoneVerified: true },
      });
      await http()
        .post('/me/phone/send-code')
        .set('Authorization', user.auth)
        .send({ phone: number })
        .expect(409);
      await http()
        .post('/me/phone/send-code')
        .set('Authorization', user.auth)
        .send({ phone: '0712' })
        .expect(400);
    });
  });

  describe('ID and business', () => {
    it('documents go to the private bucket: no anonymous read', async () => {
      const key = await document(user);
      const direct = await fetch(
        `${process.env.S3_ENDPOINT}/${process.env.S3_PRIVATE_BUCKET}/${key}`,
      );
      expect(direct.status).toBe(403);
    });

    it('request → admin rejects with a note → request again → approve', async () => {
      const key = await document(user);
      const pending = await requestId(user, [key]).expect(200);
      expect(pending.body.id).toMatchObject({ verified: false, request: { status: 'pending' } });
      await requestId(user, [key]).expect(409); // one open request per kind

      const queue = await http()
        .get('/admin/verifications')
        .set('Authorization', admin.auth)
        .expect(200);
      const item = queue.body.items.find(
        (r: { user: { userId: string } }) => r.user.userId === user.id,
      );
      expect(item).toMatchObject({ kind: 'id', details: { documentType: 'national_id' } });
      // The admin's link works, briefly.
      expect((await fetch(item.documents[0])).status).toBe(200);
      await http().get('/admin/verifications').set('Authorization', user.auth).expect(403);

      const decide = (body: object) =>
        http().post(`/admin/verify/${user.id}`).set('Authorization', admin.auth).send(body);
      await decide({ requestId: item.id, decision: 'reject' }).expect(400);
      await decide({
        requestId: item.id,
        decision: 'reject',
        note: 'The photo is too blurry to read',
      }).expect(200);
      await decide({ requestId: item.id, decision: 'approve' }).expect(409);

      const after = await http().get('/me/verification').set('Authorization', user.auth);
      expect(after.body.id.request).toMatchObject({
        status: 'rejected',
        note: 'The photo is too blurry to read',
      });

      const resubmitted = await document(user);
      await requestId(user, [resubmitted]).expect(200);
      const again = await http().get('/admin/verifications').set('Authorization', admin.auth);
      const second = again.body.items.find(
        (r: { user: { userId: string } }) => r.user.userId === user.id,
      );
      await decide({ requestId: second.id, decision: 'approve' }).expect(200);

      expect((await db.profile.findUniqueOrThrow({ where: { userId: user.id } })).idVerified).toBe(
        true,
      );
      const extra = await document(user);
      await requestId(user, [extra]).expect(409); // already verified
      const audit = await db.auditLog.findMany({
        where: { entityId: user.id, action: { startsWith: 'verification.' } },
      });
      expect(audit.map((a) => a.action).sort()).toEqual([
        'verification.approve',
        'verification.reject',
      ]);
      expect(
        await db.notification.count({
          where: {
            userId: user.id,
            type: { in: ['verification.approved', 'verification.rejected'] },
          },
        }),
      ).toBe(2);
    });

    it('only the owner’s finished uploads, from confirmed accounts', async () => {
      const other = await makeUser(app);
      const theirs = await document(other);
      await requestId(user, [theirs]).expect(400);
      await requestId(user, [
        `verification/${user.id}/00000000-0000-4000-8000-000000000000.png`,
      ]).expect(400);

      const unconfirmed = await makeUser(app, { verified: false });
      await requestId(unconfirmed, ['x']).expect(403);
      const doc = await document(user); // await first: supertest shares one server handle
      await http()
        .post('/me/verification')
        .set('Authorization', user.auth)
        .send({ kind: 'business', documents: [doc], details: { documentType: 'passport' } })
        .expect(400);
    });
  });
});
