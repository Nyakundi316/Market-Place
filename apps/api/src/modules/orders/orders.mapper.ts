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
  buyer: dealParty,
  seller: dealParty,
} satisfies Prisma.OrderInclude;

export type OrderRow = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

export const paymentDueAt = (createdAt: Date) =>
  new Date(createdAt.getTime() + ORDER_PAYMENT_WINDOW_HOURS * 3_600_000);

export function toOrderListItem(o: OrderRow, viewerId: string): OrderListItemDto {
  const side = o.buyerId === viewerId ? 'buyer' : 'seller';
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    side,
    status: o.status,
    listing: toDealListing(o.listing),
    offerId: o.offerId,
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
    actions: orderActionsFor(o.status, side),
  };
}

/** Only ever built for one of the two parties — the address is theirs to see. */
export function toOrder(o: OrderRow, viewerId: string): OrderDto {
  return {
    ...toOrderListItem(o, viewerId),
    deliveryAddress: (o.deliveryAddress as DeliveryAddress | null) ?? null,
    notes: o.notes,
  };
}
