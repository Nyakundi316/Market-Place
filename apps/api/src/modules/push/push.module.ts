import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushSender } from './push.sender';
import { PushService } from './push.service';

@Module({
  controllers: [PushController],
  providers: [PushService, PushSender],
  exports: [PushService],
})
export class PushModule {}
