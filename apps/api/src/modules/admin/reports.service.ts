import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateReportInput,
  CursorPage,
  ReportDto,
  ReportEntity,
  ReportQuery,
  ReportReason,
  ResolveReportInput,
} from '@markethub/shared';
import { Prisma, type Report } from '@prisma/client';
import { decodeCursor, olderThan, pageOf } from '../../common/cursor';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { toParty } from '../offers/offers.mapper';

type Target = ReportDto['target'];

/** §9 "Reports: user create, admin resolve". */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(user: RequestUser, input: CreateReportInput) {
    const owner = await this.ownerOf(input.entityType, input.entityId, user.id);
    if (owner === user.id) throw new BadRequestException('You can’t report your own content');
    try {
      const report = await this.db.report.create({
        data: {
          reporterId: user.id,
          entityType: input.entityType,
          entityId: input.entityId,
          reason: input.reason,
          details: input.details ?? null,
        },
      });
      await this.audit.log({
        actorId: user.id,
        action: 'report.create',
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: { reportId: report.id, reason: input.reason },
      });
      return { id: report.id, status: report.status };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('You’ve already reported this — we’re looking at it');
      }
      throw err;
    }
  }

  /**
   * Who owns the reported thing; also proves the reporter can see it, so ids
   * can't be probed (non-visible → 404).
   */
  private async ownerOf(type: ReportEntity, id: string, reporterId: string): Promise<string> {
    const notFound = () => new NotFoundException('Nothing to report there');
    switch (type) {
      case 'listing': {
        const l = await this.db.listing.findUnique({
          where: { id },
          select: { sellerId: true, status: true },
        });
        if (!l || l.status === 'removed' || l.status === 'draft') throw notFound();
        return l.sellerId;
      }
      case 'user': {
        const u = await this.db.user.findUnique({ where: { id }, select: { id: true } });
        if (!u) throw notFound();
        return u.id;
      }
      case 'message': {
        const m = await this.db.message.findFirst({
          where: { id, conversation: { OR: [{ buyerId: reporterId }, { sellerId: reporterId }] } },
          select: { senderId: true },
        });
        if (!m) throw notFound();
        return m.senderId;
      }
      case 'review': {
        const r = await this.db.review.findUnique({
          where: { id },
          select: { raterId: true, isVisible: true },
        });
        if (!r || !r.isVisible) throw notFound();
        return r.raterId;
      }
    }
  }

  async list(q: ReportQuery): Promise<CursorPage<ReportDto>> {
    const rows = await this.db.report.findMany({
      where: {
        status: q.status,
        ...(q.entityType && { entityType: q.entityType }),
        ...olderThan('createdAt', decodeCursor(q.cursor)),
      },
      include: { reporter: { select: { id: true, profile: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const { page, nextCursor } = pageOf(rows, q.limit, (r) => r.createdAt);
    const counts = await this.db.report.groupBy({
      by: ['entityType', 'entityId'],
      where: { status: 'open', entityId: { in: page.map((r) => r.entityId) } },
      _count: { _all: true },
    });
    const dupes = new Map(counts.map((c) => [`${c.entityType}:${c.entityId}`, c._count._all]));
    return {
      items: await Promise.all(
        page.map(async (r) => ({
          id: r.id,
          entityType: r.entityType as ReportEntity,
          entityId: r.entityId,
          reason: r.reason as ReportReason,
          details: r.details,
          status: r.status as ReportDto['status'],
          createdAt: r.createdAt.toISOString(),
          resolvedAt: r.resolvedAt?.toISOString() ?? null,
          reporter: toParty(r.reporter),
          target: await this.describe(r),
          duplicates: Math.max(0, (dupes.get(`${r.entityType}:${r.entityId}`) ?? 1) - 1),
        })),
      ),
      nextCursor,
    };
  }

  /** A label and a link an admin can act on, whatever the entity is. */
  private async describe(r: Report): Promise<Target> {
    switch (r.entityType) {
      case 'listing': {
        const l = await this.db.listing.findUnique({
          where: { id: r.entityId },
          select: { title: true, slug: true, sellerId: true, status: true },
        });
        return l
          ? {
              label: `${l.title}${l.status === 'removed' ? ' (removed)' : ''}`,
              link: `/l/${l.slug}`,
              ownerId: l.sellerId,
            }
          : { label: 'Deleted listing', link: null, ownerId: null };
      }
      case 'user': {
        const p = await this.db.profile.findUnique({
          where: { userId: r.entityId },
          select: { displayName: true, username: true },
        });
        return {
          label: p?.displayName ?? 'User without profile',
          link: p ? `/u/${p.username}` : null,
          ownerId: r.entityId,
        };
      }
      case 'message': {
        const m = await this.db.message.findUnique({
          where: { id: r.entityId },
          select: { body: true, senderId: true, type: true },
        });
        return m
          ? {
              label: `“${(m.body ?? `[${m.type}]`).slice(0, 140)}”`,
              link: null,
              ownerId: m.senderId,
            }
          : { label: 'Deleted message', link: null, ownerId: null };
      }
      default: {
        const v = await this.db.review.findUnique({
          where: { id: r.entityId },
          select: { comment: true, rating: true, raterId: true, isVisible: true },
        });
        return v
          ? {
              label: `${v.rating}★ ${v.comment ? `“${v.comment.slice(0, 120)}”` : ''}${v.isVisible ? '' : ' (hidden)'}`,
              link: null,
              ownerId: v.raterId,
            }
          : { label: 'Deleted review', link: null, ownerId: null };
      }
    }
  }

  /** Closes the report and every other open report about the same thing. */
  async resolve(admin: RequestUser, id: string, input: ResolveReportInput) {
    const report = await this.db.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== 'open') throw new ConflictException(`Already ${report.status}`);
    const status = input.action === 'resolve' ? 'resolved' : 'dismissed';
    const same = { entityType: report.entityType, entityId: report.entityId, status: 'open' };
    const reporters = await this.db.report.findMany({ where: same, select: { reporterId: true } });

    await this.db.$transaction(async (tx) => {
      await tx.report.updateMany({
        where: same,
        data: { status, resolvedBy: admin.id, resolvedAt: new Date() },
      });
      await this.audit.log(
        {
          actorId: admin.id,
          action: `report.${input.action}`,
          entityType: report.entityType,
          entityId: report.entityId,
          metadata: { reportId: id, closed: reporters.length, note: input.note ?? null },
        },
        tx,
      );
    });

    for (const reporterId of new Set(reporters.map((r) => r.reporterId))) {
      await this.notifications.notify(reporterId, {
        type: 'report.resolved',
        title: 'Thanks — we reviewed your report',
        body:
          status === 'resolved'
            ? 'We took action. Reports like yours keep MarketHub safe.'
            : 'We didn’t find a rule being broken this time, but we appreciate you flagging it.',
        link: null,
        payload: { reportId: id },
      });
    }
    return { ok: true, closed: reporters.length };
  }
}
