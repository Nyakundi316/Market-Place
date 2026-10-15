import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DisputesQuery } from './disputes.query';
import { EscrowService } from './escrow.service';
import { PaymentsController, WebhooksController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Gateways } from './providers/gateways';
import { ReconciliationService } from './reconciliation.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsController, WebhooksController],
  providers: [Gateways, PaymentsService, EscrowService, DisputesQuery, ReconciliationService],
  exports: [EscrowService, Gateways],
})
export class PaymentsModule {}
