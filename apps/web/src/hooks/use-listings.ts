'use client';

import type {
  CategoryNodeDto,
  CursorPage,
  FavoriteStateDto,
  ListingCardDto,
  ListingDetailDto,
} from '@markethub/shared';
import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/stores/auth';

export type ListingParams = Record<string, string | number | boolean | undefined>;

export const toQueryString = (params: ListingParams) => {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '' && v !== false) qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
};

export function useCategories(initialData?: CategoryNodeDto[]) {
  return useQuery({
    queryKey: ['categories'],
    queryFn: () => api<CategoryNodeDto[]>('/categories'),
    staleTime: 5 * 60_000,
    initialData,
  });
}

/**
 * Listing search with infinite cursor paging. The auth status is part of the
 * key so cards refetch with isFavorited once the session is known.
 */
export function useListingSearch(params: ListingParams, opts: { enabled?: boolean } = {}) {
  const status = useAuth((s) => s.status);
  return useInfiniteQuery({
    queryKey: ['listings', 'search', params, status === 'authenticated'],
    queryFn: ({ pageParam }) =>
      api<CursorPage<ListingCardDto>>(
        `/listings${toQueryString({ ...params, cursor: pageParam })}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: status !== 'unknown' && opts.enabled !== false,
  });
}

export function useListing(slug: string, initialData?: ListingDetailDto | null) {
  const status = useAuth((s) => s.status);
  return useQuery({
    queryKey: ['listing', slug, status === 'authenticated'],
    queryFn: () => api<ListingDetailDto>(`/listings/${encodeURIComponent(slug)}`),
    enabled: status !== 'unknown',
    // The server render is anonymous; use it until the personalised copy lands.
    placeholderData: initialData ?? undefined,
  });
}

/** Applies `patch` to every cached copy of a listing: search pages, lists and detail. */
export function patchListingEverywhere(
  qc: QueryClient,
  id: string,
  patch: Partial<ListingCardDto>,
) {
  qc.setQueriesData<InfiniteData<CursorPage<ListingCardDto>>>({ queryKey: ['listings'] }, (data) =>
    data?.pages
      ? {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            items: p.items.map((l) => (l.id === id ? { ...l, ...patch } : l)),
          })),
        }
      : data,
  );
  qc.setQueriesData<ListingDetailDto>({ queryKey: ['listing'] }, (l) =>
    l && l.id === id ? { ...l, ...patch } : l,
  );
}

/** §6: optimistic favourite with rollback. Anonymous users are sent to log in. */
export function useToggleFavorite() {
  const qc = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean; count: number }) =>
      api<FavoriteStateDto>(`/listings/${id}/favorite`, { method: on ? 'POST' : 'DELETE' }),
    onMutate: ({ id, on, count }) => {
      if (useAuth.getState().status !== 'authenticated') {
        router.push(`/login?next=${encodeURIComponent(location.pathname)}`);
        throw new Error('anonymous');
      }
      patchListingEverywhere(qc, id, {
        isFavorited: on,
        favoritesCount: Math.max(0, count + (on ? 1 : -1)),
      });
      return { id, on, count };
    },
    onSuccess: (state, { id }) =>
      patchListingEverywhere(qc, id, {
        isFavorited: state.favorited,
        favoritesCount: state.favoritesCount,
      }),
    onError: (err, { id, on, count }) => {
      if (err instanceof Error && err.message === 'anonymous') return;
      patchListingEverywhere(qc, id, { isFavorited: !on, favoritesCount: count });
      toast.error(err instanceof ApiError ? err.message : "Couldn't save that — try again");
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['listings', 'favorites'] }),
  });
}

type OwnerAction = 'publish' | 'sold' | 'boost' | 'delete';

/** Seller-side actions on one listing; refreshes every list that might show it. */
export function useListingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: OwnerAction }): Promise<unknown> => {
      switch (action) {
        case 'publish':
          return api<ListingDetailDto>(`/listings/${id}/publish`, { method: 'POST' });
        case 'boost':
          return api<ListingDetailDto>(`/listings/${id}/boost`, {
            method: 'POST',
            body: { days: 7 },
          });
        case 'sold':
          return api<ListingDetailDto>(`/listings/${id}`, {
            method: 'PATCH',
            body: { status: 'sold' },
          });
        case 'delete':
          return api<void>(`/listings/${id}`, { method: 'DELETE' });
      }
    },
    onSuccess: (_, { action }) => {
      toast.success(
        {
          publish: 'Your listing is live',
          sold: 'Marked as sold',
          boost: 'Boosted for 7 days',
          delete: 'Listing deleted',
        }[action],
      );
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Something went wrong — try again'),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['listings'] });
      void qc.invalidateQueries({ queryKey: ['listing'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}
