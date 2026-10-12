import type {
  Condition,
  Currency,
  ListingCardDto,
  ListingDetailDto,
  SellerSummaryDto,
} from '@markethub/shared';
import type { Prisma } from '@prisma/client';
import { toCategory } from '../categories/categories.service';

const money = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));

export const cardInclude = {
  images: { orderBy: { sortOrder: 'asc' }, take: 1 },
  seller: { select: { id: true, profile: true } },
} satisfies Prisma.ListingInclude;

export const detailInclude = {
  images: { orderBy: { sortOrder: 'asc' } },
  seller: { select: { id: true, profile: true } },
  tags: { include: { tag: true } },
  category: { include: { parent: true } },
} satisfies Prisma.ListingInclude;

type CardRow = Prisma.ListingGetPayload<{ include: typeof cardInclude }>;
type DetailRow = Prisma.ListingGetPayload<{ include: typeof detailInclude }>;

function toSeller(seller: CardRow['seller']): SellerSummaryDto {
  const p = seller.profile;
  // Only users with a profile can create listings, so p is always set in practice.
  return {
    userId: seller.id,
    username: p?.username ?? '',
    displayName: p?.displayName ?? 'Seller',
    avatarUrl: p?.avatarUrl ?? null,
    idVerified: p?.idVerified ?? false,
    businessVerified: p?.businessVerified ?? false,
    ratingAvg: p?.ratingAvg.toNumber() ?? 0,
    ratingCount: p?.ratingCount ?? 0,
    city: p?.city ?? null,
    country: p?.country ?? null,
  };
}

/** `favorites` = ids the viewer has favourited; undefined when anonymous. */
export function toCard(l: CardRow, favorites?: Set<string>): ListingCardDto {
  const cover = l.images[0];
  const featured = l.isFeatured && (!l.featuredUntil || l.featuredUntil > new Date());
  return {
    id: l.id,
    slug: l.slug,
    title: l.title,
    type: l.type,
    status: l.status,
    price: money(l.price),
    isPriceRange: l.isPriceRange,
    priceMin: money(l.priceMin),
    priceMax: money(l.priceMax),
    currency: l.currency as Currency,
    isNegotiable: l.isNegotiable,
    condition: l.condition as Condition | null,
    country: l.country,
    city: l.city,
    coverUrl: cover?.url ?? null,
    coverThumbUrl: cover?.thumbUrl ?? cover?.url ?? null,
    isFeatured: featured,
    favoritesCount: l.favoritesCount,
    publishedAt: l.publishedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    seller: toSeller(l.seller),
    isFavorited: favorites ? favorites.has(l.id) : null,
  };
}

export function toDetail(
  l: DetailRow,
  viewerId: string | null,
  favorited: boolean | null,
): ListingDetailDto {
  const card = toCard(l, undefined);
  return {
    ...card,
    isFavorited: favorited,
    description: l.description,
    images: l.images.map((i) => ({ id: i.id, url: i.url, thumbUrl: i.thumbUrl })),
    tags: l.tags.map((t) => t.tag.name),
    category: {
      ...toCategory(l.category),
      parent: l.category.parent && toCategory(l.category.parent),
    },
    stock: l.stock,
    lat: l.lat?.toNumber() ?? null,
    lng: l.lng?.toNumber() ?? null,
    contactPref: (l.contactPref ?? 'chat') as ListingDetailDto['contactPref'],
    viewsCount: l.viewsCount,
    chatCount: l.chatCount,
    featuredUntil: l.featuredUntil?.toISOString() ?? null,
    expiresAt: l.expiresAt?.toISOString() ?? null,
    updatedAt: l.updatedAt.toISOString(),
    isOwner: viewerId === l.sellerId,
  };
}
