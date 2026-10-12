import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, makeUser, PNG, resetRateLimits, type TestUser, uploadPng } from './helpers';

describe('Uploads (e2e)', () => {
  let app: INestApplication;
  let user: TestUser;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  beforeEach(async () => {
    await resetRateLimits();
    user = await makeUser(app);
  });
  afterAll(() => app.close());

  describe('POST /images/sign', () => {
    it('401 anonymous', () =>
      http()
        .post('/images/sign')
        .send({ purpose: 'listing', contentType: 'image/png', size: 10 })
        .expect(401));

    it('signs a PUT scoped to the user, and the object is publicly readable after', async () => {
      const url = await uploadPng(app, user);
      expect(url).toContain(`/listing/${user.id}/`);
      const get = await fetch(url);
      expect(get.status).toBe(200);
    });

    it('signature pins the byte length', async () => {
      const signed = await http()
        .post('/images/sign')
        .set('Authorization', user.auth)
        .send({ purpose: 'listing', contentType: 'image/png', size: 10 })
        .expect(201);
      const put = await fetch(signed.body.uploadUrl, {
        method: 'PUT',
        body: PNG, // not 10 bytes
        headers: { 'Content-Type': 'image/png' },
      });
      expect(put.ok).toBe(false);
    });

    it('400 for disallowed types and sizes', async () => {
      await http()
        .post('/images/sign')
        .set('Authorization', user.auth)
        .send({ purpose: 'listing', contentType: 'image/gif', size: 10 })
        .expect(400);
      await http()
        .post('/images/sign')
        .set('Authorization', user.auth)
        .send({ purpose: 'avatar', contentType: 'image/png', size: 25 * 1024 * 1024 })
        .expect(400);
    });
  });

  describe('POST /me/avatar', () => {
    it('sets the avatar from an uploaded object', async () => {
      const url = await uploadPng(app, user, 'avatar');
      const res = await http()
        .post('/me/avatar')
        .set('Authorization', user.auth)
        .send({ url })
        .expect(200);
      expect(res.body.profile.avatarUrl).toBe(url);
    });

    it("rejects someone else's upload, foreign URLs and never-uploaded keys", async () => {
      const other = await makeUser(app);
      const theirs = await uploadPng(app, other, 'avatar');
      await http()
        .post('/me/avatar')
        .set('Authorization', user.auth)
        .send({ url: theirs })
        .expect(400);
      await http()
        .post('/me/avatar')
        .set('Authorization', user.auth)
        .send({ url: 'https://evil.example/x.png' })
        .expect(400);

      const signed = await http()
        .post('/images/sign')
        .set('Authorization', user.auth)
        .send({ purpose: 'avatar', contentType: 'image/png', size: PNG.length })
        .expect(201);
      await http()
        .post('/me/avatar')
        .set('Authorization', user.auth)
        .send({ url: signed.body.publicUrl })
        .expect(400);
    });

    it('listing uploads cannot be used as avatars', async () => {
      const url = await uploadPng(app, user, 'listing');
      await http().post('/me/avatar').set('Authorization', user.auth).send({ url }).expect(400);
    });
  });
});
