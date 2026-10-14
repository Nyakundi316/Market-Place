import { z } from 'zod';
import { moneySchema } from './catalog';
import { cursorQuerySchema } from './pagination';
import { countrySchema } from './profile';

// ─── Offers (Phase 4) ───────────────────────────────────────────────────────

export const OFFER_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'countered',
  'expired',
  'withdrawn',
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OFFER_TTL_HOURS = 48;
export const MAX_OFFER_QUANTITY = 10_000;

const offerNoteSchema = z.string().trim().min(1).max(500, 'Keep it under 500 characters');
const quantitySchema = z.coerce.number().int().min(1).max(MAX_OFFER_QUANTITY);

/** Price and currency are checked against the listing server-side; total is never trusted. */
export const createOfferSchema = z
  .object({
    conversationId: z.string().uuid(),
    quantity: quantitySchema.default(1),
    unitPrice: moneySchema,
    message: offerNoteSchema.optional(),
  })
  .strict();

/** Quantity carries over from the offer being countered unless changed. */
export const counterOfferSchema = z
  .object({
    quantity: quantitySchema.optional(),
    unitPrice: moneySchema,
    message: offerNoteSchema.optional(),
  })
  .strict();

export const declineOfferSchema = z.object({ message: offerNoteSchema.optional() }).strict();

export const offerQuerySchema = cursorQuerySchema.extend({
  role: z.enum(['sent', 'received', 'all']).default('all'),
  status: z.enum(OFFER_STATUSES).optional(),
});

// ─── Orders ─────────────────────────────────────────────────────────────────

export const ORDER_STATUSES = [
  'awaiting_payment',
  'paid',
  'in_escrow',
  'shipped',
  'delivered',
  'completed',
  'disputed',
  'refunded',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Unpaid orders are cancelled after this and their stock released. */
export const ORDER_PAYMENT_WINDOW_HOURS = 24;

export const DELIVERY_METHODS = ['pickup', 'courier', 'digital', 'in_person'] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const deliveryAddressSchema = z
  .object({
    recipient: z.string().trim().min(2).max(80),
    phone: z
      .string()
      .trim()
      .regex(/^\+?[\d\s-]{7,20}$/, 'Enter a phone number')
      .optional(),
    line1: z.string().trim().min(3).max(120),
    line2: z.string().trim().max(120).optional(),
    city: z.string().trim().min(2).max(80),
    region: z.string().trim().max(80).optional(),
    postalCode: z.string().trim().max(20).optional(),
    country: countrySchema,
  })
  .strict();

export const createOrderSchema = z
  .object({
    offerId: z.string().uuid(),
    deliveryMethod: z.enum(DELIVERY_METHODS),
    deliveryAddress: deliveryAddressSchema.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((o) => o.deliveryMethod !== 'courier' || o.deliveryAddress, {
    path: ['deliveryAddress'],
    message: 'Add a delivery address',
  });

export const shipOrderSchema = z
  .object({ trackingNumber: z.string().trim().min(3).max(100).optional() })
  .strict();

export const cancelOrderSchema = z
  .object({ reason: z.string().trim().min(1).max(500).optional() })
  .strict();

export const orderQuerySchema = cursorQuerySchema.extend({
  role: z.enum(['buying', 'selling', 'all']).default('all'),
  status: z.enum(ORDER_STATUSES).optional(),
});

/**
 * Every status move an order can make. Payment, escrow and dispute edges are
 * driven by Phase 5 (webhooks, release jobs, admin); the user-facing ones
 * are listed in ORDER_ACTIONS.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  awaiting_payment: ['paid', 'cancelled'],
  paid: ['in_escrow', 'refunded'],
  in_escrow: ['shipped', 'refunded', 'disputed'],
  shipped: ['delivered', 'completed', 'disputed'],
  delivered: ['completed', 'disputed'],
  disputed: ['completed', 'refunded'],
  completed: [],
  refunded: [],
  cancelled: [],
};

export type DealSide = 'buyer' | 'seller';

/** What a party can do to an order from the UI, keyed by the route segment. */
export const ORDER_ACTIONS = {
  cancel: { by: ['buyer', 'seller'], from: ['awaiting_payment'], to: 'cancelled' },
  ship: { by: ['seller'], from: ['in_escrow'], to: 'shipped' },
  deliver: { by: ['seller'], from: ['shipped'], to: 'delivered' },
  // Buyer may skip the seller's "delivered" step if it arrived first.
  'confirm-delivery': { by: ['buyer'], from: ['shipped', 'delivered'], to: 'completed' },
} as const satisfies Record<
  string,
  { by: readonly DealSide[]; from: readonly OrderStatus[]; to: OrderStatus }
>;
export type OrderAction = keyof typeof ORDER_ACTIONS;

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function orderActionsFor(status: OrderStatus, side: DealSide): OrderAction[] {
  return (Object.keys(ORDER_ACTIONS) as OrderAction[]).filter((action) => {
    const rule = ORDER_ACTIONS[action];
    return (
      (rule.by as readonly DealSide[]).includes(side) &&
      (rule.from as readonly OrderStatus[]).includes(status)
    );
  });
}

export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export type CounterOfferInput = z.infer<typeof counterOfferSchema>;
export type DeclineOfferInput = z.infer<typeof declineOfferSchema>;
export type OfferQuery = z.infer<typeof offerQuerySchema>;
export type DeliveryAddress = z.infer<typeof deliveryAddressSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type ShipOrderInput = z.infer<typeof shipOrderSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type OrderQuery = z.infer<typeof orderQuerySchema>;
