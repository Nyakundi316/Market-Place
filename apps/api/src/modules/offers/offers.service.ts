import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type CounterOfferInput,
  type CreateOfferInput,
  type CursorPage,
  type DeclineOfferInput,
  formatAmount,
  multiplyMoney,
  OFFER_TTL_HOURS,
  type OfferDto,
  type OfferListItemDto,
  type OfferQuery,
} from '@markethub/shared';
import type { Message, Offer, OfferStatus, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { decodeCursor, olderThan, pageOf } from '../../common/cursor';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.module';
import { toMessage } from '../chat/chat.mapper';
import { ChatService } from '../chat/chat.service';
import { RealtimeService } from '../chat/realtime.service';
import { JobsService } from '../jobs/jobs.module';
import { NotificationsService } from '../notifications/notifications.service';
import { offerListInclude, toOffer, toOfferListItem } from './offers.mapper';

type Tx = Prisma.TransactionClient;

interface Terms {
  quantity: number;
  unitPrice: string;
  message?: string;
}

/** What a committed change needs to broadcast. */
interface Outcome {
  offer: Offer;
  messages: Message[];
  superseded?: Offer;
}

const TTL_MS = OFFER_TTL_HOURS * 3_600_000;

/**
 * §10 Phase 4 offer state machine. Every transition runs under a row lock on
 * the conversation, so two clicks on "Accept", or an accept racing a counter,
 * serialize instead of both succeeding. At most one offer per conversation is
 * pending: a new one from the same side replaces it (withdrawn), from the
 * other side it counts as a counter.
 */
@Injectable()
export class OffersService implements OnModuleInit {
  private readonly logger = new Logger(OffersService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly chat: ChatService,
    private readonly realtime: RealtimeService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    this.jobs.work('offer', async (job: Job<{ offerId: string }>) => {
      if (job.name === 'expire') await this.expire(job.data.offerId);
    });
  }

  // ─── Making offers ──────────────────────────────────────────────────────

  async create(user: RequestUser, input: CreateOfferInput): Promise<OfferDto> {
    await this.chat.assertCanChat(user);
    const conversation = await this.chat.membership(user.id, input.conversationId);
    const outcome = await this.db.$transaction(async (tx) => {
      await this.lock(tx, conversation.id);
      const pending = await tx.offer.findFirst({
        where: { conversationId: conversation.id, status: 'pending' },
      });
      return this.place(tx, user.id, conversation, input, pending);
    });
    return this.publish(
      outcome,
      outcome.superseded?.status === 'countered' ? 'offer.countered' : 'offer.received',
    );
  }

  async counter(user: RequestUser, id: string, input: CounterOfferInput): Promise<OfferDto> {
    await this.chat.assertCanChat(user);
    const outcome = await this.db.$transaction(async (tx) => {
      const original = await this.lockOffer(tx, id, user.id);
      this.assertPending(original);
      if (original.toUserId !== user.id)
        throw new ConflictException('You can’t counter your own offer');
      const conversation = await tx.conversation.findUniqueOrThrow({
        where: { id: original.conversationId },
      });
      return this.place(
        tx,
        user.id,
        conversation,
        { ...input, quantity: input.quantity ?? original.quantity },
        original,
      );
    });
    return this.publish(outcome, 'offer.countered');
  }

  // ─── Responding ─────────────────────────────────────────────────────────

  async accept(user: RequestUser, id: string): Promise<OfferDto> {
    await this.chat.assertCanChat(user);
    const outcome = await this.db.$transaction(async (tx) => {
      const offer = await this.lockOffer(tx, id, user.id);
      this.assertPending(offer);
      if (offer.toUserId !== user.id) throw new ConflictException('Only the other side can accept');
      await this.assertListingCanTake(
        tx,
        offer.listingId,
        offer.quantity,
        offer.unitPrice.toFixed(2),
      );
      return this.respond(tx, offer, 'accepted', user.id);
    });
    return this.publish(outcome, 'offer.accepted');
  }

  async decline(user: RequestUser, id: string, input: DeclineOfferInput): Promise<OfferDto> {
    const outcome = await this.db.$transaction(async (tx) => {
      const offer = await this.lockOffer(tx, id, user.id);
      this.assertPending(offer);
      if (offer.toUserId !== user.id)
        throw new ConflictException('Withdraw your own offer instead');
      return this.respond(tx, offer, 'declined', user.id, input.message);
    });
    return this.publish(outcome, 'offer.declined');
  }

  async withdraw(user: RequestUser, id: string): Promise<OfferDto> {
    const outcome = await this.db.$transaction(async (tx) => {
      const offer = await this.lockOffer(tx, id, user.id);
      this.assertPending(offer);
      if (offer.fromUserId !== user.id) throw new ConflictException('Decline it instead');
      return this.respond(tx, offer, 'withdrawn', user.id);
    });
    return this.publish(outcome, 'offer.withdrawn');
  }

  /** offer:expire job. Idempotent: anything no longer pending (or extended) is left alone. */
  async expire(offerId: string): Promise<'expired' | 'skipped'> {
    const outcome = await this.db.$transaction(async (tx) => {
      const offer = await tx.offer.findUnique({ where: { id: offerId } });
      if (!offer) return null;
      await this.lock(tx, offer.conversationId);
      const fresh = await tx.offer.findUniqueOrThrow({ where: { id: offerId } });
      if (fresh.status !== 'pending' || !fresh.expiresAt || fresh.expiresAt > new Date())
        return null;
      // Posted "by" the offer's author so the recipient's unread count moves, not theirs.
      return this.respond(tx, fresh, 'expired', fresh.fromUserId);
    });
    if (!outcome) return 'skipped';
    await this.publish(outcome, 'offer.expired');
    return 'expired';
  }

  // ─── Reading ────────────────────────────────────────────────────────────

  async mine(userId: string, q: OfferQuery): Promise<CursorPage<OfferListItemDto>> {
    const side =
      q.role === 'sent'
        ? { fromUserId: userId }
        : q.role === 'received'
          ? { toUserId: userId }
          : { OR: [{ fromUserId: userId }, { toUserId: userId }] };
    const rows = await this.db.offer.findMany({
      where: {
        AND: [
          side,
          q.status ? { status: q.status } : {},
          q.conversationId ? { conversationId: q.conversationId } : {},
          olderThan('createdAt', decodeCursor(q.cursor)),
        ],
      },
      include: offerListInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const { page, nextCursor } = pageOf(rows, q.limit, (r) => r.createdAt);
    return { items: page.map((r) => toOfferListItem(r, userId)), nextCursor };
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  private async place(
    tx: Tx,
    fromUserId: string,
    conversation: { id: string; listingId: string; buyerId: string; sellerId: string },
    terms: Terms,
    pending: Offer | null,
  ): Promise<Outcome> {
    await this.assertListingCanTake(tx, conversation.listingId, terms.quantity, terms.unitPrice);
    const listing = await tx.listing.findUniqueOrThrow({
      where: { id: conversation.listingId },
      select: { currency: true },
    });
    const toUserId =
      fromUserId === conversation.buyerId ? conversation.sellerId : conversation.buyerId;
    const now = new Date();

    // Their pending offer becomes the parent of this counter; ours is replaced.
    let superseded: Offer | undefined;
    if (pending) {
      superseded = await tx.offer.update({
        where: { id: pending.id },
        data: {
          status: pending.fromUserId === fromUserId ? 'withdrawn' : 'countered',
          respondedAt: now,
        },
      });
    }

    const offer = await tx.offer.create({
      data: {
        conversationId: conversation.id,
        listingId: conversation.listingId,
        fromUserId,
        toUserId,
        parentOfferId: superseded?.status === 'countered' ? superseded.id : null,
        quantity: terms.quantity,
        unitPrice: terms.unitPrice,
        totalPrice: multiplyMoney(terms.unitPrice, terms.quantity),
        currency: listing.currency,
        message: terms.message ?? null,
        expiresAt: new Date(now.getTime() + TTL_MS),
      },
    });
    const message = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderId: fromUserId,
        type: 'offer',
        offerId: offer.id,
        body: terms.message ?? null,
      },
    });
    return { offer, messages: [message], superseded };
  }

  private async respond(
    tx: Tx,
    offer: Offer,
    status: Extract<OfferStatus, 'accepted' | 'declined' | 'withdrawn' | 'expired'>,
    actorId: string,
    note?: string,
  ): Promise<Outcome> {
    const updated = await tx.offer.update({
      where: { id: offer.id },
      data: { status, respondedAt: new Date() },
    });
    const message = await tx.message.create({
      data: {
        conversationId: offer.conversationId,
        senderId: actorId,
        type: 'offer_response',
        offerId: offer.id,
        body: note ?? null,
      },
    });
    return { offer: updated, messages: [message] };
  }

  /** The listing must still be live, have the stock, and honour a fixed price. */
  private async assertListingCanTake(
    tx: Tx,
    listingId: string,
    quantity: number,
    unitPrice: string,
  ) {
    const l = await tx.listing.findUniqueOrThrow({
      where: { id: listingId },
      select: { status: true, type: true, stock: true, price: true, isNegotiable: true },
    });
    if (l.status !== 'active') throw new ConflictException('This listing is no longer available');
    if (l.type === 'job') throw new ConflictException('Job listings don’t take offers');
    if (l.stock !== null && quantity > l.stock) {
      throw new BadRequestException({
        message: l.stock ? `Only ${l.stock} available` : 'Out of stock',
        fields: { quantity: [`At most ${l.stock}`] },
      });
    }
    if (!l.isNegotiable && l.price && l.price.toFixed(2) !== unitPrice) {
      throw new BadRequestException({
        message: `The price is fixed at ${formatAmount(l.price.toFixed(2))}`,
        fields: { unitPrice: ['This listing isn’t negotiable'] },
      });
    }
  }

  private assertPending(offer: Offer) {
    if (offer.status !== 'pending')
      throw new ConflictException(`This offer was already ${offer.status}`);
    if (offer.expiresAt && offer.expiresAt <= new Date())
      throw new ConflictException('This offer has expired');
  }

  private async lock(tx: Tx, conversationId: string) {
    await tx.$queryRaw`SELECT id FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE`;
  }

  /** Loads under the conversation lock; non-parties get a 404 so ids don't leak. */
  private async lockOffer(tx: Tx, id: string, userId: string): Promise<Offer> {
    const peek = await tx.offer.findFirst({
      where: { id, OR: [{ fromUserId: userId }, { toUserId: userId }] },
      select: { conversationId: true },
    });
    if (!peek) throw new NotFoundException('Offer not found');
    await this.lock(tx, peek.conversationId);
    return tx.offer.findUniqueOrThrow({ where: { id } });
  }

  /** After commit: socket events, the expiry job, and a notification for the other side. */
  private async publish(
    { offer, messages, superseded }: Outcome,
    type:
      | 'offer.received'
      | 'offer.countered'
      | 'offer.accepted'
      | 'offer.declined'
      | 'offer.withdrawn'
      | 'offer.expired',
  ): Promise<OfferDto> {
    const dto = toOffer(offer);
    for (const m of messages)
      this.realtime.toConversation(offer.conversationId, 'message:new', toMessage(m));
    if (superseded)
      this.realtime.toConversation(offer.conversationId, 'offer:update', toOffer(superseded));
    this.realtime.toConversation(
      offer.conversationId,
      offer.status === 'pending' ? 'offer:new' : 'offer:update',
      dto,
    );

    if (offer.status === 'pending' && offer.expiresAt) {
      await this.jobs
        .queue('offer')
        .add(
          'expire',
          { offerId: offer.id },
          {
            jobId: `expire-${offer.id}`,
            delay: Math.max(offer.expiresAt.getTime() - Date.now(), 0),
          },
        )
        .catch((err: unknown) =>
          this.logger.error({ err, offerId: offer.id }, 'could not schedule expiry'),
        );
    }

    const listing = await this.db.listing.findUnique({
      where: { id: offer.listingId },
      select: { title: true },
    });
    const actor = await this.db.profile.findUnique({
      where: { userId: actorOf(offer, type) },
      select: { displayName: true },
    });
    const who = actor?.displayName ?? 'Someone';
    const price = `${offer.currency} ${formatAmount(dto.totalPrice)}`;
    const what = `“${listing?.title ?? 'your listing'}”`;
    const copy = {
      'offer.received': [offer.toUserId, `${who} offered ${price} for ${what}`],
      'offer.countered': [offer.toUserId, `${who} countered with ${price} for ${what}`],
      'offer.accepted': [offer.fromUserId, `${who} accepted your ${price} offer for ${what}`],
      'offer.declined': [offer.fromUserId, `${who} declined your offer for ${what}`],
      'offer.withdrawn': [offer.toUserId, `${who} withdrew their offer for ${what}`],
      'offer.expired': [offer.fromUserId, `Your ${price} offer for ${what} expired`],
    } as const;
    const [recipient, title] = copy[type];
    await this.notifications.notify(recipient, {
      type,
      title,
      body: offer.message && type !== 'offer.expired' ? offer.message : null,
      link: `/chat/${offer.conversationId}`,
      payload: { offerId: offer.id, conversationId: offer.conversationId },
    });
    return dto;
  }
}

/** Who caused this event: the offer's author for new/withdrawn, its recipient for replies. */
function actorOf(offer: Offer, type: string) {
  return type === 'offer.received' || type === 'offer.countered' || type === 'offer.withdrawn'
    ? offer.fromUserId
    : offer.toUserId;
}
