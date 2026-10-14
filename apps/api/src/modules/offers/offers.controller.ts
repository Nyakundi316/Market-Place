import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  type CounterOfferInput,
  counterOfferSchema,
  type CreateOfferInput,
  createOfferSchema,
  type DeclineOfferInput,
  declineOfferSchema,
  type OfferQuery,
  offerQuerySchema,
} from '@markethub/shared';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OffersService } from './offers.service';

const id = new ParseUUIDPipe();

@Controller('offers')
export class OffersController {
  constructor(private readonly offers: OffersService) {}

  @Get('mine')
  mine(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(offerQuerySchema)) q: OfferQuery,
  ) {
    return this.offers.mine(user.id, q);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createOfferSchema)) body: CreateOfferInput,
  ) {
    return this.offers.create(user, body);
  }

  @Post(':id/counter')
  counter(
    @CurrentUser() user: RequestUser,
    @Param('id', id) offerId: string,
    @Body(new ZodValidationPipe(counterOfferSchema)) body: CounterOfferInput,
  ) {
    return this.offers.counter(user, offerId, body);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: RequestUser, @Param('id', id) offerId: string) {
    return this.offers.accept(user, offerId);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(
    @CurrentUser() user: RequestUser,
    @Param('id', id) offerId: string,
    @Body(new ZodValidationPipe(declineOfferSchema)) body: DeclineOfferInput,
  ) {
    return this.offers.decline(user, offerId, body);
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  withdraw(@CurrentUser() user: RequestUser, @Param('id', id) offerId: string) {
    return this.offers.withdraw(user, offerId);
  }
}
