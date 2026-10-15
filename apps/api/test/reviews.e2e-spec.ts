import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, resetRateLimits, seedOrder, type TestUser } from './helpers';

describe('Reviews (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let buyer: TestUser;
  let seller: TestUser;
  const http = () => request(app.getHttpServer());
  const review = (user: TestUser, body: object) =>
    http().post('/reviews').set('Authorization', user.auth).send(body);

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetRateLimits();
    [buyer, seller] = await Promise.all([makeUser(app), makeUser(app)]);
  });
  afterAll(() => app.close());

  it('the buyer rates a completed order once; the seller profile updates', async () => {
    const { order } = await seedOrder(app, buyer, seller);
    const res = await review(buyer, {
      orderId: order.id,
      rating: 4,
      comment: 'Quick and honest',
    }).expect(201);
    expect(res.body).toMatchObject({
      orderId: order.id,
      rating: 4,
      comment: 'Quick and honest',
      counterpart: { userId: seller.id },
    });
    await review(buyer, { orderId: order.id, rating: 5 }).expect(409);

    const second = await seedOrder(app, buyer, seller);
    await review(buyer, { orderId: second.order.id, rating: 1 }).expect(201);
    const profile = await db.profile.findUniqueOrThrow({ where: { userId: seller.id } });
    expect(profile.ratingCount).toBe(2);
    expect(profile.ratingAvg.toFixed(2)).toBe('2.50');

    const note = await db.notification.findFirstOrThrow({
      where: { userId: seller.id, type: 'review.received' },
    });
    expect(note.link).toBe(`/u/${seller.username}?tab=reviews`);

    const detail = await http().get(`/orders/${order.id}`).set('Authorization', buyer.auth);
    expect(detail.body.review).toEqual({ rating: 4, comment: 'Quick and honest' });
  });

  it('only the buyer, only after completion, only real orders', async () => {
    const { order } = await seedOrder(app, buyer, seller);
    const stranger = await makeUser(app);
    await review(seller, { orderId: order.id, rating: 5 }).expect(403);
    await review(stranger, { orderId: order.id, rating: 5 }).expect(404);
    await review(buyer, { orderId: order.id, rating: 6 }).expect(400);
    await http().post('/reviews').send({ orderId: order.id, rating: 5 }).expect(401);

    const open = await seedOrder(app, buyer, seller, 'in_escrow');
    await review(buyer, { orderId: open.order.id, rating: 5 }).expect(409);
  });

  it('lists given and received, hiding moderated reviews from the profile', async () => {
    const { order } = await seedOrder(app, buyer, seller);
    const created = await review(buyer, { orderId: order.id, rating: 5 }).expect(201);

    const given = await http().get('/reviews/mine?role=given').set('Authorization', buyer.auth);
    expect(given.body.items.map((r: { id: string }) => r.id)).toEqual([created.body.id]);
    const received = await http().get('/reviews/mine').set('Authorization', seller.auth);
    expect(received.body.items[0]).toMatchObject({ rating: 5, counterpart: { userId: buyer.id } });

    await db.review.update({ where: { id: created.body.id }, data: { isVisible: false } });
    const hidden = await http().get('/reviews/mine').set('Authorization', seller.auth);
    expect(hidden.body.items).toEqual([]);
    const profile = await db.profile.findUniqueOrThrow({ where: { userId: seller.id } });
    expect(profile.ratingCount).toBe(0);
    const publicList = await http().get(`/users/${seller.id}/reviews`).expect(200);
    expect(publicList.body.items).toEqual([]);
  });
});
