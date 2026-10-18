import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { type PushOutcome, PushSender } from '../src/modules/push/push.sender';
import { PushService } from '../src/modules/push/push.service';
import { PrismaService } from '../src/prisma/prisma.module';
import { createApp, makeUser, resetRateLimits, type TestUser } from './helpers';

const keys = {
  p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};
const device = () => ({
  endpoint: `https://push.example.test/send/${Date.now()}${Math.random().toString(36).slice(2)}`,
  expirationTime: null,
  keys,
});

describe('Web Push (e2e)', () => {
  let app: INestApplication;
  let db: PrismaService;
  let push: PushService;
  let send: jest.SpyInstance<Promise<PushOutcome>, Parameters<PushSender['send']>>;
  let user: TestUser;
  let other: TestUser;
  const http = () => request(app.getHttpServer());
  const subscribe = (who: TestUser, body: unknown) =>
    http().post('/me/push-subscriptions').set('Authorization', who.auth).send(body);

  beforeAll(async () => {
    app = await createApp();
    db = app.get(PrismaService);
    push = app.get(PushService);
    // Nothing leaves the test: the in-process worker and direct calls both hit this stub.
    send = jest.spyOn(app.get(PushSender), 'send').mockResolvedValue('sent');
  });
  beforeEach(async () => {
    await resetRateLimits();
    send.mockClear();
    [user, other] = await Promise.all([makeUser(app), makeUser(app)]);
  });
  afterAll(async () => {
    send.mockRestore();
    await app.close();
  });

  const note = (userId: string, extra: { isRead?: boolean; payload?: object } = {}) =>
    db.notification.create({
      data: {
        userId,
        type: 'offer.received',
        title: 'New offer on “Desk”',
        body: 'KES 4,000',
        link: '/chat/abc',
        ...extra,
      },
    });

  it('serves the public key to anyone', async () => {
    const res = await http().get('/push/config').expect(200);
    expect(res.body).toEqual({ publicKey: process.env.VAPID_PUBLIC_KEY });
  });

  it('subscribes a device; the same device under another account moves over', async () => {
    const d = device();
    await http().post('/me/push-subscriptions').send(d).expect(401);
    await subscribe(user, { ...d, endpoint: 'http://insecure.example/x' }).expect(400);
    await subscribe(user, { endpoint: d.endpoint }).expect(400);

    await subscribe(user, d).set('User-Agent', 'Pixel 7 Chrome').expect(204);
    await subscribe(user, d).expect(204); // idempotent
    const row = await db.pushSubscription.findUniqueOrThrow({ where: { endpoint: d.endpoint } });
    expect(row).toMatchObject({ userId: user.id, p256dh: keys.p256dh, auth: keys.auth });

    await subscribe(other, d).expect(204);
    expect(await db.pushSubscription.count({ where: { endpoint: d.endpoint } })).toBe(1);
    expect(
      (await db.pushSubscription.findUniqueOrThrow({ where: { endpoint: d.endpoint } })).userId,
    ).toBe(other.id);
  });

  it('keeps the ten most recent devices per account', async () => {
    const devices = Array.from({ length: 11 }, device);
    for (const d of devices) await subscribe(user, d).expect(204);
    const kept = await db.pushSubscription.findMany({ where: { userId: user.id } });
    expect(kept).toHaveLength(10);
    expect(kept.map((k) => k.endpoint)).not.toContain(devices[0]!.endpoint);
  });

  it('unsubscribes only your own device, and repeats are fine', async () => {
    const d = device();
    await subscribe(user, d).expect(204);
    await http()
      .delete('/me/push-subscriptions')
      .set('Authorization', other.auth)
      .send({ endpoint: d.endpoint })
      .expect(204);
    expect(await db.pushSubscription.count({ where: { endpoint: d.endpoint } })).toBe(1);

    for (let i = 0; i < 2; i++) {
      await http()
        .delete('/me/push-subscriptions')
        .set('Authorization', user.auth)
        .send({ endpoint: d.endpoint })
        .expect(204);
    }
    expect(await db.pushSubscription.count({ where: { endpoint: d.endpoint } })).toBe(0);
    await http()
      .delete('/me/push-subscriptions')
      .set('Authorization', user.auth)
      .send({})
      .expect(400);
  });

  it('delivers to every device, tagged by conversation, and stamps lastPushAt', async () => {
    const [a, b] = [device(), device()];
    await subscribe(user, a).expect(204);
    await subscribe(user, b).expect(204);
    const n = await note(user.id, { payload: { conversationId: 'c-1' } });

    expect(await push.deliver(n.id)).toBe('sent');
    expect(send).toHaveBeenCalledTimes(2);
    const [sub, payload, opts] = send.mock.calls[0]!;
    expect(sub.keys).toEqual(keys);
    expect(JSON.parse(payload)).toEqual({
      id: n.id,
      title: 'New offer on “Desk”',
      body: 'KES 4,000',
      link: '/chat/abc',
      tag: 'chat-c-1',
    });
    expect(opts).toEqual({ ttl: 86_400, urgency: 'high' });
    const rows = await db.pushSubscription.findMany({ where: { userId: user.id } });
    expect(rows.every((r) => r.lastPushAt)).toBe(true);
  });

  it('drops devices the push service says are gone; retries only when nothing went out', async () => {
    const [gone, flaky] = [device(), device()];
    await subscribe(user, gone).expect(204);
    await subscribe(user, flaky).expect(204);
    const route = (map: Record<string, PushOutcome>) =>
      send.mockImplementation(async (s) => map[s.endpoint] ?? 'sent');

    route({ [gone.endpoint]: 'gone', [flaky.endpoint]: 'retry' });
    await expect(push.deliver((await note(user.id)).id)).rejects.toThrow(/retrying/);
    expect(await db.pushSubscription.count({ where: { endpoint: gone.endpoint } })).toBe(0);

    // One device got it: no retry, or that one would get it twice.
    const ok = device();
    await subscribe(user, ok).expect(204);
    route({ [flaky.endpoint]: 'retry' });
    expect(await push.deliver((await note(user.id)).id)).toBe('sent');
    send.mockResolvedValue('sent');
  });

  it('skips what was read in-app, accounts without devices, and banned users', async () => {
    expect(await push.deliver((await note(user.id)).id)).toBe('no-devices');
    await subscribe(user, device()).expect(204);
    expect(await push.deliver((await note(user.id, { isRead: true })).id)).toBe('read');
    await db.user.update({ where: { id: user.id }, data: { isBanned: true } });
    expect(await push.deliver((await note(user.id)).id)).toBe('skipped');
    expect(await push.deliver('00000000-0000-4000-8000-000000000000')).toBe('gone');
    expect(send).not.toHaveBeenCalled();
  });

  it('notify() queues a push for someone who is offline', async () => {
    const enqueue = jest.spyOn(push, 'enqueue');
    try {
      await app.get(NotificationsService).notify(user.id, {
        type: 'order.shipped',
        title: 'Your order is on its way',
        link: '/orders/x',
      });
      const row = await db.notification.findFirstOrThrow({
        where: { userId: user.id, type: 'order.shipped' },
      });
      expect(enqueue).toHaveBeenCalledWith(row.id);
    } finally {
      enqueue.mockRestore();
    }
  });
});
