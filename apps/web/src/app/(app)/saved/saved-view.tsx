'use client';

import type { CursorPage, ListingCardDto } from '@markethub/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { ListingGrid } from '@/components/listings/listing-grid';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { api } from '@/lib/api';

export function SavedView() {
  const ready = useRequireAuth();
  const query = useInfiniteQuery({
    queryKey: ['listings', 'favorites'],
    queryFn: ({ pageParam }) =>
      api<CursorPage<ListingCardDto>>(
        `/listings/favorites?limit=24${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    enabled: ready,
  });

  return (
    <div className="animate-rise-in">
      <h1 className="text-2xl font-semibold tracking-tight">Saved</h1>
      <p className="mt-1 text-sm text-muted-foreground">Listings you&apos;ve hearted.</p>
      <div className="mt-6">
        <ListingGrid
          query={query}
          empty={
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Heart className="size-4" aria-hidden /> Tap the heart on any listing to keep it here.
            </p>
          }
        />
      </div>
    </div>
  );
}
