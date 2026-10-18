import { z } from 'zod';
import { cursorQuerySchema } from './pagination';

export const NOTIFICATION_TYPES = [
  'chat.message',
  'offer.received',
  'offer.countered',
  'offer.accepted',
  'offer.declined',
  'offer.withdrawn',
  'offer.expired',
  'order.created',
  'order.shipped',
  'order.delivered',
  'order.completed',
  'order.cancelled',
  'order.paid',
  'payment.failed',
  'order.disputed',
  'order.refunded',
  'dispute.resolved',
  'payout.sent',
  'payout.setup_needed',
  'review.received',
  'listing.expired',
  'verification.approved',
  'verification.rejected',
  'moderation.warning',
  'moderation.listing_removed',
  'report.resolved',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const notificationQuerySchema = cursorQuerySchema.extend({
  unread: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /** App-relative path, e.g. /orders/{id}. */
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

// ─── Web Push (brief §3 addendum) ─────────────────────────────────────────

const base64url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[\w-]+=*$/, 'Must be base64url');

/**
 * `PushSubscription.toJSON()` from the browser. Not strict: browsers add
 * `expirationTime` (and may add more); only these fields are kept.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((u) => u.startsWith('https://'), 'Must be https'),
  keys: z.object({ p256dh: base64url(256), auth: base64url(64) }),
});

export const pushEndpointSchema = z.object({ endpoint: z.string().url().max(2048) }).strict();

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/** `publicKey` is the VAPID key the browser subscribes with; null = push is off on this server. */
export interface PushConfigDto {
  publicKey: string | null;
}
