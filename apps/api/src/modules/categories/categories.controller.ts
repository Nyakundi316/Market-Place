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
  Req,
} from '@nestjs/common';
import {
  type CreateCategoryInput,
  createCategorySchema,
  type UpdateCategoryInput,
  updateCategorySchema,
} from '@markethub/shared';
import type { Request } from 'express';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CategoriesService } from './categories.service';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Public()
  @Get()
  tree() {
    return this.categories.tree();
  }

  @Public()
  @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.categories.bySlug(slug.toLowerCase().slice(0, 80));
  }

  @Roles('admin')
  @Post()
  create(
    @Body(new ZodValidationPipe(createCategorySchema)) body: CreateCategoryInput,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.categories.create(body, user.id, req.ip);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCategorySchema)) body: UpdateCategoryInput,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.categories.update(id, body, user.id, req.ip);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(204)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: RequestUser,
    @Req() req: Request,
  ) {
    return this.categories.remove(id, user.id, req.ip);
  }
}
