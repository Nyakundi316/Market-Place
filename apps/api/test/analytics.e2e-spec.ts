import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, resetRateLimits, seedOrder, type TestUser } from './helpers';

describe('Seller analytics (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let seller: TestUser;
  let buyer: TestUser;
  const http = () => request(app.getHttpServer());
  const minutes = (n: number) => new Date(Date.now() - n * 60_000);

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetRateLimits();
    [seller, buyer] = await Promise.all([makeUser(app), makeUser(app)]);
  });
  afterAll(() => app.close());

  it('summarises listings, offers, orders, payouts and responsiveness', async () => {
    // Two chats: one answered within the hour, one never answered → 50%.
    const answered = await seedOrder(app, buyer, seller);
    const ignored = await seedOrder(app, buyer, seller, 'in_escrow');
    await db.message.createMany({
      data: [
        {
          conversationId: answered.conversation.id,
          senderId: buyer.id,
          body: 'Still there?',
          createdAt: minutes(120),
        },
        {
          conversationId: answered.conversation.id,
          senderId: seller.id,
          body: 'Yes!',
          createdAt: minutes(90),
        },
        {
          conversationId: ignored.conversation.id,
          senderId: buyer.id,
          body: 'Hello?',
          createdAt: minutes(60),
        },
      ],
    });
    await db.listing.update({
      where: { id: answered.listing.id },
      data: { viewsCount: 40, favoritesCount: 3, chatCount: 1 },
    });
    await db.transaction.create({
      data: {
        orderId: answered.order.id,
        userId: seller.id,
        type: 'payout',
        status: 'succeeded',
        amount: 980,
        currency: 'KES',
        gateway: 'sandbox',
        idempotencyKey: `order:${answered.order.id}:payout`,
      },
    });

    const res = await http()
      .get('/me/analytics?days=7')
      .set('Authorization', seller.auth)
      .expect(200);
    expect(res.body).toMatchObject({
      days: 7,
      listings: { active: 2, views: 40, favorites: 3, chats: 1 },
      offers: { received: 2, accepted: 2, acceptanceRate: 100 },
      orders: { completed: 1, inProgress: 1, cancelled: 0, refunded: 0 },
      earnings: [{ currency: 'KES', amount: '980.00' }],
      responseRate: 50,
    });
    expect(res.body.topListings[0]).toMatchObject({ id: answered.listing.id, views: 40 });

    // The nightly job writes it onto the public profile.
    await app.get(AnalyticsService).refreshResponseRates();
    const profile = await db.profile.findUniqueOrThrow({ where: { userId: seller.id } });
    expect(profile.responseRate.toNumber()).toBe(50);
  });

  it('is empty-safe and validates the window', async () => {
    const res = await http().get('/me/analytics').set('Authorization', seller.auth).expect(200);
    expect(res.body).toMatchObject({
      days: 30,
      responseRate: null,
      earnings: [],
      offers: { acceptanceRate: null },
    });
    await http().get('/me/analytics?days=45').set('Authorization', seller.auth).expect(400);
    await http().get('/me/analytics').expect(401);
  });
});
