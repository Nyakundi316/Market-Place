'use client';

import type { ConversationDto } from '@markethub/shared';
import { MessagesSquare, WifiOff } from 'lucide-react';
import Link from 'next/link';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useConversations, useIsConnected } from '@/hooks/use-chat';
import { chatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { isTypingNow, useChatStore } from '@/stores/chat';

export function PresenceDot({ online, className }: { online: boolean; className?: string }) {
  if (!online) return null;
  return (
    <span
      aria-label="Online"
      className={cn(
        'absolute bottom-0 right-0 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card',
        className,
      )}
    />
  );
}

function preview(c: ConversationDto, me: string | undefined) {
  const m = c.lastMessage;
  if (!m) return 'No messages yet — say hello';
  const text = m.body ?? (m.type === 'image' ? 'Photo' : m.type === 'file' ? 'File' : 'Message');
  return m.senderId === me ? `You: ${text}` : text;
}

function Row({ c, active }: { c: ConversationDto; active: boolean }) {
  const me = useAuth((s) => s.user?.id);
  const typing = useChatStore((s) => isTypingNow(s.typing[c.id]));
  const unread = c.unread > 0 && !active;
  return (
    <li>
      <Link
        href={`/chat/${c.id}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3 transition-colors hover:bg-accent/60',
          active && 'bg-accent',
        )}
      >
        <span className="relative mt-0.5">
          <ProfileAvatar
            name={c.counterpart.displayName}
            src={c.counterpart.avatarUrl}
            className="size-11"
          />
          <PresenceDot online={c.counterpart.online} />
        </span>
        <span className="min-w-0">
          <span className={cn('block truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>
            {c.counterpart.displayName}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{c.listing.title}</span>
          <span
            className={cn(
              'mt-0.5 block truncate text-sm',
              typing ? 'italic text-primary' : unread ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {typing ? 'typing…' : preview(c, me)}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1.5 pt-0.5">
          {c.lastMessageAt && (
            <time
              dateTime={c.lastMessageAt}
              className={cn('text-[11px]', unread ? 'text-primary' : 'text-muted-foreground')}
            >
              {chatTime(c.lastMessageAt)}
            </time>
          )}
          {unread && (
            <span
              aria-label={`${c.unread} unread`}
              className="min-w-5 rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold leading-5 text-primary-foreground"
            >
              {c.unread}
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

export function ConversationList({ activeId }: { activeId?: string }) {
  const { data, isPending, isError, refetch, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useConversations();
  const connected = useIsConnected();
  const items = data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-baseline gap-3 px-4 pb-3 pt-1 lg:pt-5">
        <h1 className="text-2xl font-semibold tracking-tight">Chats</h1>
        {!connected && !isPending && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <WifiOff className="size-3" aria-hidden /> Reconnecting…
          </span>
        )}
      </div>

      {isPending ? (
        <ul aria-hidden className="space-y-1 px-4">
          {Array.from({ length: 6 }, (_, i) => (
            <li key={i} className="flex gap-3 py-2">
              <Skeleton className="size-11 rounded-full" />
              <div className="flex-1 space-y-2 py-1">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </li>
          ))}
        </ul>
      ) : isError ? (
        <div className="mx-4 rounded-lg border border-dashed p-5 text-sm">
          <p>We couldn&apos;t load your chats.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="mx-4 mt-2 flex gap-4 rounded-lg border border-dashed p-5">
          <MessagesSquare className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div className="text-sm">
            <p className="font-medium">No chats yet</p>
            <p className="mt-0.5 text-muted-foreground">
              Message a seller from any listing and the conversation lands here.
            </p>
            <Link
              href="/feed"
              className="mt-3 inline-block font-medium text-primary underline-offset-4 hover:underline"
            >
              Browse listings
            </Link>
          </div>
        </div>
      ) : (
        <ul className="-mx-0 min-h-0 flex-1 divide-y overflow-y-auto lg:divide-y-0">
          {items.map((c) => (
            <Row key={c.id} c={c} active={c.id === activeId} />
          ))}
          {hasNextPage && (
            <li className="p-3">
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                disabled={isFetchingNextPage}
                onClick={() => void fetchNextPage()}
              >
                {isFetchingNextPage ? 'Loading…' : 'Older chats'}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
