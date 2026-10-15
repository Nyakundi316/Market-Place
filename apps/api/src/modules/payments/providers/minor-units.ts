import { fromCents, toCents } from '@markethub/shared';

// Stripe's zero-decimal currencies among the ones we sell in (§1 CURRENCIES).
const ZERO_DECIMAL = new Set(['UGX']);

/** "1500.00" → 150000 (or 1500 for zero-decimal), never via floats. */
export function toMinor(amount: string, currency: string): number {
  const cents = toCents(amount);
  if (!ZERO_DECIMAL.has(currency.toUpperCase())) return Number(cents);
  if (cents % 100n !== 0n) throw new Error(`${currency} amounts can't have a fractional part`);
  return Number(cents / 100n);
}

export function fromMinor(minor: number, currency: string): string {
  const big = BigInt(minor);
  return fromCents(ZERO_DECIMAL.has(currency.toUpperCase()) ? big * 100n : big);
}
