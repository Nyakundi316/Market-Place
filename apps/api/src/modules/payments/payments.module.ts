import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DisputesQuery } from './disputes.query';
import { EscrowService } from './escrow.service';
import { PaymentsController, WebhooksController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Gateways } from './providers/gateways';

@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [Gateways, PaymentsService, EscrowService, DisputesQuery],
  exports: [EscrowService, Gateways],
})
export class PaymentsModule {}
