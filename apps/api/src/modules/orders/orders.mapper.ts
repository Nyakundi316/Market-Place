import {
  type Currency,
  type DeliveryAddress,
  type DeliveryMethod,
  ORDER_PAYMENT_WINDOW_HOURS,
  orderActionsFor,
  type OrderDto,
  type OrderListItemDto,
} from '@markethub/shared';
import type { Prisma } from '@prisma/client';
import { dealListing, dealParty, toDealListing, toParty } from '../offers/offers.mapper';

export const orderInclude = {
  listing: dealListing,
  offer: { select: { conversationId: true } },
  escrow: { select: { status: true, releaseScheduledAt: true } },
  review: { select: { rating: true, comment: true } },
  buyer: dealParty,
  seller: dealParty,
} satisfies Prisma.OrderInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export const paymentDueAt = (createdAt: Date) =>
  new Date(createdAt.getTime() + ORDER_PAYMENT_WINDOW_HOURS * 3_600_000);

/** Status allows it, but the clock may not: unpaid past the window, disputes past theirs. */
function actionsFor(o: OrderRow, side: 'buyer' | 'seller', disputeDays: number) {
  const now = Date.now();
  return orderActionsFor(o.status, side).filter((a) => {
    if (a === 'pay') return paymentDueAt(o.createdAt).getTime() > now;
    if (a === 'dispute' && o.deliveredAt) {
      return o.deliveredAt.getTime() + disputeDays * 86_400_000 > now;
    }
    return true;
  });
}

export function toOrderListItem(o: OrderRow, viewerId: string, disputeDays = 7): OrderListItemDto {
  const side = o.buyerId === viewerId ? 'buyer' : 'seller';
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    side,
    status: o.status,
    listing: toDealListing(o.listing),
    offerId: o.offerId,
    conversationId: o.offer?.conversationId ?? null,
    buyer: toParty(o.buyer),
    seller: toParty(o.seller),
    quantity: o.quantity,
    unitPrice: o.unitPrice.toFixed(2),
    subtotal: o.subtotal.toFixed(2),
    platformFee: o.platformFee.toFixed(2),
    total: o.total.toFixed(2),
    currency: o.currency as Currency,
    deliveryMethod: o.deliveryMethod as DeliveryMethod | null,
    trackingNumber: o.trackingNumber,
    paidAt: o.paidAt?.toISOString() ?? null,
    deliveredAt: o.deliveredAt?.toISOString() ?? null,
    completedAt: o.completedAt?.toISOString() ?? null,
    cancelledAt: o.cancelledAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    paymentDueAt: o.status === 'awaiting_payment' ? paymentDueAt(o.createdAt).toISOString() : null,
    actions: actionsFor(o, side, disputeDays),
    review: o.review,
    escrow: o.escrow && {
      status: o.escrow.status,
      autoReleaseAt:
        o.escrow.status === 'held' && o.status === 'delivered'
          ? (o.escrow.releaseScheduledAt?.toISOString() ?? null)
          : null,
      awaitingPayoutDetails: o.escrow.status === 'held' && o.status === 'completed',
    },
  };
}

/** Only ever built for one of the two parties — the address is theirs to see. */
export function toOrder(o: OrderRow, viewerId: string, disputeDays = 7): OrderDto {
  return {
    ...toOrderListItem(o, viewerId, disputeDays),
    deliveryAddress: (o.deliveryAddress as DeliveryAddress | null) ?? null,
    notes: o.notes,
  };
}
