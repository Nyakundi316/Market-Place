import type {
  Attachment,
  ConversationDto,
  Currency,
  ListingStatus,
  MessageDto,
} from '@markethub/shared';
import type { Message, Prisma } from '@prisma/client';

const party = { select: { id: true, profile: true } } as const;

export const conversationInclude = {
  listing: {
    select: {
      id: true,
      slug: true,
      title: true,
      status: true,
      price: true,
      currency: true,
      images: { orderBy: { sortOrder: 'asc' }, take: 1 },
    },
  },
  buyer: party,
  seller: party,
} satisfies Prisma.ConversationInclude;

export type ConversationRow = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export function toMessage(m: Message): MessageDto {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    type: m.type,
    body: m.body,
    attachments: (m.attachments ?? []) as Attachment[],
    offerId: m.offerId,
    isRead: m.isRead,
    readAt: m.readAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export function toConversation(
  c: ConversationRow,
  viewerId: string,
  extra: { lastMessage: Message | null; online: boolean },
): ConversationDto {
  const isBuyer = c.buyerId === viewerId;
  const other = isBuyer ? c.seller : c.buyer;
  const cover = c.listing.images[0];
  return {
    id: c.id,
    role: isBuyer ? 'buyer' : 'seller',
    listing: {
      id: c.listing.id,
      slug: c.listing.slug,
      title: c.listing.title,
      status: c.listing.status as ListingStatus,
      price: c.listing.price?.toFixed(2) ?? null,
      currency: c.listing.currency as Currency,
      coverThumbUrl: cover?.thumbUrl ?? cover?.url ?? null,
    },
    counterpart: {
      userId: other.id,
      username: other.profile?.username ?? null,
      displayName: other.profile?.displayName ?? 'MarketHub user',
      avatarUrl: other.profile?.avatarUrl ?? null,
      idVerified: other.profile?.idVerified ?? false,
      online: extra.online,
    },
    lastMessage: extra.lastMessage ? toMessage(extra.lastMessage) : null,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    unread: isBuyer ? c.buyerUnread : c.sellerUnread,
    isArchived: c.isArchived,
    createdAt: c.createdAt.toISOString(),
  };
}
