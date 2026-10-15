'use client';

import type {
  BankDto,
  CancelOrderInput,
  ConversationDto,
  CounterOfferInput,
  CreateOfferInput,
  CreateOrderInput,
  CursorPage,
  NotificationDto,
  OfferDto,
  OfferListItemDto,
  OrderAction,
  OrderDto,
  OrderListItemDto,
  PaymentSessionDto,
  PayoutAccountDto,
  PaystackPayoutInput,
  ShipOrderInput,
} from '@markethub/shared';
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';

export const dealKeys = {
  all: ['deals'] as const,
  threadOffers: (conversationId: string) => ['deals', 'thread-offers', conversationId] as const,
  offers: (role: string) => ['deals', 'offers', role] as const,
  orders: (role: string) => ['deals', 'orders', role] as const,
  order: (id: string) => ['deals', 'order', id] as const,
  notifications: ['notifications'] as const,
};

type NotificationPages = InfiniteData<CursorPage<NotificationDto> & { unread: number }>;

/** Which side of this conversation pays: on a "Wanted" post it's the poster. */
export const isBuyerIn = (c: Pick<ConversationDto, 'role' | 'listing'>) =>
  c.listing.type === 'request' ? c.role === 'seller' : c.role === 'buyer';

// ─── Offers ──────────────────────────────────────────────────────────────

/** Every offer in one thread, keyed by id, so offer messages can render their card. */
export function useThreadOffers(conversationId: string) {
  const authed = useAuth((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: dealKeys.threadOffers(conversationId),
    queryFn: async () => {
      const page = await api<CursorPage<OfferListItemDto>>(
        `/offers/mine?conversationId=${conversationId}&limit=50`,
      );
      return Object.fromEntries(page.items.map((o) => [o.id, o as OfferDto]));
    },
    enabled: authed,
    staleTime: Infinity, // offer:new / offer:update keep it current
  });
}

/** Socket events and mutation results land here. */
export function applyOffer(qc: QueryClient, offer: OfferDto) {
  qc.setQueryData<Record<string, OfferDto>>(dealKeys.threadOffers(offer.conversationId), (map) =>
    map ? { ...map, [offer.id]: { ...map[offer.id], ...offer } } : map,
  );
  void qc.invalidateQueries({ queryKey: ['deals', 'offers'] });
}

type OfferMutation =
  | { kind: 'create'; input: CreateOfferInput }
  | { kind: 'counter'; id: string; input: CounterOfferInput }
  | { kind: 'accept' | 'withdraw'; id: string }
  | { kind: 'decline'; id: string; message?: string };

export function useOfferAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (m: OfferMutation) =>
      m.kind === 'create'
        ? api<OfferDto>('/offers', { method: 'POST', body: m.input })
        : api<OfferDto>(`/offers/${m.id}/${m.kind}`, {
            method: 'POST',
            body:
              m.kind === 'counter' ? m.input : m.kind === 'decline' ? { message: m.message } : {},
          }),
    onSuccess: (offer) => applyOffer(qc, offer),
  });
}

export function useMyOffers(role: 'sent' | 'received') {
  const authed = useAuth((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: dealKeys.offers(role),
    queryFn: () =>
      api<CursorPage<OfferListItemDto>>(`/offers/mine?role=${role}&status=pending&limit=20`),
    enabled: authed,
  });
}

// ─── Orders ──────────────────────────────────────────────────────────────

