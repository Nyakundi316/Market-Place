import { createECDH, randomBytes } from 'node:crypto';
import type { Env } from '@markethub/shared';
import webpush, { WebPushError } from 'web-push';
import { PushSender } from './push.sender';

const vapid = webpush.generateVAPIDKeys();
const env = (extra: Partial<Env> = {}) =>
  ({
    MAIL_FROM: 'MarketHub <no-reply@markethub.co>',
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    ...extra,
  }) as Env;

// A real browser-shaped subscription: P-256 public key + 16-byte auth secret.
const browserKey = createECDH('prime256v1');
browserKey.generateKeys();
const sub = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/test-device',
  keys: {
    p256dh: browserKey.getPublicKey().toString('base64url'),
    auth: randomBytes(16).toString('base64url'),
  },
};
const opts = { ttl: 60, urgency: 'high' as const };

describe('PushSender', () => {
  afterEach(() => jest.restoreAllMocks());

  it('encrypts and signs a real request, with a mailto: subject from MAIL_FROM', async () => {
    let details: ReturnType<typeof webpush.generateRequestDetails> | undefined;
    jest.spyOn(webpush, 'sendNotification').mockImplementation(async (s, payload, o) => {
      // What sendNotification would POST, minus the network.
      details = webpush.generateRequestDetails(s, payload, o);
      expect(o?.vapidDetails?.subject).toBe('mailto:no-reply@markethub.co');
      return { statusCode: 201, body: '', headers: {} };
    });

    expect(await new PushSender(env()).send(sub, '{"title":"hi"}', opts)).toBe('sent');
    expect(details!.endpoint).toBe(sub.endpoint);
    expect(details!.headers).toMatchObject({
      TTL: 60,
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
    });
    expect(String(details!.headers.Authorization)).toMatch(/^vapid t=.+, k=/);
  });

  it('maps push-service answers to what the job should do', async () => {
    const answer = (status: number) =>
      jest
        .spyOn(webpush, 'sendNotification')
        .mockRejectedValueOnce(new WebPushError('x', status, {}, '', sub.endpoint));
    const sender = new PushSender(env({ VAPID_SUBJECT: 'https://markethub.co' }));

    for (const [status, outcome] of [
      [404, 'gone'],
      [410, 'gone'],
      [429, 'retry'],
      [503, 'retry'],
      [403, 'rejected'],
      [413, 'rejected'],
    ] as const) {
      answer(status);
      expect(await sender.send(sub, '{}', opts)).toBe(outcome);
    }

    jest.spyOn(webpush, 'sendNotification').mockRejectedValueOnce(new Error('ETIMEDOUT'));
    expect(await sender.send(sub, '{}', opts)).toBe('retry');
  });

  it('is off without keys', async () => {
    const off = new PushSender(env({ VAPID_PUBLIC_KEY: undefined, VAPID_PRIVATE_KEY: undefined }));
    const spy = jest.spyOn(webpush, 'sendNotification');
    expect(off.publicKey).toBeNull();
    expect(await off.send(sub, '{}', opts)).toBe('rejected');
    expect(spy).not.toHaveBeenCalled();
  });
});
