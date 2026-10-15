import { describe, expect, it } from 'vitest';
import { formatAmount, multiplyMoney, orderTotals, percentOf } from '../money';
import {
  canTransitionOrder,
  counterOfferSchema,
  createOfferSchema,
  createOrderSchema,
  ORDER_ACTIONS,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  orderActionsFor,
} from './deals';
import { gatewayFor, resolveDisputeSchema } from './payments';

const conversationId = '6f1c2f8e-1b7a-4c35-9a59-0d7b8f0a2c11';
const offerId = '0b8f4f8e-2c7a-4d35-8a59-1d7b8f0a2c22';

describe('money', () => {
  it('multiplies without float drift', () => {
    expect(multiplyMoney('0.10', 3)).toBe('0.30');
    expect(multiplyMoney('19.99', 7)).toBe('139.93');
    expect(multiplyMoney('999999999999.99', 1)).toBe('999999999999.99');
    expect(formatAmount('1234567.50')).toBe('1,234,567.50');
    expect(formatAmount('999.00')).toBe('999.00');
  });

  it('rounds percentages half-up to the cent', () => {
    expect(percentOf('100.00', 2)).toBe('2.00');
    expect(percentOf('0.25', 2)).toBe('0.01'); // 0.005 → 0.01
    expect(percentOf('0.24', 2)).toBe('0.00');
    expect(percentOf('1234.56', 2.5)).toBe('30.86');
  });

  it('takes the fee from the seller side', () => {
    expect(orderTotals('1500.00', 2, 2)).toEqual({
      subtotal: '3000.00',
      platformFee: '60.00',
      total: '3000.00',
      sellerNet: '2940.00',
    });
    expect(orderTotals('10.00', 1, 0).sellerNet).toBe('10.00');
  });
});

describe('offer schemas', () => {
  it('normalises price and defaults quantity', () => {
    expect(createOfferSchema.parse({ conversationId, unitPrice: 1200 })).toEqual({
      conversationId,
      quantity: 1,
      unitPrice: '1200.00',
    });
  });

  it('never accepts a client total or currency', () => {
    expect(
      createOfferSchema.safeParse({ conversationId, unitPrice: '10', totalPrice: '1' }).success,
    ).toBe(false);
    expect(
      createOfferSchema.safeParse({ conversationId, unitPrice: '10', currency: 'USD' }).success,
    ).toBe(false);
  });

  it('rejects zero, negative and fractional quantities', () => {
    for (const quantity of [0, -1, 1.5]) {
      expect(createOfferSchema.safeParse({ conversationId, unitPrice: 5, quantity }).success).toBe(
        false,
      );
    }
    expect(counterOfferSchema.safeParse({ unitPrice: '0' }).success).toBe(false);
  });
});

describe('createOrderSchema', () => {
  const address = { recipient: 'Ama', line1: '12 Oxford St', city: 'Accra', country: 'gh' };

  it('needs an address for courier delivery only', () => {
    expect(createOrderSchema.safeParse({ offerId, deliveryMethod: 'courier' }).success).toBe(false);
    expect(createOrderSchema.safeParse({ offerId, deliveryMethod: 'pickup' }).success).toBe(true);
    const parsed = createOrderSchema.parse({
      offerId,
      deliveryMethod: 'courier',
      deliveryAddress: address,
    });
    expect(parsed.deliveryAddress?.country).toBe('GH');
  });
});

describe('order state machine', () => {
  it('terminal states go nowhere', () => {
    for (const s of ['completed', 'refunded', 'cancelled'] as const) {
      expect(ORDER_TRANSITIONS[s]).toEqual([]);
    }
  });

  it('only webhooks/jobs can skip the escrow path', () => {
    expect(canTransitionOrder('awaiting_payment', 'shipped')).toBe(false);
    expect(canTransitionOrder('awaiting_payment', 'paid')).toBe(true);
    expect(canTransitionOrder('in_escrow', 'cancelled')).toBe(false);
  });

  it('every UI action follows a legal edge', () => {
    for (const status of ORDER_STATUSES) {
      for (const side of ['buyer', 'seller'] as const) {
        for (const action of orderActionsFor(status, side)) {
          expect(canTransitionOrder(status, ORDER_ACTIONS[action].to)).toBe(true);
        }
      }
    }
  });

  it('gives each side its own buttons', () => {
    expect(orderActionsFor('awaiting_payment', 'buyer')).toEqual(['cancel', 'pay']);
    expect(orderActionsFor('awaiting_payment', 'seller')).toEqual(['cancel']);
    expect(orderActionsFor('in_escrow', 'seller')).toEqual(['ship', 'refund']);
    expect(orderActionsFor('in_escrow', 'buyer')).toEqual([]);
    expect(orderActionsFor('shipped', 'buyer')).toEqual(['confirm-delivery', 'dispute']);
    expect(orderActionsFor('delivered', 'seller')).toEqual([]);
    expect(orderActionsFor('disputed', 'buyer')).toEqual([]);
  });
});

describe('payments', () => {
  it('routes local currencies to Paystack, the rest to Stripe', () => {
    expect(gatewayFor('KES')).toBe('paystack');
    expect(gatewayFor('NGN')).toBe('paystack');
    expect(gatewayFor('USD')).toBe('stripe');
    expect(gatewayFor('UGX')).toBe('stripe');
    expect(resolveDisputeSchema.safeParse({ outcome: 'split', note: 'half' }).success).toBe(false);
    expect(
      resolveDisputeSchema.safeParse({ outcome: 'split', refundAmount: '50', note: 'half' })
        .success,
    ).toBe(true);
  });
});
