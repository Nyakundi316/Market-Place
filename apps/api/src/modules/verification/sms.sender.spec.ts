import type { Env } from '@markethub/shared';
import type Redis from 'ioredis';
import { SmsError, SmsSender, smsOutboxKey } from './sms.sender';

const AT = { AFRICASTALKING_USERNAME: 'sandbox', AFRICASTALKING_API_KEY: 'atsk_test' };

function sender(env: Partial<Env>) {
  const pushed: [string, string][] = [];
  const multi = {
    lpush: (k: string, v: string) => (pushed.push([k, v]), multi),
    expire: () => multi,
    exec: async () => [],
  };
  const redis = { multi: () => multi } as unknown as Redis;
  return { sms: new SmsSender(env as Env, redis), pushed };
}

function atReplies(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

const recipient = (statusCode: number, status: string) => ({
  SMSMessageData: {
    Message: 'Sent to 1/1',
    Recipients: [{ statusCode, status, number: '+254712345678', messageId: 'ATXid_1' }],
  },
});

describe('SmsSender', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('uses the outbox in tests even when Africa’s Talking keys are present', async () => {
    const calls = atReplies(201, recipient(101, 'Success'));
    const { sms, pushed } = sender({ NODE_ENV: 'test', ...AT });
    await sms.send('+254712345678', 'code 123456');
    expect(calls).toHaveLength(0);
    expect(pushed).toEqual([[smsOutboxKey('+254712345678'), 'code 123456']]);
  });

  it('is unavailable in production without a provider, and available with one', () => {
    expect(sender({ NODE_ENV: 'production' }).sms.available).toBe(false);
    expect(sender({ NODE_ENV: 'production', ...AT }).sms.available).toBe(true);
    expect(sender({ NODE_ENV: 'development' }).sms.available).toBe(true);
  });

  it('posts a form to the sandbox for the "sandbox" username, with the sender id', async () => {
    const calls = atReplies(201, recipient(101, 'Success'));
    const { sms, pushed } = sender({
      NODE_ENV: 'development',
      ...AT,
      AFRICASTALKING_SENDER_ID: 'MARKETHUB',
    });
    await sms.send('+254712345678', 'Your code is 123456');

    expect(pushed).toHaveLength(0);
    expect(calls[0]!.url).toBe('https://api.sandbox.africastalking.com/version1/messaging');
    expect((calls[0]!.init.headers as Record<string, string>).apiKey).toBe('atsk_test');
    expect(Object.fromEntries(calls[0]!.init.body as URLSearchParams)).toEqual({
      username: 'sandbox',
      to: '+254712345678',
      message: 'Your code is 123456',
      from: 'MARKETHUB',
    });
  });

  it('goes live for a real username', async () => {
    const calls = atReplies(201, recipient(102, 'Queued'));
    await sender({ NODE_ENV: 'production', ...AT, AFRICASTALKING_USERNAME: 'markethub' }).sms.send(
      '+254712345678',
      'hi',
    );
    expect(calls[0]!.url).toBe('https://api.africastalking.com/version1/messaging');
  });

  it('blames the number when the gateway says it can’t be texted', async () => {
    atReplies(201, recipient(403, 'InvalidPhoneNumber'));
    const err = await sender({ NODE_ENV: 'production', ...AT })
      .sms.send('+254700000000', 'hi')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SmsError);
    expect((err as SmsError).badNumber).toBe(true);
  });

  it('treats a refused key or out-of-credit account as a gateway failure', async () => {
    atReplies(401, 'The supplied authentication is invalid');
    const auth = await sender({ NODE_ENV: 'production', ...AT })
      .sms.send('+254712345678', 'hi')
      .catch((e: unknown) => e);
    expect(auth).toBeInstanceOf(SmsError);
    expect((auth as SmsError).badNumber).toBe(false);

    atReplies(201, recipient(405, 'InsufficientBalance'));
    const broke = await sender({ NODE_ENV: 'production', ...AT })
      .sms.send('+254712345678', 'hi')
      .catch((e: unknown) => e);
    expect((broke as SmsError).badNumber).toBe(false);
  });
});
