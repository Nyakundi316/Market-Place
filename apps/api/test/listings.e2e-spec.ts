import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, resetRateLimits, type TestUser, uploadPng } from './helpers';

describe('Listings (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let seller: TestUser;
  let leafId: string;
  let rootId: string;
  const http = () => request(app.getHttpServer());
  const word = () => `zq${Math.random().toString(36).slice(2, 9)}`;

  async function draft(user: TestUser, body: Record<string, unknown> = {}) {
    const images = body.images ?? [{ url: await uploadPng(app, user) }];
    const res = await http()
      .post('/listings')
      .set('Authorization', user.auth)
      .send({
        categoryId: leafId,
        type: 'product',
        title: `Samsung A54 ${word()}`,
        description: 'Barely used, 128GB, includes charger and a clear case.',
        price: 32000,
        currency: 'KES',
        country: 'KE',
        city: 'Nairobi',
        ...body,
        images,
      });
    if (res.status !== 201) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
    return res.body as { id: string; slug: string; title: string };
  }

  async function live(user: TestUser, body: Record<string, unknown> = {}) {
    const l = await draft(user, body);
    const res = await http()
      .post(`/listings/${l.id}/publish`)
      .set('Authorization', user.auth)
      .expect(200);
    return res.body as { id: string; slug: string; title: string };
  }

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    const root = await db.category.create({
      data: { name: 'Test root', slug: `root-${word()}` },
    });
    const leaf = await db.category.create({
      data: { name: 'Test leaf', slug: `leaf-${word()}`, parentId: root.id },
    });
    rootId = root.id;
    leafId = leaf.id;
  });
  beforeEach(async () => {
    await resetRateLimits();
    seller = await makeUser(app);
  });
  afterAll(() => app.close());

  describe('POST /listings', () => {
    it('401 anonymous', () => http().post('/listings').send({}).expect(401));

    it('creates a draft with images and tags', async () => {
      const url = await uploadPng(app, seller);
      const res = await http()
        .post('/listings')
        .set('Authorization', seller.auth)
        .send({
          categoryId: leafId,
          type: 'product',
          title: 'Dell XPS 13 (2022)',
          description: 'i7, 16GB RAM, 512GB SSD. Some wear on the lid, works perfectly.',
          price: '145000',
          currency: 'KES',
          country: 'KE',
          city: 'Mombasa',
          tags: ['Laptop', 'dell', 'laptop'],
          images: [{ url }],
        })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'draft',
        price: '145000.00',
        isOwner: true,
        tags: expect.arrayContaining(['laptop', 'dell']),
        images: [expect.objectContaining({ url })],
        category: expect.objectContaining({
          id: leafId,
          parent: expect.objectContaining({ id: rootId }),
        }),
      });
      expect(res.body.tags).toHaveLength(2);
      expect(res.body.slug).toMatch(/^dell-xps-13-2022-[0-9a-f]{8}$/);
    });

    it('403 without a profile; buyers may only post requests', async () => {
      const noProfile = await makeUser(app, { profile: false });
      await http()
        .post('/listings')
        .set('Authorization', noProfile.auth)
        .send({
          categoryId: leafId,
          type: 'request',
          title: 'Looking for a PS5',
          description: 'Disc edition, good condition, around Westlands.',
          price: 50000,
          currency: 'KES',
          country: 'KE',
          city: 'Nairobi',
        })
        .expect(403);

      const buyer = await makeUser(app, { role: 'buyer' });
      await expect(draft(buyer, { type: 'product' })).rejects.toThrow(/^403/);
      await expect(draft(buyer, { type: 'request', images: [] })).resolves.toBeTruthy();
    });

    it('400 for a parent category, unknown category, or bad pricing', async () => {
      await expect(draft(seller, { categoryId: rootId })).rejects.toThrow(/Pick a subcategory/);
      await expect(
        draft(seller, { categoryId: '00000000-0000-4000-8000-000000000000' }),
      ).rejects.toThrow(/^400/);
      await expect(draft(seller, { price: undefined })).rejects.toThrow(/price/);
    });

    it("400 for someone else's or non-existent image", async () => {
      const other = await makeUser(app);
      const theirs = await uploadPng(app, other);
      await expect(draft(seller, { images: [{ url: theirs }] })).rejects.toThrow(/^400/);
    });
  });

  describe('visibility', () => {
    it('drafts are owner-only; live listings are public', async () => {
      const l = await draft(seller);
      await http().get(`/listings/${l.slug}`).expect(404);
      const stranger = await makeUser(app);
      await http().get(`/listings/${l.slug}`).set('Authorization', stranger.auth).expect(404);
      await http().get(`/listings/${l.slug}`).set('Authorization', seller.auth).expect(200);

      await http().post(`/listings/${l.id}/publish`).set('Authorization', seller.auth).expect(200);
      const pub = await http().get(`/listings/${l.slug}`).expect(200);
      expect(pub.body).toMatchObject({ status: 'active', isOwner: false, isFavorited: null });
      expect(JSON.stringify(pub.body)).not.toContain(seller.email);
    });

    it('counts a view once per viewer per hour, never the owner', async () => {
      const l = await live(seller);
      const viewer = await makeUser(app);
      await http().get(`/listings/${l.slug}`).set('Authorization', viewer.auth);
      await http().get(`/listings/${l.slug}`).set('Authorization', viewer.auth);
      await http().get(`/listings/${l.slug}`).set('Authorization', seller.auth);
      const row = await db.listing.findUniqueOrThrow({ where: { id: l.id } });
      expect(row.viewsCount).toBe(1);
    });

    it("banned sellers' listings disappear", async () => {
      const banned = await makeUser(app);
      const l = await live(banned);
      await db.user.update({ where: { id: banned.id }, data: { isBanned: true } });
      await http().get(`/listings/${l.slug}`).expect(404);
    });
  });

  describe('POST /listings/:id/publish', () => {
    it('needs a verified email', async () => {
      const unverified = await makeUser(app, { verified: false });
      const l = await draft(unverified);
      await http()
        .post(`/listings/${l.id}/publish`)
        .set('Authorization', unverified.auth)
        .expect(403);
    });

    it('products need a photo; services do not', async () => {
      const noPhoto = await draft(seller, { images: [] });
      const res = await http()
        .post(`/listings/${noPhoto.id}/publish`)
        .set('Authorization', seller.auth)
        .expect(400);
      expect(res.body.fields).toEqual({ images: ['Required'] });
      await live(seller, { type: 'service', images: [], condition: undefined });
    });

    it('sets a 30-day expiry, counts on the profile, and refuses a second publish', async () => {
      const l = await live(seller);
      const row = await db.listing.findUniqueOrThrow({ where: { id: l.id } });
      const days = (row.expiresAt!.getTime() - row.publishedAt!.getTime()) / 86_400_000;
      expect(days).toBe(30);
      const profile = await db.profile.findUniqueOrThrow({ where: { userId: seller.id } });
      expect(profile.listingsCount).toBe(1);
      await http().post(`/listings/${l.id}/publish`).set('Authorization', seller.auth).expect(409);
    });

    it("403 on someone else's listing", async () => {
      const l = await draft(seller);
      const other = await makeUser(app);
      await http().post(`/listings/${l.id}/publish`).set('Authorization', other.auth).expect(403);
    });
  });

  describe('PATCH /listings/:id', () => {
    it("403 for non-owners, 404 when it doesn't exist", async () => {
      const l = await draft(seller);
      const other = await makeUser(app);
      await http()
        .patch(`/listings/${l.id}`)
        .set('Authorization', other.auth)
        .send({ price: 1 })
        .expect(403);
      await http()
        .patch('/listings/00000000-0000-4000-8000-000000000000')
        .set('Authorization', seller.auth)
        .send({ price: 1 })
        .expect(404);
    });

    it('checks pricing against the merged row', async () => {
      const l = await draft(seller);
      const res = await http()
        .patch(`/listings/${l.id}`)
        .set('Authorization', seller.auth)
        .send({ isPriceRange: true })
        .expect(400);
      expect(Object.keys(res.body.fields).sort()).toEqual(['priceMax', 'priceMin']);

      const ok = await http()
        .patch(`/listings/${l.id}`)
        .set('Authorization', seller.auth)
        .send({ isPriceRange: true, priceMin: 100, priceMax: 200 })
        .expect(200);
      expect(ok.body).toMatchObject({ price: null, priceMin: '100.00', priceMax: '200.00' });
    });

    it('new title → new slug; mark sold once', async () => {
      const l = await live(seller);
      const res = await http()
        .patch(`/listings/${l.id}`)
        .set('Authorization', seller.auth)
        .send({ title: 'Renamed phone listing' })
        .expect(200);
      expect(res.body.slug).toMatch(/^renamed-phone-listing-/);
      await http().get(`/listings/${l.slug}`).expect(404);

      await http()
        .patch(`/listings/${l.id}`)
        .set('Authorization', seller.auth)
        .send({ status: 'sold' })
        .expect(200);
      await http()
        .patch(`/listings/${l.id}`)
        .set('Authorization', seller.auth)
        .send({ status: 'sold' })
        .expect(409);
      expect(
        (await db.profile.findUniqueOrThrow({ where: { userId: seller.id } })).listingsCount,
      ).toBe(0);
    });

    it('replaces images; keeps already-attached ones valid', async () => {
      const l = await draft(seller);
      const current = await db.listingImage.findFirstOrThrow({ where: { listingId: l.id } });
      const added = await uploadPng(app, seller);
      const res = await http()
        .patch(`/listings/${l.id}`)
        .set('Authorization', seller.auth)
        .send({ images: [{ url: added }, { url: current.url }] })
        .expect(200);
      expect(res.body.images.map((i: { url: string }) => i.url)).toEqual([added, current.url]);
    });
  });

  describe('DELETE /listings/:id', () => {
    it('soft-removes and updates the count', async () => {
      const l = await live(seller);
      await http().delete(`/listings/${l.id}`).set('Authorization', seller.auth).expect(204);
      await http().get(`/listings/${l.slug}`).set('Authorization', seller.auth).expect(404);
      expect((await db.listing.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('removed');
      expect(
        (await db.profile.findUniqueOrThrow({ where: { userId: seller.id } })).listingsCount,
      ).toBe(0);
      await http().delete(`/listings/${l.id}`).set('Authorization', seller.auth).expect(404);
    });
  });

  describe('GET /listings (search)', () => {
    it('finds by words and by typo, only active ones', async () => {
      const token = word();
      await live(seller, { title: `Vintage turntable ${token}` });
      await draft(seller, { title: `Hidden draft ${token}` });

      const exact = await http().get('/listings').query({ q: token }).expect(200);
      expect(exact.body.items).toHaveLength(1);
      expect(exact.body.items[0].title).toContain('turntable');

      const typo = await http()
        .get('/listings')
        .query({ q: `turntabel ${token}`, sellerId: seller.id })
        .expect(200);
      expect(typo.body.items.length).toBeGreaterThan(0);
    });

    it('filters by category tree, price, city, type and verified', async () => {
      const token = word();
      await live(seller, { title: `Cheap ${token}`, price: 100, city: 'Kisumu' });
      await live(seller, { title: `Pricey ${token}`, price: 900 });
      const q = (extra: Record<string, unknown>) =>
        http()
          .get('/listings')
          .query({ sellerId: seller.id, ...extra })
          .expect(200)
          .then((r) => r.body.items.map((i: { title: string }) => i.title.split(' ')[0]));

      expect(await q({ categoryId: rootId })).toHaveLength(2); // parent includes children
      expect(await q({ maxPrice: 500 })).toEqual(['Cheap']);
      expect(await q({ minPrice: 500 })).toEqual(['Pricey']);
      expect(await q({ city: 'kisumu' })).toEqual(['Cheap']);
      expect(await q({ type: 'service' })).toEqual([]);
      expect(await q({ verified: 'true' })).toEqual([]);
      await db.profile.update({ where: { userId: seller.id }, data: { idVerified: true } });
      expect(await q({ verified: 'true' })).toHaveLength(2);
    });

    it('pages through price order with a cursor, no gaps or repeats', async () => {
      for (const price of [300, 100, 200, 100]) await live(seller, { price });
      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const res = await http()
          .get('/listings')
          .query({ sellerId: seller.id, sort: 'price_asc', limit: 3, cursor })
          .expect(200);
        seen.push(...res.body.items.map((i: { price: string }) => i.price));
        cursor = res.body.nextCursor ?? undefined;
      } while (cursor);
      expect(seen).toEqual(['100.00', '100.00', '200.00', '300.00']);
    });

    it('400 on a tampered cursor or limit > 50', async () => {
      await http().get('/listings').query({ cursor: '!!!' }).expect(400);
      await http().get('/listings').query({ limit: 51 }).expect(400);
    });

    it('hides listings past their expiry even before the job runs', async () => {
      const l = await live(seller);
      await db.listing.update({
        where: { id: l.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await http().get('/listings').query({ sellerId: seller.id }).expect(200);
      expect(res.body.items).toEqual([]);
    });
  });

  describe('favourites', () => {
    it('toggle is idempotent, shows on cards, and lists in /favorites', async () => {
      const l = await live(seller);
      const fan = await makeUser(app);
      await http().post(`/listings/${l.id}/favorite`).expect(401);

      for (let i = 0; i < 2; i++) {
        const res = await http()
          .post(`/listings/${l.id}/favorite`)
          .set('Authorization', fan.auth)
          .expect(200);
        expect(res.body).toEqual({ favorited: true, favoritesCount: 1 });
      }
      const search = await http()
        .get('/listings')
        .query({ sellerId: seller.id })
        .set('Authorization', fan.auth)
        .expect(200);
      expect(search.body.items[0].isFavorited).toBe(true);

      const mine = await http()
        .get('/listings/favorites')
        .set('Authorization', fan.auth)
        .expect(200);
      expect(mine.body.items.map((i: { id: string }) => i.id)).toEqual([l.id]);

      const off = await http()
        .delete(`/listings/${l.id}/favorite`)
        .set('Authorization', fan.auth)
        .expect(200);
      expect(off.body).toEqual({ favorited: false, favoritesCount: 0 });
    });

    it("can't favourite your own or a draft", async () => {
      const l = await live(seller);
      await http().post(`/listings/${l.id}/favorite`).set('Authorization', seller.auth).expect(400);
      const d = await draft(seller);
      const fan = await makeUser(app);
      await http().post(`/listings/${d.id}/favorite`).set('Authorization', fan.auth).expect(404);
    });
  });

  describe('POST /listings/:id/boost', () => {
    it('features a live listing once, audited', async () => {
      const l = await live(seller);
      await http()
        .post(`/listings/${l.id}/boost`)
        .set('Authorization', seller.auth)
        .send({ days: 3 })
        .expect(200)
        .expect((r) => expect(r.body.isFeatured).toBe(true));
      await http()
        .post(`/listings/${l.id}/boost`)
        .set('Authorization', seller.auth)
        .send({})
        .expect(409);

      const featured = await http()
        .get('/listings')
        .query({ sellerId: seller.id, featured: 'true' })
        .expect(200);
      expect(featured.body.items).toHaveLength(1);
      expect(await db.auditLog.count({ where: { entityId: l.id, action: 'listing.boost' } })).toBe(
        1,
      );
    });

    it('409 for drafts', async () => {
      const d = await draft(seller);
      await http()
        .post(`/listings/${d.id}/boost`)
        .set('Authorization', seller.auth)
        .send({})
        .expect(409);
    });
  });

  describe('GET /listings/mine', () => {
    it('includes drafts, excludes removed, filters by status', async () => {
      const d = await draft(seller);
      const l = await live(seller);
      const gone = await draft(seller);
      await http().delete(`/listings/${gone.id}`).set('Authorization', seller.auth).expect(204);

      const all = await http().get('/listings/mine').set('Authorization', seller.auth).expect(200);
      expect(all.body.items.map((i: { id: string }) => i.id).sort()).toEqual([d.id, l.id].sort());
      const drafts = await http()
        .get('/listings/mine')
        .query({ status: 'draft' })
        .set('Authorization', seller.auth)
        .expect(200);
      expect(drafts.body.items.map((i: { id: string }) => i.id)).toEqual([d.id]);
    });
  });
});
