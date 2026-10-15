import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AdminUserDto, AdminUserQuery, CursorPage } from '@markethub/shared';
import type { Prisma } from '@prisma/client';
import { decodeCursor, olderThan, pageOf } from '../../common/cursor';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.module';
import { AuditService } from '../audit/audit.service';
import { RealtimeService } from '../chat/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { toParty } from '../offers/offers.mapper';

/**
 * §9: every admin action is audited, in the same transaction as the change.
 * Bans cut a user off everywhere at once: sessions revoked, sockets dropped,
 * and the guards already refuse banned accounts on every request.
 */
@Injectable()
export class ModerationService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  /** §4 POST /admin/listings/:id/remove */
  async removeListing(admin: RequestUser, id: string, reason: string) {
    const listing = await this.db.listing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.status === 'removed') throw new ConflictException('Already removed');
    await this.db.$transaction(async (tx) => {
      await tx.listing.update({ where: { id }, data: { status: 'removed', isFeatured: false } });
      const live = await tx.listing.count({
        where: { sellerId: listing.sellerId, status: 'active' },
      });
      await tx.profile.updateMany({
        where: { userId: listing.sellerId },
        data: { listingsCount: live },
      });
      await this.audit.log(
        {
          actorId: admin.id,
          action: 'listing.remove',
          entityType: 'listing',
          entityId: id,
          metadata: { reason, from: listing.status },
        },
        tx,
      );
    });
    await this.notifications.notify(listing.sellerId, {
      type: 'moderation.listing_removed',
      title: `“${listing.title}” was removed`,
      body: reason,
      link: '/seller',
      payload: { listingId: id },
    });
    return { ok: true };
  }

  async hideReview(admin: RequestUser, id: string, reason: string) {
    const review = await this.db.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Review not found');
    if (!review.isVisible) throw new ConflictException('Already hidden');
    await this.db.$transaction(async (tx) => {
      // The rating trigger recounts the seller's average without it.
      await tx.review.update({ where: { id }, data: { isVisible: false } });
      await this.audit.log(
        {
          actorId: admin.id,
          action: 'review.hide',
          entityType: 'review',
          entityId: id,
          metadata: { reason, rateeId: review.rateeId },
        },
        tx,
      );
    });
    return { ok: true };
  }

  async warn(admin: RequestUser, userId: string, message: string) {
    await this.target(admin, userId);
    await this.audit.log({
      actorId: admin.id,
      action: 'user.warn',
      entityType: 'user',
      entityId: userId,
      metadata: { message },
    });
    await this.notifications.notify(userId, {
      type: 'moderation.warning',
      title: 'A warning from the MarketHub team',
      body: message,
      link: null,
      payload: {},
    });
    return { ok: true };
  }

  /** §4 POST /admin/users/:id/ban */
  async ban(admin: RequestUser, userId: string, reason: string) {
    const user = await this.target(admin, userId);
    if (user.isBanned) throw new ConflictException('Already banned');
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { isBanned: true } });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.log(
        {
          actorId: admin.id,
          action: 'user.ban',
          entityType: 'user',
          entityId: userId,
          metadata: { reason },
        },
        tx,
      );
    });
    this.realtime.disconnectUser(userId);
    return { ok: true };
  }

  async unban(admin: RequestUser, userId: string, reason: string) {
    const user = await this.target(admin, userId);
    if (!user.isBanned) throw new ConflictException('Not banned');
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { isBanned: false } });
      await this.audit.log(
        {
          actorId: admin.id,
          action: 'user.unban',
          entityType: 'user',
          entityId: userId,
          metadata: { reason },
        },
        tx,
      );
    });
    return { ok: true };
  }

  /** Admins don't moderate themselves or each other from the panel. */
  private async target(admin: RequestUser, userId: string) {
    if (userId === admin.id) throw new BadRequestException('You can’t moderate yourself');
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'admin') throw new ForbiddenException('Admins can’t be moderated here');
    return user;
  }

  async users(q: AdminUserQuery): Promise<CursorPage<AdminUserDto>> {
    const term = q.q?.trim();
    const where: Prisma.UserWhereInput = {
      ...(q.banned !== undefined && { isBanned: q.banned }),
      ...(term && {
        OR: [
          { email: { contains: term, mode: 'insensitive' } },
          { profile: { username: { contains: term, mode: 'insensitive' } } },
          { profile: { displayName: { contains: term, mode: 'insensitive' } } },
          ...(/^[0-9a-f-]{36}$/i.test(term) ? [{ id: term }] : []),
        ],
      }),
      ...olderThan('createdAt', decodeCursor(q.cursor)),
    };
    const rows = await this.db.user.findMany({
      where,
      include: { profile: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const { page, nextCursor } = pageOf(rows, q.limit, (r) => r.createdAt);
    const ids = page.map((u) => u.id);
    const [warnings, reports] = await Promise.all([
      this.db.auditLog.groupBy({
        by: ['entityId'],
        where: {
          entityType: 'user',
          entityId: { in: ids },
          action: { in: ['user.warn', 'user.ban'] },
        },
        _count: { _all: true },
      }),
      this.db.report.groupBy({
        by: ['entityId'],
        where: { entityType: 'user', entityId: { in: ids }, status: 'open' },
        _count: { _all: true },
      }),
    ]);
    const w = new Map(warnings.map((x) => [x.entityId, x._count._all]));
    const r = new Map(reports.map((x) => [x.entityId, x._count._all]));
    return {
      items: page.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        isBanned: u.isBanned,
        isEmailVerified: u.isEmailVerified,
        isPhoneVerified: u.isPhoneVerified,
        createdAt: u.createdAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        profile: u.profile && {
          ...toParty(u),
          businessVerified: u.profile.businessVerified,
          listingsCount: u.profile.listingsCount,
        },
        warnings: w.get(u.id) ?? 0,
        openReports: r.get(u.id) ?? 0,
      })),
      nextCursor,
    };
  }
}
