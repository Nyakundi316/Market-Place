'use client';

import { useListingSearch } from '@/hooks/use-listings';
import { ListingFilters, SortSelect, useFilterParams } from './listing-filters';
import { ListingGrid } from './listing-grid';

/** Filters column + results. `fixed` params (e.g. categoryId) aren't user-editable here. */
export function ListingBrowser({
  fixed = {},
  toolbar,
}: {
  fixed?: Record<string, string>;
  toolbar?: React.ReactNode;
}) {
  const { apiParams } = useFilterParams();
  const query = useListingSearch({ ...apiParams, ...fixed });

  return (
    <div className="mt-6 lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
      <ListingFilters variant="sidebar" />
      <div>
        <div className="mb-4 flex items-center gap-2">
          {toolbar}
          <ListingFilters variant="sheet" />
          <div className="ml-auto">
            <SortSelect />
          </div>
        </div>
        <ListingGrid query={query} />
      </div>
    </div>
  );
}
