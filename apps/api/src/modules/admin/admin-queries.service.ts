import { Injectable } from '@nestjs/common';
import type {
  AdminOverviewDto,
  AuditEntryDto,
  AuditQuery,
  Currency,
  CursorPage,
} from '@markethub/shared';
import { decodeCursor, olderThan, pageOf } from '../../common/cursor';
import { PrismaService } from '../../prisma/prisma.module';

const WEEK_MS = 7 * 86_400_000;

/** Read-only views for the admin panel: the queue counts and the §9 audit trail. */
@Injectable()
export class AdminQueriesService {
  constructor(private readonly db: PrismaService) {}

  async overview(): Promise<AdminOverviewDto> {
    const since = new Date(Date.now() - WEEK_MS);
    const [
      openReports,
      openDisputes,
      pendingVerifications,
      bannedUsers,
      newUsers,
      newListings,
      completed,
      gmv,
    ] = await Promise.all([
      this.db.report.count({ where: { status: 'open' } }),
      this.db.order.count({ where: { status: 'disputed' } }),
      this.db.verificationRequest.count({ where: { status: 'pending' } }),
      this.db.user.count({ where: { isBanned: true } }),
      this.db.user.count({ where: { createdAt: { gte: since } } }),
      this.db.listing.count({ where: { publishedAt: { gte: since } } }),
      this.db.order.count({ where: { status: 'completed', completedAt: { gte: since } } }),
      this.db.order.groupBy({
        by: ['currency'],
        where: { status: 'completed', completedAt: { gte: since } },
        _sum: { total: true },
      }),
    ]);
    return {
      openReports,
      openDisputes,
      pendingVerifications,
      bannedUsers,
      newUsers,
      newListings,
      completedOrders: completed,
      gmv: gmv.map((g) => ({
        currency: g.currency as Currency,
        amount: (g._sum.total ?? 0).toFixed(2),
      })),
    };
  }

  /** §9 audit viewer: filter by what, who or which thing; newest first. */
  async audit(q: AuditQuery): Promise<CursorPage<AuditEntryDto>> {
    const rows = await this.db.auditLog.findMany({
      where: {
        ...(q.entityType && { entityType: q.entityType }),
        ...(q.entityId && { entityId: q.entityId }),
        ...(q.actorId && { actorId: q.actorId }),
        ...(q.action && { action: { startsWith: q.action } }),
        ...olderThan('createdAt', decodeCursor(q.cursor)),
      },
      include: {
        actor: { select: { id: true, email: true, profile: { select: { displayName: true } } } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const { page, nextCursor } = pageOf(rows, q.limit, (r) => r.createdAt);
    return {
      items: page.map((a) => ({
        id: a.id,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        metadata: a.metadata,
        createdAt: a.createdAt.toISOString(),
        actor: a.actor && { id: a.actor.id, label: a.actor.profile?.displayName ?? a.actor.email },
      })),
      nextCursor,
    };
  }
}
