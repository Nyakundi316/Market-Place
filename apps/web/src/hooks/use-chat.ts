'use client';

import type {
  Attachment,
  ConversationDto,
  CursorPage,
  MessageDto,
  ReadReceipt,
  SendMessageInput,
} from '@markethub/shared';
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';

/** A message as the UI holds it: server copy, or an optimistic one in flight. */
export type ChatMessage = MessageDto & { status?: 'sending' | 'failed' };

type Pages<T> = InfiniteData<CursorPage<T>>;

export const chatKeys = {
  list: ['chat', 'conversations'] as const,
  one: (id: string) => ['chat', 'conversation', id] as const,
  messages: (id: string) => ['chat', 'messages', id] as const,
};

// ─── Queries ─────────────────────────────────────────────────────────────

export function useConversations() {
  const authed = useAuth((s) => s.status === 'authenticated');
  return useInfiniteQuery({
    queryKey: chatKeys.list,
    queryFn: ({ pageParam }) =>
      api<CursorPage<ConversationDto>>(
        `/conversations?limit=30${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed,
    staleTime: 60_000, // the socket keeps it fresh
  });
}

export function useConversation(id: string) {
  const qc = useQueryClient();
  const authed = useAuth((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: chatKeys.one(id),
    queryFn: () => api<ConversationDto>(`/conversations/${id}`),
    enabled: authed,
    // Opening from the inbox shouldn't flash a skeleton.
    placeholderData: () =>
      qc
        .getQueryData<Pages<ConversationDto>>(chatKeys.list)
        ?.pages.flatMap((p) => p.items)
        .find((c) => c.id === id),
  });
}

/** Pages are newest-first; the thread renders them in a column-reverse list. */
export function useMessages(id: string) {
  const authed = useAuth((s) => s.status === 'authenticated');
  return useInfiniteQuery({
    queryKey: chatKeys.messages(id),
    queryFn: ({ pageParam }) =>
      api<CursorPage<ChatMessage>>(
        `/conversations/${id}/messages?limit=40${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed,
    staleTime: Infinity, // live updates come over the socket; reconnects invalidate
  });
}

// ─── Cache updates (socket events + optimistic sends) ────────────────────

/** Inserts or replaces a message at the newest end of its thread. */
export function upsertMessage(qc: QueryClient, msg: ChatMessage, replaceId?: string) {
  qc.setQueryData<Pages<ChatMessage>>(chatKeys.messages(msg.conversationId), (data) => {
    if (!data) return data;
    const drop = (m: ChatMessage) => m.id !== msg.id && m.id !== replaceId;
    const [first, ...rest] = data.pages;
    return {
      ...data,
      pages: [
        { ...first!, items: [msg, ...first!.items.filter(drop)] },
        ...rest.map((p) => ({ ...p, items: p.items.filter(drop) })),
      ],
    };
  });
}

export function patchMessage(
  qc: QueryClient,
  conversationId: string,
  id: string,
  patch: Partial<ChatMessage>,
) {
  qc.setQueryData<Pages<ChatMessage>>(chatKeys.messages(conversationId), (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((m) => (m.id === id ? { ...m, ...patch } : m)),
          })),
        }
      : data,
  );
}

function patchConversation(
  qc: QueryClient,
  id: string,
  fn: (c: ConversationDto) => ConversationDto,
) {
  qc.setQueryData<ConversationDto>(chatKeys.one(id), (c) => (c ? fn(c) : c));
  qc.setQueryData<Pages<ConversationDto>>(chatKeys.list, (data) =>
    data
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((c) => (c.id === id ? fn(c) : c)),
          })),
        }
      : data,
  );
}

/** Moves the conversation to the top with its new preview; unknown ones trigger a refetch. */
export function bumpConversation(qc: QueryClient, msg: MessageDto, countUnread: boolean) {
  const list = qc.getQueryData<Pages<ConversationDto>>(chatKeys.list);
  const known = list?.pages.some((p) => p.items.some((c) => c.id === msg.conversationId));
  const apply = (c: ConversationDto): ConversationDto => ({
    ...c,
    lastMessage: msg,
    lastMessageAt: msg.createdAt,
    unread: countUnread ? c.unread + 1 : c.unread,
  });
  qc.setQueryData<ConversationDto>(chatKeys.one(msg.conversationId), (c) => (c ? apply(c) : c));
  if (!list) return;
  if (!known) {
    void qc.invalidateQueries({ queryKey: chatKeys.list });
    return;
  }
  const all = list.pages.flatMap((p) => p.items);
  const moved = apply(all.find((c) => c.id === msg.conversationId)!);
  qc.setQueryData<Pages<ConversationDto>>(chatKeys.list, {
    ...list,
    pages: list.pages.map((p, i) => ({
      ...p,
      items: [...(i === 0 ? [moved] : []), ...p.items.filter((c) => c.id !== msg.conversationId)],
    })),
  });
}

