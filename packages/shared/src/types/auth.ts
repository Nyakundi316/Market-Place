export type UserRole = 'seller' | 'buyer' | 'both' | 'admin';

/** What the client knows about the signed-in user. Never includes passwordHash (§9). */
export interface AuthUserDto {
  id: string;
  email: string;
  role: UserRole;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  /** false until onboarding sets a username */
  hasProfile: boolean;
}

/** Refresh token travels only as an httpOnly cookie, so it's absent here. */
export interface AuthResponseDto {
  accessToken: string;
  accessTokenExpiresIn: number;
  user: AuthUserDto;
}

export interface PublicProfileDto {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  profession: string | null;
  company: string | null;
  website: string | null;
  country: string | null;
  city: string | null;
  socials: Record<string, string>;
  idVerified: boolean;
  businessVerified: boolean;
  ratingAvg: number;
  ratingCount: number;
  listingsCount: number;
  completedDeals: number;
  responseRate: number;
  memberSince: string;
}

export interface MeDto {
  user: AuthUserDto;
  profile: PublicProfileDto | null;
  phone: string | null;
}

export interface ApiErrorDto {
  statusCode: number;
  error: string;
  message: string;
  /** field → messages, present on validation failures */
  fields?: Record<string, string[]>;
  requestId?: string;
}
