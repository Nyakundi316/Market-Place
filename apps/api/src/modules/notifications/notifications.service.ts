import { Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import type {
  CursorPage,
  Env,
  NotificationDto,
  NotificationQuery,
  NotificationType,
} from '@markethub/shared';
import type { Notification, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { decodeCursor, olderThan, pageOf } from '../../common/cursor';
import { InjectEnv } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.module';
import { RealtimeService } from '../chat/realtime.service';
import { JobsService } from '../jobs/jobs.module';
import { MailService } from '../mail/mail.service';

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  /** App-relative path. */
  link?: string | null;
  payload?: Prisma.InputJsonValue;
}

interface EmailJob {
  notificationId: string;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export const toNotification = (n: Notification): NotificationDto => ({
  id: n.id,
  type: n.type as NotificationType,
  title: n.title,
  body: n.body,
  link: n.link,
  isRead: n.isRead,
  createdAt: n.createdAt.toISOString(),
});

/**
 * In-app first (row + `notification:new`), email only when the recipient has
 * no live socket — the same rule chat uses. Mail goes through §8 `email:send`
 * so a slow or failing provider never holds up the request that caused it.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly jobs: JobsService,
    private readonly mail: MailService,
    @InjectEnv() private readonly env: Env,
  ) {}

  onModuleInit() {
    this.jobs.work('email', async (job: Job<EmailJob>) => {
      if (job.name === 'send') await this.deliverEmail(job.data.notificationId);
    });
  }

  /** Call after the change it describes has committed. Never throws. */
  async notify(userId: string, input: NotifyInput): Promise<void> {
    try {
      const row = await this.db.notification.create({
        data: {
          userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          link: input.link ?? null,
          payload: input.payload,
        },
      });
      this.realtime.toUser(userId, 'notification:new', toNotification(row));
      if (!(await this.realtime.online([userId])).size) {
        await this.jobs
          .queue('email')
          .add('send', { notificationId: row.id } satisfies EmailJob, { jobId: `email-${row.id}` });
      }
    } catch (err) {
      // The deal already moved; a missed notice must not turn that into a 500.
      this.logger.error({ err, userId, type: input.type }, 'notify failed');
    }
  }

  /** Returns what happened, for tests. */
  async deliverEmail(notificationId: string) {
    const n = await this.db.notification.findUnique({
      where: { id: notificationId },
      include: { user: { select: { email: true, isActive: true, isBanned: true } } },
    });
    if (!n) return 'gone';
    if (!n.user.isActive || n.user.isBanned) return 'skipped';
    if (n.isRead) return 'read'; // seen in-app before the job ran

    const link = n.link ? `${this.env.WEB_URL}${n.link}` : this.env.WEB_URL;
    await this.mail.send({
      to: n.user.email,
      subject: n.title,
      text: `${n.body ? `${n.body}\n\n` : ''}Open MarketHub: ${link}`,
      html: `${n.body ? `<p>${escapeHtml(n.body)}</p>` : ''}<p><a href="${link}">Open MarketHub</a></p>`,
    });
    return 'sent';
  }

  async list(userId: string, q: NotificationQuery) {
    const rows = await this.db.notification.findMany({
      where: {
        userId,
        ...(q.unread !== undefined && { isRead: !q.unread }),
        ...olderThan('createdAt', decodeCursor(q.cursor)),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const { page, nextCursor } = pageOf(rows, q.limit, (r) => r.createdAt);
    const unread = await this.db.notification.count({ where: { userId, isRead: false } });
    return {
      items: page.map(toNotification),
      nextCursor,
      unread,
    } satisfies CursorPage<NotificationDto> & { unread: number };
  }

  async read(userId: string, id: string): Promise<NotificationDto> {
    const n = await this.db.notification.findFirst({ where: { id, userId } });
    if (!n) throw new NotFoundException('Notification not found');
    if (n.isRead) return toNotification(n);
    return toNotification(
      await this.db.notification.update({
        where: { id },
        data: { isRead: true, readAt: new Date() },
      }),
    );
  }

  async readAll(userId: string) {
    const { count } = await this.db.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { updated: count };
  }
}