/** Their receipt ticks my messages; my own (another tab) clears my badge. */
export function applyReceipt(qc: QueryClient, r: ReadReceipt, myId: string) {
  if (r.byUser === myId) {
    patchConversation(qc, r.conversationId, (c) => ({ ...c, unread: 0 }));
    return;
  }
  qc.setQueryData<Pages<ChatMessage>>(chatKeys.messages(r.conversationId), (data) => {
    if (!data) return data;
    const all = data.pages.flatMap((p) => p.items);
    const until = all.find((m) => m.id === r.upTo)?.createdAt ?? r.readAt;
    return {
      ...data,
      pages: data.pages.map((p) => ({
        ...p,
        items: p.items.map((m) =>
          m.senderId === myId && !m.isRead && !m.status && m.createdAt <= until
            ? { ...m, isRead: true, readAt: r.readAt }
            : m,
        ),
      })),
    };
  });
}

export function applyPresence(qc: QueryClient, userId: string, online: boolean) {
  const fn = (c: ConversationDto) =>
    c.counterpart.userId === userId ? { ...c, counterpart: { ...c.counterpart, online } } : c;
  qc.setQueriesData<ConversationDto>({ queryKey: ['chat', 'conversation'] }, (c) =>
    c ? fn(c) : c,
  );
  qc.setQueryData<Pages<ConversationDto>>(chatKeys.list, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map(fn) })) } : data,
  );
}

// ─── Actions ─────────────────────────────────────────────────────────────

/**
 * Optimistic send: the bubble appears at once, then is swapped for the server
 * copy. Socket first (with ack), REST when the socket is down.
 */
export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  const me = useAuth((s) => s.user?.id);

  const deliver = useCallback(async (input: SendMessageInput): Promise<MessageDto> => {
    const socket = getSocket();
    if (!socket.connected) return api<MessageDto>('/messages', { method: 'POST', body: input });
    const ack = await socket.timeout(10_000).emitWithAck('message:send', input);
    if (!ack.ok) throw new ApiError(ack.retryAfterMs ? 429 : 400, ack.error);
    return ack.data;
  }, []);

  return useCallback(
    async (draft: { body?: string; attachments?: Attachment[] }, retryOf?: string) => {
      if (!me) return;
      const attachments = draft.attachments ?? [];
      const input: SendMessageInput = {
        conversationId,
        type: attachments.length ? 'image' : 'text',
        body: draft.body?.trim() || undefined,
        attachments,
      };
      const tempId = retryOf ?? `tmp-${crypto.randomUUID()}`;
      const optimistic: ChatMessage = {
        id: tempId,
        conversationId,
        senderId: me,
        type: input.type,
        body: input.body ?? null,
        attachments,
        offerId: null,
        isRead: false,
        readAt: null,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      upsertMessage(qc, optimistic, tempId);
      try {
        const saved = await deliver(input);
        upsertMessage(qc, saved, tempId);
        bumpConversation(qc, saved, false);
      } catch (err) {
        patchMessage(qc, conversationId, tempId, { status: 'failed' });
        throw err;
      }
    },
    [conversationId, deliver, me, qc],
  );
}

/** Clears my unread for a thread; the server broadcasts the receipt to the other side. */
export async function markRead(qc: QueryClient, conversationId: string) {
  patchConversation(qc, conversationId, (c) => ({ ...c, unread: 0 }));
  const socket = getSocket();
  if (socket.connected) socket.emit('message:read', { conversationId });
  else
    await api(`/conversations/${conversationId}/read`, { method: 'POST', body: {} }).catch(
      () => undefined,
    );
}

export function useTotalUnread() {
  const { data } = useConversations();
  return data?.pages.reduce((n, p) => n + p.items.reduce((m, c) => m + c.unread, 0), 0) ?? 0;
}

export const useIsConnected = () => useChatStore((s) => s.connected);
