import type {
  Currency,
  DealListingDto,
  DealPartyDto,
  ListingType,
  OfferDto,
  OfferListItemDto,
} from '@markethub/shared';
import type { Offer, Prisma, Profile } from '@prisma/client';

export const dealParty = { select: { id: true, profile: true } } as const;
export const dealListing = {
  select: {
    id: true,
    slug: true,
    title: true,
    type: true,
    images: { orderBy: { sortOrder: 'asc' }, take: 1 },
  },
} satisfies Prisma.ListingDefaultArgs;

export const offerListInclude = {
  order: { select: { id: true } },
  listing: dealListing,
  fromUser: dealParty,
  toUser: dealParty,
} satisfies Prisma.OfferInclude;

type OfferListRow = Prisma.OfferGetPayload<{ include: typeof offerListInclude }>;
type ListingRow = Prisma.ListingGetPayload<typeof dealListing>;

export function toParty(u: { id: string; profile: Profile | null }): DealPartyDto {
  return {
    userId: u.id,
    username: u.profile?.username ?? null,
    displayName: u.profile?.displayName ?? 'MarketHub user',
    avatarUrl: u.profile?.avatarUrl ?? null,
    idVerified: u.profile?.idVerified ?? false,
  };
}

export function toDealListing(l: ListingRow): DealListingDto {
  const cover = l.images[0];
  return {
    id: l.id,
    slug: l.slug,
    title: l.title,
    type: l.type as ListingType,
    coverThumbUrl: cover?.thumbUrl ?? cover?.url ?? null,
  };
}

export function toOffer(o: Offer & { order?: { id: string } | null }): OfferDto {
  return {
    id: o.id,
    conversationId: o.conversationId,
    listingId: o.listingId,
    fromUserId: o.fromUserId,
    toUserId: o.toUserId,
    parentOfferId: o.parentOfferId,
    quantity: o.quantity,
    unitPrice: o.unitPrice.toFixed(2),
    totalPrice: o.totalPrice.toFixed(2),
    currency: o.currency as Currency,
    message: o.message,
    status: o.status,
    expiresAt: o.expiresAt?.toISOString() ?? null,
    respondedAt: o.respondedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
    orderId: o.order?.id ?? null,
  };
}

export function toOfferListItem(o: OfferListRow, viewerId: string): OfferListItemDto {
  const sent = o.fromUserId === viewerId;
  return {
    ...toOffer(o),
    listing: toDealListing(o.listing),
    counterpart: toParty(sent ? o.toUser : o.fromUser),
    direction: sent ? 'sent' : 'received',
  };
}
