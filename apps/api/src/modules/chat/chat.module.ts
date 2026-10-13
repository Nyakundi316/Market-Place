import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { RealtimeService } from './realtime.service';

@Module({
  controllers: [ChatController],
  providers: [ChatService, RealtimeService],
  exports: [ChatService, RealtimeService],
})
export class ChatModule {}
