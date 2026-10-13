import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JobsService } from '../src/modules/jobs/jobs.module';
import { OfflineNotifier } from '../src/modules/chat/offline-notifier';
import { PrismaService } from '../src/prisma/prisma.module';
import { REDIS } from '../src/redis/redis.module';
import type Redis from 'ioredis';
import { createApp, makeUser, resetRateLimits, type TestUser } from './helpers';

/** RFC 2047 "=?UTF-8?Q?...?=" → text, for subjects with non-ASCII characters. */
const decodeHeader = (h: string) =>
  h.replace(/\?=\s+=\?/g, '?==?').replace(/=\?UTF-8\?Q\?(.*?)\?=/gi, (_, q: string) =>
    Buffer.from(
      q
        .replace(/_/g, ' ')
        .replace(/=([0-9A-F]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))),
      'latin1',
    ).toString('utf8'),
  );

interface MailhogItem {
  Content: { Headers: { Subject: string[] }; Body: string };
}

async function inbox(to: string, timeoutMs = 5000) {
  const url = `http://localhost:8025/api/v2/search?kind=to&query=${encodeURIComponent(to)}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { items } = (await (await fetch(url)).json()) as { items: MailhogItem[] };
    if (items.length) return items;
    await new Promise((r) => setTimeout(r, 150));
  }
  return [];
}

describe('notify:offline (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let notifier: OfflineNotifier;
  let jobs: JobsService;
  let redis: Redis;
  let categoryId: string;
  let seller: TestUser;
  let buyer: TestUser;
  let conversationId: string;
  const http = () => request(app.getHttpServer());
  const send = (user: TestUser, body: string) =>
    http()
      .post('/messages')
      .set('Authorization', user.auth)
      .send({ conversationId, body })
      .expect(201);
  const jobFor = (recipientId: string) =>
    jobs.queue('notify').getJob(`offline:${recipientId}:${conversationId}`);

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    notifier = app.get(OfflineNotifier);
    jobs = app.get(JobsService);
    redis = app.get(REDIS);
    categoryId = (
      await db.category.create({ data: { name: 'Notify', slug: `nt-${Date.now().toString(36)}` } })
    ).id;
  });
  beforeEach(async () => {
    await resetRateLimits();
    [seller, buyer] = await Promise.all([makeUser(app), makeUser(app)]);
    const slug = `nt-${Math.random().toString(36).slice(2, 10)}`;
    const listing = await db.listing.create({
      data: {
        sellerId: seller.id,
        categoryId,
        type: 'product',
        title: `Bike <b>${slug}</b>`,
        slug,
        description: 'Mountain bike, 21 gears, new tyres, minor rust on the chain guard.',
        price: 20000,
        currency: 'KES',
        status: 'active',
        publishedAt: new Date(),
      },
    });
    conversationId = (
      await http()
        .post('/conversations')
        .set('Authorization', buyer.auth)
        .send({ listingId: listing.id })
        .expect(201)
    ).body.id;
  });
  afterAll(() => app.close());

  it('a burst to an offline user schedules one delayed job', async () => {
    await send(buyer, 'hi');
    await send(buyer, 'are you there?');
    await send(buyer, 'hello?');
    const job = await jobFor(seller.id);
    expect(job?.data).toEqual({ recipientId: seller.id, conversationId });
    expect(await job?.isDelayed()).toBe(true);
    expect(await jobs.queue('notify').getDelayedCount()).toBe(1);
  });

  it('nothing is queued when the recipient is online', async () => {
    await redis.set(`presence:${seller.id}`, 1, 'EX', 60);
    await send(buyer, 'hi');
    expect(await jobFor(seller.id)).toBeUndefined();
  });

  it('delivers one escaped email + in-app notification, then is idempotent', async () => {
    await send(buyer, 'first');
    await send(buyer, '<script>alert(1)</script> 18k?');

    expect(await notifier.deliver({ recipientId: seller.id, conversationId })).toBe('sent');
    const [mail] = await inbox(seller.email);
    expect(decodeHeader(mail!.Content.Headers.Subject[0]!)).toMatch(
      /messaged you about “Bike <b>nt-/,
    );
    const body = mail!.Content.Body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
    // Raw text is fine in text/plain; the HTML part must be escaped.
    const html = body.split(/Content-Type: text\/html/i)[1] ?? '';
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(body).toContain('(+1 more)');
    expect(body).toContain(`/chat/${conversationId}`);

    const notes = await db.notification.findMany({ where: { userId: seller.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: 'chat.message', link: `/chat/${conversationId}` });

    expect(await notifier.deliver({ recipientId: seller.id, conversationId })).toBe('duplicate');
  });

  it('skips if they came online or already read it', async () => {
    await send(buyer, 'hi');
    await redis.set(`presence:${seller.id}`, 1, 'EX', 60);
    expect(await notifier.deliver({ recipientId: seller.id, conversationId })).toBe('online');
    await redis.del(`presence:${seller.id}`);

    await http()
      .post(`/conversations/${conversationId}/read`)
      .set('Authorization', seller.auth)
      .send({})
      .expect(200);
    expect(await notifier.deliver({ recipientId: seller.id, conversationId })).toBe('read');
  });
});
