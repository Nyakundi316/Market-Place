'use client';

import { ArrowRight, PackageOpen } from 'lucide-react';
import Link from 'next/link';
import { ListingCard } from '@/components/listings/listing-card';
import { ListingGrid } from '@/components/listings/listing-grid';
import { Button } from '@/components/ui/button';
import { useListingSearch } from '@/hooks/use-listings';

export function FeedListings() {
  const featured = useListingSearch({ featured: true, limit: 8 });
  const fresh = useListingSearch({ sort: 'newest', limit: 24 });
  const boosted = featured.data?.pages[0]?.items ?? [];

  return (
    <>
      {boosted.length > 0 && (
        <section aria-labelledby="featured-heading" className="mt-8">
          <h2
            id="featured-heading"
            className="flex items-center gap-2 font-display text-xl font-medium"
          >
            <span aria-hidden className="size-2 rounded-full bg-saffron" />
            Featured
          </h2>
          {/* A scroll strip rather than a second grid: featured is a taste, not a page. */}
          <div className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] lg:mx-0 lg:gap-4 lg:px-0">
            {boosted.map((l) => (
              <div key={l.id} className="w-44 shrink-0 snap-start sm:w-52">
                <ListingCard listing={l} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="fresh-heading" className="mt-8 lg:mt-12">
        <div className="mb-4 flex items-baseline justify-between gap-4 lg:mb-5">
          <h2 id="fresh-heading" className="font-display text-2xl font-medium lg:text-[1.75rem]">
            Just listed
          </h2>
          <Link
            href="/search?sort=newest"
            className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            See all
            <ArrowRight
              className="size-3.5 transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </div>
        <ListingGrid
          query={fresh}
          lead
          empty={
            <div className="grid gap-6 rounded-xl border border-dashed bg-card p-6 sm:grid-cols-[auto_1fr] sm:items-center lg:max-w-2xl lg:p-8">
              <span className="grid size-14 place-items-center rounded-full bg-secondary text-primary">
                <PackageOpen className="size-7" strokeWidth={1.5} />
              </span>
              <div>
                <h3 className="font-display text-lg font-medium">Nothing listed yet</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Be the first — post a product or service and buyers can chat and pay you through
                  escrow.
                </p>
                <Button asChild className="mt-4">
                  <Link href="/create">Post a listing</Link>
                </Button>
              </div>
            </div>
          }
        />
      </section>
    </>
  );
}
