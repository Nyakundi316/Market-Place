import { describe, expect, it } from 'vitest';
import { chatTime, dayLabel, formatMoney, formatPrice, sameDay, timeAgo } from './format';

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

describe('chat timestamps', () => {
  const now = new Date(2026, 9, 13, 15, 0); // Tue 13 Oct 2026, 15:00 local

  it('chatTime: clock today, weekday this week, date beyond', () => {
    expect(chatTime(new Date(2026, 9, 13, 9, 5).toISOString(), now)).toMatch(/9:05/);
    expect(chatTime(new Date(2026, 9, 10, 9, 5).toISOString(), now)).toMatch(/^Sat/);
    expect(chatTime(new Date(2026, 8, 1).toISOString(), now)).toMatch(/1|Sep/);
  });

  it('dayLabel: Today / Yesterday / full date', () => {
    expect(dayLabel(new Date(2026, 9, 13, 0, 1).toISOString(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 12, 23, 59).toISOString(), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 9, 1).toISOString(), now)).toMatch(/October/);
  });

  it('sameDay compares local calendar days', () => {
    expect(
      sameDay(new Date(2026, 9, 13, 0, 1).toISOString(), new Date(2026, 9, 13, 23).toISOString()),
    ).toBe(true);
    expect(
      sameDay(new Date(2026, 9, 12, 23).toISOString(), new Date(2026, 9, 13, 1).toISOString()),
    ).toBe(false);
  });
});
