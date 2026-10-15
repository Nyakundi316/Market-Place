import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ListingExpiry } from './listing-expiry';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { SeoController } from './seo.controller';

@Module({
  controllers: [ListingsController, SeoController],
  imports: [NotificationsModule],
  providers: [ListingsService, ListingExpiry],
  exports: [ListingsService],
})
export class ListingsModule {}
