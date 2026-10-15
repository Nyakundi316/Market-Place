import { createHmac, timingSafeEqual } from 'node:crypto';
import type { BankDto, Currency } from '@markethub/shared';
import { fromMinor, toMinor } from './minor-units';
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

const API = 'https://api.paystack.co';

// Transfer recipient type per settlement currency.
const RECIPIENT_TYPE: Record<string, string> = {
  NGN: 'nuban',
  GHS: 'ghipss',
  ZAR: 'basa',
  KES: 'kepss',
};

interface Envelope<T> {
  status: boolean;
  message: string;
  data: T;
}

export class PaystackError extends Error {
  constructor(
    readonly httpStatus: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Hosted checkout (authorization_url) for the charge; transfers to a
 * recipient on release. No SDK: the REST surface is small and stable.
 */
export class PaystackProvider implements PaymentProvider {
  readonly gateway = 'paystack' as const;

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => null)) as Envelope<T> | null;
    if (!res.ok || !json?.status) {
      throw new PaystackError(res.status, json?.message ?? `Paystack responded ${res.status}`);
    }
    return json.data;
  }

  async charge(p: ChargeParams): Promise<ChargeResult> {
    // Our idempotency key is the reference, so a retry can't open a second charge.
    const reference = p.idempotencyKey.replace(/[^\w-]/g, '-');
    const data = await this.call<{ authorization_url: string; reference: string }>(
      'POST',
      '/transaction/initialize',
      {
        email: p.email,
        amount: toMinor(p.amount),
        currency: p.currency,
        reference,
        callback_url: p.returnUrl,
        metadata: { orderId: p.orderId },
      },
    );
    return { ref: data.reference, status: 'requires_action', redirectUrl: data.authorization_url };
  }

  /** Paystack captures on success; nothing to do. */
  async capture(): Promise<void> {}

  async refund(
    ref: string,
    amount: string,
    currency: Currency,
    idempotencyKey: string,
  ): Promise<RefundResult> {
    const data = await this.call<{ id: number; status: string }>('POST', '/refund', {
      transaction: ref,
      amount: toMinor(amount),
      merchant_note: idempotencyKey,
    });
    return {
      ref: String(data.id),
      status:
        data.status === 'processed' ? 'succeeded' : data.status === 'failed' ? 'failed' : 'pending',
    };
  }

  async transfer(p: TransferParams): Promise<TransferResult> {
    const data = await this.call<{ transfer_code: string; status: string }>('POST', '/transfer', {
      source: 'balance',
      amount: toMinor(p.amount),
      currency: p.currency,
      recipient: p.destination,
      // Paystack dedupes on reference, which makes the payout idempotent.
      reference: p.idempotencyKey.replace(/[^\w-]/g, '-'),
      reason: `MarketHub order ${p.orderId}`,
    });
    return {
      ref: data.transfer_code,
      status:
        data.status === 'success' ? 'succeeded' : data.status === 'failed' ? 'failed' : 'pending',
    };
  }

  /** §7: HMAC-SHA512 of the raw body, compared in constant time. */
  verifyWebhook(raw: Buffer, signature: string): GatewayEvent {
    const expected = createHmac('sha512', this.webhookSecret).update(raw).digest();
    const given = Buffer.from(signature ?? '', 'hex');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new WebhookSignatureError('Bad Paystack signature');
    }
    const body = JSON.parse(raw.toString('utf8')) as {
      event: string;
      data: {
        id: number;
        reference?: string;
        transfer_code?: string;
        amount?: number;
        currency?: string;
        status?: string;
        transaction_reference?: string;
      };
    };
    // Paystack events carry no id of their own; event + object id is unique.
    const id = `${body.event}:${body.data.id}`;
    const d = body.data;
    switch (body.event) {
      case 'charge.success':
        return {
          id,
          kind: 'charge.succeeded',
          ref: d.reference!,
          amount: fromMinor(d.amount ?? 0),
          currency: (d.currency ?? '').toUpperCase(),
        };
      case 'refund.processed':
      case 'refund.failed':
        return {
          id,
          kind: body.event === 'refund.processed' ? 'refund.succeeded' : 'refund.failed',
          ref: String(d.id),
          chargeRef: d.transaction_reference ?? '',
        };
      case 'transfer.success':
      case 'transfer.failed':
      case 'transfer.reversed':
        return {
          id,
          kind: body.event === 'transfer.success' ? 'transfer.succeeded' : 'transfer.failed',
          ref: d.transfer_code!,
        };
      default:
        return { id, kind: 'ignored', type: body.event };
    }
  }

  async lookup(ref: string): Promise<ChargeLookup> {
    const d = await this.call<{ status: string; amount: number; currency: string }>(
      'GET',
      `/transaction/verify/${encodeURIComponent(ref)}`,
    );
    return {
      status:
        d.status === 'success'
          ? 'succeeded'
          : d.status === 'failed' || d.status === 'abandoned'
            ? 'failed'
            : 'pending',
      amount: fromMinor(d.amount),
      currency: d.currency.toUpperCase(),
    };
  }

  // ─── Payout recipients ────────────────────────────────────────────────

  async banks(currency: string): Promise<BankDto[]> {
    const list = await this.call<{ code: string; name: string; active: boolean; type: string }[]>(
      'GET',
      `/bank?currency=${encodeURIComponent(currency)}&perPage=100`,
    );
    return list.filter((b) => b.active).map((b) => ({ code: b.code, name: b.name, type: b.type }));
  }

  async setupPayouts(opts: {
    name: string;
    bankCode: string;
    accountNumber: string;
    currency: string;
  }): Promise<PayoutSetup> {
    // Mobile money (M-Pesa) and banks need different recipient types; Paystack's
    // bank list says which, so ask it rather than guess from the currency.
    const bank = (await this.banks(opts.currency)).find((b) => b.code === opts.bankCode);
    const r = await this.call<{
      recipient_code: string;
      details: { bank_name: string; account_number: string };
    }>('POST', '/transferrecipient', {
      type: bank?.type ?? RECIPIENT_TYPE[opts.currency] ?? 'nuban',
      name: opts.name,
      account_number: opts.accountNumber,
      bank_code: opts.bankCode,
      currency: opts.currency,
    });
    return {
      accountRef: r.recipient_code,
      status: 'ready',
      details: {
        label: `${r.details.bank_name} ····${r.details.account_number.slice(-4)}`,
        currency: opts.currency,
      },
    };
  }
}
