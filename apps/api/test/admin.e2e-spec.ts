import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.module';
import {
  cookiesFrom,
  createApp,
  makeUser,
  resetRateLimits,
  seedOrder,
  type TestUser,
} from './helpers';

describe('Reports, moderation and admin views (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let admin: TestUser;
  let seller: TestUser;
  let buyer: TestUser;
  const http = () => request(app.getHttpServer());
  const asAdmin = (method: 'get' | 'post', path: string) =>
    http()[method](path).set('Authorization', admin.auth);

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetRateLimits();
    [admin, seller, buyer] = await Promise.all([
      makeUser(app, { role: 'admin' }),
      makeUser(app),
      makeUser(app),
    ]);
  });
  afterAll(() => app.close());

  const report = (user: TestUser, body: object) =>
    http().post('/reports').set('Authorization', user.auth).send(body);

  describe('POST /reports', () => {
    it('one open report per person per thing; not your own; only what you can see', async () => {
      const { listing, conversation } = await seedOrder(app, buyer, seller);
      const body = { entityType: 'listing', entityId: listing.id, reason: 'scam' };
      await report(buyer, body).expect(201);
      await report(buyer, body).expect(409);
      await report(seller, body).expect(400);
      await report(buyer, { ...body, entityId: '00000000-0000-4000-8000-000000000000' }).expect(
        404,
      );
      await http().post('/reports').send(body).expect(401);

      // Messages: only members of the chat can report them.
      const msg = await db.message.create({
        data: {
          conversationId: conversation.id,
          senderId: seller.id,
          body: 'pay me outside the app',
        },
      });
      const outsider = await makeUser(app);
      await report(outsider, { entityType: 'message', entityId: msg.id, reason: 'scam' }).expect(
        404,
      );
      await report(buyer, { entityType: 'message', entityId: msg.id, reason: 'scam' }).expect(201);
      expect(
        await db.auditLog.count({ where: { action: 'report.create', actorId: buyer.id } }),
      ).toBe(2);
    });
  });

  describe('admin queue', () => {
    it('lists open reports with a target and duplicate count; resolving closes them all', async () => {
      const { listing } = await seedOrder(app, buyer, seller);
      const third = await makeUser(app);
      await report(buyer, { entityType: 'listing', entityId: listing.id, reason: 'scam' }).expect(
        201,
      );
      await report(third, { entityType: 'listing', entityId: listing.id, reason: 'fake' }).expect(
        201,
      );

      const queue = await asAdmin('get', '/admin/reports?entityType=listing').expect(200);
      const mine = queue.body.items.filter((r: { entityId: string }) => r.entityId === listing.id);
      expect(mine).toHaveLength(2);
      expect(mine[0]).toMatchObject({
        target: { label: listing.title, link: `/l/${listing.slug}`, ownerId: seller.id },
        duplicates: 1,
      });
      await http().get('/admin/reports').set('Authorization', buyer.auth).expect(403);

      const resolved = await asAdmin('post', `/admin/reports/${mine[0].id}/resolve`)
        .send({ action: 'resolve', note: 'Removed the listing' })
        .expect(200);
      expect(resolved.body.closed).toBe(2);
      await asAdmin('post', `/admin/reports/${mine[1].id}/resolve`)
        .send({ action: 'dismiss' })
        .expect(409);
      expect(
        await db.notification.count({
          where: { type: 'report.resolved', userId: { in: [buyer.id, third.id] } },
        }),
      ).toBe(2);
      // Closed, so the same person can report it again if it comes back.
      await report(buyer, { entityType: 'listing', entityId: listing.id, reason: 'scam' }).expect(
        201,
      );
    });
  });

  describe('moderation', () => {
    it('removes a listing: hidden, counted out, owner told, audited', async () => {
      const { listing } = await seedOrder(app, buyer, seller);
      await asAdmin('post', `/admin/listings/${listing.id}/remove`).send({}).expect(400);
      await asAdmin('post', `/admin/listings/${listing.id}/remove`)
        .send({ reason: 'Counterfeit goods' })
        .expect(200);
      await asAdmin('post', `/admin/listings/${listing.id}/remove`)
        .send({ reason: 'again' })
        .expect(409);
      await http().get(`/listings/${listing.slug}`).expect(404);
      const note = await db.notification.findFirstOrThrow({
        where: { userId: seller.id, type: 'moderation.listing_removed' },
      });
      expect(note.body).toBe('Counterfeit goods');
      const audit = await db.auditLog.findFirstOrThrow({
        where: { action: 'listing.remove', entityId: listing.id },
      });
      expect(audit).toMatchObject({
        actorId: admin.id,
        metadata: { reason: 'Counterfeit goods', from: 'active' },
      });
      await http()
        .post(`/admin/listings/${listing.id}/remove`)
        .set('Authorization', seller.auth)
        .send({ reason: 'x x x' })
        .expect(403);
    });

    it('hides a review and the seller’s rating follows', async () => {
      const { order } = await seedOrder(app, buyer, seller);
      const r = await http()
        .post('/reviews')
        .set('Authorization', buyer.auth)
        .send({ orderId: order.id, rating: 1 });
      expect(
        (await db.profile.findUniqueOrThrow({ where: { userId: seller.id } })).ratingCount,
      ).toBe(1);
      await asAdmin('post', `/admin/reviews/${r.body.id}/hide`)
        .send({ reason: 'Not about the deal' })
        .expect(200);
      expect(
        (await db.profile.findUniqueOrThrow({ where: { userId: seller.id } })).ratingCount,
      ).toBe(0);
    });

    it('ban cuts the user off at once; unban restores access', async () => {
      // A real session, to prove the refresh token dies with the ban.
      const email = seller.email;
      const login = await http()
        .post('/auth/login')
        .send({ email, password: 'correct horse battery' })
        .expect(200);
      const cookies = cookiesFrom(login);

      await asAdmin('post', `/admin/users/${seller.id}/ban`)
        .send({ reason: 'Repeated scams' })
        .expect(200);
      await asAdmin('post', `/admin/users/${seller.id}/ban`)
        .send({ reason: 'Repeated scams' })
        .expect(409);
      await http().get('/me').set('Authorization', seller.auth).expect(403);
      await http()
        .post('/auth/refresh')
        .set('Cookie', `mh_rt=${cookies.mh_rt}; mh_csrf=${cookies.mh_csrf}`)
        .set('x-csrf-token', cookies.mh_csrf!)
        .expect((res) => expect([401, 403]).toContain(res.status));
      await http()
        .post('/auth/login')
        .send({ email, password: 'correct horse battery' })
        .expect(403);

      await asAdmin('post', `/admin/users/${seller.id}/unban`)
        .send({ reason: 'Appeal accepted' })
        .expect(200);
      await http()
        .post('/auth/login')
        .send({ email, password: 'correct horse battery' })
        .expect(200);
      const actions = await db.auditLog.findMany({
        where: { entityId: seller.id, action: { startsWith: 'user.' } },
        orderBy: { createdAt: 'asc' },
      });
      expect(actions.map((a) => a.action)).toEqual(
        expect.arrayContaining(['user.ban', 'user.unban']),
      );
    });

    it('warns with a notification; admins and self are off limits', async () => {
      await asAdmin('post', `/admin/users/${seller.id}/warn`)
        .send({ message: 'short' })
        .expect(400);
      await asAdmin('post', `/admin/users/${seller.id}/warn`)
        .send({ message: 'Please keep payments inside MarketHub.' })
        .expect(200);
      const note = await db.notification.findFirstOrThrow({
        where: { userId: seller.id, type: 'moderation.warning' },
      });
      expect(note.body).toBe('Please keep payments inside MarketHub.');

      const other = await makeUser(app, { role: 'admin' });
      await asAdmin('post', `/admin/users/${other.id}/ban`).send({ reason: 'test it' }).expect(403);
      await asAdmin('post', `/admin/users/${admin.id}/ban`).send({ reason: 'test it' }).expect(400);
    });
  });

  describe('views', () => {
    it('user search shows warnings and open reports', async () => {
      await asAdmin('post', `/admin/users/${seller.id}/warn`).send({
        message: 'Please keep payments inside MarketHub.',
      });
      await report(buyer, { entityType: 'user', entityId: seller.id, reason: 'offensive' }).expect(
        201,
      );
      const res = await asAdmin('get', `/admin/users?q=${seller.username}`).expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        id: seller.id,
        warnings: 1,
        openReports: 1,
        isBanned: false,
      });
      expect(res.body.items[0]).not.toHaveProperty('passwordHash');
      await asAdmin('get', '/admin/users?limit=51').expect(400);
    });

    it('audit log filters by entity and action prefix', async () => {
      await asAdmin('post', `/admin/users/${seller.id}/warn`).send({
        message: 'Please keep payments inside MarketHub.',
      });
      const res = await asAdmin(
        'get',
        `/admin/audit?entityType=user&entityId=${seller.id}&action=user.`,
      ).expect(200);
      expect(res.body.items[0]).toMatchObject({
        action: 'user.warn',
        actor: { id: admin.id },
        metadata: { message: 'Please keep payments inside MarketHub.' },
      });
      await http().get('/admin/audit').set('Authorization', seller.auth).expect(403);
    });

    it('overview counts the queues', async () => {
      const { listing } = await seedOrder(app, buyer, seller);
      await report(buyer, { entityType: 'listing', entityId: listing.id, reason: 'spam' }).expect(
        201,
      );
      const res = await asAdmin('get', '/admin/overview').expect(200);
      expect(res.body.openReports).toBeGreaterThanOrEqual(1);
      expect(res.body.completedOrders).toBeGreaterThanOrEqual(1);
      expect(res.body.gmv.find((g: { currency: string }) => g.currency === 'KES')).toBeTruthy();
    });
  });
});
