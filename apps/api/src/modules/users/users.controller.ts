import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  type CursorQuery,
  cursorQuerySchema,
  setAvatarSchema,
  type UpdateProfileInput,
  updateProfileSchema,
} from '@markethub/shared';
import type { Request } from 'express';
import { z } from 'zod';
import {
  CurrentUser,
  type RequestUser,
  Viewer,
} from '../../common/decorators/current-user.decorator';
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
  profile(
    @Param('username', usernameParam) username: string,
    @Viewer() viewer: RequestUser | null,
  ) {
    return this.users.publicProfile(username, viewer?.id ?? null);
  }

  @Post('users/:id/follow')
  @HttpCode(200)
  follow(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.users.follow(user.id, id, true);
  }

  @Delete('users/:id/follow')
  @HttpCode(200)
  unfollow(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.users.follow(user.id, id, false);
  }

  @Public()
  @Get('users/:id/reviews')
  reviews(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(cursorQuerySchema)) q: CursorQuery,
  ) {
    return this.users.reviewsFor(id, q);
  }
}
