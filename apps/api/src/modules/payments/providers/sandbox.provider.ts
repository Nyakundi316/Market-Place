import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { BankDto, Currency } from '@markethub/shared';
import type Redis from 'ioredis';
import {
  type ChargeLookup,
  type ChargeParams,
  type ChargeResult,
  type GatewayEvent,
  type PaymentProvider,
  type PayoutSetup,
  type RefundResult,
  type TransferParams,
  type TransferResult,
  WebhookSignatureError,
} from './payment-provider';

/** Stripe's public test numbers, so the habit carries over to the real thing. */
export const SANDBOX_CARDS = { ok: '4242424242424242', declined: '4000000000000002' } as const;

const key = (ref: string) => `sandbox:charge:${ref}`;
const CHARGE_TTL_S = 30 * 86_400;

/**
 * Stands in for Stripe and Paystack outside production while their keys are
 * placeholders. It keeps charge state in Redis and emits *signed* webhook
 * bodies, so payments travel the same verify → dedupe → apply path as real
 * gateway events. The env schema makes real keys mandatory in production.
 */
export class SandboxProvider implements PaymentProvider {
  readonly gateway = 'sandbox' as const;

  constructor(
    private readonly redis: Redis,
    private readonly secret: string,
  ) {}

  async charge(p: ChargeParams): Promise<ChargeResult> {
    const ref = `sbx_ch_${randomUUID()}`;
    await this.redis.set(
      key(ref),
      JSON.stringify({
        status: 'pending',
        amount: p.amount,
        currency: p.currency,
        orderId: p.orderId,
      }),
      'EX',
      CHARGE_TTL_S,
    );
    // The client secret is just the ref: the sandbox card form posts it back.
    return { ref, status: 'requires_action', clientSecret: ref };
  }

  async capture(): Promise<void> {}

  async refund(ref: string): Promise<RefundResult> {
    return { ref: `sbx_re_${ref.slice(-12)}_${Date.now()}`, status: 'succeeded' };
  }

  async transfer(p: TransferParams): Promise<TransferResult> {
    return { ref: `sbx_tr_${p.orderId.slice(0, 8)}_${Date.now()}`, status: 'succeeded' };
  }

  sign(raw: Buffer) {
    return createHmac('sha256', this.secret).update(raw).digest('hex');
  }

  /**
   * "Pays" with a test card: records the outcome and returns the signed
   * webhook the gateway would have sent.
   */
  async pay(ref: string, card: string): Promise<{ raw: Buffer; signature: string } | null> {
    const stored = await this.redis.get(key(ref));
    if (!stored) return null;
    const charge = JSON.parse(stored) as { amount: string; currency: string };
    const ok = card.replace(/\s/g, '') === SANDBOX_CARDS.ok;
    await this.redis.set(
      key(ref),
      JSON.stringify({ ...charge, status: ok ? 'succeeded' : 'failed' }),
      'EX',
      CHARGE_TTL_S,
    );
    const raw = Buffer.from(
      JSON.stringify({
        id: `sbx_evt_${randomUUID()}`,
        type: ok ? 'charge.succeeded' : 'charge.failed',
        ref,
        amount: charge.amount,
        currency: charge.currency,
      }),
    );
    return { raw, signature: this.sign(raw) };
  }

  verifyWebhook(raw: Buffer, signature: string): GatewayEvent {
    const expected = Buffer.from(this.sign(raw), 'hex');
    const given = Buffer.from(signature ?? '', 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new WebhookSignatureError('Bad sandbox signature');
    }
    const e = JSON.parse(raw.toString('utf8')) as {
      id: string;
      type: 'charge.succeeded' | 'charge.failed';
      ref: string;
      amount: string;
      currency: string;
    };
    return { id: e.id, kind: e.type, ref: e.ref, amount: e.amount, currency: e.currency };
  }

  async lookup(ref: string): Promise<ChargeLookup> {
    const stored = await this.redis.get(key(ref));
    if (!stored) return { status: 'failed', amount: '0.00', currency: '' };
    const c = JSON.parse(stored) as {
      status: ChargeLookup['status'];
      amount: string;
      currency: string;
    };
    return { status: c.status, amount: c.amount, currency: c.currency };
  }

  async banks(): Promise<BankDto[]> {
    return [
      { code: 'SBX001', name: 'Sandbox Bank' },
      { code: 'SBX002', name: 'Test Mobile Money' },
    ];
  }

  async setupPayouts(opts: {
    accountNumber?: string;
    currency?: Currency | string;
  }): Promise<PayoutSetup> {
    return {
      accountRef: `sbx_acct_${randomUUID()}`,
      status: 'ready',
      details: {
        label: opts.accountNumber
          ? `Sandbox Bank ····${opts.accountNumber.slice(-4)}`
          : 'Sandbox payouts',
        currency: opts.currency,
      },
    };
  }
}
