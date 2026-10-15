import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  type AdminUserQuery,
  adminUserQuerySchema,
  type AuditQuery,
  auditQuerySchema,
  banUserSchema,
  type CreateReportInput,
  createReportSchema,
  removeListingSchema,
  type ReportQuery,
  reportQuerySchema,
  type ResolveReportInput,
  resolveReportSchema,
  warnUserSchema,
} from '@markethub/shared';
import type { z } from 'zod';
import { CurrentUser, type RequestUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminQueriesService } from './admin-queries.service';
import { ModerationService } from './moderation.service';
import { ReportsService } from './reports.service';

const id = new ParseUUIDPipe();
type Reason = z.infer<typeof banUserSchema>;

/** POST /reports is for everyone (§9 "user create"). */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(createReportSchema)) body: CreateReportInput,
  ) {
    return this.reports.create(user, body);
  }
}

@Controller('admin')
@Roles('admin')
export class AdminController {
  constructor(
    private readonly reports: ReportsService,
    private readonly moderation: ModerationService,
    private readonly queries: AdminQueriesService,
  ) {}

  @Get('overview')
  overview() {
    return this.queries.overview();
  }

  @Get('audit')
  audit(@Query(new ZodValidationPipe(auditQuerySchema)) q: AuditQuery) {
    return this.queries.audit(q);
  }

  // ─── Reports ────────────────────────────────────────────────────────────

  @Get('reports')
  listReports(@Query(new ZodValidationPipe(reportQuerySchema)) q: ReportQuery) {
    return this.reports.list(q);
  }

  @Post('reports/:id/resolve')
  @HttpCode(200)
  resolve(
    @CurrentUser() admin: RequestUser,
    @Param('id', id) reportId: string,
    @Body(new ZodValidationPipe(resolveReportSchema)) body: ResolveReportInput,
  ) {
    return this.reports.resolve(admin, reportId, body);
  }

  // ─── Moderation ─────────────────────────────────────────────────────────

  @Post('listings/:id/remove')
  @HttpCode(200)
  removeListing(
    @CurrentUser() admin: RequestUser,
    @Param('id', id) listingId: string,
    @Body(new ZodValidationPipe(removeListingSchema)) body: Reason,
  ) {
    return this.moderation.removeListing(admin, listingId, body.reason);
  }

  @Post('reviews/:id/hide')
  @HttpCode(200)
  hideReview(
    @CurrentUser() admin: RequestUser,
    @Param('id', id) reviewId: string,
    @Body(new ZodValidationPipe(removeListingSchema)) body: Reason,
  ) {
    return this.moderation.hideReview(admin, reviewId, body.reason);
  }

  @Get('users')
  users(@Query(new ZodValidationPipe(adminUserQuerySchema)) q: AdminUserQuery) {
    return this.moderation.users(q);
  }

  @Post('users/:id/warn')
  @HttpCode(200)
  warn(
    @CurrentUser() admin: RequestUser,
    @Param('id', id) userId: string,
    @Body(new ZodValidationPipe(warnUserSchema)) body: z.infer<typeof warnUserSchema>,
  ) {
    return this.moderation.warn(admin, userId, body.message);
  }

  @Post('users/:id/ban')
  @HttpCode(200)
  ban(
    @CurrentUser() admin: RequestUser,
    @Param('id', id) userId: string,
    @Body(new ZodValidationPipe(banUserSchema)) body: Reason,
  ) {
    return this.moderation.ban(admin, userId, body.reason);
  }

  @Post('users/:id/unban')
  @HttpCode(200)
  unban(
    @CurrentUser() admin: RequestUser,
    @Param('id', id) userId: string,
    @Body(new ZodValidationPipe(banUserSchema)) body: Reason,
  ) {
    return this.moderation.unban(admin, userId, body.reason);
  }
}
