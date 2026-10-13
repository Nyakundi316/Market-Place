'use client';

import type { ConversationDto } from '@markethub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, RotateCcw } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { Fragment, useEffect, useLayoutEffect, useRef } from 'react';
import { toast } from 'sonner';
import { PresenceDot } from '@/components/chat/conversation-list';
import { ProfileAvatar } from '@/components/profile-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type ChatMessage,
  markRead,
  useConversation,
  useMessages,
  useSendMessage,
} from '@/hooks/use-chat';
import { ApiError } from '@/lib/api';
import { dayLabel, formatMoney, messageTime, sameDay } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/stores/auth';
import { isTypingNow, useChatStore } from '@/stores/chat';
import { Composer } from './composer';

const GROUP_MS = 2 * 60_000; // consecutive messages from one sender within this sit tight together

function ThreadHeader({ c }: { c: ConversationDto }) {
  const typing = useChatStore((s) => isTypingNow(s.typing[c.id]));
  const { counterpart: who, listing } = c;
  return (
    <header className="border-b bg-card/80 backdrop-blur lg:flex lg:items-center">
      <div className="flex items-center gap-3 px-2 py-2 lg:min-w-0 lg:flex-1 lg:px-5 lg:py-3">
        <Link
          href="/chat"
          aria-label="Back to chats"
          className="grid size-9 place-items-center rounded-full hover:bg-accent lg:hidden"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <span className="relative">
          <ProfileAvatar name={who.displayName} src={who.avatarUrl} />
          <PresenceDot online={who.online} />
        </span>
        <div className="min-w-0 flex-1">
          {who.username ? (
            <Link
              href={`/u/${who.username}`}
              className="block truncate font-medium hover:underline"
            >
              {who.displayName}
            </Link>
          ) : (
            <span className="block truncate font-medium">{who.displayName}</span>
          )}
          <p
            className={cn('text-xs', typing ? 'text-primary' : 'text-muted-foreground')}
            aria-live="polite"
          >
            {typing ? 'typing…' : who.online ? 'Online' : c.role === 'buyer' ? 'Seller' : 'Buyer'}
          </p>
        </div>
      </div>

      {/* The listing stays in view: every message is about this item. */}
      <Link
        href={`/l/${listing.slug}`}
        className="flex items-center gap-3 border-t px-4 py-2 text-sm hover:bg-accent/50 lg:mr-5 lg:max-w-xs lg:shrink-0 lg:rounded-lg lg:border lg:px-2 lg:py-1.5"
      >
        {listing.coverThumbUrl ? (
          <Image
            src={listing.coverThumbUrl}
            alt=""
            width={40}
            height={40}
            unoptimized
            className="size-9 rounded object-cover"
          />
        ) : (
          <span className="size-9 rounded bg-muted" />
        )}
        <span className="min-w-0">
          <span className="block truncate">{listing.title}</span>
          <span className="text-xs text-muted-foreground">
            {listing.status === 'sold'
              ? 'Sold'
              : listing.price
                ? formatMoney(listing.price, listing.currency)
                : 'Price on request'}
          </span>
        </span>
      </Link>
    </header>
  );
}

function Bubble({
  m,
  mine,
  tight,
  onRetry,
}: {
  m: ChatMessage;
  mine: boolean;
  tight: boolean;
  onRetry: () => void;
}) {
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start', tight ? 'mt-0.5' : 'mt-3')}>
      <div
        className={cn(
          'max-w-[80%] rounded-2xl text-[15px] leading-snug lg:max-w-[65%]',
          // A photo with no caption gets a thin frame instead of text padding.
          m.body ? 'px-3 py-2' : 'p-1 pb-1.5',
          mine
            ? 'bg-primary text-primary-foreground'
            : 'border bg-card text-card-foreground shadow-card',
          mine && !tight && 'rounded-br-md',
          !mine && !tight && 'rounded-bl-md',
          m.status === 'sending' && 'opacity-70',
          m.status === 'failed' && 'bg-destructive/10 text-foreground ring-1 ring-destructive/40',
        )}
      >
        {m.attachments.map((a) =>
          a.contentType.startsWith('image/') ? (
            <a
              key={a.url}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className={cn('mb-1 block', m.body && '-mx-1')}
            >
              <Image
                src={a.url}
                alt="Photo"
                width={a.width ?? 800}
                height={a.height ?? 600}
                unoptimized
                className="max-h-72 w-auto rounded-xl object-cover"
              />
            </a>
          ) : (
            <a key={a.url} href={a.url} target="_blank" rel="noreferrer" className="underline">
              Open attachment
            </a>
          ),
        )}
        {/* Text renders as text: React escapes it (§5 "store raw, escape on render"). */}
        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        <span
          className={cn(
            'mt-0.5 block text-right text-[10px]',
            !m.body && 'pr-2',
            mine ? 'opacity-75' : 'text-muted-foreground',
          )}
        >
          {messageTime(m.createdAt)}
        </span>
      </div>
      {m.status === 'failed' && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-2 flex items-center gap-1 self-center text-xs font-medium text-destructive"
        >
          <RotateCcw className="size-3" /> Retry
        </button>
      )}
    </div>
  );
}

