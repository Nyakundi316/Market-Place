import { Injectable } from '@nestjs/common';
import type { Env } from '@markethub/shared';
import webpush, { type PushSubscription, WebPushError } from 'web-push';
import { InjectEnv } from '../../config/env.validation';

export interface PushOptions {
  /** Seconds the push service keeps it for an offline device. */
  ttl: number;
  urgency: 'normal' | 'high';
}

export type PushOutcome = 'sent' | 'gone' | 'rejected' | 'retry';

/**
 * Web Push with VAPID (brief §3 addendum; replaces §1 FCM). web-push does the
 * RFC 8291 payload encryption and signs the VAPID JWT. Kept apart from
 * PushService so tests can stand in for the push services.
 */
@Injectable()
export class PushSender {
  private readonly vapid: { subject: string; publicKey: string; privateKey: string } | null;

  constructor(@InjectEnv() env: Env) {
    const mailbox = /<([^>]+)>/.exec(env.MAIL_FROM)?.[1] ?? env.MAIL_FROM;
    this.vapid =
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? {
            subject: env.VAPID_SUBJECT ?? `mailto:${mailbox}`,
            publicKey: env.VAPID_PUBLIC_KEY,
            privateKey: env.VAPID_PRIVATE_KEY,
          }
        : null;
  }

  get publicKey() {
    return this.vapid?.publicKey ?? null;
  }

  async send(sub: PushSubscription, payload: string, opts: PushOptions): Promise<PushOutcome> {
    if (!this.vapid) return 'rejected';
    try {
      await webpush.sendNotification(sub, payload, {
        vapidDetails: this.vapid,
        TTL: opts.ttl,
        urgency: opts.urgency,
        timeout: 10_000,
      });
      return 'sent';
    } catch (err) {
      if (!(err instanceof WebPushError)) return 'retry'; // network, timeout
      // 404/410: the browser unsubscribed or the subscription expired.
      if (err.statusCode === 404 || err.statusCode === 410) return 'gone';
      if (err.statusCode === 429 || err.statusCode >= 500) return 'retry';
      // 400/403/413: bad request, VAPID mismatch (keys rotated) — retrying won't fix it.
      return 'rejected';
    }
  }
}
