import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { OfflineNotifier } from './offline-notifier';
import { RealtimeService } from './realtime.service';

@Module({
  imports: [AuthModule],
  controllers: [ChatController],
  providers: [ChatService, RealtimeService, ChatGateway, OfflineNotifier],
  exports: [ChatService, RealtimeService],
})
export class ChatModule {}
