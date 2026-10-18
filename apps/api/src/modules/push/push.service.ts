import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { PushConfigDto, PushSubscriptionInput } from '@markethub/shared';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.module';
import { JobsService } from '../jobs/jobs.module';
import { PushSender } from './push.sender';

interface PushJob {
  notificationId: string;
}

/** Old devices beyond this are dropped when a new one subscribes. */
const DEVICES_PER_USER = 10;
const DAY_S = 86_400;

// Chat and offers are conversations someone is waiting on; the rest can wait for the
// device's next wake-up.
const URGENT = /^(chat|offer)\./;

/**
 * §8 `push:send` = queue `push`, job `send`. Fired next to `email:send` when the
 * recipient has no live socket. One job per notification (jobId), and devices that
 * already got it aren't retried: the job only throws when nothing went out at all.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly jobs: JobsService,
    private readonly sender: PushSender,
  ) {}

  onModuleInit() {
    this.jobs.work('push', async (job: Job<PushJob>) => {
      if (job.name === 'send') await this.deliver(job.data.notificationId);
    });
  }

  config(): PushConfigDto {
    return { publicKey: this.sender.publicKey };
  }

  async subscribe(userId: string, sub: PushSubscriptionInput, userAgent?: string) {
    const fields = {
      userId,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    };
    // Upsert on the endpoint: the device now belongs to whoever subscribed it last.
    await this.db.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { endpoint: sub.endpoint, ...fields },
      update: fields,
    });
    const stale = await this.db.pushSubscription.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      skip: DEVICES_PER_USER,
      select: { id: true },
    });
    if (stale.length) {
      await this.db.pushSubscription.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    }
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.db.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  /** Never throws: push is a nicety on top of the in-app row and the email. */
  async enqueue(notificationId: string) {
    await this.jobs
      .queue('push')
      .add('send', { notificationId } satisfies PushJob, { jobId: `push-${notificationId}` })
      .catch((err: unknown) => this.logger.error({ err }, 'could not enqueue push:send'));
  }

  /** Returns what happened, for tests. */
  async deliver(notificationId: string) {
    if (!this.sender.publicKey) return 'off';
    const n = await this.db.notification.findUnique({
      where: { id: notificationId },
      include: {
        user: { select: { isActive: true, isBanned: true, pushSubscriptions: true } },
      },
    });
    if (!n) return 'gone';
    if (!n.user.isActive || n.user.isBanned) return 'skipped';
    if (n.isRead) return 'read';
    if (!n.user.pushSubscriptions.length) return 'no-devices';

    const conversationId = (n.payload as { conversationId?: string } | null)?.conversationId;
    const payload = JSON.stringify({
      id: n.id,
      title: n.title,
      body: n.body?.slice(0, 300) ?? '',
      link: n.link ?? '/feed',
      // Same tag = the newer one replaces the older on the device.
      tag: conversationId ? `chat-${conversationId}` : `n-${n.id}`,
    });
    const urgent = URGENT.test(n.type);

    const outcomes = await Promise.all(
      n.user.pushSubscriptions.map(async (s) => ({
        id: s.id,
        outcome: await this.sender.send(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { ttl: urgent ? DAY_S : 3 * DAY_S, urgency: urgent ? 'high' : 'normal' },
        ),
      })),
    );
    const ids = (o: string) => outcomes.filter((x) => x.outcome === o).map((x) => x.id);

    const [sent, gone] = [ids('sent'), ids('gone')];
    if (gone.length) await this.db.pushSubscription.deleteMany({ where: { id: { in: gone } } });
    if (sent.length) {
      await this.db.pushSubscription.updateMany({
        where: { id: { in: sent } },
        data: { lastPushAt: new Date() },
      });
      return 'sent';
    }
    if (ids('retry').length) throw new Error('push services unavailable; retrying');
    return gone.length ? 'gone-devices' : 'rejected';
  }
}
