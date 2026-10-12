import type { Condition, Currency, ListingType } from '../schemas/catalog';

export interface CategoryDto {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  sortOrder: number;
}

export interface CategoryNodeDto extends CategoryDto {
  children: CategoryDto[];
}

export interface CategoryDetailDto extends CategoryDto {
  parent: CategoryDto | null;
  children: CategoryDto[];
}

export type ListingStatus = 'draft' | 'pending' | 'active' | 'sold' | 'expired' | 'removed';

/** Just enough of the seller to judge trust at a glance. */
export interface SellerSummaryDto {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  idVerified: boolean;
  businessVerified: boolean;
  ratingAvg: number;
  ratingCount: number;
  city: string | null;
  country: string | null;
}

/** Money fields are decimal strings, e.g. "1500.00". */
export interface ListingCardDto {
  id: string;
  slug: string;
  title: string;
  type: ListingType;
  status: ListingStatus;
  price: string | null;
  isPriceRange: boolean;
  priceMin: string | null;
  priceMax: string | null;
  currency: Currency;
  isNegotiable: boolean;
  condition: Condition | null;
  country: string | null;
  city: string | null;
  coverUrl: string | null;
  coverThumbUrl: string | null;
  isFeatured: boolean;
  favoritesCount: number;
  publishedAt: string | null;
  createdAt: string;
  seller: SellerSummaryDto;
  /** null when anonymous */
  isFavorited: boolean | null;
}

export interface ListingImageDto {
  id: string;
  url: string;
  thumbUrl: string | null;
}

export interface ListingDetailDto extends ListingCardDto {
  description: string;
  images: ListingImageDto[];
  tags: string[];
  category: CategoryDto & { parent: CategoryDto | null };
  stock: number | null;
  lat: number | null;
  lng: number | null;
  contactPref: 'chat' | 'phone' | 'both';
  viewsCount: number;
  chatCount: number;
  featuredUntil: string | null;
  expiresAt: string | null;
  updatedAt: string;
  isOwner: boolean;
}

export interface PresignedUploadDto {
  /** PUT the file here with the same Content-Type */
  uploadUrl: string;
  /** public URL to store on the listing/profile once uploaded */
  publicUrl: string;
  key: string;
  expiresIn: number;
}

export interface FollowStateDto {
  following: boolean;
  followersCount: number;
}

export interface FavoriteStateDto {
  favorited: boolean;
  favoritesCount: number;
}
