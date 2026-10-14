import type { OfferStatus, OrderStatus } from '@markethub/shared';
import { cn } from '@/lib/utils';

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  awaiting_payment: 'Awaiting payment',
  paid: 'Paid',
  in_escrow: 'Paid · in escrow',
  shipped: 'Shipped',
  delivered: 'Delivered',
  completed: 'Completed',
  disputed: 'In dispute',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

const OFFER_LABEL: Record<OfferStatus, string> = {
  pending: 'Waiting for reply',
  accepted: 'Accepted',
  declined: 'Declined',
  countered: 'Countered',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
};

// Three tones are enough: something to do, done well, closed.
const tone = (s: OfferStatus | OrderStatus) =>
  s === 'accepted' || s === 'completed'
    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
    : s === 'pending' || s === 'awaiting_payment' || s === 'disputed'
      ? 'bg-saffron/20 text-saffron-foreground'
      : s === 'in_escrow' || s === 'shipped' || s === 'delivered' || s === 'paid'
        ? 'bg-primary/10 text-primary'
        : 'bg-muted text-muted-foreground';

export function StatusPill({
  status,
  kind,
  className,
}: {
  status: OfferStatus | OrderStatus;
  kind: 'offer' | 'order';
  className?: string;
}) {
  const label =
    kind === 'offer'
      ? OFFER_LABEL[status as OfferStatus]
      : ORDER_STATUS_LABEL[status as OrderStatus];
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone(status),
        className,
      )}
    >
      {label}
    </span>
  );
}
