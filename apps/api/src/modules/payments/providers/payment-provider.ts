import type { Currency } from '@markethub/shared';

export type GatewayName = 'paystack' | 'sandbox';

export interface ChargeParams {
  orderId: string;
  /** Decimal string, e.g. "1500.00". */
  amount: string;
  currency: Currency;
  email: string;
  description: string;
  idempotencyKey: string;
  /** Where a hosted page sends the buyer back (Paystack). */
  returnUrl: string;
}

export interface ChargeResult {
  ref: string;
  status: 'requires_action' | 'processing' | 'succeeded';
  clientSecret?: string;
  redirectUrl?: string;
}

export interface RefundResult {
  ref: string;
  status: 'pending' | 'succeeded' | 'failed';
}

export interface TransferParams {
  orderId: string;
  amount: string;
  currency: Currency;
  /** PayoutAccount.accountRef */
  destination: string;
  /** The charge the money came from (kept for gateways that tie transfers to it). */
  sourceRef: string;
  idempotencyKey: string;
}

export interface TransferResult {
  ref: string;
  status: 'pending' | 'succeeded' | 'failed';
}

/** Gateway events reduced to what the escrow flow acts on. */
export type GatewayEvent =
  | {
      id: string;
      kind: 'charge.succeeded' | 'charge.failed';
      ref: string;
      amount: string;
      currency: string;
    }
  | { id: string; kind: 'refund.succeeded' | 'refund.failed'; ref: string; chargeRef: string }
  | { id: string; kind: 'transfer.succeeded' | 'transfer.failed'; ref: string }
  | {
      id: string;
      kind: 'payout_account.updated';
      accountRef: string;
      ready: boolean;
      restricted: boolean;
    }
  | { id: string; kind: 'ignored'; type: string };

export interface ChargeLookup {
  status: 'pending' | 'succeeded' | 'failed';
  amount: string;
  currency: string;
}

export interface PayoutSetup {
  accountRef: string;
  status: 'pending' | 'ready';
  details: { label: string; currency?: string } | null;
}

/** §7 PaymentProvider, plus the lookups reconciliation and payouts need. */
export interface PaymentProvider {
  readonly gateway: GatewayName;
  charge(p: ChargeParams): Promise<ChargeResult>;
  capture(ref: string): Promise<void>;
  refund(
    ref: string,
    amount: string,
    currency: Currency,
    idempotencyKey: string,
  ): Promise<RefundResult>;
  transfer(p: TransferParams): Promise<TransferResult>;
  /** Throws on a bad signature. `raw` must be the exact request bytes. */
  verifyWebhook(raw: Buffer, signature: string): GatewayEvent;
  lookup(ref: string): Promise<ChargeLookup>;
}

export class WebhookSignatureError extends Error {}
