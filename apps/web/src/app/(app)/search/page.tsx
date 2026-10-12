import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ListingGridSkeleton } from '@/components/listings/listing-grid';
import { SearchView } from './search-view';

export const metadata: Metadata = { title: 'Search' };

export default function SearchPage() {
  return (
    <Suspense fallback={<ListingGridSkeleton />}>
      <SearchView />
    </Suspense>
  );
}