export function useOrders(role: 'buying' | 'selling') {
  const authed = useAuth((s) => s.status === 'authenticated');
  return useInfiniteQuery({
    queryKey: dealKeys.orders(role),
    queryFn: ({ pageParam }) =>
      api<CursorPage<OrderListItemDto>>(
        `/orders?role=${role}&limit=20${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed,
  });
}

/** `poll` while a payment is being confirmed by the gateway's webhook. */
export function useOrder(id: string, { poll = false } = {}) {
  const authed = useAuth((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: dealKeys.order(id),
    queryFn: () => api<OrderDto>(`/orders/${id}`),
    enabled: authed,
    refetchInterval: poll ? 2_000 : false,
  });
}

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOrderInput) =>
      api<OrderDto>('/orders', { method: 'POST', body: input }),
    onSuccess: (order) => {
      qc.setQueryData(dealKeys.order(order.id), order);
      void qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useOrderAction(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      action,
      body = {},
    }: {
      action: OrderAction;
      body?: ShipOrderInput | CancelOrderInput;
    }) => api<OrderDto>(`/orders/${id}/${action}`, { method: 'POST', body }),
    onSuccess: (order) => {
      qc.setQueryData(dealKeys.order(id), order);
      void qc.invalidateQueries({ queryKey: ['deals', 'orders'] });
    },
  });
}

// ─── Notifications ───────────────────────────────────────────────────────

export function useNotifications() {
  const authed = useAuth((s) => s.status === 'authenticated');
  return useInfiniteQuery({
    queryKey: dealKeys.notifications,
    queryFn: ({ pageParam }) =>
      api<CursorPage<NotificationDto> & { unread: number }>(
        `/notifications?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed,
    staleTime: 5 * 60_000, // notification:new keeps it fresh
  });
}

export const unreadNotifications = (data: NotificationPages | undefined) =>
  data?.pages[0]?.unread ?? 0;

export function prependNotification(qc: QueryClient, n: NotificationDto) {
  qc.setQueryData<NotificationPages>(dealKeys.notifications, (data) => {
    if (!data) return data;
    const [first, ...rest] = data.pages;
    if (first!.items.some((x) => x.id === n.id)) return data;
    return {
      ...data,
      pages: [{ ...first!, items: [n, ...first!.items], unread: first!.unread + 1 }, ...rest],
    };
  });
}

function markLocal(qc: QueryClient, id: string | 'all') {
  qc.setQueryData<NotificationPages>(dealKeys.notifications, (data) => {
    if (!data) return data;
    const wasUnread = data.pages.some((p) => p.items.some((n) => n.id === id && !n.isRead));
    return {
      ...data,
      pages: data.pages.map((p, i) => ({
        ...p,
        items: p.items.map((n) => (id === 'all' || n.id === id ? { ...n, isRead: true } : n)),
        unread: i > 0 ? p.unread : id === 'all' ? 0 : Math.max(0, p.unread - (wasUnread ? 1 : 0)),
      })),
    };
  });
}

/** Optimistic: the dot clears at once; a failure just refetches. */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | 'all') =>
      api(id === 'all' ? '/notifications/read-all' : `/notifications/${id}/read`, {
        method: 'POST',
      }),
    onMutate: (id) => markLocal(qc, id),
    onError: () => void qc.invalidateQueries({ queryKey: dealKeys.notifications }),
  });
}

// ─── Payments & payouts ──────────────────────────────────────────────────

export function useStartPayment(orderId: string) {
  return useMutation({
    mutationFn: () => api<PaymentSessionDto>(`/orders/${orderId}/pay`, { method: 'POST' }),
  });
}

/** Sandbox only: stands in for the gateway's card form. */
export function useSandboxCharge() {
  return useMutation({
    mutationFn: (body: { ref: string; card: string }) =>
      api<{ status: 'pending' | 'succeeded' | 'failed' }>('/payments/sandbox/pay', {
        method: 'POST',
        body,
      }),
  });
}

/** Dispute (buyer) and refund (seller) return no order; refetch it. */
export function useEscrowAction(orderId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, body }: { action: 'dispute' | 'refund'; body: object }) =>
      api(`/orders/${orderId}/${action}`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['deals'] }),
  });
}

export const payoutKeys = {
  accounts: ['payouts', 'accounts'] as const,
  banks: (currency: string) => ['payouts', 'banks', currency] as const,
};

export function usePayoutAccounts() {
  const authed = useAuth((s) => s.status === 'authenticated');
  return useQuery({
    queryKey: payoutKeys.accounts,
    queryFn: () => api<PayoutAccountDto[]>('/me/payout-accounts'),
    enabled: authed,
  });
}

export function useBanks(currency: string | null) {
  return useQuery({
    queryKey: payoutKeys.banks(currency ?? ''),
    queryFn: () => api<BankDto[]>(`/payments/banks?currency=${currency}`),
    enabled: !!currency,
    staleTime: 60 * 60_000,
  });
}

export function useSetupPayouts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      input: { gateway: 'stripe' } | ({ gateway: 'paystack' } & PaystackPayoutInput),
    ) => {
      const { gateway, ...body } = input;
      return api<PayoutAccountDto>(`/me/payout-accounts/${gateway}`, { method: 'POST', body });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: payoutKeys.accounts }),
  });
}
