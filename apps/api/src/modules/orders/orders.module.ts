import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [ChatModule, NotificationsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
