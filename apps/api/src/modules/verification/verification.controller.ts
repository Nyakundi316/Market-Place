import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  type CreateVerificationInput,
  createVerificationSchema,
  type ReviewVerificationInput,
  reviewVerificationSchema,
  sendPhoneCodeSchema,
  type VerificationQuery,
  verificationQuerySchema,
  verifyPhoneSchema,
} from '@markethub/shared';
import type { z } from 'zod';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { VerificationService } from './verification.service';

@Controller()
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get('me/verification')
  status(@CurrentUser() user: RequestUser) {
    return this.verification.status(user.id);
  }

  @Post('me/verification')
  @HttpCode(200)
  request(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createVerificationSchema)) body: CreateVerificationInput,
  ) {
    return this.verification.request(user, body);
  }

  // Per-user caps live in the service (3 sends / 15 min, 5 tries per code); no IP
  // bucket, which would lock out whole carrier NATs.
  @Post('me/phone/send-code')
  @HttpCode(200)
  sendCode(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(sendPhoneCodeSchema)) body: z.infer<typeof sendPhoneCodeSchema>,
  ) {
    return this.verification.sendPhoneCode(user, body.phone);
  }

  @Post('me/phone/verify')
  @HttpCode(200)
  verifyPhone(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(verifyPhoneSchema)) body: z.infer<typeof verifyPhoneSchema>,
  ) {
    return this.verification.verifyPhone(user, body.code);
  }

  @Get('admin/verifications')
  @Roles('admin')
  queue(@Query(new ZodValidationPipe(verificationQuerySchema)) q: VerificationQuery) {
    return this.verification.queue(q);
  }

  @Post('admin/verify/:userId')
  @HttpCode(200)
  @Roles('admin')
  decide(
    @CurrentUser() admin: RequestUser,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodValidationPipe(reviewVerificationSchema)) body: ReviewVerificationInput,
  ) {
    return this.verification.decide(admin, userId, body);
  }
}
