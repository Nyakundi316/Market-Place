import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { type NotificationQuery, notificationQuerySchema } from '@markethub/shared';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(notificationQuerySchema)) q: NotificationQuery,
  ) {
    return this.notifications.list(user.id, q);
  }

  // Declared before :id/read so "read-all" never matches as an id.
  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: RequestUser) {
    return this.notifications.readAll(user.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentUser() user: RequestUser, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notifications.read(user.id, id);
  }
}
