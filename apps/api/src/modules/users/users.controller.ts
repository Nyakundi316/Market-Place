import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { setAvatarSchema, type UpdateProfileInput, updateProfileSchema } from '@markethub/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

// Lookup only: bounded and normalised, no format rules (unknown names just 404).
const usernameParam = new ZodValidationPipe(z.string().trim().toLowerCase().min(1).max(30));

@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.users.me(user.id);
  }

  @Patch('me')
  updateMe(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
    @Req() req: Request,
  ) {
    return this.users.updateMe(user.id, body, req.ip);
  }

  /** Body is the publicUrl from POST /images/sign (purpose=avatar) after the PUT succeeded. */
  @Post('me/avatar')
  @HttpCode(200)
  setAvatar(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(setAvatarSchema)) body: { url: string },
  ) {
    return this.users.setAvatar(user.id, body.url);
  }

  @Public()
  @Get('users/:username')
  profile(@Param('username', usernameParam) username: string) {
    return this.users.publicProfile(username);
  }
}
