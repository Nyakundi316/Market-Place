import { Module } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { SeoController } from './seo.controller';

@Module({
  controllers: [ListingsController, SeoController],
  providers: [ListingsService],
  exports: [ListingsService],
})
export class ListingsModule {}
