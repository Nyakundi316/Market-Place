import { createHmac } from 'node:crypto';
import { fromMinor, toMinor } from './minor-units';
import { WebhookSignatureError } from './payment-provider';
import { PaystackProvider } from './paystack.provider';

describe('minor units', () => {
  it('converts to subunits without floats', () => {
    expect(toMinor('1500.00')).toBe(150000);
    expect(toMinor('0.10')).toBe(10);
    expect(toMinor('19.99')).toBe(1999);
    expect(fromMinor(150000)).toBe('1500.00');
    expect(fromMinor(5)).toBe('0.05');
  });
});

describe('PaystackProvider.verifyWebhook', () => {
  const secret = 'whsec_paystack_test';
  const provider = new PaystackProvider('sk_test_x', secret);
  const body = Buffer.from(
    JSON.stringify({
      event: 'charge.success',
      data: { id: 302961, reference: 'order-abc-charge', amount: 4300000, currency: 'KES' },
    }),
  );
  const sign = (raw: Buffer) => createHmac('sha512', secret).update(raw).digest('hex');

  it('accepts a correctly signed event and normalises it', () => {
    expect(provider.verifyWebhook(body, sign(body))).toEqual({
      id: 'charge.success:302961',
      kind: 'charge.succeeded',
      ref: 'order-abc-charge',
      amount: '43000.00',
      currency: 'KES',
    });
  });

  it('rejects tampered bodies and bad or missing signatures', () => {
    const tampered = Buffer.from(body.toString().replace('4300000', '1'));
    expect(() => provider.verifyWebhook(tampered, sign(body))).toThrow(WebhookSignatureError);
    expect(() => provider.verifyWebhook(body, 'deadbeef')).toThrow(WebhookSignatureError);
    expect(() => provider.verifyWebhook(body, '')).toThrow(WebhookSignatureError);
  });
});

describe('PaystackProvider.setupPayouts', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('uses the recipient type Paystack reports for the bank (M-Pesa → mobile_money)', async () => {
    const calls: { url: string; body?: Record<string, unknown> }[] = [];
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body
        ? (JSON.parse(String(init.body)) as Record<string, unknown>)
        : undefined;
      calls.push({ url: String(url), body });
      const data = String(url).includes('/bank?')
        ? [
            { code: 'MPESA', name: 'M-PESA', active: true, type: 'mobile_money' },
            { code: '01', name: 'KCB Bank', active: true, type: 'kepss' },
          ]
        : {
            recipient_code: 'RCP_1',
            details: { bank_name: 'M-PESA', account_number: '0712345678' },
          };
      return new Response(JSON.stringify({ status: true, message: 'ok', data }), { status: 200 });
    }) as typeof fetch;

    const setup = await new PaystackProvider('sk_test_x', 'whsec').setupPayouts({
      name: 'Juma',
      bankCode: 'MPESA',
      accountNumber: '0712345678',
      currency: 'KES',
    });
    const create = calls.find((c) => c.url.endsWith('/transferrecipient'));
    expect(create?.body).toMatchObject({
      type: 'mobile_money',
      bank_code: 'MPESA',
      currency: 'KES',
    });
    expect(setup).toMatchObject({
      accountRef: 'RCP_1',
      status: 'ready',
      details: { label: 'M-PESA ····5678' },
    });
  });
});
