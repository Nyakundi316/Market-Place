import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Env } from '@markethub/shared';
import { InjectEnv } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.module';
import { JobsService } from '../jobs/jobs.module';

const DAY_MS = 86_400_000;

/**
 * §8 audit:cleanup — housekeeping only. audit_logs, transactions and escrow
 * rows are never pruned (decided 2026-10-15); this clears rows that have
 * stopped meaning anything: dead sign-in tokens, old read notifications and
 * webhook events long past any gateway retry window.
 */
@Injectable()
export class Cleanup implements OnModuleInit {
  private readonly logger = new Logger(Cleanup.name);

  constructor(
    private readonly db: PrismaService,
    private readonly jobs: JobsService,
    @InjectEnv() private readonly env: Env,
  ) {}

  async onModuleInit() {
    this.jobs.work(
      'cleanup',
      async (job) => {
        if (job.name === 'nightly') await this.run();
      },
      1,
    );
    if (this.env.NODE_ENV === 'test') return;
    await this.jobs
      .queue('cleanup')
      .upsertJobScheduler(
        'nightly-cleanup',
        { pattern: '15 3 * * *', tz: 'UTC' },
        { name: 'nightly' },
      )
      .catch((err: unknown) => this.logger.error({ err }, 'could not schedule cleanup'));
  }

  async run(now = new Date()) {
    const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const month = ago(30);
    const quarter = ago(90);

    // Refresh tokens go by expiry alone: a used or revoked one that hasn't
    // expired is what lets reuse of a stolen token revoke its family.
    const [refreshTokens, authTokens, notifications, webhookEvents] = await Promise.all([
      this.db.refreshToken.deleteMany({ where: { expiresAt: { lt: month } } }),
      this.db.authToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: month } }, { usedAt: { lt: month } }] },
      }),
      this.db.notification.deleteMany({ where: { isRead: true, readAt: { lt: quarter } } }),
      // Unprocessed (failed) events stay for someone to look at.
      this.db.webhookEvent.deleteMany({ where: { processedAt: { lt: quarter } } }),
    ]);
    const counts = {
      refreshTokens: refreshTokens.count,
      authTokens: authTokens.count,
      notifications: notifications.count,
      webhookEvents: webhookEvents.count,
    };
    this.logger.log(counts, 'cleanup done');
    return counts;
  }
}
