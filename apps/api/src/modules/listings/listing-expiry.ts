import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Env } from '@markethub/shared';
import { InjectEnv } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.module';
import { JobsService } from '../jobs/jobs.module';
import { NotificationsService } from '../notifications/notifications.service';

const BATCH = 500;

/**
 * §8 listing:expire. Search already hides listings past `expiresAt` the
 * moment they lapse; this job makes it official — status `expired`, the
 * seller's live count corrected, and one nudge per seller to renew (renewing
 * is just publishing again, from the Expired tab).
 */
@Injectable()
export class ListingExpiry implements OnModuleInit {
  private readonly logger = new Logger(ListingExpiry.name);

  constructor(
    private readonly db: PrismaService,
    private readonly jobs: JobsService,
    private readonly notifications: NotificationsService,
    @InjectEnv() private readonly env: Env,
  ) {}

  async onModuleInit() {
    this.jobs.work(
      'listing',
      async (job) => {
        if (job.name === 'expire') await this.run();
      },
      1,
    );
    if (this.env.NODE_ENV === 'test') return;
    await this.jobs
      .queue('listing')
      .upsertJobScheduler('hourly-expire', { pattern: '7 * * * *', tz: 'UTC' }, { name: 'expire' })
      .catch((err: unknown) => this.logger.error({ err }, 'could not schedule listing expiry'));
  }

  /** Idempotent: only touches listings still `active` and already past their date. */
  async run(now = new Date()): Promise<number> {
    const perSeller = new Map<string, string[]>();
    let total = 0;
    for (;;) {
      const due = await this.db.listing.findMany({
        where: { status: 'active', expiresAt: { lte: now } },
        select: { id: true, sellerId: true, title: true },
        take: BATCH,
      });
      if (!due.length) break;
      // The status guard makes a concurrent run (or a renew in between) harmless.
      const { count } = await this.db.listing.updateMany({
        where: { id: { in: due.map((l) => l.id) }, status: 'active' },
        data: { status: 'expired', isFeatured: false },
      });
      total += count;
      for (const l of due)
        perSeller.set(l.sellerId, [...(perSeller.get(l.sellerId) ?? []), l.title]);
      if (due.length < BATCH) break;
    }

    for (const [sellerId, titles] of perSeller) {
      const live = await this.db.listing.count({ where: { sellerId, status: 'active' } });
      await this.db.profile.updateMany({
        where: { userId: sellerId },
        data: { listingsCount: live },
      });
      await this.notifications.notify(sellerId, {
        type: 'listing.expired',
        title:
          titles.length === 1
            ? `“${titles[0]}” has expired`
            : `${titles.length} of your listings have expired`,
        body: 'Renew them in one tap to put them back in search for another 30 days.',
        link: '/seller?tab=expired',
        payload: { count: titles.length },
      });
    }
    if (total) this.logger.log(`expired ${total} listings for ${perSeller.size} sellers`);
    return total;
  }
}