export function Thread({ id }: { id: string }) {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user?.id);
  const conversation = useConversation(id);
  const messages = useMessages(id);
  const send = useSendMessage(id);
  const typing = useChatStore((s) => isTypingNow(s.typing[id]));
  const setOpen = useChatStore((s) => s.setOpen);

  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const restore = useRef<number | null>(null); // distance from bottom before older messages loaded
  const stuck = useRef(true); // following the newest message

  // Oldest → newest for reading order; pages arrive newest-first.
  const list = (messages.data?.pages ?? [])
    .flatMap((p) => p.items)
    .slice()
    .reverse();
  const newestId = list.at(-1)?.id;
  const oldestId = list[0]?.id;

  useEffect(() => {
    setOpen(id);
    return () => setOpen(null);
  }, [id, setOpen]);

  // Read on open, on new arrivals, and when the tab comes back into view.
  const unread = conversation.data?.unread ?? 0;
  useEffect(() => {
    const read = () => {
      if (document.visibilityState === 'visible' && unread > 0) void markRead(qc, id);
    };
    read();
    document.addEventListener('visibilitychange', read);
    return () => document.removeEventListener('visibilitychange', read);
  }, [id, qc, unread, newestId]);

  // Stay pinned to the bottom when following (or when I just sent something);
  // keep the reading position when older pages load above.
  const newestMine = list.at(-1)?.senderId === me;
  const seenNewest = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (restore.current !== null) {
      el.scrollTop = el.scrollHeight - restore.current;
      restore.current = null;
      return;
    }
    const arrived = newestId !== seenNewest.current;
    seenNewest.current = newestId;
    if (stuck.current || (arrived && newestMine)) el.scrollTop = el.scrollHeight;
  }, [newestId, oldestId, typing, newestMine]);

  // Load older history when the top comes into view.
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = messages;
  useEffect(() => {
    const el = top.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting || isFetchingNextPage) return;
      const s = scroller.current!;
      restore.current = s.scrollHeight - s.scrollTop;
      void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const submit = async (draft: Parameters<typeof send>[0], retryOf?: string) => {
    stuck.current = true;
    try {
      await send(draft, retryOf);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Message not sent');
    }
  };

  if (conversation.isError) {
    return (
      <div className="fixed inset-x-0 bottom-0 top-14 z-50 bg-background p-6 lg:static lg:z-auto lg:bg-transparent lg:p-10">
        <p className="font-medium">This chat isn&apos;t available</p>
        <Link
          href="/chat"
          className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
        >
          Back to chats
        </Link>
      </div>
    );
  }

  return (
    <section
      aria-label="Conversation"
      className="fixed inset-x-0 bottom-0 top-14 z-50 flex flex-col bg-background lg:relative lg:inset-auto lg:z-auto lg:min-h-0 lg:bg-transparent"
    >
      {conversation.data ? (
        <ThreadHeader c={conversation.data} />
      ) : (
        <div className="flex items-center gap-3 border-b px-5 py-3">
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      )}

      <div
        ref={scroller}
        role="log"
        aria-label="Messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 lg:px-6"
      >
        <div ref={top} className="h-px" />
        {isFetchingNextPage && (
          <p className="flex justify-center py-2 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-label="Loading earlier messages" />
          </p>
        )}
        {messages.isPending ? (
          <div aria-hidden className="space-y-3 pt-6">
            <Skeleton className="h-9 w-2/5 rounded-2xl" />
            <Skeleton className="ml-auto h-9 w-1/2 rounded-2xl" />
            <Skeleton className="h-14 w-3/5 rounded-2xl" />
          </div>
        ) : list.length === 0 ? (
          <p className="pt-10 text-sm text-muted-foreground">
            Start with a question about the item — condition, pickup, or whether the price is
            flexible.
          </p>
        ) : (
          list.map((m, i) => {
            const prev = list[i - 1];
            const newDay = !prev || !sameDay(prev.createdAt, m.createdAt);
            const tight =
              !newDay &&
              prev!.senderId === m.senderId &&
              Date.parse(m.createdAt) - Date.parse(prev!.createdAt) < GROUP_MS;
            const mine = m.senderId === me;
            const lastMine = mine && !list.slice(i + 1).some((n) => n.senderId === me);
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <p className="mb-1 mt-5 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {dayLabel(m.createdAt)}
                  </p>
                )}
                <Bubble
                  m={m}
                  mine={mine}
                  tight={tight}
                  onRetry={() =>
                    void submit({ body: m.body ?? undefined, attachments: m.attachments }, m.id)
                  }
                />
                {lastMine && !m.status && (
                  <p className="mt-0.5 text-right text-[11px] text-muted-foreground">
                    {m.isRead ? 'Seen' : 'Sent'}
                  </p>
                )}
                {lastMine && m.status === 'sending' && (
                  <p className="mt-0.5 text-right text-[11px] text-muted-foreground">Sending…</p>
                )}
              </Fragment>
            );
          })
        )}
        {typing && (
          <div className="mt-3 flex" aria-label="Typing">
            <span className="flex gap-1 rounded-2xl rounded-bl-md border bg-card px-3 py-3 shadow-card">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70"
                  style={{ animationDelay: `${d}ms` }}
                />
              ))}
            </span>
          </div>
        )}
      </div>

      <Composer
        conversationId={id}
        disabled={!conversation.data}
        onSend={(draft) => submit(draft)}
      />
    </section>
  );
}
