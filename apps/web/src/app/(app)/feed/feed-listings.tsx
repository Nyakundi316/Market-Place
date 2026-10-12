'use client';

import { PackageOpen } from 'lucide-react';
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
            className="text-sm font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Featured
          </h2>
          {/* A scroll strip rather than a second grid: featured is a taste, not a page. */}
          <div className="-mx-4 mt-3 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] lg:mx-0 lg:px-0">
            {boosted.map((l) => (
              <div key={l.id} className="w-40 shrink-0 snap-start sm:w-48">
                <ListingCard listing={l} />
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="fresh-heading" className="mt-8 lg:mt-10">
        <h2 id="fresh-heading" className="mb-4 text-lg font-semibold">
          Just listed
        </h2>
        <ListingGrid
          query={fresh}
          empty={
            <div className="grid gap-6 rounded-xl border border-dashed bg-card p-6 sm:grid-cols-[auto_1fr] sm:items-center lg:max-w-2xl lg:p-8">
              <span className="grid size-14 place-items-center rounded-full bg-secondary text-primary">
                <PackageOpen className="size-7" strokeWidth={1.5} />
              </span>
              <div>
                <h3 className="font-semibold">Nothing listed yet</h3>
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
