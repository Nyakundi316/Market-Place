import type { Env } from '@markethub/shared';
import { MailService } from './mail.service';

const resend = () =>
  new MailService({
    RESEND_API_KEY: 're_test',
    MAIL_FROM: 'MarketHub <no-reply@markethub.co>',
  } as Env);
const mail = (to: string) => ({ to, subject: 'New message', text: 'hi', html: '<p>hi</p>' });

describe('MailService (Resend)', () => {
  const realFetch = global.fetch;
  let sent: string[];

  beforeEach(() => {
    sent = [];
    global.fetch = jest.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      sent.push((JSON.parse(String(init!.body)) as { to: string }).to);
      return new Response('{"id":"x"}', { status: 200 });
    }) as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('sends real addresses', async () => {
    await resend().send(mail('wanjiru@gmail.com'));
    expect(sent).toEqual(['wanjiru@gmail.com']);
  });

  it('never hands reserved domains (load-test users, examples) to Resend', async () => {
    for (const to of ['u1@load.markethub.test', 'a@example', 'b@foo.invalid', 'c@e2e.local']) {
      await resend().send(mail(to));
    }
    expect(sent).toEqual([]);
  });

  it('surfaces Resend failures so the email job retries', async () => {
    global.fetch = jest.fn(async () => new Response('', { status: 500 })) as typeof fetch;
    await expect(resend().send(mail('wanjiru@gmail.com'))).rejects.toThrow('Resend responded 500');
  });
});
