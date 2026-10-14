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
