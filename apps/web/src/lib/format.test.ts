import { describe, expect, it } from 'vitest';
import { formatMoney, formatPrice, timeAgo } from './format';

describe('formatMoney', () => {
  it('drops .00 on whole amounts and keeps cents otherwise', () => {
    expect(formatMoney('45000.00', 'KES')).toMatch(/^KES 45,000$/);
    expect(formatMoney('99.50', 'USD')).toMatch(/^USD 99\.50$/);
  });
});

describe('formatPrice', () => {
  const base = {
    price: null,
    priceMin: null,
    priceMax: null,
    isPriceRange: false,
    currency: 'KES' as const,
  };
  it('formats ranges without repeating the currency', () => {
    expect(
      formatPrice({ ...base, isPriceRange: true, priceMin: '100.00', priceMax: '250.00' }),
    ).toBe('KES 100 – 250');
  });
  it('falls back when unpriced', () => {
    expect(formatPrice(base)).toBe('Price on request');
  });
});

describe('timeAgo', () => {
  it('rounds to the biggest sensible unit', () => {
    const now = Date.parse('2026-10-13T12:00:00Z');
    expect(timeAgo('2026-10-13T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-10T12:00:00Z', now)).toMatch(/3 days ago/);
  });
});
