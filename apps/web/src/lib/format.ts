import type { ListingCardDto } from '@markethub/shared';

const moneyFormatters = new Map<string, Intl.NumberFormat>();

/** §6: money via Intl with the currency from the data. Whole amounts drop the ".00". */
export function formatMoney(amount: string | number, currency: string) {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  const whole = Number.isInteger(value);
  const key = `${currency}:${whole}`;
  let fmt = moneyFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    });
    moneyFormatters.set(key, fmt);
  }
  // "KES 45,000" reads better than "KES 45,000" with a non-breaking space in narrow cards.
  return fmt.format(value).replace(/ /g, ' ');
}

export function formatPrice(
  l: Pick<ListingCardDto, 'price' | 'priceMin' | 'priceMax' | 'isPriceRange' | 'currency'>,
) {
  if (l.isPriceRange && l.priceMin && l.priceMax) {
    return `${formatMoney(l.priceMin, l.currency)} – ${formatMoney(l.priceMax, l.currency).replace(`${l.currency} `, '')}`;
  }
  return l.price ? formatMoney(l.price, l.currency) : 'Price on request';
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "3 days ago", "yesterday", "just now" */
export function timeAgo(iso: string | null | undefined, now = Date.now()) {
  if (!iso) return '';
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export const CONDITION_LABEL: Record<string, string> = {
  new: 'New',
  like_new: 'Like new',
  good: 'Good',
  fair: 'Fair',
  for_parts: 'For parts',
};

export const TYPE_LABEL: Record<string, string> = {
  product: 'Product',
  service: 'Service',
  job: 'Job',
  request: 'Wanted',
};
