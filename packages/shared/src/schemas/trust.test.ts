import { describe, expect, it } from 'vitest';
import {
  analyticsQuerySchema,
  createReportSchema,
  createReviewSchema,
  createVerificationSchema,
  reviewVerificationSchema,
  sendPhoneCodeSchema,
} from './trust';

const id = '6f1c2f8e-1b7a-4c35-9a59-0d7b8f0a2c11';

describe('trust schemas', () => {
  it('reviews take whole stars from 1 to 5', () => {
    expect(createReviewSchema.safeParse({ orderId: id, rating: 5 }).success).toBe(true);
    for (const rating of [0, 6, 4.5]) {
      expect(createReviewSchema.safeParse({ orderId: id, rating }).success).toBe(false);
    }
  });

  it('"other" reports need details', () => {
    const base = { entityType: 'listing', entityId: id };
    expect(createReportSchema.safeParse({ ...base, reason: 'scam' }).success).toBe(true);
    expect(createReportSchema.safeParse({ ...base, reason: 'other' }).success).toBe(false);
    expect(
      createReportSchema.safeParse({ ...base, reason: 'other', details: 'Selling stolen bikes' })
        .success,
    ).toBe(true);
    expect(
      createReportSchema.safeParse({ ...base, entityType: 'order', reason: 'scam' }).success,
    ).toBe(false);
  });

  it('normalises phone numbers to E.164', () => {
    expect(sendPhoneCodeSchema.parse({ phone: '+254 712-345 678' }).phone).toBe('+254712345678');
    expect(sendPhoneCodeSchema.safeParse({ phone: '0712345678' }).success).toBe(false);
  });

  it('verification details depend on the kind', () => {
    expect(
      createVerificationSchema.safeParse({
        kind: 'business',
        documents: ['verification/u/a.jpg'],
        details: { businessName: 'Juma Electronics', registrationNumber: 'PVT-123' },
      }).success,
    ).toBe(true);
    expect(
      createVerificationSchema.safeParse({
        kind: 'id',
        documents: ['verification/u/a.jpg'],
        details: { businessName: 'Juma Electronics', registrationNumber: 'PVT-123' },
      }).success,
    ).toBe(false);
    expect(
      createVerificationSchema.safeParse({
        kind: 'id',
        documents: [],
        details: { documentType: 'passport' },
      }).success,
    ).toBe(false);
  });

  it('rejections must say why', () => {
    expect(reviewVerificationSchema.safeParse({ requestId: id, decision: 'reject' }).success).toBe(
      false,
    );
    expect(
      reviewVerificationSchema.safeParse({
        requestId: id,
        decision: 'reject',
        note: 'Photo is blurry',
      }).success,
    ).toBe(true);
  });

  it('analytics windows are 7, 30 or 90 days', () => {
    expect(analyticsQuerySchema.parse({}).days).toBe(30);
    expect(analyticsQuerySchema.parse({ days: '90' }).days).toBe(90);
    expect(analyticsQuerySchema.safeParse({ days: '45' }).success).toBe(false);
  });
});
