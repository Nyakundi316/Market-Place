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

// ─── Chat timestamps (client-rendered only, so the local zone is fine) ────

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const longDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** Inbox column: "14:05", "Tue", "3 Oct". */
export function chatTime(iso: string, now = new Date()) {
  const d = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days <= 0) return clock.format(d);
  if (days < 7) return weekday.format(d);
  return shortDate.format(d);
}

export const messageTime = (iso: string) => clock.format(new Date(iso));

/** Separator between days in a thread. */
export function dayLabel(iso: string, now = new Date()) {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return longDate.format(new Date(iso));
}

export const sameDay = (a: string, b: string) =>
  startOfDay(new Date(a)) === startOfDay(new Date(b));
