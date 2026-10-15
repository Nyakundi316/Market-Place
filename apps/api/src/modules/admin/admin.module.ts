import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminController, ReportsController } from './admin.controller';
import { AdminQueriesService } from './admin-queries.service';
import { ModerationService } from './moderation.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [ChatModule, NotificationsModule],
  controllers: [ReportsController, AdminController],
  providers: [ReportsService, ModerationService, AdminQueriesService],
})
export class AdminModule {}
