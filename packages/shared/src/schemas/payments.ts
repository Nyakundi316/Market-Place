import { z } from 'zod';
import { CURRENCIES, type Currency, moneySchema } from './catalog';

/**
 * Paystack is the only gateway (Stripe doesn't serve Kenyan businesses). The
 * PaymentProvider adapter (§7) stays, so another gateway can be added later
 * by extending this list and gatewayFor().
 */
export const GATEWAYS = ['paystack'] as const;
export type Gateway = (typeof GATEWAYS)[number];

/** Every listing currency (CURRENCIES) is one Paystack charges in. */
export const PAYSTACK_CURRENCIES: readonly Currency[] = CURRENCIES;
export const gatewayFor = (_currency: Currency | string): Gateway => 'paystack';

/** Where sellers can be paid out: local banks and mobile money (M-Pesa in Kenya). */
export const PAYOUT_CURRENCIES = ['KES', 'NGN', 'GHS', 'ZAR'] as const;

export const DISPUTE_OUTCOMES = ['release', 'refund', 'split'] as const;

/** Admin decision on a disputed order (§7). `split` refunds part, releases the rest. */
export const resolveDisputeSchema = z
  .object({
    outcome: z.enum(DISPUTE_OUTCOMES),
    refundAmount: moneySchema.optional(),
    note: z.string().trim().min(3).max(1000),
  })
  .strict()
  .refine((v) => v.outcome !== 'split' || v.refundAmount, {
    path: ['refundAmount'],
    message: 'How much goes back to the buyer?',
  });

export const paystackPayoutSchema = z
  .object({
    bankCode: z.string().trim().min(2).max(20),
    /** Bank account number, or the phone number for mobile money (e.g. 0712345678). */
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{6,20}$/, 'Digits only'),
    currency: z.enum(PAYOUT_CURRENCIES),
  })
  .strict();

export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
export type PaystackPayoutInput = z.infer<typeof paystackPayoutSchema>;

/** What the client needs to collect payment; never carries card data (§7). */
export interface PaymentSessionDto {
  orderId: string;
  gateway: Gateway | 'sandbox';
  /** `succeeded`: already paid (idempotent replay). */
  status: 'requires_action' | 'processing' | 'succeeded';
  amount: string;
  currency: Currency;
  /** Sandbox only: the reference its test card form posts back. */
  clientSecret: string | null;
  /** Paystack's hosted checkout (card, bank, M-Pesa / mobile money). */
  redirectUrl: string | null;
}

export interface PayoutAccountDto {
  gateway: Gateway;
  status: 'pending' | 'ready' | 'restricted';
  details: { label: string; currency?: string } | null;
}

export interface BankDto {
  code: string;
  name: string;
  /** Paystack recipient type, e.g. `mobile_money` for M-Pesa, `kepss` for Kenyan banks. */
  type?: string;
}
