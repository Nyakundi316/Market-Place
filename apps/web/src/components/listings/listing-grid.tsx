'use client';

import type { CursorPage, ListingCardDto } from '@markethub/shared';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { SearchX } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ListingCard } from './listing-card';

const GRID = 'grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 lg:gap-x-5 lg:gap-y-9 xl:grid-cols-4';

export function ListingGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className={GRID} aria-busy aria-label="Loading listings">
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[4/3] rounded-md" />
          <Skeleton className="mt-2.5 h-4 w-1/2" />
          <Skeleton className="mt-1.5 h-3.5 w-5/6" />
          <Skeleton className="mt-1.5 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

/** Renders an infinite listing query; loads the next page when the sentinel scrolls into view. */
export function ListingGrid({
  query,
  empty,
  showStatus,
  lead = false,
}: {
  query: UseInfiniteQueryResult<InfiniteData<CursorPage<ListingCardDto>>>;
  empty?: React.ReactNode;
  showStatus?: boolean;
  /** first listing gets a 2×2 tile — for curated feeds, not for search results */
  lead?: boolean;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, isPending, isError, refetch } =
    query;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver(
      ([entry]) => entry?.isIntersecting && !isFetchingNextPage && void fetchNextPage(),
      { rootMargin: '600px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isPending) return <ListingGridSkeleton />;
  if (isError) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-sm">
        <p>We couldn&apos;t load listings.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const items = data.pages.flatMap((p) => p.items);
  if (!items.length) {
    return (
      empty ?? (
        <div className="flex items-start gap-4 rounded-lg border border-dashed p-6">
          <SearchX className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
          <div>
            <p className="font-medium">No listings match</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Try a wider area, fewer filters, or a different word.
            </p>
          </div>
        </div>
      )
    );
  }

  return (
    <>
      <div className={GRID}>
        {items.map((l, i) => (
          <ListingCard
            key={l.id}
            listing={l}
            priority={i < 4}
            showStatus={showStatus}
            lead={lead && i === 0}
          />
        ))}
      </div>
      <div ref={sentinel} className={cn('h-10', isFetchingNextPage && 'mt-6')}>
        {isFetchingNextPage && <ListingGridSkeleton count={4} />}
      </div>
    </>
  );
}
