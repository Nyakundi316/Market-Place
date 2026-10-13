import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { Attachment, Env } from '@markethub/shared';
import type { Job } from 'bullmq';
import { InjectEnv } from '../../config/env.validation';
import { PrismaService } from '../../prisma/prisma.module';
import { JobsService } from '../jobs/jobs.module';
import { MailService } from '../mail/mail.service';
import { RealtimeService } from './realtime.service';

export interface OfflineJob {
  recipientId: string;
  conversationId: string;
}

/** Long enough to collapse a burst of messages into one email. */
export const OFFLINE_DELAY_MS = 60_000;

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/**
 * §5 "no presence → enqueue notify:offline". One delayed job per recipient and
 * conversation (the jobId dedupes a burst); when it runs it re-checks, because
 * by then they may have come online or read everything.
 */
@Injectable()
export class OfflineNotifier implements OnModuleInit {
  private readonly logger = new Logger(OfflineNotifier.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly db: PrismaService,
    private readonly mail: MailService,
    private readonly realtime: RealtimeService,
    @InjectEnv() private readonly env: Env,
  ) {}

  onModuleInit() {
    this.jobs.work('notify', async (job: Job<OfflineJob>) => {
      if (job.name === 'offline') await this.deliver(job.data);
    });
  }

  async enqueue(data: OfflineJob) {
    await this.jobs
      .queue('notify')
      .add('offline', data, {
        jobId: `offline:${data.recipientId}:${data.conversationId}`,
        delay: OFFLINE_DELAY_MS,
      })
      // A lost notification shouldn't fail the message that was already saved.
      .catch((err: unknown) => this.logger.error({ err }, 'could not enqueue notify:offline'));
  }

  /** Returns what it did, for tests and logs. */
  async deliver({ recipientId, conversationId }: OfflineJob) {
    if ((await this.realtime.online([recipientId])).size) return 'online';

    const c = await this.db.conversation.findUnique({
      where: { id: conversationId },
      include: {
        listing: { select: { title: true } },
        buyer: { select: { id: true, email: true, isActive: true, isBanned: true, profile: true } },
        seller: {
          select: { id: true, email: true, isActive: true, isBanned: true, profile: true },
        },
      },
    });
    if (!c) return 'gone';
    const [recipient, sender] =
      c.buyerId === recipientId ? [c.buyer, c.seller] : [c.seller, c.buyer];
    if (recipient.id !== recipientId || !recipient.isActive || recipient.isBanned) return 'skipped';

    const unread = c.buyerId === recipientId ? c.buyerUnread : c.sellerUnread;
    const latest = await this.db.message.findFirst({
      where: { conversationId, senderId: { not: recipientId }, isRead: false },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (!unread || !latest) return 'read';

    // Idempotency marker: one notification per latest message, so retries don't repeat it.
    const already = await this.db.notification.findFirst({
      where: {
        userId: recipientId,
        type: 'chat.message',
        payload: { path: ['messageId'], equals: latest.id },
      },
      select: { id: true },
    });
    if (already) return 'duplicate';

    const name = sender.profile?.displayName ?? 'Someone';
    const attachments = (latest.attachments ?? []) as Attachment[];
    const preview =
      latest.body?.slice(0, 280) ||
      (attachments.length
        ? latest.type === 'image'
          ? 'Sent a photo'
          : 'Sent a file'
        : 'New message');
    const more = unread > 1 ? ` (+${unread - 1} more)` : '';
    const link = `${this.env.WEB_URL}/chat/${conversationId}`;
    const subject = `${name} messaged you about “${c.listing.title}”`;

    await this.mail.send({
      to: recipient.email,
      subject,
      text: `${name}: ${preview}${more}\n\nReply on MarketHub: ${link}`,
      html: `<p><strong>${escapeHtml(name)}</strong>: ${escapeHtml(preview)}${escapeHtml(more)}</p><p><a href="${link}">Reply on MarketHub</a></p>`,
    });
    await this.db.notification.create({
      data: {
        userId: recipientId,
        type: 'chat.message',
        title: subject,
        body: preview,
        link: `/chat/${conversationId}`,
        payload: { conversationId, messageId: latest.id, unread },
      },
    });
    return 'sent';
  }
}
