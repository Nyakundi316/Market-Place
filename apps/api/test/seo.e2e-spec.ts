import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, resetRateLimits, seedOrder } from './helpers';

describe('GET /seo/sitemap (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
  });
  beforeEach(() => resetRateLimits());
  afterAll(() => app.close());

  it('lists live listings and active sellers only, publicly', async () => {
    const [seller, buyer, banned] = await Promise.all([makeUser(app), makeUser(app), makeUser(app)]);
    const live = (await seedOrder(app, buyer, seller)).listing;
    const removed = (await seedOrder(app, buyer, seller)).listing;
    await db.listing.update({ where: { id: removed.id }, data: { status: 'removed' } });
    const hidden = (await seedOrder(app, buyer, banned)).listing;
    await db.user.update({ where: { id: banned.id }, data: { isBanned: true } });
    await db.profile.updateMany({
      where: { userId: { in: [seller.id, banned.id] } },
      data: { listingsCount: 1 },
    });

    const res = await request(app.getHttpServer()).get('/seo/sitemap').expect(200);
    const slugs = res.body.listings.map((l: { slug: string }) => l.slug);
    expect(slugs).toContain(live.slug);
    expect(slugs).not.toContain(removed.slug);
    expect(slugs).not.toContain(hidden.slug);

    const usernames = res.body.profiles.map((p: { username: string }) => p.username);
    expect(usernames).toContain(seller.username);
    expect(usernames).not.toContain(banned.username);
    expect(usernames).not.toContain(buyer.username); // nothing listed

    expect(res.body.categories.some((c: { slug: string }) => c.slug === 'seeded-orders')).toBe(true);
    expect(res.body.listings[0]).toEqual({ slug: expect.any(String), updatedAt: expect.any(String) });
  });
});
