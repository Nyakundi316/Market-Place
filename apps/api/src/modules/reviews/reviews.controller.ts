import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  type CreateReviewInput,
  createReviewSchema,
  type MyReviewsQuery,
  myReviewsQuerySchema,
} from '@markethub/shared';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createReviewSchema)) body: CreateReviewInput,
  ) {
    return this.reviews.create(user, body);
  }

  @Get('mine')
  mine(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(myReviewsQuerySchema)) q: MyReviewsQuery,
  ) {
    return this.reviews.mine(user.id, q);
  }
}
