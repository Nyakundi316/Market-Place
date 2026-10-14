import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OffersService } from '../src/modules/offers/offers.service';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, resetRateLimits, type TestUser } from './helpers';

describe('Offers (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let categoryId: string;
  let seller: TestUser;
  let buyer: TestUser;
  let stranger: TestUser;
  let listingId: string;
  let conversationId: string;
  const http = () => request(app.getHttpServer());
  const word = () => `of${Math.random().toString(36).slice(2, 9)}`;

  const offer = (user: TestUser, body: Record<string, unknown>) =>
    http()
      .post('/offers')
      .set('Authorization', user.auth)
      .send({ conversationId, ...body });
  const act = (user: TestUser, id: string, action: string, body: object = {}) =>
    http().post(`/offers/${id}/${action}`).set('Authorization', user.auth).send(body);
  const offerMessages = () =>
    db.message.findMany({
      where: { conversationId, type: { in: ['offer', 'offer_response'] } },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    categoryId = (await db.category.create({ data: { name: 'Offers', slug: `cat-${word()}` } })).id;
  });
  beforeEach(async () => {
    await resetRateLimits();
    [seller, buyer, stranger] = await Promise.all([makeUser(app), makeUser(app), makeUser(app)]);
    const slug = `offer-${word()}`;
    listingId = (
      await db.listing.create({
        data: {
          sellerId: seller.id,
          categoryId,
          type: 'product',
          title: `Road bike ${slug}`,
          slug,
          description: 'Aluminium frame, 105 groupset, serviced last month.',
          price: 30000,
          currency: 'KES',
          stock: 3,
          status: 'active',
          publishedAt: new Date(),
        },
      })
    ).id;
    conversationId = (
      await http().post('/conversations').set('Authorization', buyer.auth).send({ listingId })
    ).body.id;
  });
  afterAll(() => app.close());

  describe('POST /offers', () => {
    it('creates a pending offer priced server-side, posts it in chat, notifies the seller', async () => {
      const res = await offer(buyer, {
        unitPrice: '12500.5',
        quantity: 2,
        message: 'Cash today',
      }).expect(201);
      expect(res.body).toMatchObject({
        fromUserId: buyer.id,
        toUserId: seller.id,
        quantity: 2,
        unitPrice: '12500.50',
        totalPrice: '25001.00',
        currency: 'KES',
        status: 'pending',
        parentOfferId: null,
        orderId: null,
      });
      const hours = (Date.parse(res.body.expiresAt) - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(47.9);
      expect(hours).toBeLessThanOrEqual(48);

      const [msg] = await offerMessages();
      expect(msg).toMatchObject({ type: 'offer', offerId: res.body.id, body: 'Cash today' });
      const c = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      expect(c.sellerUnread).toBe(1);

      const note = await db.notification.findFirstOrThrow({ where: { userId: seller.id } });
      expect(note).toMatchObject({ type: 'offer.received', link: `/chat/${conversationId}` });
      expect(note.title).toContain('KES 25,001.00');
    });

    it('rejects client-sent totals/currency, bad quantities and non-members', async () => {
      await offer(buyer, { unitPrice: '10', totalPrice: '1' }).expect(400);
      await offer(buyer, { unitPrice: '10', currency: 'USD' }).expect(400);
      await offer(buyer, { unitPrice: '10', quantity: 0 }).expect(400);
      await offer(stranger, { unitPrice: '10' }).expect(404);
      await http().post('/offers').send({ conversationId, unitPrice: '10' }).expect(401);
    });

    it('needs a confirmed email', async () => {
      await db.user.update({ where: { id: buyer.id }, data: { isEmailVerified: false } });
      await offer(buyer, { unitPrice: '10' }).expect(403);
    });

    it('checks stock, fixed prices, job listings and listing status', async () => {
      await offer(buyer, { unitPrice: '100', quantity: 4 }).expect(400);

      await db.listing.update({ where: { id: listingId }, data: { isNegotiable: false } });
      const fixed = await offer(buyer, { unitPrice: '100' }).expect(400);
      expect(fixed.body.message).toContain('30,000.00');
      await offer(buyer, { unitPrice: '30000' }).expect(201);

      await db.listing.update({ where: { id: listingId }, data: { type: 'job' } });
      await offer(buyer, { unitPrice: '30000' }).expect(409);

      await db.listing.update({
        where: { id: listingId },
        data: { type: 'product', status: 'sold' },
      });
      await offer(buyer, { unitPrice: '30000' }).expect(409);
    });

    it('a second offer from the same side replaces the first', async () => {
      const first = await offer(buyer, { unitPrice: '20000' }).expect(201);
      const second = await offer(buyer, { unitPrice: '22000' }).expect(201);
      expect(second.body.parentOfferId).toBeNull();
      const old = await db.offer.findUniqueOrThrow({ where: { id: first.body.id } });
      expect(old.status).toBe('withdrawn');
      expect(await db.offer.count({ where: { conversationId, status: 'pending' } })).toBe(1);
    });

    it('an offer from the other side counts as a counter', async () => {
      const first = await offer(buyer, { unitPrice: '20000' }).expect(201);
      const reply = await offer(seller, { unitPrice: '27000' }).expect(201);
      expect(reply.body).toMatchObject({ parentOfferId: first.body.id, toUserId: buyer.id });
      expect((await db.offer.findUniqueOrThrow({ where: { id: first.body.id } })).status).toBe(
        'countered',
      );
      const note = await db.notification.findFirstOrThrow({ where: { userId: buyer.id } });
      expect(note.type).toBe('offer.countered');
    });
  });

  describe('responding', () => {
    let offerId: string;
    beforeEach(async () => {
      offerId = (await offer(buyer, { unitPrice: '25000', message: 'Fair?' })).body.id;
    });

    it('counter: only the recipient; keeps quantity unless changed', async () => {
      await act(buyer, offerId, 'counter', { unitPrice: '26000' }).expect(409);
      await act(stranger, offerId, 'counter', { unitPrice: '26000' }).expect(404);
      const res = await act(seller, offerId, 'counter', { unitPrice: '28000' }).expect(201);
      expect(res.body).toMatchObject({
        parentOfferId: offerId,
        fromUserId: seller.id,
        quantity: 1,
        totalPrice: '28000.00',
      });
      // The original is settled now.
      await act(seller, offerId, 'accept').expect(409);
    });

    it('accept: recipient only, once', async () => {
      await act(buyer, offerId, 'accept').expect(409);
      await act(stranger, offerId, 'accept').expect(404);
      const res = await act(seller, offerId, 'accept').expect(200);
      expect(res.body.status).toBe('accepted');
      expect(res.body.respondedAt).not.toBeNull();
      const again = await act(seller, offerId, 'accept').expect(409);
      expect(again.body.message).toContain('already accepted');

      const msgs = await offerMessages();
      expect(msgs.map((m) => m.type)).toEqual(['offer', 'offer_response']);
      expect(msgs[1]!.senderId).toBe(seller.id);
      const note = await db.notification.findFirstOrThrow({
        where: { userId: buyer.id, type: 'offer.accepted' },
      });
      expect(note.title).toContain('accepted your');
    });

    it('accept: concurrent clicks settle exactly once', async () => {
      const results = await Promise.all([
        act(seller, offerId, 'accept'),
        act(seller, offerId, 'accept'),
        act(seller, offerId, 'accept'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect(await db.message.count({ where: { offerId, type: 'offer_response' } })).toBe(1);
    });

    it('accept: re-checks the listing', async () => {
      await db.listing.update({ where: { id: listingId }, data: { stock: 0 } });
      await act(seller, offerId, 'accept').expect(400);
      await db.listing.update({ where: { id: listingId }, data: { stock: 2, status: 'removed' } });
      await act(seller, offerId, 'accept').expect(409);
    });

    it('decline with a note; withdraw by the author only', async () => {
      await act(seller, offerId, 'withdraw').expect(409);
      const declined = await act(seller, offerId, 'decline', { message: 'Too low' }).expect(200);
      expect(declined.body.status).toBe('declined');
      const [, response] = await offerMessages();
      expect(response).toMatchObject({ type: 'offer_response', body: 'Too low' });

      const next = (await offer(buyer, { unitPrice: '27000' })).body.id as string;
      await act(seller, next, 'withdraw').expect(409);
      await act(buyer, next, 'decline').expect(409);
      expect((await act(buyer, next, 'withdraw').expect(200)).body.status).toBe('withdrawn');
      await act(buyer, next, 'withdraw').expect(409);
    });

    it('expiry: the job settles it once; late accepts are refused', async () => {
      const service = app.get(OffersService);
      expect(await service.expire(offerId)).toBe('skipped'); // not due yet

      await db.offer.update({
        where: { id: offerId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await act(seller, offerId, 'accept').expect(409);
      expect(await service.expire(offerId)).toBe('expired');
      expect(await service.expire(offerId)).toBe('skipped');

      const row = await db.offer.findUniqueOrThrow({ where: { id: offerId } });
      expect(row.status).toBe('expired');
      const [, response] = await offerMessages();
      // Posted as the author, so it's the seller's unread count that moves.
      expect(response).toMatchObject({ type: 'offer_response', senderId: buyer.id });
      const note = await db.notification.findFirstOrThrow({
        where: { userId: buyer.id, type: 'offer.expired' },
      });
      expect(note.title).toContain('expired');
    });

    it('rejects a malformed id', async () => {
      await act(seller, 'not-a-uuid', 'accept').expect(400);
    });
  });

  describe('GET /offers/mine', () => {
    it('filters by side, status and conversation; paginates', async () => {
      const a = (await offer(buyer, { unitPrice: '20000' })).body.id as string;
      await act(seller, a, 'counter', { unitPrice: '29000' }).expect(201);

      const sent = await http()
        .get('/offers/mine?role=sent')
        .set('Authorization', buyer.auth)
        .expect(200);
      expect(sent.body.items).toHaveLength(1);
      expect(sent.body.items[0]).toMatchObject({
        id: a,
        status: 'countered',
        direction: 'sent',
        listing: { id: listingId },
        counterpart: { userId: seller.id },
      });

      const pending = await http()
        .get(`/offers/mine?status=pending&conversationId=${conversationId}`)
        .set('Authorization', buyer.auth)
        .expect(200);
      expect(pending.body.items).toHaveLength(1);
      expect(pending.body.items[0].direction).toBe('received');

      const page1 = await http()
        .get('/offers/mine?limit=1')
        .set('Authorization', seller.auth)
        .expect(200);
      expect(page1.body.nextCursor).toBeTruthy();
      const page2 = await http()
        .get(`/offers/mine?limit=1&cursor=${page1.body.nextCursor}`)
        .set('Authorization', seller.auth)
        .expect(200);
      expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);

      const none = await http().get('/offers/mine').set('Authorization', stranger.auth).expect(200);
      expect(none.body.items).toEqual([]);
      await http().get('/offers/mine?limit=51').set('Authorization', buyer.auth).expect(400);
    });
  });
});
