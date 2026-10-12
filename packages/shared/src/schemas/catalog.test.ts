import { describe, expect, it } from 'vitest';
import {
  createListingSchema,
  listingQuerySchema,
  moneySchema,
  updateListingSchema,
} from './catalog';
import { signUploadSchema } from './uploads';

const base = {
  categoryId: '6f1c2f8e-1b7a-4c35-9a59-0d7b8f0a2c11',
  type: 'product',
  title: 'iPhone 13, 128GB',
  description: 'Lightly used, battery health 91%, comes with box and cable.',
  currency: 'KES',
  country: 'ke',
  city: 'Nairobi',
};

describe('moneySchema', () => {
  it.each([
    [1500, '1500.00'],
    ['99.9', '99.90'],
    ['0.01', '0.01'],
  ])('%s → %s', (input, out) => expect(moneySchema.parse(input)).toBe(out));

  it.each(['0', '-5', '1.234', 'abc', '1e5', '1234567890123'])('rejects %s', (v) =>
    expect(moneySchema.safeParse(v).success).toBe(false),
  );
});

describe('createListingSchema', () => {
  it('fills defaults and normalises', () => {
    const out = createListingSchema.parse({
      ...base,
      price: 45000,
      tags: ['Apple', 'apple', 'iOS'],
    });
    expect(out).toMatchObject({
      price: '45000.00',
      country: 'KE',
      isNegotiable: true,
      isPriceRange: false,
      contactPref: 'chat',
      tags: ['apple', 'ios'],
      images: [],
    });
  });

  it('needs a price unless it is a range', () => {
    const r = createListingSchema.safeParse(base);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(['price']);
  });

  it('range needs min ≤ max', () => {
    const r = createListingSchema.safeParse({
      ...base,
      isPriceRange: true,
      priceMin: 500,
      priceMax: 100,
    });
    expect(r.error?.issues.map((i) => i.path.join('.'))).toEqual(['priceMax']);
    expect(
      createListingSchema.safeParse({ ...base, isPriceRange: true, priceMin: 100, priceMax: 500 })
        .success,
    ).toBe(true);
  });

  it('rejects server-owned fields', () => {
    expect(createListingSchema.safeParse({ ...base, price: 1, status: 'active' }).success).toBe(
      false,
    );
    expect(createListingSchema.safeParse({ ...base, price: 1, isFeatured: true }).success).toBe(
      false,
    );
  });

  it('caps images at 10', () => {
    const images = Array.from({ length: 11 }, (_, i) => ({ url: `https://cdn.test/${i}.jpg` }));
    expect(createListingSchema.safeParse({ ...base, price: 1, images }).success).toBe(false);
  });
});

describe('updateListingSchema', () => {
  it('only lets sellers move status to sold', () => {
    expect(updateListingSchema.safeParse({ status: 'sold' }).success).toBe(true);
    expect(updateListingSchema.safeParse({ status: 'active' }).success).toBe(false);
  });
});

describe('listingQuerySchema', () => {
  it('parses query-string values', () => {
    expect(listingQuerySchema.parse({ verified: 'true', rating: '4', limit: '10' })).toMatchObject({
      verified: true,
      rating: 4,
      limit: 10,
    });
  });
});

describe('signUploadSchema', () => {
  it('accepts listing video, rejects avatar video and >20MB', () => {
    expect(
      signUploadSchema.safeParse({ purpose: 'listing', contentType: 'video/mp4', size: 1000 })
        .success,
    ).toBe(true);
    expect(
      signUploadSchema.safeParse({ purpose: 'avatar', contentType: 'video/mp4', size: 1000 })
        .success,
    ).toBe(false);
    expect(
      signUploadSchema.safeParse({
        purpose: 'listing',
        contentType: 'image/png',
        size: 21 * 1024 * 1024,
      }).success,
    ).toBe(false);
    expect(
      signUploadSchema.safeParse({ purpose: 'listing', contentType: 'image/gif', size: 10 })
        .success,
    ).toBe(false);
  });
});
