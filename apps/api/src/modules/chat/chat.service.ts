import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConversationDto,
  ConversationQuery,
  CursorPage,
  CursorQuery,
  MessageDto,
  ReadReceipt,
  SendMessageInput,
  StartConversationInput,
} from '@markethub/shared';
import { Prisma, type Message } from '@prisma/client';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { POLICIES } from '../../common/rate-limit/rate-limit.service';
import type Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.module';
import { InjectRedis } from '../../redis/redis.module';
import { UploadsService } from '../uploads/uploads.service';
import {
  conversationInclude,
  type ConversationRow,
  toConversation,
  toMessage,
} from './chat.mapper';
import { RealtimeService } from './realtime.service';

type Cursor = { t: string; id: string };
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');
function decode(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Cursor;
    if (typeof c?.t === 'string' && typeof c.id === 'string' && !Number.isNaN(Date.parse(c.t)))
      return c;
  } catch {
    /* fall through */
  }
  throw new BadRequestException({ message: 'Invalid cursor', fields: { cursor: ['Invalid'] } });
}

const member = (userId: string) => ({ OR: [{ buyerId: userId }, { sellerId: userId }] });

@Injectable()
export class ChatService {
  constructor(
    private readonly db: PrismaService,
    private readonly uploads: UploadsService,
    private readonly realtime: RealtimeService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  // ─── Conversations ──────────────────────────────────────────────────────

  async list(userId: string, q: ConversationQuery): Promise<CursorPage<ConversationDto>> {
    const cursor = decode(q.cursor);
    const where: Prisma.ConversationWhereInput = {
      AND: [
        member(userId),
        q.archived === undefined ? {} : { isArchived: q.archived },
        cursor
          ? {
              OR: [
                { lastMessageAt: { lt: new Date(cursor.t) } },
                { lastMessageAt: new Date(cursor.t), id: { lt: cursor.id } },
              ],
            }
          : {},
      ],
    };
    const rows = await this.db.conversation.findMany({
      where,
      include: conversationInclude,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: await this.hydrate(page, userId),
      nextCursor:
        rows.length > q.limit && last?.lastMessageAt
          ? encode({ t: last.lastMessageAt.toISOString(), id: last.id })
          : null,
    };
  }

  async get(userId: string, id: string): Promise<ConversationDto> {
    const [dto] = await this.hydrate([await this.membership(userId, id)], userId);
    return dto!;
  }

  /**
   * Find-or-create (§4) for the buyer side. The unique (listing, buyer, seller)
   * makes a concurrent double-click land on the same row.
   */
  async start(
    user: RequestUser,
    input: StartConversationInput,
  ): Promise<{ conversation: ConversationDto; created: boolean }> {
    await this.assertCanChat(user);
    const listing = await this.db.listing.findUnique({
      where: { id: input.listingId },
      select: { id: true, sellerId: true, status: true },
    });
    if (!listing || listing.status !== 'active') throw new NotFoundException('Listing not found');
    if (listing.sellerId === user.id) throw new BadRequestException('This is your own listing');

    const key = { listingId: listing.id, buyerId: user.id, sellerId: listing.sellerId };
    let row = await this.db.conversation.findUnique({
      where: { listingId_buyerId_sellerId: key },
      include: conversationInclude,
    });
    let created = false;
    if (!row) {
      try {
        row = await this.db.$transaction(async (tx) => {
          const c = await tx.conversation.create({
            // Sorts with the rest until the first message's trigger moves it.
            data: { ...key, lastMessageAt: new Date() },
            include: conversationInclude,
          });
          await tx.listing.update({
            where: { id: listing.id },
            data: { chatCount: { increment: 1 } },
          });
          return c;
        });
        created = true;
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'))
          throw err;
        row = await this.db.conversation.findUniqueOrThrow({
          where: { listingId_buyerId_sellerId: key },
          include: conversationInclude,
        });
      }
      this.realtime.joinConversation(row.id, [row.buyerId, row.sellerId]);
    }

    if (input.body) {
      await this.send(user, {
        conversationId: row.id,
        type: 'text',
        body: input.body,
        attachments: [],
      });
      row = await this.db.conversation.findUniqueOrThrow({
        where: { id: row.id },
        include: conversationInclude,
      });
    }
    const [conversation] = await this.hydrate([row], user.id);
    if (created) {
      const [forSeller] = await this.hydrate([row], row.sellerId);
      this.realtime.toUser(row.sellerId, 'conversation:new', forSeller!);
    }
    return { conversation: conversation!, created };
  }

  // ─── Messages ───────────────────────────────────────────────────────────

  /** Newest first; the client reverses for display. */
  async messages(userId: string, id: string, q: CursorQuery): Promise<CursorPage<MessageDto>> {
    await this.membership(userId, id);
    const cursor = decode(q.cursor);
    const rows = await this.db.message.findMany({
      where: {
        conversationId: id,
        ...(cursor && {
          OR: [
            { createdAt: { lt: new Date(cursor.t) } },
            { createdAt: new Date(cursor.t), id: { lt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map(toMessage),
      nextCursor:
        rows.length > q.limit && last
          ? encode({ t: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** §5: persist, then broadcast. Used by both REST and the gateway. */
  async send(user: RequestUser, input: SendMessageInput): Promise<MessageDto> {
    await this.assertCanChat(user);
    const conversation = await this.membership(user.id, input.conversationId);
    await this.throttle(user.id);
    if (input.attachments.length) {
      await this.uploads.assertUploaded(
        input.attachments.map((a) => a.url),
        user.id,
        'chat',
      );
    }

    const message = toMessage(
      await this.db.message.create({
        data: {
          conversationId: conversation.id,
          senderId: user.id,
          type: input.type,
          body: input.body || null,
          attachments: input.attachments as Prisma.InputJsonValue,
        },
      }),
    );
    this.realtime.toConversation(conversation.id, 'message:new', message);
    return message;
  }

  /**
   * Marks the counterpart's messages up to `upTo` (default: all) as read and
   * recounts the viewer's unread badge. Null when there was nothing new.
   */
  async read(userId: string, id: string, upTo?: string): Promise<ReadReceipt | null> {
    const conversation = await this.membership(userId, id);
    let until: Message | null = null;
    if (upTo) {
      until = await this.db.message.findFirst({ where: { id: upTo, conversationId: id } });
      if (!until) throw new NotFoundException('Message not found');
    }
    const readAt = new Date();
    const isBuyer = conversation.buyerId === userId;

    const receipt = await this.db.$transaction(async (tx) => {
      const unreadWhere: Prisma.MessageWhereInput = {
        conversationId: id,
        senderId: { not: userId },
        isRead: false,
      };
      const lastUnread = await tx.message.findFirst({
        where: { ...unreadWhere, ...(until && { createdAt: { lte: until.createdAt } }) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      const { count } = await tx.message.updateMany({
        where: { ...unreadWhere, ...(until && { createdAt: { lte: until.createdAt } }) },
        data: { isRead: true, readAt },
      });
      const remaining = await tx.message.count({ where: unreadWhere });
      await tx.conversation.update({
        where: { id },
        data: isBuyer ? { buyerUnread: remaining } : { sellerUnread: remaining },
      });
      return count && lastUnread
        ? { conversationId: id, upTo: lastUnread.id, byUser: userId, readAt: readAt.toISOString() }
        : null;
    });

    if (receipt) this.realtime.toConversation(id, 'message:read', receipt);
    return receipt;
  }

  // ─── Guards & helpers ───────────────────────────────────────────────────

  /** Members only; anyone else gets a 404 so ids don't leak. */
  async membership(userId: string, id: string): Promise<ConversationRow> {
    const row = await this.db.conversation.findFirst({
      where: { id, ...member(userId) },
      include: conversationInclude,
    });
    if (!row) throw new NotFoundException('Conversation not found');
    return row;
  }

  /** Conversation ids the user belongs to — for joining socket rooms. */
  async conversationIds(userId: string) {
    const rows = await this.db.conversation.findMany({
      where: member(userId),
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Same bar as publishing: a confirmed inbox and a profile people can see. */
  private async assertCanChat(user: RequestUser) {
    if (!user.isEmailVerified) throw new ForbiddenException('Confirm your email to send messages');
    const profile = await this.db.profile.findUnique({
      where: { userId: user.id },
      select: { userId: true },
    });
    if (!profile) throw new ForbiddenException('Finish setting up your profile first');
  }

  /**
   * §5/§9: 20 messages per 10s as a fixed window (INCR+EXPIRE), one counter
   * shared by REST and the socket. A token bucket would refill mid-burst.
   */
  private async throttle(userId: string) {
    const { capacity, windowMs } = POLICIES.messages;
    const key = `rl:messages:${userId}`;
    const [[, count], , [, ttl]] = (await this.redis
      .multi()
      .incr(key)
      .pexpire(key, windowMs, 'NX')
      .pttl(key)
      .exec()) as [[null, number], unknown, [null, number]];
    if (count > capacity) {
      throw new HttpException(
        { message: 'You’re sending messages too fast', retryAfterMs: Math.max(ttl, 0) },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async hydrate(rows: ConversationRow[], viewerId: string): Promise<ConversationDto[]> {
    const lastIds = rows.map((r) => r.lastMessageId).filter((v): v is string => !!v);
    const counterparts = rows.map((r) => (r.buyerId === viewerId ? r.sellerId : r.buyerId));
    const [lastMessages, online] = await Promise.all([
      lastIds.length ? this.db.message.findMany({ where: { id: { in: lastIds } } }) : [],
      this.realtime.online(counterparts),
    ]);
    const byId = new Map(lastMessages.map((m) => [m.id, m]));
    return rows.map((r, i) =>
      toConversation(r, viewerId, {
        lastMessage: (r.lastMessageId && byId.get(r.lastMessageId)) || null,
        online: online.has(counterparts[i]!),
      }),
    );
  }
}
