import { fromCents, toCents } from '@markethub/shared';

/**
 * Paystack takes amounts in the currency's subunit (kobo, pesewas, cents) —
 * ×100 for every currency we sell in. Via integer cents, never floats.
 */
export const toMinor = (amount: string): number => Number(toCents(amount));

export const fromMinor = (minor: number): string => fromCents(BigInt(minor));
