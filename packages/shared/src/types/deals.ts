import type { Currency, ListingType } from '../schemas/catalog';
import type {
  DealSide,
  DeliveryAddress,
  DeliveryMethod,
  OfferStatus,
  OrderAction,
  OrderStatus,
} from '../schemas/deals';

export interface DealPartyDto {
  userId: string;
  username: string | null;
  displayName: string;
  avatarUrl: string | null;
  idVerified: boolean;
}

export interface DealListingDto {
  id: string;
  slug: string;
  title: string;
  type: ListingType;
  coverThumbUrl: string | null;
}

/** Money fields are decimal strings. */
export interface OfferDto {
  id: string;
  conversationId: string;
  listingId: string;
  fromUserId: string;
  toUserId: string;
  parentOfferId: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  currency: Currency;
  message: string | null;
  status: OfferStatus;
  expiresAt: string | null;
  respondedAt: string | null;
  createdAt: string;
  /** Set once an order exists for this (accepted) offer. */
  orderId: string | null;
}

/** /offers/mine rows carry enough context to render without the conversation. */
export interface OfferListItemDto extends OfferDto {
  listing: DealListingDto;
  counterpart: DealPartyDto;
  direction: 'sent' | 'received';
}

export interface OrderDto {
  id: string;
  orderNumber: string;
  /** Which side of the order the viewer is on. */
  side: DealSide;
  status: OrderStatus;
  listing: DealListingDto;
  offerId: string | null;
  /** The chat the deal was struck in. */
  conversationId: string | null;
  buyer: DealPartyDto;
  seller: DealPartyDto;
  quantity: number;
  unitPrice: string;
  subtotal: string;
  platformFee: string;
  total: string;
  currency: Currency;
  deliveryMethod: DeliveryMethod | null;
  /** Only shown to the two parties. */
  deliveryAddress: DeliveryAddress | null;
  trackingNumber: string | null;
  notes: string | null;
  paidAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Unpaid orders auto-cancel at this time. */
  paymentDueAt: string | null;
  actions: OrderAction[];
}

export type OrderListItemDto = Omit<OrderDto, 'deliveryAddress' | 'notes'>;
