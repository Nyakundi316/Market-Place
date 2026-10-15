import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UploadsModule } from '../uploads/uploads.module';
import { SmsSender } from './sms.sender';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

@Module({
  imports: [NotificationsModule, UploadsModule],
  controllers: [VerificationController],
  providers: [VerificationService, SmsSender],
})
export class VerificationModule {}
