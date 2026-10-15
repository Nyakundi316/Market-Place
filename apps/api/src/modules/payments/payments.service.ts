import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Currency, Env, PaymentSessionDto } from '@markethub/shared';
import type { Order, Prisma, Transaction } from '@prisma/client';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { InjectEnv } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paymentDueAt } from '../orders/orders.mapper';
import { EscrowService } from './escrow.service';
import { Gateways } from './providers/gateways';
import {
  type GatewayEvent,
  type GatewayName,
  WebhookSignatureError,
} from './providers/payment-provider';

type Tx = Prisma.TransactionClient;
type ChargeEvent = Extract<GatewayEvent, { amount: string }>;
type Session = Pick<PaymentSessionDto, 'clientSecret' | 'redirectUrl' | 'status'>;

/** Gateway calls inside a transaction need more than Prisma's 5s default. */
const GATEWAY_TX = { timeout: 25_000, maxWait: 10_000 } as const;

/**
 * §7 charge + webhooks. Starting a payment never marks an order paid: only a
 * verified webhook does, and each event is applied exactly once.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly gateways: Gateways,
    private readonly escrow: EscrowService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @InjectEnv() private readonly env: Env,
  ) {}

  // ─── POST /orders/:id/pay ───────────────────────────────────────────────

  async pay(user: RequestUser, orderId: string): Promise<PaymentSessionDto> {
    // The order row lock makes concurrent clicks share one gateway charge.
    return this.db.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM orders WHERE id = ${orderId}::uuid
          AND (buyer_id = ${user.id}::uuid OR seller_id = ${user.id}::uuid) FOR UPDATE`;
      if (!locked) throw new NotFoundException('Order not found');
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { buyer: { select: { email: true } } },
      });
      if (order.buyerId !== user.id) throw new ForbiddenException('Only the buyer pays');

      const charges = await tx.transaction.findMany({
        where: { orderId, type: 'charge' },
        orderBy: { createdAt: 'asc' },
      });
      // §7 step 3: already paid → say so, don't charge again.
      if (charges.some((c) => c.status === 'succeeded'))
        return this.session(order, null, 'succeeded');
      if (order.status !== 'awaiting_payment') {
        throw new ConflictException(`This order is ${order.status.replace('_', ' ')}`);
      }
      if (paymentDueAt(order.createdAt) <= new Date()) {
        throw new ConflictException('The payment window for this order has closed');
      }

      const provider = this.gateways.forCurrency(order.currency);
      const open = charges.find((c) => c.status === 'pending' && c.gateway === provider.gateway);
      if (open?.gatewayRef) {
        return this.session(
          order,
          open,
          (open.gatewayPayload as { session?: Session })?.session?.status,
        );
      }

      // A failed attempt stays on record (§7: never delete); the next one gets its own key.
      const idempotencyKey = `order:${order.id}:charge${charges.length ? `:${charges.length + 1}` : ''}`;
      const txn =
        open ??
        (await tx.transaction.create({
          data: {
            orderId,
            userId: user.id,
            type: 'charge',
            status: 'pending',
            amount: order.total,
            currency: order.currency,
            gateway: provider.gateway,
            idempotencyKey,
          },
        }));

      const result = await provider.charge({
        orderId,
        amount: order.total.toFixed(2),
        currency: order.currency as Currency,
        email: order.buyer.email,
        description: `MarketHub ${order.orderNumber}`,
        idempotencyKey: txn.idempotencyKey,
        returnUrl: `${this.env.WEB_URL}/orders/${orderId}?paid=1`,
      });
      const session: Session = {
        status: result.status,
        clientSecret: result.clientSecret ?? null,
        redirectUrl: result.redirectUrl ?? null,
      };
      const saved = await tx.transaction.update({
        where: { id: txn.id },
        data: { gatewayRef: result.ref, gatewayPayload: { session } },
      });
      await this.audit.log(
        {
          actorId: user.id,
          action: 'payment.initiate',
          entityType: 'order',
          entityId: orderId,
          metadata: { gateway: provider.gateway, txnId: txn.id, amount: order.total.toFixed(2) },
        },
        tx,
      );
      return this.session(order, saved, result.status);
    }, GATEWAY_TX);
  }

  private session(
    order: Order,
    txn: Transaction | null,
    status: PaymentSessionDto['status'] = 'requires_action',
  ): PaymentSessionDto {
    const s = (txn?.gatewayPayload as { session?: Session } | null)?.session;
    const gateway = (txn?.gateway ?? this.gateways.nameFor(order.currency)) as GatewayName;
    return {
      orderId: order.id,
      gateway,
      status,
      amount: order.total.toFixed(2),
      currency: order.currency as Currency,
      clientSecret: status === 'succeeded' ? null : (s?.clientSecret ?? null),
      publishableKey: gateway === 'stripe' ? this.gateways.stripePublishableKey : null,
      redirectUrl: status === 'succeeded' ? null : (s?.redirectUrl ?? null),
    };
  }

  /** Sandbox checkout: the "card form" posts here instead of to a gateway. */
  async sandboxPay(user: RequestUser, ref: string, card: string) {
    const txn = await this.db.transaction.findFirst({
      where: { gatewayRef: ref, gateway: 'sandbox', type: 'charge', userId: user.id },
    });
    if (!txn) throw new NotFoundException('Payment not found');
    const signed = await this.gateways.sandbox.pay(ref, card);
    if (!signed) throw new NotFoundException('Payment not found');
    await this.ingest('sandbox', signed.raw, signed.signature);
    const after = await this.db.transaction.findUniqueOrThrow({ where: { id: txn.id } });
    return { status: after.status };
  }

  // ─── Webhooks ───────────────────────────────────────────────────────────

  /**
   * Verify → record the event id → apply, all in one transaction: a replay
   * hits the unique (gateway, eventId) and does nothing, and a failure rolls
   * the record back so the gateway's retry gets another go.
   */
  async ingest(gateway: GatewayName, raw: Buffer | undefined, signature: string | undefined) {
    if (!raw?.length) throw new BadRequestException('Empty body');
    let provider;
    try {
      provider = this.gateways.byName(gateway);
    } catch {
      throw new NotFoundException(`${gateway} is not configured`);
    }
    let event: GatewayEvent;
    try {
      event = provider.verifyWebhook(raw, signature ?? '');
    } catch (err) {
      if (err instanceof WebhookSignatureError || err instanceof SyntaxError) {
        this.logger.warn({ gateway, reason: (err as Error).message }, 'rejected webhook');
        throw new BadRequestException('Invalid signature');
      }
      throw err;
    }

    const after: (() => Promise<void>)[] = [];
    const applied = await this.db.$transaction(async (tx) => {
      const inserted = await tx.$executeRaw`
        INSERT INTO webhook_events (id, gateway, event_id, type, payload, created_at)
        VALUES (gen_random_uuid(), ${gateway}, ${event.id},
                ${event.kind === 'ignored' ? event.type : event.kind},
                ${JSON.stringify(event)}::jsonb, now())
        ON CONFLICT (gateway, event_id) DO NOTHING`;
      if (!inserted) return false;
      await this.apply(tx, gateway, event, after);
      await tx.webhookEvent.update({
        where: { gateway_eventId: { gateway, eventId: event.id } },
        data: { processedAt: new Date() },
      });
      return true;
    });

    // Side effects only once the money state is committed.
    for (const fn of after)
      await fn().catch((err: unknown) => this.logger.error({ err }, 'post-webhook step failed'));
    return { received: true, duplicate: !applied };
  }

  private async apply(
    tx: Tx,
    gateway: GatewayName,
    e: GatewayEvent,
    after: (() => Promise<void>)[],
  ) {
    switch (e.kind) {
      case 'charge.succeeded':
        return this.chargeSucceeded(tx, gateway, e, after);
      case 'charge.failed': {
        const txn = await this.chargeTxn(tx, gateway, e.ref);
        if (!txn || txn.status !== 'pending') return;
        await tx.transaction.update({ where: { id: txn.id }, data: { status: 'failed' } });
        after.push(() =>
          this.notifications.notify(txn.userId, {
            type: 'payment.failed',
            title: 'Your payment didn’t go through',
            body: 'Nothing was charged. You can try again or use another card.',
            link: `/orders/${txn.orderId}`,
            payload: { orderId: txn.orderId },
          }),
        );
        return;
      }
      case 'refund.succeeded':
      case 'refund.failed':
        await tx.transaction.updateMany({
          where: { gateway, gatewayRef: e.ref, type: 'refund', status: 'pending' },
          data: { status: e.kind === 'refund.succeeded' ? 'succeeded' : 'failed' },
        });
        return;
      case 'transfer.succeeded':
      case 'transfer.failed':
        return this.escrow.onTransferResult(
          tx,
          gateway,
          e.ref,
          e.kind === 'transfer.succeeded',
          after,
        );
      case 'payout_account.updated':
        return this.escrow.onPayoutAccountUpdate(
          tx,
          gateway,
          e.accountRef,
          e.ready,
          e.restricted,
          after,
        );
      case 'ignored':
        return;
    }
  }

  private chargeTxn(tx: Tx, gateway: GatewayName, ref: string) {
    return tx.transaction.findFirst({ where: { gateway, gatewayRef: ref, type: 'charge' } });
  }

  private async chargeSucceeded(
    tx: Tx,
    gateway: GatewayName,
    e: ChargeEvent,
    after: (() => Promise<void>)[],
  ) {
    const txn = await this.chargeTxn(tx, gateway, e.ref);
    if (!txn) {
      this.logger.warn({ gateway, ref: e.ref }, 'charge.succeeded for an unknown payment');
      return;
    }
    if (txn.status === 'succeeded') return;

    // Never trust a success that doesn't match what we asked for.
    if (txn.amount.toFixed(2) !== e.amount || txn.currency !== e.currency) {
      await this.audit.log(
        {
          actorId: null,
          action: 'payment.mismatch',
          entityType: 'transaction',
          entityId: txn.id,
          metadata: {
            expected: `${txn.amount.toFixed(2)} ${txn.currency}`,
            got: `${e.amount} ${e.currency}`,
          },
        },
        tx,
      );
      this.logger.error({ txnId: txn.id }, 'charge amount mismatch — order left unpaid');
      return;
    }

    await tx.transaction.update({ where: { id: txn.id }, data: { status: 'succeeded' } });
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${txn.orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: txn.orderId } });

    if (order.status !== 'awaiting_payment') {
      // Paid after it was cancelled (or a second success): give the money straight back.
      await this.audit.log(
        {
          actorId: null,
          action: 'payment.late',
          entityType: 'order',
          entityId: order.id,
          metadata: { status: order.status, txnId: txn.id },
        },
        tx,
      );
      after.push(() => this.escrow.refundCharge(txn.id, 'Paid after the order closed'));
      return;
    }

    const now = new Date();
    // §7 step 6: paid and into escrow in one step; the hold is what release spends.
    await tx.order.update({ where: { id: order.id }, data: { status: 'in_escrow', paidAt: now } });
    await tx.escrowHold.create({
      data: {
        orderId: order.id,
        amount: order.total,
        currency: order.currency,
        status: 'held',
        heldAt: now,
      },
    });
    for (const action of ['order.paid', 'escrow.hold'] as const) {
      await this.audit.log(
        {
          actorId: null,
          action,
          entityType: 'order',
          entityId: order.id,
          metadata: {
            txnId: txn.id,
            amount: order.total.toFixed(2),
            currency: order.currency,
            gateway,
          },
        },
        tx,
      );
    }
    after.push(async () => {
      await this.notifications.notify(order.sellerId, {
        type: 'order.paid',
        title: `Order ${order.orderNumber} is paid — time to send it`,
        body: 'The money is held in escrow and released to you once the buyer confirms delivery.',
        link: `/orders/${order.id}`,
        payload: { orderId: order.id },
      });
      await this.notifications.notify(order.buyerId, {
        type: 'order.paid',
        title: `Payment received for ${order.orderNumber}`,
        body: 'It’s held safely until you confirm delivery.',
        link: `/orders/${order.id}`,
        payload: { orderId: order.id },
      });
    });
  }
}
