'use client';

import type { ServerToClientEvents } from '@markethub/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';
import {
  applyPresence,
  applyReceipt,
  bumpConversation,
  chatKeys,
  markRead,
  upsertMessage,
} from '@/hooks/use-chat';
import { applyOffer, dealKeys, prependNotification } from '@/hooks/use-deals';
import { disconnectSocket, getSocket } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useChatStore } from '@/stores/chat';

const visible = () => document.visibilityState === 'visible';

/**
 * Keeps one socket open while signed in and folds its events into the React
 * Query cache, so every screen (inbox, thread, nav badge) stays live.
 */
export function RealtimeBridge() {
  const qc = useQueryClient();
  const router = useRouter();
  const userId = useAuth((s) => (s.status === 'authenticated' ? s.user?.id : undefined));

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket();
    const chat = useChatStore.getState();

    const onConnect = () => {
      chat.setConnected(true);
      // Anything could have happened meanwhile.
      void qc.invalidateQueries({ queryKey: ['chat'] });
      void qc.invalidateQueries({ queryKey: dealKeys.all });
      void qc.invalidateQueries({ queryKey: dealKeys.notifications });
    };
    const onDisconnect = () => chat.setConnected(false);
    const on: Partial<ServerToClientEvents> = {
      'message:new': (msg) => {
        const mine = msg.senderId === userId;
        const viewing =
          useChatStore.getState().openConversation === msg.conversationId && visible();
        upsertMessage(qc, msg);
        bumpConversation(qc, msg, !mine && !viewing);
        if (mine) return;
        chat.setTyping(msg.conversationId, false);
        if (viewing) void markRead(qc, msg.conversationId);
      },
      'message:read': (r) => applyReceipt(qc, r, userId),
      typing: ({ conversationId, isTyping, userId: who }) => {
        if (who !== userId) chat.setTyping(conversationId, isTyping);
      },
      'presence:update': ({ userId: who, status }) => applyPresence(qc, who, status === 'online'),
      'conversation:new': () => void qc.invalidateQueries({ queryKey: chatKeys.list }),
      'offer:new': (offer) => applyOffer(qc, offer),
      'offer:update': (offer) => applyOffer(qc, offer),
      'notification:new': (n) => {
        prependNotification(qc, n);
        // Anything that moves an order or its money refreshes the deal screens.
        if (/^(order|payment|payout|dispute)\./.test(n.type)) {
          void qc.invalidateQueries({ queryKey: dealKeys.all });
        }
        // Chat has its own badge and live thread; deal events deserve a nudge.
        if (n.type === 'chat.message' || (n.link && window.location.pathname === n.link)) return;
        toast(n.title, {
          action: n.link ? { label: 'View', onClick: () => router.push(n.link!) } : undefined,
        });
      },
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    for (const [event, fn] of Object.entries(on)) socket.on(event as 'typing', fn as never);
    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      for (const [event, fn] of Object.entries(on)) socket.off(event as 'typing', fn as never);
      disconnectSocket();
      chat.setConnected(false);
    };
  }, [qc, router, userId]);

  return null;
}
