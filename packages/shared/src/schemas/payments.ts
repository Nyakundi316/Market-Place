import { z } from 'zod';
import { type Currency, moneySchema } from './catalog';

export const GATEWAYS = ['stripe', 'paystack'] as const;
export type Gateway = (typeof GATEWAYS)[number];

/** Paystack settles these locally; Stripe takes the rest (§1 adapter). */
export const PAYSTACK_CURRENCIES: readonly Currency[] = ['NGN', 'GHS', 'KES', 'ZAR'];
export const gatewayFor = (currency: Currency | string): Gateway =>
  PAYSTACK_CURRENCIES.includes(currency as Currency) ? 'paystack' : 'stripe';

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
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{6,20}$/, 'Digits only'),
    currency: z.enum(['NGN', 'GHS', 'KES', 'ZAR']),
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
  /** Stripe Elements. */
  clientSecret: string | null;
  publishableKey: string | null;
  /** Paystack hosted page. */
  redirectUrl: string | null;
}

export interface PayoutAccountDto {
  gateway: Gateway;
  status: 'pending' | 'ready' | 'restricted';
  details: { label: string; currency?: string } | null;
  /** Stripe onboarding / dashboard link while pending. */
  actionUrl: string | null;
}

export interface BankDto {
  code: string;
  name: string;
}
