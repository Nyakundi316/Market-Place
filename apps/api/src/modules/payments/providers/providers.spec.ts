import { createHmac } from 'node:crypto';
import Stripe from 'stripe';
import { fromMinor, toMinor } from './minor-units';
import { WebhookSignatureError } from './payment-provider';
import { PaystackProvider } from './paystack.provider';
import { StripeProvider } from './stripe.provider';

describe('minor units', () => {
  it('converts without floats, honouring zero-decimal currencies', () => {
    expect(toMinor('1500.00', 'KES')).toBe(150000);
    expect(toMinor('0.10', 'USD')).toBe(10);
    expect(toMinor('19.99', 'eur')).toBe(1999);
    expect(toMinor('50000.00', 'UGX')).toBe(50000);
    expect(() => toMinor('50000.50', 'UGX')).toThrow(/fractional/);
    expect(fromMinor(150000, 'kes')).toBe('1500.00');
    expect(fromMinor(50000, 'ugx')).toBe('50000.00');
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

describe('StripeProvider.verifyWebhook', () => {
  const secret = 'whsec_stripe_test';
  const provider = new StripeProvider('sk_test_x', secret);
  const stripe = new Stripe('sk_test_x');
  const event = (type: string, object: Record<string, unknown>) =>
    JSON.stringify({ id: 'evt_1', object: 'event', type, data: { object } });

  it('normalises a payment_intent.succeeded', () => {
    const payload = event('payment_intent.succeeded', {
      id: 'pi_1',
      amount: 4300000,
      currency: 'usd',
    });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(provider.verifyWebhook(Buffer.from(payload), header)).toEqual({
      id: 'evt_1',
      kind: 'charge.succeeded',
      ref: 'pi_1',
      amount: '43000.00',
      currency: 'USD',
    });
  });

  it('rejects a signature made with another secret', () => {
    const payload = event('payment_intent.succeeded', { id: 'pi_1', amount: 1, currency: 'usd' });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_other' });
    expect(() => provider.verifyWebhook(Buffer.from(payload), header)).toThrow(
      WebhookSignatureError,
    );
  });

  it('marks Connect accounts ready only once payouts are enabled', () => {
    const payload = event('account.updated', {
      id: 'acct_1',
      payouts_enabled: true,
      details_submitted: true,
      requirements: { disabled_reason: null },
    });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(provider.verifyWebhook(Buffer.from(payload), header)).toMatchObject({
      kind: 'payout_account.updated',
      accountRef: 'acct_1',
      ready: true,
      restricted: false,
    });
  });
});
