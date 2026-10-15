import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  type Currency,
  type DisputeOrderInput,
  type Env,
  fromCents,
  type NotificationType,
  type PayoutAccountDto,
  type PaystackPayoutInput,
  percentOf,
  type RefundOrderInput,
  type ResolveDisputeInput,
  toCents,
} from '@markethub/shared';
import type { Order, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { InjectEnv } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { JobsService } from '../jobs/jobs.module';
import { NotificationsService } from '../notifications/notifications.service';
import { Gateways } from './providers/gateways';
import type { GatewayName, PayoutSetup } from './providers/payment-provider';

type Tx = Prisma.TransactionClient;
type After = (() => Promise<void>)[];

const GATEWAY_TX = { timeout: 25_000, maxWait: 10_000 } as const;
const HOUR = 3_600_000;

/**
 * §7 release, refunds and disputes. Money rows are only ever inserted or
 * moved forward; every state change is audited. Gateway calls run inside the
 * transaction that records them, so a failed call leaves nothing half-done
 * and the job (or request) can simply be retried.
 */
@Injectable()
export class EscrowService implements OnModuleInit {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly gateways: Gateways,
    private readonly jobs: JobsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @InjectEnv() private readonly env: Env,
  ) {}

  onModuleInit() {
    this.jobs.work('payout', async (job: Job<{ orderId: string }>) => {
      if (job.name === 'release') await this.release(job.data.orderId);
      if (job.name === 'auto-release') await this.autoRelease(job.data.orderId);
    });
  }

  // ─── Scheduling (called by OrdersService) ───────────────────────────────

  /** §8 payout:release, right after the buyer confirms. */
  async queueRelease(orderId: string) {
    await this.jobs
      .queue('payout')
      .add('release', { orderId }, { jobId: `release-${orderId}` })
      .catch((err: unknown) => this.logger.error({ err, orderId }, 'could not queue release'));
  }

  /** §8 payout:auto-release, ESCROW_AUTO_RELEASE_HOURS after "delivered". */
  async scheduleAutoRelease(orderId: string, deliveredAt: Date) {
    const due = deliveredAt.getTime() + this.env.ESCROW_AUTO_RELEASE_HOURS * HOUR;
    await this.db.escrowHold.updateMany({
      where: { orderId, status: 'held' },
      data: { releaseScheduledAt: new Date(due) },
    });
    await this.jobs
      .queue('payout')
      .add(
        'auto-release',
        { orderId },
        { jobId: `autorelease-${orderId}`, delay: Math.max(due - Date.now(), 0) },
      )
      .catch((err: unknown) =>
        this.logger.error({ err, orderId }, 'could not schedule auto-release'),
      );
  }

  /** The buyer went quiet after delivery: complete the order, then release. */
  async autoRelease(orderId: string): Promise<'released' | 'skipped' | 'needs_account'> {
    const done = await this.db.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      if (!order || order.status !== 'delivered' || !order.deliveredAt) return false;
      if (order.deliveredAt.getTime() + this.env.ESCROW_AUTO_RELEASE_HOURS * HOUR > Date.now())
        return false;
      await this.complete(tx, order, null);
      return true;
    });
    if (!done) return 'skipped';
    return this.release(orderId);
  }

  // ─── Release ────────────────────────────────────────────────────────────

  async release(orderId: string): Promise<'released' | 'skipped' | 'needs_account'> {
    const after: After = [];
    const outcome = await this.db.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      const hold = await tx.escrowHold.findUnique({ where: { orderId } });
      if (!order || !hold || order.status !== 'completed' || hold.status !== 'held')
        return 'skipped';
      return this.releaseIn(tx, order, after);
    }, GATEWAY_TX);
    for (const fn of after) await fn();
    return outcome;
  }

  /**
   * Pays the seller what's left after any refunds. With no refund the fee is
   * the one fixed at order time; after a partial refund it's charged on what
   * the seller actually keeps.
   */
  private async releaseIn(tx: Tx, order: Order, after: After) {
    const refunds = await tx.transaction.findMany({
      where: { orderId: order.id, type: 'refund', status: { in: ['pending', 'succeeded'] } },
      select: { amount: true },
    });
    const refunded = refunds.reduce((sum, r) => sum + toCents(r.amount.toFixed(2)), 0n);
    const kept = fromCents(toCents(order.total.toFixed(2)) - refunded);
    const fee = refunded
      ? percentOf(kept, this.env.PLATFORM_FEE_PERCENT)
      : order.platformFee.toFixed(2);
    const net = fromCents(toCents(kept) - toCents(fee));
    return this.payOut(tx, order, net, fee, refunded ? 'partially_refunded' : 'released', after);
  }

  /**
   * Transfers `net` to the seller and settles the hold. Leaves the hold in
   * place (and tells the seller) when there's nowhere to send the money yet.
   */
  private async payOut(
    tx: Tx,
    order: Order,
    net: string,
    fee: string,
    settle: 'released' | 'partially_refunded',
    after: After,
  ): Promise<'released' | 'needs_account'> {
    const charge = await tx.transaction.findFirstOrThrow({
      where: { orderId: order.id, type: 'charge', status: 'succeeded' },
    });
    const account = await tx.payoutAccount.findFirst({
      where: { userId: order.sellerId, gateway: charge.gateway, status: 'ready' },
    });
    if (!account) {
      await tx.escrowHold.update({
        where: { orderId: order.id },
        data: { notes: 'Waiting for the seller to add payout details' },
      });
      after.push(() =>
        this.notify(
          order.sellerId,
          'payout.setup_needed',
          `Add payout details to receive ${order.orderNumber}`,
          order,
          'Your money is safe in escrow; it’s sent as soon as your payout account is ready.',
          '/settings#payouts',
        ),
      );
      return 'needs_account';
    }

    const provider = this.gateways.byName(charge.gateway);
    const now = new Date();
    if (Number(net) > 0) {
      const attempts = await tx.transaction.count({ where: { orderId: order.id, type: 'payout' } });
      const payout = await tx.transaction.create({
        data: {
          orderId: order.id,
          userId: order.sellerId,
          type: 'payout',
          status: 'pending',
          amount: net,
          currency: order.currency,
          gateway: charge.gateway,
          // A transfer that failed stays on record; a retry gets the next key.
          idempotencyKey: `order:${order.id}:payout${attempts ? `:${attempts + 1}` : ''}`,
        },
      });
      const result = await provider.transfer({
        orderId: order.id,
        amount: net,
        currency: order.currency as Currency,
        destination: account.accountRef,
        sourceRef: charge.gatewayRef!,
        idempotencyKey: payout.idempotencyKey,
      });
      await tx.transaction.update({
        where: { id: payout.id },
        data: {
          gatewayRef: result.ref,
          status:
            result.status === 'succeeded'
              ? 'succeeded'
              : result.status === 'failed'
                ? 'failed'
                : 'pending',
        },
      });
      if (result.status === 'failed')
        throw new Error(`Transfer for ${order.id} failed at the gateway`);
    }
    const feeRecorded = await tx.transaction.count({ where: { orderId: order.id, type: 'fee' } });
    if (Number(fee) > 0 && !feeRecorded) {
      await tx.transaction.create({
        data: {
          orderId: order.id,
          userId: order.sellerId,
          type: 'fee',
          status: 'succeeded',
          amount: fee,
          currency: order.currency,
          gateway: charge.gateway,
          idempotencyKey: `order:${order.id}:fee`,
        },
      });
    }
    await tx.escrowHold.update({
      where: { orderId: order.id },
      data: { status: settle, releasedAt: now, notes: null },
    });
    await this.audit.log(
      {
        actorId: null,
        action: 'escrow.release',
        entityType: 'order',
        entityId: order.id,
        metadata: { net, fee, currency: order.currency, gateway: charge.gateway },
      },
      tx,
    );
    after.push(() =>
      this.notify(
        order.sellerId,
        'payout.sent',
        `${order.currency} ${net} is on its way to you`,
        order,
        `Payout for ${order.orderNumber}, after the MarketHub fee.`,
      ),
    );
    return 'released';
  }

  // ─── Refunds ────────────────────────────────────────────────────────────

  /** Inserts the refund row and asks the gateway; amount defaults to the full charge. */
  private async refundIn(
    tx: Tx,
    order: Order,
    amount: string,
    reason: string,
    actorId: string | null,
  ) {
    const charge = await tx.transaction.findFirstOrThrow({
      where: { orderId: order.id, type: 'charge', status: 'succeeded' },
    });
    const previous = await tx.transaction.count({ where: { orderId: order.id, type: 'refund' } });
    const refund = await tx.transaction.create({
      data: {
        orderId: order.id,
        userId: order.buyerId,
        type: 'refund',
        status: 'pending',
        amount,
        currency: order.currency,
        gateway: charge.gateway,
        idempotencyKey: `order:${order.id}:refund${previous ? `:${previous + 1}` : ''}`,
      },
    });
    const result = await this.gateways
      .byName(charge.gateway)
      .refund(charge.gatewayRef!, amount, order.currency as Currency, refund.idempotencyKey);
    if (result.status === 'failed') throw new ConflictException('The gateway refused the refund');
    await tx.transaction.update({
      where: { id: refund.id },
      data: {
        gatewayRef: result.ref,
        status: result.status === 'succeeded' ? 'succeeded' : 'pending',
      },
    });
    await this.audit.log(
      {
        actorId,
        action: 'payment.refund',
        entityType: 'order',
        entityId: order.id,
        metadata: { amount, currency: order.currency, reason, refundTxnId: refund.id },
      },
      tx,
    );
  }

  /** A charge that landed on an order that had already closed (late webhook). */
  async refundCharge(chargeTxnId: string, reason: string) {
    await this.db.$transaction(async (tx) => {
      const charge = await tx.transaction.findUniqueOrThrow({ where: { id: chargeTxnId } });
      const order = await this.lockOrder(tx, charge.orderId);
      const already = await tx.transaction.findFirst({
        where: {
          orderId: charge.orderId,
          type: 'refund',
          status: { in: ['pending', 'succeeded'] },
        },
      });
      if (!order || already) return;
      await this.refundIn(tx, order, charge.amount.toFixed(2), reason, null);
    }, GATEWAY_TX);
  }

  /** Seller can't fulfil a paid order: everything back to the buyer. */
  async sellerRefund(user: RequestUser, orderId: string, input: RefundOrderInput) {
    const after: After = [];
    await this.db.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, orderId, user.id);
      if (!order) throw new NotFoundException('Order not found');
      if (order.sellerId !== user.id)
        throw new ForbiddenException('Only the seller can refund this order');
      if (order.status !== 'in_escrow')
        throw new ConflictException('Only a paid, unshipped order can be refunded');
      await this.refundIn(
        tx,
        order,
        order.total.toFixed(2),
        input.reason ?? 'Seller cancelled',
        user.id,
      );
      await this.closeRefunded(tx, order, 'refunded', user.id);
      after.push(() =>
        this.notify(
          order.buyerId,
          'order.refunded',
          `Order ${order.orderNumber} was cancelled and refunded`,
          order,
          input.reason ?? null,
        ),
      );
    }, GATEWAY_TX);
    for (const fn of after) await fn();
  }

  private async closeRefunded(tx: Tx, order: Order, escrow: 'refunded', actorId: string | null) {
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'refunded', cancelledAt: new Date() },
    });
    await tx.escrowHold.update({
      where: { orderId: order.id },
      data: { status: escrow, refundedAt: new Date() },
    });
    // Stock goes back on sale, as with an unpaid cancel.
    const l = await tx.listing.findUniqueOrThrow({
      where: { id: order.listingId },
      select: { stock: true, status: true },
    });
    if (l.stock !== null) {
      await tx.listing.update({
        where: { id: order.listingId },
        data: {
          stock: { increment: order.quantity },
          ...(l.status === 'sold' && { status: 'active' }),
        },
      });
    }
    await this.audit.log(
      {
        actorId,
        action: 'order.refund',
        entityType: 'order',
        entityId: order.id,
        metadata: { from: order.status, to: 'refunded' },
      },
      tx,
    );
  }

  // ─── Disputes ───────────────────────────────────────────────────────────

  async dispute(user: RequestUser, orderId: string, input: DisputeOrderInput) {
    const after: After = [];
    await this.db.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, orderId, user.id);
      if (!order) throw new NotFoundException('Order not found');
      if (order.buyerId !== user.id)
        throw new ForbiddenException('Only the buyer can open a dispute');
      if (order.status !== 'shipped' && order.status !== 'delivered') {
        throw new ConflictException('Disputes open once the order is on its way');
      }
      const windowEnds =
        order.deliveredAt && order.deliveredAt.getTime() + this.env.DISPUTE_WINDOW_DAYS * 24 * HOUR;
      if (windowEnds && windowEnds < Date.now()) {
        throw new ConflictException(
          `Disputes close ${this.env.DISPUTE_WINDOW_DAYS} days after delivery`,
        );
      }
      await tx.order.update({ where: { id: orderId }, data: { status: 'disputed' } });
      await tx.escrowHold.update({
        where: { orderId },
        data: { status: 'disputed', disputeReason: input.reason, releaseScheduledAt: null },
      });
      await this.audit.log(
        {
          actorId: user.id,
          action: 'order.dispute',
          entityType: 'order',
          entityId: orderId,
          metadata: { from: order.status, reason: input.reason },
        },
        tx,
      );
      const admins = await tx.user.findMany({
        where: { role: 'admin', isActive: true },
        select: { id: true },
      });
      after.push(async () => {
        await this.notify(
          order.sellerId,
          'order.disputed',
          `The buyer opened a dispute on ${order.orderNumber}`,
          order,
          input.reason,
        );
        for (const a of admins) {
          await this.notify(
            a.id,
            'order.disputed',
            `Dispute on ${order.orderNumber}`,
            order,
            input.reason,
            `/admin/disputes`,
          );
        }
      });
    });
    for (const fn of after) await fn();
  }

  async resolveDispute(admin: RequestUser, orderId: string, input: ResolveDisputeInput) {
    const after: After = [];
    await this.db.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      if (!order) throw new NotFoundException('Order not found');
      if (order.status !== 'disputed') throw new ConflictException('This order isn’t in dispute');
      const total = order.total.toFixed(2);
      let summary: string;

      if (input.outcome === 'refund') {
        await this.refundIn(tx, order, total, input.note, admin.id);
        await this.closeRefunded(tx, order, 'refunded', admin.id);
        summary = 'refunded in full to the buyer';
      } else {
        const refund = input.outcome === 'split' ? input.refundAmount! : '0.00';
        const kept = toCents(total) - toCents(refund);
        if (input.outcome === 'split' && (toCents(refund) <= 0n || kept <= 0n)) {
          throw new BadRequestException({
            message: 'A split must leave something for each side',
            fields: { refundAmount: [`Between 0 and ${total}`] },
          });
        }
        if (input.outcome === 'split') await this.refundIn(tx, order, refund, input.note, admin.id);
        await this.complete(tx, order, admin.id);
        // Back to held so the normal release (now, or once payouts are set up) settles it.
        await tx.escrowHold.update({ where: { orderId }, data: { status: 'held' } });
        await this.releaseIn(tx, { ...order, status: 'completed' }, after);
        summary =
          input.outcome === 'split'
            ? `${order.currency} ${refund} refunded, the rest released`
            : 'released to the seller';
      }

      await this.audit.log(
        {
          actorId: admin.id,
          action: 'dispute.resolve',
          entityType: 'order',
          entityId: orderId,
          metadata: {
            outcome: input.outcome,
            refundAmount: input.refundAmount ?? null,
            note: input.note,
          },
        },
        tx,
      );
      after.push(async () => {
        for (const id of [order.buyerId, order.sellerId]) {
          await this.notify(
            id,
            'dispute.resolved',
            `Dispute on ${order.orderNumber} resolved: ${summary}`,
            order,
            input.note,
          );
        }
      });
    }, GATEWAY_TX);
    for (const fn of after) await fn();
  }

  // ─── Gateway events ─────────────────────────────────────────────────────

  async onTransferResult(tx: Tx, gateway: GatewayName, ref: string, ok: boolean, after: After) {
    const payout = await tx.transaction.findFirst({
      where: { gateway, gatewayRef: ref, type: 'payout' },
    });
    if (!payout) return;
    if (ok) {
      if (payout.status === 'pending')
        await tx.transaction.update({ where: { id: payout.id }, data: { status: 'succeeded' } });
      return;
    }
    await tx.transaction.update({
      where: { id: payout.id },
      data: { status: payout.status === 'succeeded' ? 'reversed' : 'failed' },
    });
    // The money is back with the platform: the hold is held again until someone looks.
    await tx.escrowHold.update({
      where: { orderId: payout.orderId },
      data: { status: 'held', releasedAt: null, notes: `Transfer ${ref} failed or was reversed` },
    });
    await this.audit.log(
      {
        actorId: null,
        action: 'payout.failed',
        entityType: 'order',
        entityId: payout.orderId,
        metadata: { ref, gateway },
      },
      tx,
    );
    after.push(async () =>
      this.logger.error({ orderId: payout.orderId, ref }, 'payout failed — escrow back on hold'),
    );
  }

  async onPayoutAccountUpdate(
    tx: Tx,
    gateway: GatewayName,
    accountRef: string,
    ready: boolean,
    restricted: boolean,
    after: After,
  ) {
    const account = await tx.payoutAccount.findUnique({
      where: { gateway_accountRef: { gateway, accountRef } },
    });
    if (!account) return;
    const status = ready ? 'ready' : restricted ? 'restricted' : 'pending';
    await tx.payoutAccount.update({ where: { id: account.id }, data: { status } });
    if (status === 'ready' && account.status !== 'ready') {
      after.push(() => this.releaseWaiting(account.userId, gateway));
    }
  }

  /** Completed orders whose payout was waiting for this seller's account. */
  private async releaseWaiting(sellerId: string, gateway: string) {
    const waiting = await this.db.order.findMany({
      where: {
        sellerId,
        status: 'completed',
        escrow: { status: 'held' },
        transactions: { some: { type: 'charge', status: 'succeeded', gateway } },
      },
      select: { id: true },
    });
    for (const o of waiting) await this.queueRelease(o.id);
  }

  // ─── Payout accounts ────────────────────────────────────────────────────

  async payoutAccounts(userId: string): Promise<PayoutAccountDto[]> {
    const rows = await this.db.payoutAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      gateway: 'paystack' as const, // sandbox accounts stand in for Paystack ones
      status: r.status,
      details: (r.details as PayoutAccountDto['details']) ?? null,
    }));
  }

  async setupPaystackPayouts(
    user: RequestUser,
    input: PaystackPayoutInput,
  ): Promise<PayoutAccountDto> {
    const paystack = this.gateways.paystack;
    const profile = await this.db.profile.findUnique({ where: { userId: user.id } });
    if (!profile) throw new ForbiddenException('Finish setting up your profile first');
    const setup = paystack
      ? await paystack.setupPayouts({ ...input, name: profile.displayName })
      : await this.gateways.sandbox.setupPayouts(input);
    return this.savePayoutAccount(user.id, paystack ? 'paystack' : 'sandbox', setup);
  }

  banks(currency: string) {
    return (this.gateways.paystack ?? this.gateways.sandbox).banks(currency);
  }

  private async savePayoutAccount(
    userId: string,
    gateway: GatewayName,
    setup: PayoutSetup,
  ): Promise<PayoutAccountDto> {
    const data = {
      accountRef: setup.accountRef,
      status: setup.status,
      details: setup.details ?? undefined,
    };
    await this.db.payoutAccount.upsert({
      where: { userId_gateway: { userId, gateway } },
      create: { userId, gateway, ...data },
      update: data,
    });
    await this.audit.log({
      actorId: userId,
      action: 'payout_account.set',
      entityType: 'user',
      entityId: userId,
      metadata: { gateway, status: setup.status },
    });
    if (setup.status === 'ready') await this.releaseWaiting(userId, gateway);
    return { gateway: 'paystack', status: setup.status, details: setup.details };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async complete(tx: Tx, order: Order, actorId: string | null) {
    const now = new Date();
    await tx.order.update({
      where: { id: order.id },
      data: { status: 'completed', completedAt: now, deliveredAt: order.deliveredAt ?? now },
    });
    await tx.profile.updateMany({
      where: { userId: { in: [order.buyerId, order.sellerId] } },
      data: { completedDeals: { increment: 1 } },
    });
    await this.audit.log(
      {
        actorId,
        action: actorId ? 'order.complete' : 'order.auto_complete',
        entityType: 'order',
        entityId: order.id,
        metadata: { from: order.status, to: 'completed' },
      },
      tx,
    );
  }

  private async lockOrder(tx: Tx, id: string, partyId?: string): Promise<Order | null> {
    const rows = partyId
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM orders WHERE id = ${id}::uuid
            AND (buyer_id = ${partyId}::uuid OR seller_id = ${partyId}::uuid) FOR UPDATE`
      : await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM orders WHERE id = ${id}::uuid FOR UPDATE`;
    return rows.length ? tx.order.findUniqueOrThrow({ where: { id } }) : null;
  }

  private notify(
    userId: string,
    type: NotificationType,
    title: string,
    order: Order,
    body: string | null,
    link = `/orders/${order.id}`,
  ) {
    return this.notifications.notify(userId, {
      type,
      title,
      body,
      link,
      payload: { orderId: order.id },
    });
  }
}
