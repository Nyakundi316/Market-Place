'use client';

import { useTotalUnread } from '@/hooks/use-chat';
import { cn } from '@/lib/utils';

/** Sidebar shows the number; the mobile tab bar only has room for a dot. */
export function UnreadCount({
  variant,
  className,
}: {
  variant: 'count' | 'dot';
  className?: string;
}) {
  const n = useTotalUnread();
  if (!n) return null;
  if (variant === 'dot') {
    return (
      <span
        aria-label={`${n} unread`}
        className={cn('size-2 rounded-full bg-destructive ring-2 ring-card', className)}
      />
    );
  }
  return (
    <span
      aria-label={`${n} unread`}
      className={cn(
        'min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold leading-5 text-primary-foreground',
        className,
      )}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}
