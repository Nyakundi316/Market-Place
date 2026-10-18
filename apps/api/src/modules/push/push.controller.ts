import { Body, Controller, Delete, Get, Headers, HttpCode, Post } from '@nestjs/common';
import {
  pushEndpointSchema,
  type PushSubscriptionInput,
  pushSubscriptionSchema,
} from '@markethub/shared';
import type { z } from 'zod';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PushService } from './push.service';

@Controller()
export class PushController {
  constructor(private readonly push: PushService) {}

  /** The VAPID public key browsers subscribe with; null when push is off. */
  @Public()
  @Get('push/config')
  config() {
    return this.push.config();
  }

  @Post('me/push-subscriptions')
  @HttpCode(204)
  async subscribe(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(pushSubscriptionSchema)) body: PushSubscriptionInput,
    @Headers('user-agent') userAgent?: string,
  ) {
    await this.push.subscribe(user.id, body, userAgent);
  }

  // Idempotent: removing a device that isn't there (or isn't yours) is still a 204.
  @Delete('me/push-subscriptions')
  @HttpCode(204)
  async unsubscribe(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(pushEndpointSchema)) body: z.infer<typeof pushEndpointSchema>,
  ) {
    await this.push.unsubscribe(user.id, body.endpoint);
  }
}
