import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { PushModule } from '../push/push.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [ChatModule, PushModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
