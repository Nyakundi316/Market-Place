import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import {
  type CursorQuery,
  cursorQuerySchema,
  type DisputeOrderInput,
  disputeOrderSchema,
  type Env,
  type PaystackPayoutInput,
  paystackPayoutSchema,
  type RefundOrderInput,
  refundOrderSchema,
  type ResolveDisputeInput,
  resolveDisputeSchema,
} from '@markethub/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RateLimit, SkipRateLimit } from '../../common/rate-limit/rate-limit.guard';
import { InjectEnv } from '../../config/env.validation';
import { DisputesQuery } from './disputes.query';
import { EscrowService } from './escrow.service';
import { PaymentsService } from './payments.service';

const id = new ParseUUIDPipe();
const sandboxPaySchema = z
  .object({ ref: z.string().min(8).max(100), card: z.string().max(30) })
  .strict();
const banksQuerySchema = z.object({ currency: z.enum(['NGN', 'GHS', 'KES', 'ZAR']) });

/** Money-moving routes sit behind the §9 payment limit (5/min/user, fails closed). */
@Controller()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly escrow: EscrowService,
    private readonly disputes: DisputesQuery,
    @InjectEnv() private readonly env: Env,
  ) {}

  @Post('orders/:id/pay')
  @HttpCode(200)
  @RateLimit('payment')
  pay(@CurrentUser() user: RequestUser, @Param('id', id) orderId: string) {
    return this.payments.pay(user, orderId);
  }

  @Post('orders/:id/dispute')
  @HttpCode(200)
  @RateLimit('payment')
  async dispute(
    @CurrentUser() user: RequestUser,
    @Param('id', id) orderId: string,
    @Body(new ZodValidationPipe(disputeOrderSchema)) body: DisputeOrderInput,
  ) {
    await this.escrow.dispute(user, orderId, body);
    return { ok: true };
  }

  @Post('orders/:id/refund')
  @HttpCode(200)
  @RateLimit('payment')
  async refund(
    @CurrentUser() user: RequestUser,
    @Param('id', id) orderId: string,
    @Body(new ZodValidationPipe(refundOrderSchema)) body: RefundOrderInput,
  ) {
    await this.escrow.sellerRefund(user, orderId, body);
    return { ok: true };
  }

  /** The sandbox's stand-in for a card form. Never routed in production. */
  @Post('payments/sandbox/pay')
  @HttpCode(200)
  @RateLimit('payment')
  sandboxPay(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(sandboxPaySchema)) body: z.infer<typeof sandboxPaySchema>,
  ) {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
    return this.payments.sandboxPay(user, body.ref, body.card);
  }

  // ─── Payout accounts ────────────────────────────────────────────────────

  @Get('me/payout-accounts')
  payoutAccounts(@CurrentUser() user: RequestUser) {
    return this.escrow.payoutAccounts(user.id);
  }

  @Post('me/payout-accounts/stripe')
  @HttpCode(200)
  @RateLimit('payment')
  stripePayouts(@CurrentUser() user: RequestUser) {
    return this.escrow.setupStripePayouts(user);
  }

  @Post('me/payout-accounts/paystack')
  @HttpCode(200)
  @RateLimit('payment')
  paystackPayouts(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(paystackPayoutSchema)) body: PaystackPayoutInput,
  ) {
    return this.escrow.setupPaystackPayouts(user, body);
  }

  @Get('payments/banks')
  banks(@Query(new ZodValidationPipe(banksQuerySchema)) q: z.infer<typeof banksQuerySchema>) {
    return this.escrow.banks(q.currency);
  }

  // ─── Admin: §7 dispute resolution ───────────────────────────────────────

  @Get('admin/disputes')
  @Roles('admin')
  listDisputes(@Query(new ZodValidationPipe(cursorQuerySchema)) q: CursorQuery) {
    return this.disputes.list(q);
  }

  @Post('admin/disputes/:id/resolve')
  @HttpCode(200)
  @Roles('admin')
  async resolve(
    @CurrentUser() user: RequestUser,
    @Param('id', id) orderId: string,
    @Body(new ZodValidationPipe(resolveDisputeSchema)) body: ResolveDisputeInput,
  ) {
    await this.escrow.resolveDispute(user, orderId, body);
    return { ok: true };
  }
}

/** §7 webhooks: authenticated by signature over the raw body, not by JWT. */
@Public()
@SkipRateLimit()
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly payments: PaymentsService,
    @InjectEnv() private readonly env: Env,
  ) {}

  @Post('stripe')
  @HttpCode(200)
  stripe(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig?: string) {
    return this.payments.ingest('stripe', req.rawBody, sig);
  }

  @Post('paystack')
  @HttpCode(200)
  paystack(@Req() req: RawBodyRequest<Request>, @Headers('x-paystack-signature') sig?: string) {
    return this.payments.ingest('paystack', req.rawBody, sig);
  }

  @Post('sandbox')
  @HttpCode(200)
  sandbox(@Req() req: RawBodyRequest<Request>, @Headers('x-sandbox-signature') sig?: string) {
    if (this.env.NODE_ENV === 'production') throw new NotFoundException();
    return this.payments.ingest('sandbox', req.rawBody, sig);
  }
}
