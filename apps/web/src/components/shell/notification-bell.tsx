'use client';

import type { NotificationDto } from '@markethub/shared';
import { Bell, Handshake, MessageCircle, Package } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { unreadNotifications, useMarkNotificationRead, useNotifications } from '@/hooks/use-deals';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';

const iconFor = (type: NotificationDto['type']) =>
  type.startsWith('order.') ? Package : type.startsWith('offer.') ? Handshake : MessageCircle;

/** §6 NotificationBell + NotificationList. Radix handles focus and arrow keys. */
export function NotificationBell({ className }: { className?: string }) {
  const authed = useAuth((s) => s.status === 'authenticated');
  const q = useNotifications();
  const mark = useMarkNotificationRead();
  if (!authed) return null;

  const unread = unreadNotifications(q.data);
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          className={cn('relative rounded-full', className)}
        >
          <Bell className="size-[18px]" />
          {unread > 0 && (
            <span className="absolute right-1 top-1 min-w-4 rounded-full bg-destructive px-1 text-center text-[10px] font-semibold leading-4 text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-[min(22rem,calc(100vw-2rem))] p-0"
      >
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 && (
            <button
              type="button"
              onClick={() => mark.mutate('all')}
              className="text-xs font-medium text-primary hover:underline"
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[min(26rem,70dvh)] overflow-y-auto p-1">
          {q.isPending ? (
            <div className="space-y-2 p-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          ) : (
            items.map((n) => {
              const Icon = iconFor(n.type);
              return (
                <DropdownMenuItem key={n.id} asChild className="items-start gap-3 px-2.5 py-2">
                  <Link href={n.link ?? '/deals'} onClick={() => !n.isRead && mark.mutate(n.id)}>
                    <Icon
                      className={cn(
                        'mt-0.5 size-4 shrink-0',
                        n.isRead ? 'text-muted-foreground' : 'text-primary',
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={cn(
                          'line-clamp-2 text-[13px] leading-snug',
                          !n.isRead && 'font-medium',
                        )}
                      >
                        {n.title}
                      </span>
                      {n.body && (
                        <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
                          {n.body}
                        </span>
                      )}
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {timeAgo(n.createdAt)}
                      </span>
                    </span>
                    {!n.isRead && (
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                        aria-label="Unread"
                      />
                    )}
                  </Link>
                </DropdownMenuItem>
              );
            })
          )}
          {q.hasNextPage && (
            <button
              type="button"
              onClick={() => void q.fetchNextPage()}
              className="w-full py-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Show older
            </button>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
