import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type CancelOrderInput,
  type CreateOrderInput,
  type CursorPage,
  type Env,
  type NotificationType,
  ORDER_ACTIONS,
  type OrderAction,
  type OrderDto,
  type OrderListItemDto,
  type OrderQuery,
  orderTotals,
  type ShipOrderInput,
} from '@markethub/shared';
import { type Order, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { decodeCursor, olderThan, pageOf } from '../../common/cursor';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { InjectEnv } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { toMessage } from '../chat/chat.mapper';
import { ChatService } from '../chat/chat.service';
import { RealtimeService } from '../chat/realtime.service';
import { JobsService } from '../jobs/jobs.module';
import { NotificationsService } from '../notifications/notifications.service';
import { EscrowService } from '../payments/escrow.service';
import { toOffer } from '../offers/offers.mapper';
import {
  orderInclude,
  type OrderRow,
  paymentDueAt,
  toOrder,
  toOrderListItem,
} from './orders.mapper';

type Tx = Prisma.TransactionClient;

/** The changes that are plain status moves; pay/dispute/refund move money (PaymentsService). */
type StatusAction = Extract<OrderAction, 'cancel' | 'ship' | 'deliver' | 'confirm-delivery'>;

const VERB: Record<StatusAction, string> = {
  cancel: 'cancel',
  ship: 'mark as shipped',
  deliver: 'mark as delivered',
  'confirm-delivery': 'confirm delivery of',
};

/**
 * Orders come from accepted offers (§4). Every status change goes through
 * the shared ORDER_ACTIONS table under a row lock and is audited (§9).
 * Stock is reserved at creation and given back if the order is cancelled.
 */
@Injectable()
export class OrdersService implements OnModuleInit {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly chat: ChatService,
    private readonly realtime: RealtimeService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly escrow: EscrowService,
    @InjectEnv() private readonly env: Env,
  ) {}

  onModuleInit() {
    this.jobs.work('order', async (job: Job<{ orderId: string }>) => {
      if (job.name === 'payment-timeout') await this.cancelUnpaid(job.data.orderId);
    });
  }

  // ─── Create ─────────────────────────────────────────────────────────────

  /** Idempotent per offer: a retry (or double submit) returns the same order. */
  async create(
    user: RequestUser,
    input: CreateOrderInput,
  ): Promise<{ order: OrderDto; created: boolean }> {
    await this.chat.assertCanChat(user);
    const offer = await this.db.offer.findFirst({
      where: { id: input.offerId, OR: [{ fromUserId: user.id }, { toUserId: user.id }] },
      include: { conversation: true, listing: { select: { type: true } } },
    });
    if (!offer) throw new NotFoundException('Offer not found');

    // On a "request" listing the poster is the one buying.
    const { conversation: c } = offer;
    const [buyerId, sellerId] =
      offer.listing.type === 'request' ? [c.sellerId, c.buyerId] : [c.buyerId, c.sellerId];
    if (user.id !== buyerId) throw new ForbiddenException('Only the buyer can place this order');

    const existing = await this.findByOffer(offer.id);
    if (existing)
      return { order: toOrder(existing, user.id, this.env.DISPUTE_WINDOW_DAYS), created: false };
    if (offer.status !== 'accepted') {
      throw new ConflictException('Only an accepted offer can become an order');
    }

    let order: OrderRow;
    let note;
    try {
      ({ order, note } = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM listings WHERE id = ${offer.listingId}::uuid FOR UPDATE`;
        const listing = await tx.listing.findUniqueOrThrow({ where: { id: offer.listingId } });
        if (listing.status !== 'active') {
          throw new ConflictException('This listing is no longer available');
        }
        if (listing.stock !== null) {
          if (listing.stock < offer.quantity) {
            throw new ConflictException(
              listing.stock ? `Only ${listing.stock} left` : 'This listing just sold out',
            );
          }
          await this.adjustStock(tx, listing.id, -offer.quantity);
        }

        const [{ n }] = await tx.$queryRaw<
          [{ n: bigint }]
        >`SELECT nextval('order_number_seq') AS n`;
        const totals = orderTotals(
          offer.unitPrice.toFixed(2),
          offer.quantity,
          this.env.PLATFORM_FEE_PERCENT,
        );
        const created = await tx.order.create({
          data: {
            orderNumber: `ORD-${new Date().getUTCFullYear()}-${String(n).padStart(6, '0')}`,
            listingId: listing.id,
            offerId: offer.id,
            buyerId,
            sellerId,
            quantity: offer.quantity,
            unitPrice: offer.unitPrice,
            subtotal: totals.subtotal,
            platformFee: totals.platformFee,
            total: totals.total,
            currency: offer.currency,
            deliveryMethod: input.deliveryMethod,
            deliveryAddress: input.deliveryAddress ?? Prisma.DbNull,
            notes: input.notes ?? null,
          },
          include: orderInclude,
        });
        const message = await tx.message.create({
          data: {
            conversationId: c.id,
            senderId: user.id,
            type: 'system',
            offerId: offer.id,
            body: `Order ${created.orderNumber} placed`,
          },
        });
        await this.audit.log(
          {
            actorId: user.id,
            action: 'order.create',
            entityType: 'order',
            entityId: created.id,
            metadata: { offerId: offer.id, total: totals.total, currency: offer.currency },
          },
          tx,
        );
        return { order: created, note: message };
      }));
    } catch (err) {
      // Lost a race with a concurrent submit for the same offer.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findByOffer(offer.id);
        if (winner)
          return { order: toOrder(winner, user.id, this.env.DISPUTE_WINDOW_DAYS), created: false };
      }
      throw err;
    }

    this.realtime.toConversation(c.id, 'message:new', toMessage(note));
    this.realtime.toConversation(
      c.id,
      'offer:update',
      toOffer({ ...offer, order: { id: order.id } }),
    );
    await this.jobs
      .queue('order')
      .add(
        'payment-timeout',
        { orderId: order.id },
        {
          jobId: `unpaid-${order.id}`,
          delay: Math.max(paymentDueAt(order.createdAt).getTime() - Date.now(), 0),
        },
      )
      .catch((err: unknown) =>
        this.logger.error({ err, orderId: order.id }, 'could not schedule payment timeout'),
      );
    await this.notifyParty(
      order,
      sellerId,
      'order.created',
      `New order ${order.orderNumber} for “${order.listing.title}”`,
    );
    return { order: toOrder(order, user.id, this.env.DISPUTE_WINDOW_DAYS), created: true };
  }

  // ─── Status changes ─────────────────────────────────────────────────────

  async ship(user: RequestUser, id: string, input: ShipOrderInput) {
    return this.transition(user, id, 'ship', { trackingNumber: input.trackingNumber ?? null });
  }

  async deliver(user: RequestUser, id: string) {
    return this.transition(user, id, 'deliver', { deliveredAt: new Date() });
  }

  async confirmDelivery(user: RequestUser, id: string) {
    return this.transition(user, id, 'confirm-delivery', {});
  }

  async cancel(user: RequestUser, id: string, input: CancelOrderInput) {
    return this.transition(user, id, 'cancel', {}, input.reason);
  }

  /** order:payment-timeout job. Idempotent; a paid or already-cancelled order is left alone. */
  async cancelUnpaid(orderId: string): Promise<'cancelled' | 'skipped'> {
    const order = await this.db.$transaction(async (tx) => {
      const current = await this.lockOrder(tx, orderId);
      if (!current || current.status !== 'awaiting_payment') return null;
      if (paymentDueAt(current.createdAt) > new Date()) return null;
      return this.applyCancel(tx, current, null, 'Not paid in time');
    });
    if (!order) return 'skipped';
    const title = `Order ${order.orderNumber} was cancelled — it wasn’t paid in time`;
    await Promise.all([
      this.notifyParty(order, order.buyerId, 'order.cancelled', title),
      this.notifyParty(order, order.sellerId, 'order.cancelled', title),
    ]);
    return 'cancelled';
  }

  private async transition(
    user: RequestUser,
    id: string,
    action: StatusAction,
    data: Prisma.OrderUpdateInput,
    reason?: string,
  ): Promise<OrderDto> {
    const rule = ORDER_ACTIONS[action];
    const order = await this.db.$transaction(async (tx) => {
      const current = await this.lockOrder(tx, id, user.id);
      if (!current) throw new NotFoundException('Order not found');
      const side = current.buyerId === user.id ? 'buyer' : 'seller';
      if (!(rule.by as readonly string[]).includes(side)) {
        throw new ForbiddenException(
          `Only the ${rule.by.join(' or ')} can ${VERB[action]} this order`,
        );
      }
      if (!(rule.from as readonly string[]).includes(current.status)) {
        throw new ConflictException(
          `Can’t ${VERB[action]} an order that is ${current.status.replace('_', ' ')}`,
        );
      }
      if (action === 'cancel') return this.applyCancel(tx, current, user.id, reason);

      const now = new Date();
      const updated = await tx.order.update({
        where: { id },
        data: {
          ...data,
          status: rule.to,
          ...(rule.to === 'completed' && {
            completedAt: now,
            deliveredAt: current.deliveredAt ?? now,
          }),
        },
        include: orderInclude,
      });
      if (rule.to === 'completed') {
        await tx.profile.updateMany({
          where: { userId: { in: [current.buyerId, current.sellerId] } },
          data: { completedDeals: { increment: 1 } },
        });
      }
      await this.audit.log(
        {
          actorId: user.id,
          action: `order.${action.replace('-', '_')}`,
          entityType: 'order',
          entityId: id,
          metadata: { from: current.status, to: rule.to },
        },
        tx,
      );
      return updated;
    });

    // §7: confirmation releases escrow now; "delivered" starts the auto-release clock.
    if (action === 'confirm-delivery') await this.escrow.queueRelease(order.id);
    if (action === 'deliver' && order.deliveredAt) {
      await this.escrow.scheduleAutoRelease(order.id, order.deliveredAt);
    }

    const other = order.buyerId === user.id ? order.sellerId : order.buyerId;
    const what = `${order.orderNumber} (“${order.listing.title}”)`;
    const copy: Record<StatusAction, [NotificationType, string]> = {
      cancel: ['order.cancelled', `Order ${what} was cancelled`],
      ship: ['order.shipped', `Order ${what} is on its way`],
      deliver: ['order.delivered', `Order ${what} was marked delivered — please confirm`],
      'confirm-delivery': ['order.completed', `Order ${what} is complete`],
    };
    const [type, title] = copy[action];
    await this.notifyParty(
      order,
      other,
      type,
      title,
      reason ?? (action === 'ship' ? order.trackingNumber : null),
    );
    return toOrder(order, user.id, this.env.DISPUTE_WINDOW_DAYS);
  }

  private async applyCancel(tx: Tx, order: Order, actorId: string | null, reason?: string) {
    const updated = await tx.order.update({
      where: { id: order.id },
      data: { status: 'cancelled', cancelledAt: new Date() },
      include: orderInclude,
    });
    const listing = await tx.listing.findUniqueOrThrow({
      where: { id: order.listingId },
      select: { stock: true },
    });
    if (listing.stock !== null) await this.adjustStock(tx, order.listingId, order.quantity);
    await this.audit.log(
      {
        actorId,
        action: actorId ? 'order.cancel' : 'order.auto_cancel',
        entityType: 'order',
        entityId: order.id,
        metadata: { from: order.status, to: 'cancelled', ...(reason && { reason }) },
      },
      tx,
    );
    return updated;
  }

  /**
   * Moves stock and keeps status in step: sold at zero, live again when a
   * cancellation puts units back on a listing that had sold out.
   */
  private async adjustStock(tx: Tx, listingId: string, delta: number) {
    const l = await tx.listing.update({
      where: { id: listingId },
      data: { stock: { increment: delta } },
      select: { stock: true, status: true, sellerId: true },
    });
    const next =
      l.stock === 0 && l.status === 'active'
        ? 'sold'
        : l.stock! > 0 && l.status === 'sold' && delta > 0
          ? 'active'
          : null;
    if (!next) return;
    await tx.listing.update({ where: { id: listingId }, data: { status: next } });
    const live = await tx.listing.count({ where: { sellerId: l.sellerId, status: 'active' } });
    await tx.profile.updateMany({ where: { userId: l.sellerId }, data: { listingsCount: live } });
  }

  // ─── Read ───────────────────────────────────────────────────────────────

  async list(userId: string, q: OrderQuery): Promise<CursorPage<OrderListItemDto>> {
    const side =
      q.role === 'buying'
        ? { buyerId: userId }
        : q.role === 'selling'
          ? { sellerId: userId }
          : { OR: [{ buyerId: userId }, { sellerId: userId }] };
    const rows = await this.db.order.findMany({
      where: {
        AND: [
          side,
          q.status ? { status: q.status } : {},
          olderThan('createdAt', decodeCursor(q.cursor)),
        ],
      },
      include: orderInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const { page, nextCursor } = pageOf(rows, q.limit, (r) => r.createdAt);
    return {
      items: page.map((r) => toOrderListItem(r, userId, this.env.DISPUTE_WINDOW_DAYS)),
      nextCursor,
    };
  }

  async get(userId: string, id: string): Promise<OrderDto> {
    const order = await this.db.order.findFirst({
      where: { id, OR: [{ buyerId: userId }, { sellerId: userId }] },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('Order not found');
    return toOrder(order, userId, this.env.DISPUTE_WINDOW_DAYS);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private findByOffer(offerId: string) {
    return this.db.order.findUnique({ where: { offerId }, include: orderInclude });
  }

  /** Row-locks the order; with `partyId`, only if that user is on it (else null). */
  private async lockOrder(tx: Tx, id: string, partyId?: string): Promise<Order | null> {
    const rows = partyId
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM orders WHERE id = ${id}::uuid
            AND (buyer_id = ${partyId}::uuid OR seller_id = ${partyId}::uuid) FOR UPDATE`
      : await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM orders WHERE id = ${id}::uuid FOR UPDATE`;
    if (!rows.length) return null;
    return tx.order.findUniqueOrThrow({ where: { id } });
  }

  private notifyParty(
    order: OrderRow,
    userId: string,
    type: NotificationType,
    title: string,
    body: string | null = null,
  ) {
    return this.notifications.notify(userId, {
      type,
      title,
      body,
      link: `/orders/${order.id}`,
      payload: { orderId: order.id },
    });
  }
}
