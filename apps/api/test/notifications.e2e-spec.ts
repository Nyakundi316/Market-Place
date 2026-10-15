import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, mailTo, resetRateLimits, type TestUser } from './helpers';

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let notifications: NotificationsService;
  let alice: TestUser;
  let bob: TestUser;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    notifications = app.get(NotificationsService);
  });
  beforeEach(async () => {
    await resetRateLimits();
    [alice, bob] = await Promise.all([makeUser(app), makeUser(app)]);
  });
  afterAll(() => app.close());

  const seed = (userId: string, n: number) =>
    db.notification.createMany({
      data: Array.from({ length: n }, (_, i) => ({
        userId,
        type: 'offer.received',
        title: `Offer ${i}`,
        createdAt: new Date(Date.now() - (n - i) * 1000),
      })),
    });

  it('notify() stores, and queues email for an offline recipient', async () => {
    await notifications.notify(alice.id, {
      type: 'order.shipped',
      title: 'Your order ORD-TEST is on its way',
      body: 'Tracking <TRK-1>',
      link: '/orders/x',
    });
    const row = await db.notification.findFirstOrThrow({ where: { userId: alice.id } });
    expect(row).toMatchObject({ type: 'order.shipped', isRead: false, link: '/orders/x' });

    // The in-process worker picks it up; the email is the observable effect.
    expect(await mailTo(alice.email, /on its way/, 10_000)).not.toBeNull();
  });

  it('deliverEmail skips what was already read in-app', async () => {
    const row = await db.notification.create({
      data: { userId: alice.id, type: 'offer.accepted', title: 'Accepted', isRead: true },
    });
    expect(await notifications.deliverEmail(row.id)).toBe('read');
    expect(await notifications.deliverEmail('00000000-0000-4000-8000-000000000000')).toBe('gone');
  });

  it('lists newest first with cursor, unread filter and unread count', async () => {
    await seed(alice.id, 5);
    const first = await http()
      .get('/notifications?limit=3')
      .set('Authorization', alice.auth)
      .expect(200);
    expect(first.body.items.map((n: { title: string }) => n.title)).toEqual([
      'Offer 4',
      'Offer 3',
      'Offer 2',
    ]);
    expect(first.body.unread).toBe(5);
    const rest = await http()
      .get(`/notifications?limit=3&cursor=${first.body.nextCursor}`)
      .set('Authorization', alice.auth)
      .expect(200);
    expect(rest.body.items).toHaveLength(2);
    expect(rest.body.nextCursor).toBeNull();

    await http().get('/notifications?cursor=nope').set('Authorization', alice.auth).expect(400);
    await http().get('/notifications?limit=51').set('Authorization', alice.auth).expect(400);
  });

  it('marks one or all as read', async () => {
    await seed(alice.id, 3);
    const { body } = await http().get('/notifications').set('Authorization', alice.auth);
    const target = body.items[0].id as string;

    const one = await http()
      .post(`/notifications/${target}/read`)
      .set('Authorization', alice.auth)
      .expect(200);
    expect(one.body.isRead).toBe(true);

    const unread = await http()
      .get('/notifications?unread=true')
      .set('Authorization', alice.auth)
      .expect(200);
    expect(unread.body.items).toHaveLength(2);

    const all = await http()
      .post('/notifications/read-all')
      .set('Authorization', alice.auth)
      .expect(200);
    expect(all.body.updated).toBe(2);
    const after = await http().get('/notifications').set('Authorization', alice.auth);
    expect(after.body.unread).toBe(0);
  });

  it("can't read or mark someone else's notifications", async () => {
    await seed(alice.id, 1);
    const mine = await db.notification.findFirstOrThrow({ where: { userId: alice.id } });
    await http().post(`/notifications/${mine.id}/read`).set('Authorization', bob.auth).expect(404);
    const bobs = await http().get('/notifications').set('Authorization', bob.auth).expect(200);
    expect(bobs.body.items).toEqual([]);
    await http().post('/notifications/read-all').set('Authorization', bob.auth).expect(200);
    expect((await db.notification.findUniqueOrThrow({ where: { id: mine.id } })).isRead).toBe(
      false,
    );
  });

  it('requires auth', async () => {
    await http().get('/notifications').expect(401);
    await http().post('/notifications/read-all').expect(401);
  });
});
