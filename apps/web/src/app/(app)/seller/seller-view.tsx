'use client';

import type { CursorPage, ListingCardDto, ListingStatus } from '@markethub/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Heart, ImageOff, Plus } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { OwnerActions } from '@/components/listings/owner-actions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/hooks/use-me';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { api } from '@/lib/api';
import { formatPrice, timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SellerStats } from './seller-stats';

const TABS: { status: ListingStatus; label: string; empty: string }[] = [
  {
    status: 'active',
    label: 'Live',
    empty: 'Nothing live. Publish a draft or post something new.',
  },
  { status: 'draft', label: 'Drafts', empty: 'No drafts.' },
  { status: 'sold', label: 'Sold', empty: 'Sold listings show up here.' },
  {
    status: 'expired',
    label: 'Expired',
    empty: 'Listings expire after 30 days; republish them from here.',
  },
];

function Row({ l }: { l: ListingCardDto }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <Link
        href={`/l/${l.slug}`}
        className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted"
      >
        {l.coverThumbUrl ? (
          <Image
            src={l.coverThumbUrl}
            alt=""
            fill
            unoptimized
            sizes="64px"
            className="object-cover"
          />
        ) : (
          <ImageOff className="m-auto mt-5 size-5 text-muted-foreground" aria-hidden />
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/l/${l.slug}`} className="line-clamp-1 text-sm font-medium hover:underline">
          {l.title}
        </Link>
        <p className="tabular text-sm">{formatPrice(l)}</p>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Heart className="size-3" aria-hidden /> {l.favoritesCount}
          </span>
          <span>
            {l.status === 'active' ? 'Published' : 'Created'}{' '}
            {timeAgo(l.publishedAt ?? l.createdAt)}
          </span>
          {l.isFeatured && <span className="font-medium text-saffron-foreground">Boosted</span>}
        </p>
      </div>
      <OwnerActions listing={l} layout="menu" />
    </li>
  );
}

export function SellerView() {
  const ready = useRequireAuth();
  const { data: me } = useMe();
  const [tab, setTab] = useState<ListingStatus>('active');
  const q = useInfiniteQuery({
    queryKey: ['listings', 'mine', tab],
    queryFn: ({ pageParam }) =>
      api<CursorPage<ListingCardDto>>(
        `/listings/mine?status=${tab}&limit=20${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    enabled: ready,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const current = TABS.find((t) => t.status === tab)!;

  return (
    <div className="max-w-2xl animate-rise-in">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your listings</h1>
          {me?.profile && (
            <p className="mt-1 text-sm text-muted-foreground">
              {me.profile.listingsCount} live · {me.profile.completedDeals} completed deals
            </p>
          )}
        </div>
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/create">
            <Plus className="size-4" /> New
          </Link>
        </Button>
      </div>

      {ready && <SellerStats />}

      <div
        role="tablist"
        aria-label="Listing status"
        className="-mx-4 mt-6 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none]"
      >
        {TABS.map((t) => (
          <button
            key={t.status}
            role="tab"
            aria-selected={tab === t.status}
            onClick={() => setTab(t.status)}
            className={cn(
              'shrink-0 rounded-full px-3.5 py-1.5 text-sm',
              tab === t.status
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {q.isPending || !ready ? (
        <ul className="mt-2 divide-y">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex gap-3 py-3">
              <Skeleton className="size-16" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-4 w-1/4" />
              </div>
            </li>
          ))}
        </ul>
      ) : items.length ? (
        <ul className="mt-2 divide-y" role="tabpanel">
          {items.map((l) => (
            <Row key={l.id} l={l} />
          ))}
        </ul>
      ) : (
        <p
          className="mt-6 rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
          role="tabpanel"
        >
          {current.empty}
        </p>
      )}
      {q.hasNextPage && (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void q.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  );
}
