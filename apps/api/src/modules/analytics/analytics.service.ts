import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Currency, Env, SellerAnalyticsDto } from '@markethub/shared';
import { InjectEnv } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.module';
import { JobsService } from '../jobs/jobs.module';

const DAY_MS = 86_400_000;
const IN_PROGRESS = ['paid', 'in_escrow', 'shipped', 'delivered', 'disputed'] as const;

/**
 * Response rate: of the buyer conversations a seller received in the last
 * 90 days, the share they answered within 24 hours of the buyer's first
 * message. One statement for everyone (nightly) or one seller (on demand).
 */
const RESPONSE_SQL = `
  WITH firsts AS (
    SELECT c.id, c.seller_id, min(m.created_at) AS first_buyer
    FROM conversations c
    JOIN messages m ON m.conversation_id = c.id AND m.sender_id = c.buyer_id
    WHERE c.created_at > now() - interval '90 days' AND ($1::uuid IS NULL OR c.seller_id = $1::uuid)
    GROUP BY c.id, c.seller_id
  )
  SELECT f.seller_id AS "sellerId",
         count(*)::int AS total,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM messages r
           WHERE r.conversation_id = f.id AND r.sender_id = f.seller_id
             AND r.created_at > f.first_buyer AND r.created_at <= f.first_buyer + interval '24 hours'
         ))::int AS answered
  FROM firsts f
  GROUP BY f.seller_id`;

type ResponseRow = { sellerId: string; total: number; answered: number };
const percent = (r: ResponseRow) => Math.round((r.answered / r.total) * 10_000) / 100;

@Injectable()
export class AnalyticsService implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly jobs: JobsService,
    @InjectEnv() private readonly env: Env,
  ) {}

  async onModuleInit() {
    this.jobs.work(
      'stats',
      async (job) => {
        if (job.name === 'response-rates') await this.refreshResponseRates();
      },
      1,
    );
    if (this.env.NODE_ENV === 'test') return;
    await this.jobs
      .queue('stats')
      .upsertJobScheduler(
        'nightly-response-rates',
        { pattern: '30 2 * * *', tz: 'UTC' },
        { name: 'response-rates' },
      )
      .catch((err: unknown) => this.logger.error({ err }, 'could not schedule response rates'));
  }

  /** Writes Profile.responseRate for every seller with recent buyer chats. */
  async refreshResponseRates(): Promise<number> {
    const rows = await this.db.$queryRawUnsafe<ResponseRow[]>(RESPONSE_SQL, null);
    for (const r of rows) {
      await this.db.profile.updateMany({
        where: { userId: r.sellerId },
        data: { responseRate: percent(r) },
      });
    }
    return rows.length;
  }

  async responseRate(sellerId: string): Promise<number | null> {
    const [row] = await this.db.$queryRawUnsafe<ResponseRow[]>(RESPONSE_SQL, sellerId);
    return row?.total ? percent(row) : null;
  }

  async forSeller(userId: string, days: number): Promise<SellerAnalyticsDto> {
    const since = new Date(Date.now() - days * DAY_MS);
    const live = { sellerId: userId, status: { not: 'removed' as const } };
    const [active, totals, received, accepted, orders, payouts, profile, top, responseRate] =
      await Promise.all([
        this.db.listing.count({ where: { sellerId: userId, status: 'active' } }),
        this.db.listing.aggregate({
          where: live,
          _sum: { viewsCount: true, favoritesCount: true, chatCount: true },
        }),
        this.db.offer.count({ where: { toUserId: userId, createdAt: { gte: since } } }),
        this.db.offer.count({
          where: { toUserId: userId, createdAt: { gte: since }, status: 'accepted' },
        }),
        this.db.order.groupBy({
          by: ['status'],
          where: { sellerId: userId, createdAt: { gte: since } },
          _count: { _all: true },
        }),
        // What actually reached the seller: payouts, after fees and any partial refunds.
        this.db.transaction.groupBy({
          by: ['currency'],
          where: { userId, type: 'payout', status: 'succeeded', createdAt: { gte: since } },
          _sum: { amount: true },
        }),
        this.db.profile.findUnique({
          where: { userId },
          select: { ratingAvg: true, ratingCount: true },
        }),
        this.db.listing.findMany({
          where: live,
          orderBy: [{ viewsCount: 'desc' }, { favoritesCount: 'desc' }],
          take: 5,
          select: {
            id: true,
            slug: true,
            title: true,
            viewsCount: true,
            favoritesCount: true,
            chatCount: true,
          },
        }),
        this.responseRate(userId),
      ]);
    const byStatus = new Map(orders.map((o) => [o.status, o._count._all]));
    return {
      days,
      listings: {
        active,
        views: totals._sum.viewsCount ?? 0,
        favorites: totals._sum.favoritesCount ?? 0,
        chats: totals._sum.chatCount ?? 0,
      },
      offers: {
        received,
        accepted,
        acceptanceRate: received ? Math.round((accepted / received) * 1000) / 10 : null,
      },
      orders: {
        completed: byStatus.get('completed') ?? 0,
        inProgress: IN_PROGRESS.reduce((n, s) => n + (byStatus.get(s) ?? 0), 0),
        cancelled: byStatus.get('cancelled') ?? 0,
        refunded: byStatus.get('refunded') ?? 0,
      },
      earnings: payouts.map((p) => ({
        currency: p.currency as Currency,
        amount: (p._sum.amount ?? 0).toFixed(2),
      })),
      responseRate,
      rating: { average: profile?.ratingAvg.toNumber() ?? 0, count: profile?.ratingCount ?? 0 },
      topListings: top.map((l) => ({
        id: l.id,
        slug: l.slug,
        title: l.title,
        views: l.viewsCount,
        favorites: l.favoritesCount,
        chats: l.chatCount,
      })),
    };
  }
}
