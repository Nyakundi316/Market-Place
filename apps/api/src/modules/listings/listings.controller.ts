import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  boostListingSchema,
  type CreateListingInput,
  createListingSchema,
  type CursorQuery,
  cursorQuerySchema,
  type ListingQuery,
  listingQuerySchema,
  type MyListingsQuery,
  myListingsQuerySchema,
  type UpdateListingInput,
  updateListingSchema,
} from '@markethub/shared';
import type { Request } from 'express';
import {
  CurrentUser,
  type RequestUser,
  Viewer,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Verified } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ListingsService } from './listings.service';

const id = new ParseUUIDPipe();

@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Public()
  @Get()
  search(
    @Query(new ZodValidationPipe(listingQuerySchema)) q: ListingQuery,
    @Viewer() viewer: RequestUser | null,
  ) {
    return this.listings.search(q, viewer);
  }

  @Get('mine')
  mine(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(myListingsQuerySchema)) q: MyListingsQuery,
  ) {
    return this.listings.mine(user.id, q);
  }

  @Get('favorites')
  favorites(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(cursorQuerySchema)) q: CursorQuery,
  ) {
    return this.listings.favorites(user.id, q);
  }

  @Public()
  @Get(':slug')
  bySlug(@Param('slug') slug: string, @Viewer() viewer: RequestUser | null, @Req() req: Request) {
    return this.listings.bySlug(slug.slice(0, 120), viewer, req.ip);
  }

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createListingSchema)) body: CreateListingInput,
  ) {
    return this.listings.create(user, body);
  }

  @Patch(':id')
  update(
    @Param('id', id) listingId: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateListingSchema)) body: UpdateListingInput,
  ) {
    return this.listings.update(listingId, user, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', id) listingId: string, @CurrentUser() user: RequestUser) {
    return this.listings.remove(listingId, user.id);
  }

  @Verified()
  @Post(':id/publish')
  @HttpCode(200)
  publish(@Param('id', id) listingId: string, @CurrentUser() user: RequestUser) {
    return this.listings.publish(listingId, user);
  }

  @Verified()
  @Post(':id/boost')
  @HttpCode(200)
  boost(
    @Param('id', id) listingId: string,
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(boostListingSchema)) body: { days: number },
    @Req() req: Request,
  ) {
    return this.listings.boost(listingId, user, body.days, req.ip);
  }

  @Post(':id/favorite')
  @HttpCode(200)
  favorite(@Param('id', id) listingId: string, @CurrentUser() user: RequestUser) {
    return this.listings.favorite(listingId, user.id, true);
  }

  @Delete(':id/favorite')
  @HttpCode(200)
  unfavorite(@Param('id', id) listingId: string, @CurrentUser() user: RequestUser) {
    return this.listings.favorite(listingId, user.id, false);
  }
}
