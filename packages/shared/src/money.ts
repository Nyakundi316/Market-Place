/**
 * Money arithmetic on decimal strings ("1500.00") via integer cents, so no
 * amount ever passes through a float. Inputs are expected to be validated
 * by `moneySchema` (≤ 2 decimals) already.
 */

export function toCents(amount: string): bigint {
  const [whole = '0', frac = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0').slice(0, 2));
}

export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

export function multiplyMoney(unitPrice: string, quantity: number): string {
  return fromCents(toCents(unitPrice) * BigInt(quantity));
}

/** Percent of an amount, rounded half-up to the cent. Accepts 2.5 (%), not 0.025. */
export function percentOf(amount: string, percent: number): string {
  const basisPoints = BigInt(Math.round(percent * 100));
  return fromCents((toCents(amount) * basisPoints + 5_000n) / 10_000n);
}

export interface OrderTotals {
  subtotal: string;
  platformFee: string;
  /** What the buyer is charged. */
  total: string;
  /** What reaches the seller on release (§7 "transfer net"). */
  sellerNet: string;
}

/** §7: the platform fee comes out of the seller's side; the buyer pays the agreed price. */
export function orderTotals(unitPrice: string, quantity: number, feePercent: number): OrderTotals {
  const subtotal = multiplyMoney(unitPrice, quantity);
  const platformFee = percentOf(subtotal, feePercent);
  return {
    subtotal,
    platformFee,
    total: subtotal,
    sellerNet: fromCents(toCents(subtotal) - toCents(platformFee)),
  };
}
