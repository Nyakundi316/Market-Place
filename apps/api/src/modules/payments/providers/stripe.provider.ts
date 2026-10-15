import type { Currency } from '@markethub/shared';
import Stripe from 'stripe';
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

const chargeStatus = (s: Stripe.PaymentIntent.Status): ChargeResult['status'] =>
  s === 'succeeded' ? 'succeeded' : s === 'processing' ? 'processing' : 'requires_action';

const refundStatus = (s: string | null): RefundResult['status'] =>
  s === 'succeeded' ? 'succeeded' : s === 'failed' || s === 'canceled' ? 'failed' : 'pending';

/**
 * Charge-now on the platform account, then a separate Connect transfer on
 * release (PROGRESS: escrow model). Funds stay with the platform meanwhile.
 */
export class StripeProvider implements PaymentProvider {
  readonly gateway = 'stripe' as const;
  private readonly stripe: Stripe;

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 15_000 });
  }

  async charge(p: ChargeParams): Promise<ChargeResult> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: toMinor(p.amount, p.currency),
        currency: p.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true }, // 3DS/SCA handled by Elements (§7)
        receipt_email: p.email,
        description: p.description,
        transfer_group: p.orderId,
        metadata: { orderId: p.orderId },
      },
      { idempotencyKey: p.idempotencyKey },
    );
    return {
      ref: intent.id,
      status: chargeStatus(intent.status),
      clientSecret: intent.client_secret ?? undefined,
    };
  }

  async capture(ref: string): Promise<void> {
    await this.stripe.paymentIntents.capture(ref);
  }

  async refund(
    ref: string,
    amount: string,
    currency: Currency,
    idempotencyKey: string,
  ): Promise<RefundResult> {
    const r = await this.stripe.refunds.create(
      { payment_intent: ref, amount: toMinor(amount, currency), metadata: { chargeRef: ref } },
      { idempotencyKey },
    );
    return { ref: r.id, status: refundStatus(r.status) };
  }

  async transfer(p: TransferParams): Promise<TransferResult> {
    const intent = await this.stripe.paymentIntents.retrieve(p.sourceRef);
    const charge =
      typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id;
    const t = await this.stripe.transfers.create(
      {
        amount: toMinor(p.amount, p.currency),
        currency: p.currency.toLowerCase(),
        destination: p.destination,
        transfer_group: p.orderId,
        // Ties the transfer to the charge so it can go out before the funds settle.
        ...(charge && { source_transaction: charge }),
        metadata: { orderId: p.orderId },
      },
      { idempotencyKey: p.idempotencyKey },
    );
    return { ref: t.id, status: t.reversed ? 'failed' : 'succeeded' };
  }

  verifyWebhook(raw: Buffer, signature: string): GatewayEvent {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(raw, signature, this.webhookSecret);
    } catch (err) {
      throw new WebhookSignatureError((err as Error).message);
    }
    switch (event.type) {
      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        return {
          id: event.id,
          kind: event.type === 'payment_intent.succeeded' ? 'charge.succeeded' : 'charge.failed',
          ref: pi.id,
          amount: fromMinor(pi.amount, pi.currency),
          currency: pi.currency.toUpperCase(),
        };
      }
      case 'refund.updated': {
        const r = event.data.object;
        const status = refundStatus(r.status);
        if (status === 'pending') return { id: event.id, kind: 'ignored', type: event.type };
        const pi = typeof r.payment_intent === 'string' ? r.payment_intent : r.payment_intent?.id;
        return {
          id: event.id,
          kind: status === 'succeeded' ? 'refund.succeeded' : 'refund.failed',
          ref: r.id,
          chargeRef: pi ?? '',
        };
      }
      case 'transfer.reversed':
        return { id: event.id, kind: 'transfer.failed', ref: event.data.object.id };
      case 'account.updated': {
        const a = event.data.object;
        return {
          id: event.id,
          kind: 'payout_account.updated',
          accountRef: a.id,
          ready: Boolean(a.payouts_enabled && a.details_submitted),
          restricted: Boolean(a.requirements?.disabled_reason),
        };
      }
      default:
        return { id: event.id, kind: 'ignored', type: event.type };
    }
  }

  async lookup(ref: string): Promise<ChargeLookup> {
    const pi = await this.stripe.paymentIntents.retrieve(ref);
    return {
      status:
        pi.status === 'succeeded' ? 'succeeded' : pi.status === 'canceled' ? 'failed' : 'pending',
      amount: fromMinor(pi.amount_received || pi.amount, pi.currency),
      currency: pi.currency.toUpperCase(),
    };
  }

  // ─── Connect onboarding (§7 KYC) ──────────────────────────────────────

  async setupPayouts(opts: {
    userId: string;
    email: string;
    country: string | null;
    existingRef?: string;
    returnUrl: string;
  }): Promise<PayoutSetup> {
    const account =
      opts.existingRef ??
      (
        await this.stripe.accounts.create(
          {
            type: 'express',
            email: opts.email,
            ...(opts.country && { country: opts.country }),
            capabilities: { transfers: { requested: true } },
            metadata: { userId: opts.userId },
          },
          { idempotencyKey: `payout-account:${opts.userId}` },
        )
      ).id;
    const current = await this.stripe.accounts.retrieve(account);
    if (current.payouts_enabled && current.details_submitted) {
      return { accountRef: account, status: 'ready', details: { label: 'Stripe account' } };
    }
    const link = await this.stripe.accountLinks.create({
      account,
      type: 'account_onboarding',
      refresh_url: opts.returnUrl,
      return_url: opts.returnUrl,
    });
    return { accountRef: account, status: 'pending', details: null, actionUrl: link.url };
  }
}
