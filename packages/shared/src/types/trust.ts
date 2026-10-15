import type { Currency } from '../schemas/catalog';
import type { ReportEntity, ReportReason, VerificationKind } from '../schemas/trust';
import type { DealPartyDto } from './deals';

export interface MyReviewDto {
  id: string;
  orderId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  /** The other person: who wrote it (received) or who it's about (given). */
  counterpart: DealPartyDto;
  listing: { title: string; slug: string } | null;
}

export interface ReportDto {
  id: string;
  entityType: ReportEntity;
  entityId: string;
  reason: ReportReason;
  details: string | null;
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedAt: string | null;
  reporter: DealPartyDto;
  /** A human handle on the reported thing, resolved server-side. */
  target: { label: string; link: string | null; ownerId: string | null };
  /** Other open reports about the same thing. */
  duplicates: number;
}

export interface VerificationStatusDto {
  phone: { number: string | null; verified: boolean; available: boolean };
  id: { verified: boolean; request: VerificationRequestSummary | null };
  business: { verified: boolean; request: VerificationRequestSummary | null };
}

export interface VerificationRequestSummary {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string | null;
  createdAt: string;
}

export interface AdminVerificationDto {
  id: string;
  kind: VerificationKind;
  status: 'pending' | 'approved' | 'rejected';
  details: Record<string, string>;
  /** Short-lived signed links; never stored. */
  documents: string[];
  user: DealPartyDto & { email: string; createdAt: string };
  createdAt: string;
  note: string | null;
}

export interface AdminUserDto {
  id: string;
  email: string;
  role: string;
  isBanned: boolean;
  isEmailVerified: boolean;
  isPhoneVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  profile: (DealPartyDto & { businessVerified: boolean; listingsCount: number }) | null;
  /** Warnings and bans on record (from the audit log). */
  warnings: number;
  openReports: number;
}

export interface AuditEntryDto {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  createdAt: string;
  actor: { id: string; label: string } | null;
}

export interface AdminOverviewDto {
  openReports: number;
  openDisputes: number;
  pendingVerifications: number;
  bannedUsers: number;
  /** Last 7 days. */
  newUsers: number;
  newListings: number;
  completedOrders: number;
  gmv: { currency: Currency; amount: string }[];
}

export interface SellerAnalyticsDto {
  days: number;
  listings: { active: number; views: number; favorites: number; chats: number };
  offers: { received: number; accepted: number; acceptanceRate: number | null };
  orders: { completed: number; inProgress: number; cancelled: number; refunded: number };
  /** Net of fees, per currency, for orders completed in the window. */
  earnings: { currency: Currency; amount: string }[];
  /** Share of buyer conversations answered within 24h (last 90 days). */
  responseRate: number | null;
  rating: { average: number; count: number };
  topListings: {
    id: string;
    slug: string;
    title: string;
    views: number;
    favorites: number;
    chats: number;
  }[];
}
