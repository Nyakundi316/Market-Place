import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, resetRateLimits, type TestUser, uploadPng } from './helpers';

describe('Chat REST (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let categoryId: string;
  let seller: TestUser;
  let buyer: TestUser;
  let listingId: string;
  const http = () => request(app.getHttpServer());
  const word = () => `zc${Math.random().toString(36).slice(2, 9)}`;

  async function listing(owner: TestUser, status: 'active' | 'draft' = 'active') {
    const slug = `chat-${word()}`;
    const l = await db.listing.create({
      data: {
        sellerId: owner.id,
        categoryId,
        type: 'product',
        title: `Canon EOS ${slug}`,
        slug,
        description: 'Body only, shutter count 12k, no scratches on the sensor.',
        price: 54000,
        currency: 'KES',
        status,
        publishedAt: status === 'active' ? new Date() : null,
      },
    });
    return l.id;
  }

  const start = (user: TestUser, body: Record<string, unknown>) =>
    http().post('/conversations').set('Authorization', user.auth).send(body);
  const send = (user: TestUser, body: Record<string, unknown>) =>
    http().post('/messages').set('Authorization', user.auth).send(body);

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    categoryId = (await db.category.create({ data: { name: 'Chat test', slug: `cat-${word()}` } }))
      .id;
  });
  beforeEach(async () => {
    await resetRateLimits();
    [seller, buyer] = await Promise.all([makeUser(app), makeUser(app)]);
    listingId = await listing(seller);
  });
  afterAll(() => app.close());

  describe('POST /conversations', () => {
    it('find-or-create: 201 then 200 with the same conversation; counts the chat once', async () => {
      const first = await start(buyer, { listingId }).expect(201);
      const again = await start(buyer, { listingId }).expect(200);
      expect(again.body.id).toBe(first.body.id);
      expect(first.body).toMatchObject({
        role: 'buyer',
        unread: 0,
        lastMessage: null,
        listing: { id: listingId, price: '54000.00', currency: 'KES' },
        counterpart: { userId: seller.id, username: seller.username, online: false },
      });
      expect(first.body.lastMessageAt).toEqual(expect.any(String));
      const l = await db.listing.findUniqueOrThrow({ where: { id: listingId } });
      expect(l.chatCount).toBe(1);
    });

    it('concurrent opens land on one row', async () => {
      const results = await Promise.all([1, 2, 3].map(() => start(buyer, { listingId })));
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    });

    it('an opening message is stored and counts as unread for the seller', async () => {
      const res = await start(buyer, { listingId, body: '  Is it still available?  ' }).expect(201);
      expect(res.body.lastMessage).toMatchObject({ body: 'Is it still available?', type: 'text' });
      const seen = await http()
        .get(`/conversations/${res.body.id}`)
        .set('Authorization', seller.auth)
        .expect(200);
      expect(seen.body).toMatchObject({ role: 'seller', unread: 1 });
    });

    it('refuses your own listing, hidden listings, unverified users and users with no profile', async () => {
      await start(seller, { listingId }).expect(400);
      await start(buyer, { listingId: await listing(seller, 'draft') }).expect(404);
      await start(await makeUser(app, { verified: false }), { listingId }).expect(403);
      await start(await makeUser(app, { profile: false }), { listingId }).expect(403);
    });
  });

  describe('reading conversations', () => {
    it('lists for both sides, newest activity first; strangers get 404', async () => {
      const older = (await start(buyer, { listingId, body: 'first' }).expect(201)).body.id;
      const newer = (await start(buyer, { listingId: await listing(seller), body: 'second' })).body
        .id;

      const mine = await http().get('/conversations').set('Authorization', buyer.auth).expect(200);
      expect(mine.body.items.map((c: { id: string }) => c.id)).toEqual([newer, older]);

      const theirs = await http()
        .get('/conversations?limit=1')
        .set('Authorization', seller.auth)
        .expect(200);
      expect(theirs.body.items).toHaveLength(1);
      const next = await http()
        .get(`/conversations?limit=1&cursor=${theirs.body.nextCursor}`)
        .set('Authorization', seller.auth)
        .expect(200);
      expect(next.body.items[0].id).toBe(older);
      expect(next.body.nextCursor).toBeNull();

      const stranger = await makeUser(app);
      const none = await http().get('/conversations').set('Authorization', stranger.auth);
      expect(none.body.items).toEqual([]);
      await http().get(`/conversations/${older}`).set('Authorization', stranger.auth).expect(404);
      await http()
        .get(`/conversations/${older}/messages`)
        .set('Authorization', stranger.auth)
        .expect(404);
    });

    it('messages page newest first by cursor without gaps or repeats', async () => {
      const conversationId = (await start(buyer, { listingId }).expect(201)).body.id;
      for (let i = 1; i <= 5; i++) {
        await send(i % 2 ? buyer : seller, { conversationId, body: `m${i}` }).expect(201);
      }
      const seen: string[] = [];
      let cursor = '';
      do {
        const page = await http()
          .get(`/conversations/${conversationId}/messages?limit=2${cursor && `&cursor=${cursor}`}`)
          .set('Authorization', buyer.auth)
          .expect(200);
        seen.push(...page.body.items.map((m: { body: string }) => m.body));
        cursor = page.body.nextCursor ?? '';
      } while (cursor);
      expect(seen).toEqual(['m5', 'm4', 'm3', 'm2', 'm1']);
    });
  });

  describe('POST /messages', () => {
    it('only members can post; the body is stored raw', async () => {
      const conversationId = (await start(buyer, { listingId }).expect(201)).body.id;
      const raw = '<img src=x onerror=alert(1)> 50k?';
      const res = await send(seller, { conversationId, body: raw }).expect(201);
      expect(res.body).toMatchObject({ senderId: seller.id, body: raw, isRead: false });

      await send(await makeUser(app), { conversationId, body: 'hi' }).expect(404);
      await send(buyer, { conversationId, type: 'system', body: 'fake' }).expect(400);
    });

    it('attachments must be your own finished chat uploads', async () => {
      const conversationId = (await start(buyer, { listingId }).expect(201)).body.id;
      const own = await uploadPng(app, buyer, 'chat');
      await send(buyer, {
        conversationId,
        type: 'image',
        attachments: [{ url: own, contentType: 'image/png', size: 68 }],
      }).expect(201);

      const someoneElses = await uploadPng(app, seller, 'chat');
      await send(buyer, {
        conversationId,
        type: 'image',
        attachments: [{ url: someoneElses, contentType: 'image/png', size: 68 }],
      }).expect(400);
      const listingPhoto = await uploadPng(app, buyer, 'listing');
      await send(buyer, {
        conversationId,
        type: 'image',
        attachments: [{ url: listingPhoto, contentType: 'image/png', size: 68 }],
      }).expect(400);
    });

    it('rate limited to 20 per 10s', async () => {
      const conversationId = (await start(buyer, { listingId }).expect(201)).body.id;
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++)
        statuses.push((await send(buyer, { conversationId, body: `${i}` })).status);
      expect(statuses.slice(0, 20).every((s) => s === 201)).toBe(true);
      expect(statuses[20]).toBe(429);
    });
  });

  describe('POST /conversations/:id/read', () => {
    it('marks the other side’s messages read up to a point and recounts unread', async () => {
      const conversationId = (await start(buyer, { listingId }).expect(201)).body.id;
      const ids: string[] = [];
      for (const body of ['a', 'b', 'c']) {
        ids.push((await send(buyer, { conversationId, body }).expect(201)).body.id);
      }
      await send(seller, { conversationId, body: 'mine' }).expect(201);

      const partial = await http()
        .post(`/conversations/${conversationId}/read`)
        .set('Authorization', seller.auth)
        .send({ upTo: ids[1] })
        .expect(200);
      expect(partial.body.receipt).toMatchObject({ upTo: ids[1], byUser: seller.id });
      const mid = await http()
        .get(`/conversations/${conversationId}`)
        .set('Authorization', seller.auth);
      expect(mid.body.unread).toBe(1);

      const rest = await http()
        .post(`/conversations/${conversationId}/read`)
        .set('Authorization', seller.auth)
        .send({})
        .expect(200);
      expect(rest.body.receipt.upTo).toBe(ids[2]);
      const nothing = await http()
        .post(`/conversations/${conversationId}/read`)
        .set('Authorization', seller.auth)
        .send({})
        .expect(200);
      expect(nothing.body.receipt).toBeNull();

      const rows = await db.message.findMany({ where: { conversationId } });
      expect(rows.filter((m) => m.senderId === buyer.id).every((m) => m.isRead && m.readAt)).toBe(
        true,
      );
      expect(rows.find((m) => m.senderId === seller.id)?.isRead).toBe(false); // own messages untouched
      const after = await http()
        .get(`/conversations/${conversationId}`)
        .set('Authorization', seller.auth);
      expect(after.body.unread).toBe(0);
    });
  });
});
