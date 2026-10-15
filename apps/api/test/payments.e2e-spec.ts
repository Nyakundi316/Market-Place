import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EscrowService } from '../src/modules/payments/escrow.service';
import { Gateways } from '../src/modules/payments/providers/gateways';
import { ReconciliationService } from '../src/modules/payments/reconciliation.service';
import { REDIS } from '../src/redis/redis.module';
import type Redis from 'ioredis';
import { SANDBOX_CARDS } from '../src/modules/payments/providers/sandbox.provider';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, resetRateLimits, type TestUser } from './helpers';

/** Polls until `check` returns something truthy (in-process BullMQ workers run async). */
async function until<T>(check: () => Promise<T>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await check();
    if (v || Date.now() > deadline) return v;
    await new Promise((r) => setTimeout(r, 150));
  }
}

describe('Payments & escrow (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let gateways: Gateways;
  let escrow: EscrowService;
  let categoryId: string;
  let seller: TestUser;
  let buyer: TestUser;
  let stranger: TestUser;
  let listingId: string;
  const http = () => request(app.getHttpServer());
  const word = () => `py${Math.random().toString(36).slice(2, 9)}`;

  /** Offer at 43,000 KES accepted and checked out; returns the order id. */
  async function placeOrder() {
    const conv = await http()
      .post('/conversations')
      .set('Authorization', buyer.auth)
      .send({ listingId });
    const offer = await http()
      .post('/offers')
      .set('Authorization', buyer.auth)
      .send({ conversationId: conv.body.id, unitPrice: '43000' });
    await http()
      .post(`/offers/${offer.body.id}/accept`)
      .set('Authorization', seller.auth)
      .expect(200);
    const order = await http()
      .post('/orders')
      .set('Authorization', buyer.auth)
      .send({ offerId: offer.body.id, deliveryMethod: 'pickup' })
      .expect(201);
    return order.body.id as string;
  }

  const pay = (user: TestUser, orderId: string) =>
    http().post(`/orders/${orderId}/pay`).set('Authorization', user.auth);
  const card = (user: TestUser, ref: string, number: string) =>
    http()
      .post('/payments/sandbox/pay')
      .set('Authorization', user.auth)
      .send({ ref, card: number });
  const act = (user: TestUser, orderId: string, action: string, body: object = {}) =>
    http().post(`/orders/${orderId}/${action}`).set('Authorization', user.auth).send(body);

  async function paidOrder() {
    const orderId = await placeOrder();
    const session = await pay(buyer, orderId).expect(200);
    await card(buyer, session.body.clientSecret, SANDBOX_CARDS.ok).expect(200);
    return orderId;
  }
  const sandboxPayouts = (user: TestUser) =>
    http()
      .post('/me/payout-accounts/paystack')
      .set('Authorization', user.auth)
      .send({ bankCode: 'SBX001', accountNumber: '0123456789', currency: 'KES' })
      .expect(200);

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    gateways = app.get(Gateways);
    escrow = app.get(EscrowService);
    categoryId = (await db.category.create({ data: { name: 'Payments', slug: `cat-${word()}` } }))
      .id;
  });
  beforeEach(async () => {
    await resetRateLimits();
    [seller, buyer, stranger] = await Promise.all([makeUser(app), makeUser(app), makeUser(app)]);
    const slug = `pay-${word()}`;
    listingId = (
      await db.listing.create({
        data: {
          sellerId: seller.id,
          categoryId,
          type: 'product',
          title: `Sofa set ${slug}`,
          slug,
          description: 'Five-seater, grey fabric, two years old, no stains or tears.',
          price: 45000,
          currency: 'KES',
          stock: 1,
          status: 'active',
          publishedAt: new Date(),
        },
      })
    ).id;
  });
  afterAll(() => app.close());

  describe('POST /orders/:id/pay', () => {
    it('opens one payment session per order, for the buyer only', async () => {
      const orderId = await placeOrder();
      await pay(seller, orderId).expect(403);
      await pay(stranger, orderId).expect(404);
      await http().post(`/orders/${orderId}/pay`).expect(401);

      const [a, b] = await Promise.all([pay(buyer, orderId), pay(buyer, orderId)]);
      expect(a.status).toBe(200);
      expect(b.body.clientSecret).toBe(a.body.clientSecret);
      expect(a.body).toMatchObject({
        orderId,
        gateway: 'sandbox', // KES routes to Paystack, which has no keys here
        status: 'requires_action',
        amount: '43000.00',
        currency: 'KES',
        publishableKey: null,
      });
      expect(await db.transaction.count({ where: { orderId, type: 'charge' } })).toBe(1);
      const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe('awaiting_payment'); // only a webhook moves it (§7)
    });

    it('a declined card leaves the order unpaid; a retry gets a fresh charge and lands in escrow', async () => {
      const orderId = await placeOrder();
      const first = await pay(buyer, orderId).expect(200);
      expect((await card(buyer, first.body.clientSecret, SANDBOX_CARDS.declined)).body.status).toBe(
        'failed',
      );
      expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        'awaiting_payment',
      );
      expect(
        await db.notification.count({ where: { userId: buyer.id, type: 'payment.failed' } }),
      ).toBe(1);

      const second = await pay(buyer, orderId).expect(200);
      expect(second.body.clientSecret).not.toBe(first.body.clientSecret);
      await card(buyer, second.body.clientSecret, SANDBOX_CARDS.ok).expect(200);

      const order = await db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { escrow: true, transactions: { orderBy: { createdAt: 'asc' } } },
      });
      expect(order.status).toBe('in_escrow');
      expect(order.paidAt).not.toBeNull();
      expect(order.escrow).toMatchObject({ status: 'held', currency: 'KES' });
      expect(order.escrow!.amount.toFixed(2)).toBe('43000.00');
      expect(
        order.transactions.map((t) => [t.idempotencyKey.split(':').slice(2).join(':'), t.status]),
      ).toEqual([
        ['charge', 'failed'],
        ['charge:2', 'succeeded'],
      ]);
      const audit = await db.auditLog.findMany({
        where: { entityId: orderId, action: { in: ['order.paid', 'escrow.hold'] } },
      });
      expect(audit).toHaveLength(2);
      expect(
        await db.notification.count({ where: { userId: seller.id, type: 'order.paid' } }),
      ).toBe(1);

      // Paying again is a no-op that says so.
      const again = await pay(buyer, orderId).expect(200);
      expect(again.body).toMatchObject({ status: 'succeeded', clientSecret: null });
    });

    it('refuses closed orders and expired payment windows', async () => {
      const orderId = await placeOrder();
      await db.order.update({
        where: { id: orderId },
        data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
      });
      await pay(buyer, orderId).expect(409);
      await act(buyer, orderId, 'cancel').expect(200);
      await pay(buyer, orderId).expect(409);
    });

    it('is behind the payment rate limit (5/min)', async () => {
      const orderId = await placeOrder();
      for (let i = 0; i < 5; i++) await pay(buyer, orderId).expect(200);
      await pay(buyer, orderId).expect(429);
    });
  });

  describe('webhooks', () => {
    async function signedSuccess(orderId: string) {
      const session = await pay(buyer, orderId).expect(200);
      return gateways.sandbox.pay(session.body.clientSecret, SANDBOX_CARDS.ok);
    }
    const post = (raw: Buffer, signature: string) =>
      http()
        .post('/webhooks/sandbox')
        .set('Content-Type', 'application/json')
        .set('x-sandbox-signature', signature)
        .send(raw.toString());

    it('applies an event once; replays are acknowledged and ignored', async () => {
      const orderId = await placeOrder();
      const signed = (await signedSuccess(orderId))!;
      const first = await post(signed.raw, signed.signature).expect(200);
      expect(first.body).toEqual({ received: true, duplicate: false });
      const replay = await post(signed.raw, signed.signature).expect(200);
      expect(replay.body).toEqual({ received: true, duplicate: true });
      expect(await db.escrowHold.count({ where: { orderId } })).toBe(1);
      expect(
        await db.notification.count({ where: { userId: seller.id, type: 'order.paid' } }),
      ).toBe(1);
    });

    it('rejects bad or missing signatures without touching anything', async () => {
      const orderId = await placeOrder();
      const signed = (await signedSuccess(orderId))!;
      await post(signed.raw, 'ab'.repeat(32)).expect(400);
      await http().post('/webhooks/sandbox').send(signed.raw.toString()).expect(400);
      const tampered = Buffer.from(signed.raw.toString().replace('43000.00', '1.00'));
      await post(tampered, signed.signature).expect(400);
      expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        'awaiting_payment',
      );
      // Unconfigured real gateways aren't open endpoints.
      await http().post('/webhooks/stripe').set('stripe-signature', 'x').send('{}').expect(404);
    });

    it('a success for the wrong amount never pays the order', async () => {
      const orderId = await placeOrder();
      const session = await pay(buyer, orderId).expect(200);
      const raw = Buffer.from(
        JSON.stringify({
          id: `sbx_evt_${word()}`,
          type: 'charge.succeeded',
          ref: session.body.clientSecret,
          amount: '43.00',
          currency: 'KES',
        }),
      );
      await post(raw, gateways.sandbox.sign(raw)).expect(200);
      expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        'awaiting_payment',
      );
      expect(await db.auditLog.count({ where: { action: 'payment.mismatch' } })).toBeGreaterThan(0);
    });

    it('money that arrives after the order closed goes straight back', async () => {
      const orderId = await placeOrder();
      const signed = (await signedSuccess(orderId))!;
      await act(seller, orderId, 'cancel').expect(200);
      await post(signed.raw, signed.signature).expect(200);
      const refund = await until(() =>
        db.transaction.findFirst({ where: { orderId, type: 'refund' } }),
      );
      expect(refund).toMatchObject({ status: 'succeeded', userId: buyer.id });
      expect(refund!.amount.toFixed(2)).toBe('43000.00');
      expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        'cancelled',
      );
    });
  });

  describe('release', () => {
    it('confirm-delivery pays the seller net of the fee once a payout account exists', async () => {
      const orderId = await paidOrder();
      await act(seller, orderId, 'ship', { trackingNumber: 'G4S-1' }).expect(200);
      await act(buyer, orderId, 'confirm-delivery').expect(200);

      // No payout account yet: the money waits in escrow and the seller is told.
      const nudge = await until(() =>
        db.notification.findFirst({ where: { userId: seller.id, type: 'payout.setup_needed' } }),
      );
      expect(nudge?.link).toBe('/settings#payouts');
      expect((await db.escrowHold.findUniqueOrThrow({ where: { orderId } })).status).toBe('held');

      const account = await sandboxPayouts(seller);
      expect(account.body).toMatchObject({
        status: 'ready',
        details: { label: 'Sandbox Bank ····6789' },
      });

      const hold = await until(async () => {
        const h = await db.escrowHold.findUniqueOrThrow({ where: { orderId } });
        return h.status === 'released' ? h : null;
      });
      expect(hold?.releasedAt).not.toBeNull();
      const txns = await db.transaction.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      expect(txns.map((t) => [t.type, t.status, t.amount.toFixed(2)])).toEqual([
        ['charge', 'succeeded', '43000.00'],
        ['payout', 'succeeded', '42140.00'],
        ['fee', 'succeeded', '860.00'],
      ]);
      expect(await escrow.release(orderId)).toBe('skipped'); // idempotent
      expect(
        await db.notification.count({ where: { userId: seller.id, type: 'payout.sent' } }),
      ).toBe(1);
    });

    it('auto-releases ESCROW_AUTO_RELEASE_HOURS after delivery if the buyer stays quiet', async () => {
      await sandboxPayouts(seller);
      const orderId = await paidOrder();
      await act(seller, orderId, 'ship').expect(200);
      await act(seller, orderId, 'deliver').expect(200);
      const scheduled = await db.escrowHold.findUniqueOrThrow({ where: { orderId } });
      const hours = (scheduled.releaseScheduledAt!.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(71.9);

      expect(await escrow.autoRelease(orderId)).toBe('skipped'); // not due
      await db.order.update({
        where: { id: orderId },
        data: { deliveredAt: new Date(Date.now() - 73 * 3_600_000) },
      });
      expect(await escrow.autoRelease(orderId)).toBe('released');
      const order = await db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { escrow: true },
      });
      expect(order.status).toBe('completed');
      expect(order.escrow!.status).toBe('released');
      expect(
        await db.auditLog.count({ where: { entityId: orderId, action: 'order.auto_complete' } }),
      ).toBe(1);
    });
  });

  describe('disputes and refunds', () => {
    it('buyer disputes within the window; admin splits it', async () => {
      const admin = await makeUser(app, { role: 'admin' });
      await sandboxPayouts(seller);
      const orderId = await paidOrder();
      await act(seller, orderId, 'ship').expect(200);

      await act(seller, orderId, 'dispute', { reason: 'Seller cannot dispute this' }).expect(403);
      await act(buyer, orderId, 'dispute', { reason: 'short' }).expect(400);
      await act(buyer, orderId, 'dispute', { reason: 'Arrived with a torn cushion' }).expect(200);
      const held = await db.escrowHold.findUniqueOrThrow({ where: { orderId } });
      expect(held).toMatchObject({
        status: 'disputed',
        disputeReason: 'Arrived with a torn cushion',
      });
      await act(buyer, orderId, 'confirm-delivery').expect(409);
      await until(() =>
        db.notification.findFirst({ where: { userId: admin.id, type: 'order.disputed' } }),
      );

      const queue = await http()
        .get('/admin/disputes')
        .set('Authorization', admin.auth)
        .expect(200);
      expect(queue.body.items.some((d: { orderId: string }) => d.orderId === orderId)).toBe(true);
      await http().get('/admin/disputes').set('Authorization', buyer.auth).expect(403);

      const resolve = (user: TestUser, body: object) =>
        http()
          .post(`/admin/disputes/${orderId}/resolve`)
          .set('Authorization', user.auth)
          .send(body);
      await resolve(buyer, { outcome: 'refund', note: 'nope' }).expect(403);
      await resolve(admin, { outcome: 'split', refundAmount: '43000', note: 'all of it' }).expect(
        400,
      );
      await resolve(admin, {
        outcome: 'split',
        refundAmount: '10000',
        note: 'Cushion repair cost',
      }).expect(200);

      const order = await db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { escrow: true },
      });
      expect(order.status).toBe('completed');
      expect(order.escrow!.status).toBe('partially_refunded');
      const txns = await db.transaction.findMany({
        where: { orderId },
        orderBy: { createdAt: 'asc' },
      });
      expect(txns.map((t) => [t.type, t.amount.toFixed(2)])).toEqual([
        ['charge', '43000.00'],
        ['refund', '10000.00'],
        ['payout', '32340.00'], // 33,000 kept − 2% fee
        ['fee', '660.00'],
      ]);
      await resolve(admin, { outcome: 'refund', note: 'again' }).expect(409);
      expect(
        await db.auditLog.count({ where: { entityId: orderId, action: 'dispute.resolve' } }),
      ).toBe(1);
      expect(
        await db.notification.count({
          where: { type: 'dispute.resolved', payload: { path: ['orderId'], equals: orderId } },
        }),
      ).toBe(2);
    });

    it('disputes close DISPUTE_WINDOW_DAYS after delivery', async () => {
      const orderId = await paidOrder();
      await act(seller, orderId, 'ship').expect(200);
      await act(seller, orderId, 'deliver').expect(200);
      await db.order.update({
        where: { id: orderId },
        data: { deliveredAt: new Date(Date.now() - 8 * 86_400_000) },
      });
      const detail = await http().get(`/orders/${orderId}`).set('Authorization', buyer.auth);
      expect(detail.body.actions).not.toContain('dispute');
      await act(buyer, orderId, 'dispute', { reason: 'Too late to complain now' }).expect(409);
    });

    it('seller refunds a paid order they can’t fulfil; stock comes back', async () => {
      const orderId = await paidOrder();
      expect((await db.listing.findUniqueOrThrow({ where: { id: listingId } })).status).toBe(
        'sold',
      );
      await act(buyer, orderId, 'refund').expect(403);
      await act(seller, orderId, 'refund', { reason: 'Damaged in storage' }).expect(200);

      const order = await db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { escrow: true },
      });
      expect(order.status).toBe('refunded');
      expect(order.escrow!.status).toBe('refunded');
      const refund = await db.transaction.findFirstOrThrow({ where: { orderId, type: 'refund' } });
      expect(refund.amount.toFixed(2)).toBe('43000.00');
      expect(await db.listing.findUniqueOrThrow({ where: { id: listingId } })).toMatchObject({
        stock: 1,
        status: 'active',
      });
      await act(seller, orderId, 'refund').expect(409);
    });
  });

  describe('payout accounts', () => {
    it('lists and replaces the seller’s account; validates bank details', async () => {
      await http()
        .post('/me/payout-accounts/paystack')
        .set('Authorization', seller.auth)
        .send({ bankCode: 'SBX001', accountNumber: 'abc', currency: 'KES' })
        .expect(400);
      await sandboxPayouts(seller);
      const list = await http()
        .get('/me/payout-accounts')
        .set('Authorization', seller.auth)
        .expect(200);
      expect(list.body).toHaveLength(1);
      const banks = await http()
        .get('/payments/banks?currency=KES')
        .set('Authorization', seller.auth)
        .expect(200);
      expect(banks.body[0]).toMatchObject({ code: 'SBX001' });
      await http()
        .get('/payments/banks?currency=USD')
        .set('Authorization', seller.auth)
        .expect(400);
    });
  });

  describe('reconciliation', () => {
    const backdate = (orderId: string) =>
      db.transaction.updateMany({
        where: { orderId, type: 'charge' },
        data: { createdAt: new Date(Date.now() - 20 * 60_000) },
      });

    it('recovers a payment whose webhook never arrived, exactly once', async () => {
      const orderId = await placeOrder();
      const session = await pay(buyer, orderId).expect(200);
      await gateways.sandbox.pay(session.body.clientSecret, SANDBOX_CARDS.ok); // webhook "lost"
      await backdate(orderId);

      const recon = app.get(ReconciliationService);
      const report = await recon.run();
      const txn = await db.transaction.findFirstOrThrow({ where: { orderId, type: 'charge' } });
      expect(report.recovered).toContain(txn.id);
      expect((await db.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        'in_escrow',
      );

      const again = await recon.run();
      expect(again.recovered).not.toContain(txn.id);
      expect(await db.escrowHold.count({ where: { orderId } })).toBe(1);
    });

    it('closes abandoned charges and alerts admins about ledger mismatches', async () => {
      const admin = await makeUser(app, { role: 'admin' });
      const abandoned = await placeOrder();
      const s1 = await pay(buyer, abandoned).expect(200);
      await gateways.sandbox.pay(s1.body.clientSecret, SANDBOX_CARDS.declined);
      await backdate(abandoned);

      // A paid order the gateway now reports for a different amount.
      await db.listing.update({ where: { id: listingId }, data: { stock: 2, status: 'active' } });
      const paid = await paidOrder();
      const charge = await db.transaction.findFirstOrThrow({
        where: { orderId: paid, type: 'charge', status: 'succeeded' },
      });
      const redis = app.get<Redis>(REDIS);
      const key = `sandbox:charge:${charge.gatewayRef}`;
      await redis.set(
        key,
        JSON.stringify({ ...JSON.parse((await redis.get(key))!), amount: '4300.00' }),
      );

      const report = await app.get(ReconciliationService).run();
      const failedTxn = await db.transaction.findFirstOrThrow({
        where: { orderId: abandoned, type: 'charge' },
      });
      expect(report.failed).toContain(failedTxn.id);
      expect(failedTxn.status).toBe('failed');
      expect(report.mismatches).toContainEqual({
        txnId: charge.id,
        ours: '43000.00 KES succeeded',
        theirs: '4300.00 KES succeeded',
      });
      expect(
        await db.auditLog.count({ where: { action: 'reconcile.mismatch', entityId: charge.id } }),
      ).toBe(1);
      const alert = await db.notification.findFirstOrThrow({ where: { userId: admin.id } });
      expect(alert.title).toMatch(/Reconciliation/);
    });
  });
});
