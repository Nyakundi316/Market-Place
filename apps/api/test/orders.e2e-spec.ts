import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, resetRateLimits, type TestUser } from './helpers';

describe('Orders (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let categoryId: string;
  let seller: TestUser;
  let buyer: TestUser;
  let stranger: TestUser;
  let listingId: string;
  const http = () => request(app.getHttpServer());
  const word = () => `or${Math.random().toString(36).slice(2, 9)}`;
  const address = { recipient: 'Wanjiru K', line1: '14 Moi Ave', city: 'Nairobi', country: 'KE' };

  async function makeListing(owner: TestUser, extra: Record<string, unknown> = {}) {
    const slug = `order-${word()}`;
    return (
      await db.listing.create({
        data: {
          sellerId: owner.id,
          categoryId,
          type: 'product',
          title: `Espresso machine ${slug}`,
          slug,
          description: 'Dual boiler, descaled monthly, comes with a grinder.',
          price: 45000,
          currency: 'KES',
          stock: 2,
          status: 'active',
          publishedAt: new Date(),
          ...extra,
        },
      })
    ).id;
  }

  /** Opener offers, the listing owner accepts. Returns the accepted offer id. */
  async function acceptedOffer(opener: TestUser, owner: TestUser, id = listingId, quantity = 1) {
    const conv = await http()
      .post('/conversations')
      .set('Authorization', opener.auth)
      .send({ listingId: id });
    const offer = await http()
      .post('/offers')
      .set('Authorization', opener.auth)
      .send({ conversationId: conv.body.id, unitPrice: '40000', quantity })
      .expect(201);
    await http()
      .post(`/offers/${offer.body.id}/accept`)
      .set('Authorization', owner.auth)
      .expect(200);
    return offer.body.id as string;
  }

  const place = (user: TestUser, body: Record<string, unknown>) =>
    http().post('/orders').set('Authorization', user.auth).send(body);
  const act = (user: TestUser, id: string, action: string, body: object = {}) =>
    http().post(`/orders/${id}/${action}`).set('Authorization', user.auth).send(body);
  const setStatus = (id: string, status: 'in_escrow' | 'shipped') =>
    db.order.update({ where: { id }, data: { status } });

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    categoryId = (await db.category.create({ data: { name: 'Orders', slug: `cat-${word()}` } })).id;
  });
  beforeEach(async () => {
    await resetRateLimits();
    [seller, buyer, stranger] = await Promise.all([makeUser(app), makeUser(app), makeUser(app)]);
    listingId = await makeListing(seller);
  });
  afterAll(() => app.close());

  describe('POST /orders', () => {
    it('turns an accepted offer into an order and reserves stock', async () => {
      const offerId = await acceptedOffer(buyer, seller);
      const res = await place(buyer, {
        offerId,
        deliveryMethod: 'courier',
        deliveryAddress: address,
        notes: 'Call on arrival',
      }).expect(201);

      expect(res.body.orderNumber).toMatch(
        new RegExp(`^ORD-${new Date().getUTCFullYear()}-\\d{6,}$`),
      );
      expect(res.body).toMatchObject({
        side: 'buyer',
        status: 'awaiting_payment',
        offerId,
        quantity: 1,
        unitPrice: '40000.00',
        subtotal: '40000.00',
        platformFee: '800.00', // §12 default 2%, from the seller's side
        total: '40000.00',
        currency: 'KES',
        deliveryMethod: 'courier',
        deliveryAddress: address,
        notes: 'Call on arrival',
        actions: ['cancel'],
        buyer: { userId: buyer.id },
        seller: { userId: seller.id },
      });
      const due = (Date.parse(res.body.paymentDueAt) - Date.now()) / 3_600_000;
      expect(due).toBeGreaterThan(23.9);

      expect((await db.listing.findUniqueOrThrow({ where: { id: listingId } })).stock).toBe(1);
      const system = await db.message.findFirstOrThrow({ where: { type: 'system', offerId } });
      expect(system.body).toBe(`Order ${res.body.orderNumber} placed`);
      expect(
        await db.auditLog.count({ where: { entityId: res.body.id, action: 'order.create' } }),
      ).toBe(1);
      const note = await db.notification.findFirstOrThrow({
        where: { userId: seller.id, type: 'order.created' },
      });
      expect(note.link).toBe(`/orders/${res.body.id}`);

      const offers = await http().get('/offers/mine').set('Authorization', buyer.auth);
      expect(offers.body.items[0].orderId).toBe(res.body.id);
    });

    it('is idempotent per offer, including concurrent submits', async () => {
      const offerId = await acceptedOffer(buyer, seller);
      const body = { offerId, deliveryMethod: 'pickup' };
      const results = await Promise.all([
        place(buyer, body),
        place(buyer, body),
        place(buyer, body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await db.order.count({ where: { offerId } })).toBe(1);
      // Stock moved once.
      expect((await db.listing.findUniqueOrThrow({ where: { id: listingId } })).stock).toBe(1);
    });

    it('only the buyer, only from an accepted offer, with an address for courier', async () => {
      const offerId = await acceptedOffer(buyer, seller);
      await place(seller, { offerId, deliveryMethod: 'pickup' }).expect(403);
      await place(stranger, { offerId, deliveryMethod: 'pickup' }).expect(404);
      await place(buyer, { offerId, deliveryMethod: 'courier' }).expect(400);
      await http().post('/orders').send({ offerId, deliveryMethod: 'pickup' }).expect(401);

      const conv = await http()
        .post('/conversations')
        .set('Authorization', buyer.auth)
        .send({ listingId });
      const pending = await http()
        .post('/offers')
        .set('Authorization', buyer.auth)
        .send({ conversationId: conv.body.id, unitPrice: '41000' });
      await place(buyer, { offerId: pending.body.id, deliveryMethod: 'pickup' }).expect(409);
    });

    it('refuses when the listing sold out after the offer was accepted', async () => {
      const offerId = await acceptedOffer(buyer, seller, listingId, 2);
      await db.listing.update({ where: { id: listingId }, data: { stock: 1 } });
      const res = await place(buyer, { offerId, deliveryMethod: 'pickup' }).expect(409);
      expect(res.body.message).toBe('Only 1 left');
    });

    it('selling the last unit marks the listing sold; cancelling brings it back', async () => {
      const offerId = await acceptedOffer(buyer, seller, listingId, 2);
      const order = await place(buyer, { offerId, deliveryMethod: 'pickup' }).expect(201);
      let l = await db.listing.findUniqueOrThrow({ where: { id: listingId } });
      expect(l).toMatchObject({ stock: 0, status: 'sold' });
      expect(
        (await db.profile.findUniqueOrThrow({ where: { userId: seller.id } })).listingsCount,
      ).toBe(0);

      await act(seller, order.body.id, 'cancel', { reason: 'Found a crack' }).expect(200);
      l = await db.listing.findUniqueOrThrow({ where: { id: listingId } });
      expect(l).toMatchObject({ stock: 2, status: 'active' });
    });

    it('on a request listing, the poster is the buyer', async () => {
      const requestId = await makeListing(buyer, { type: 'request', stock: null });
      // The provider (seller) opens the chat and offers; the poster accepts.
      const offerId = await acceptedOffer(seller, buyer, requestId);
      await place(seller, { offerId, deliveryMethod: 'in_person' }).expect(403);
      const res = await place(buyer, { offerId, deliveryMethod: 'in_person' }).expect(201);
      expect(res.body).toMatchObject({ side: 'buyer', seller: { userId: seller.id } });
    });
  });

  describe('status changes', () => {
    let orderId: string;
    beforeEach(async () => {
      const offerId = await acceptedOffer(buyer, seller);
      orderId = (
        await place(buyer, { offerId, deliveryMethod: 'courier', deliveryAddress: address })
      ).body.id;
    });

    it('either side can cancel before payment, once', async () => {
      await act(stranger, orderId, 'cancel').expect(404);
      const res = await act(buyer, orderId, 'cancel', { reason: 'Changed my mind' }).expect(200);
      expect(res.body).toMatchObject({ status: 'cancelled', actions: [] });
      expect(res.body.cancelledAt).not.toBeNull();
      await act(seller, orderId, 'cancel').expect(409);

      const audit = await db.auditLog.findFirstOrThrow({
        where: { entityId: orderId, action: 'order.cancel' },
      });
      expect(audit).toMatchObject({ actorId: buyer.id });
      expect(audit.metadata).toMatchObject({ from: 'awaiting_payment', reason: 'Changed my mind' });
      const note = await db.notification.findFirstOrThrow({
        where: { userId: seller.id, type: 'order.cancelled' },
      });
      expect(note.body).toBe('Changed my mind');
    });

    it('can’t ship before payment (Phase 5 moves it to in_escrow)', async () => {
      const res = await act(seller, orderId, 'ship').expect(409);
      expect(res.body.message).toContain('awaiting payment');
    });

    it('ship → deliver → confirm, each by the right side', async () => {
      await setStatus(orderId, 'in_escrow');
      await act(buyer, orderId, 'cancel').expect(409); // paid orders go through refunds
      await act(buyer, orderId, 'ship').expect(403);

      const shipped = await act(seller, orderId, 'ship', { trackingNumber: 'G4S-55102' }).expect(
        200,
      );
      expect(shipped.body).toMatchObject({ status: 'shipped', trackingNumber: 'G4S-55102' });
      const shippedNote = await db.notification.findFirstOrThrow({
        where: { userId: buyer.id, type: 'order.shipped' },
      });
      expect(shippedNote.body).toBe('G4S-55102');

      const delivered = await act(seller, orderId, 'deliver').expect(200);
      expect(delivered.body.status).toBe('delivered');
      expect(delivered.body.deliveredAt).not.toBeNull();

      await act(seller, orderId, 'confirm-delivery').expect(403);
      const done = await act(buyer, orderId, 'confirm-delivery').expect(200);
      expect(done.body).toMatchObject({ status: 'completed', actions: [] });

      const profiles = await db.profile.findMany({
        where: { userId: { in: [buyer.id, seller.id] } },
      });
      expect(profiles.map((p) => p.completedDeals)).toEqual([1, 1]);
      const actions = await db.auditLog.findMany({
        where: { entityId: orderId },
        orderBy: { createdAt: 'asc' },
      });
      expect(actions.map((a) => a.action)).toEqual([
        'order.create',
        'order.ship',
        'order.deliver',
        'order.confirm_delivery',
      ]);
    });

    it('buyer may confirm straight from shipped', async () => {
      await setStatus(orderId, 'shipped');
      const done = await act(buyer, orderId, 'confirm-delivery').expect(200);
      expect(done.body.status).toBe('completed');
      expect(done.body.deliveredAt).not.toBeNull();
    });

    it('payment timeout cancels unpaid orders once and restocks', async () => {
      const service = app.get(OrdersService);
      expect(await service.cancelUnpaid(orderId)).toBe('skipped'); // not due

      await db.order.update({
        where: { id: orderId },
        data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
      });
      expect(await service.cancelUnpaid(orderId)).toBe('cancelled');
      expect(await service.cancelUnpaid(orderId)).toBe('skipped');

      expect((await db.listing.findUniqueOrThrow({ where: { id: listingId } })).stock).toBe(2);
      const audit = await db.auditLog.findFirstOrThrow({
        where: { entityId: orderId, action: 'order.auto_cancel' },
      });
      expect(audit.actorId).toBeNull();
      expect(
        await db.notification.count({
          where: { type: 'order.cancelled', payload: { path: ['orderId'], equals: orderId } },
        }),
      ).toBe(2);
    });

    it('payment timeout leaves paid orders alone', async () => {
      await db.order.update({
        where: { id: orderId },
        data: { status: 'in_escrow', createdAt: new Date(Date.now() - 25 * 3_600_000) },
      });
      expect(await app.get(OrdersService).cancelUnpaid(orderId)).toBe('skipped');
    });
  });

  describe('GET /orders', () => {
    it('lists by side and status; detail for parties only', async () => {
      const offerId = await acceptedOffer(buyer, seller);
      const order = await place(buyer, {
        offerId,
        deliveryMethod: 'courier',
        deliveryAddress: address,
      });

      const buying = await http()
        .get('/orders?role=buying')
        .set('Authorization', buyer.auth)
        .expect(200);
      expect(buying.body.items).toHaveLength(1);
      expect(buying.body.items[0]).not.toHaveProperty('deliveryAddress');
      const selling = await http()
        .get('/orders?role=selling')
        .set('Authorization', buyer.auth)
        .expect(200);
      expect(selling.body.items).toEqual([]);
      const sellerView = await http()
        .get('/orders?status=awaiting_payment')
        .set('Authorization', seller.auth)
        .expect(200);
      expect(sellerView.body.items[0]).toMatchObject({ side: 'seller', actions: ['cancel'] });

      const detail = await http()
        .get(`/orders/${order.body.id}`)
        .set('Authorization', seller.auth)
        .expect(200);
      expect(detail.body.deliveryAddress).toEqual(address);
      await http().get(`/orders/${order.body.id}`).set('Authorization', stranger.auth).expect(404);
      await http().get('/orders?limit=51').set('Authorization', buyer.auth).expect(400);
      await http().get('/orders?status=lost').set('Authorization', buyer.auth).expect(400);
    });

    it('paginates', async () => {
      const second = await makeListing(seller);
      for (const id of [listingId, second]) {
        const offerId = await acceptedOffer(buyer, seller, id);
        await place(buyer, { offerId, deliveryMethod: 'pickup' }).expect(201);
      }
      const p1 = await http().get('/orders?limit=1').set('Authorization', buyer.auth).expect(200);
      const p2 = await http()
        .get(`/orders?limit=1&cursor=${p1.body.nextCursor}`)
        .set('Authorization', buyer.auth)
        .expect(200);
      expect(p2.body.items[0].id).not.toBe(p1.body.items[0].id);
      expect(p2.body.nextCursor).toBeNull();
    });
  });
});
