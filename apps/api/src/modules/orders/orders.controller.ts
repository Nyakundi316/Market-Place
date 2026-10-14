import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  type CancelOrderInput,
  cancelOrderSchema,
  type CreateOrderInput,
  createOrderSchema,
  type OrderQuery,
  orderQuerySchema,
  type ShipOrderInput,
  shipOrderSchema,
} from '@markethub/shared';
import type { Response } from 'express';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OrdersService } from './orders.service';

const id = new ParseUUIDPipe();

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** 201 for a new order, 200 when this offer already has one (safe to retry). */
  @Post()
  async create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { order, created } = await this.orders.create(user, body);
    res.status(created ? 201 : 200);
    return order;
  }

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(orderQuerySchema)) q: OrderQuery,
  ) {
    return this.orders.list(user.id, q);
  }

  @Get(':id')
  get(@CurrentUser() user: RequestUser, @Param('id', id) orderId: string) {
    return this.orders.get(user.id, orderId);
  }

  @Post(':id/ship')
  @HttpCode(200)
  ship(
    @CurrentUser() user: RequestUser,
    @Param('id', id) orderId: string,
    @Body(new ZodValidationPipe(shipOrderSchema)) body: ShipOrderInput,
  ) {
    return this.orders.ship(user, orderId, body);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  deliver(@CurrentUser() user: RequestUser, @Param('id', id) orderId: string) {
    return this.orders.deliver(user, orderId);
  }

  @Post(':id/confirm-delivery')
  @HttpCode(200)
  confirmDelivery(@CurrentUser() user: RequestUser, @Param('id', id) orderId: string) {
    return this.orders.confirmDelivery(user, orderId);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentUser() user: RequestUser,
    @Param('id', id) orderId: string,
    @Body(new ZodValidationPipe(cancelOrderSchema)) body: CancelOrderInput,
  ) {
    return this.orders.cancel(user, orderId, body);
  }
}
