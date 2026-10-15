import { Controller, Get, Query } from '@nestjs/common';
import { type AnalyticsQuery, analyticsQuerySchema } from '@markethub/shared';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AnalyticsService } from './analytics.service';

@Controller('me/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  get(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(analyticsQuerySchema)) q: AnalyticsQuery,
  ) {
    return this.analytics.forSeller(user.id, q.days);
  }
}
