'use client';

import { CURRENCIES, LISTING_SORTS, LISTING_TYPES } from '@markethub/shared';
import { SlidersHorizontal, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { ListingParams } from '@/hooks/use-listings';
import { countryOptions } from '@/lib/countries';
import { TYPE_LABEL } from '@/lib/format';
import { cn } from '@/lib/utils';

const FILTER_KEYS = [
  'q',
  'type',
  'minPrice',
  'maxPrice',
  'country',
  'city',
  'rating',
  'verified',
  'sort',
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];
type Filters = Partial<Record<FilterKey, string>>;

const SORT_LABEL: Record<string, string> = {
  relevance: 'Best match',
  newest: 'Newest',
  price_asc: 'Price: low to high',
  price_desc: 'Price: high to low',
};

/** Filters live in the URL, so a search can be shared or bookmarked. */
export function useFilterParams() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo(() => {
    const out: Filters = {};
    for (const k of FILTER_KEYS) {
      const v = search.get(k);
      if (v) out[k] = v;
    }
    return out;
  }, [search]);

  const apiParams: ListingParams = { ...filters, limit: 24 };

  const setFilters = (next: Filters) => {
    const qs = new URLSearchParams();
    for (const k of FILTER_KEYS) if (next[k]) qs.set(k, next[k]!);
    router.replace(`${pathname}${qs.size ? `?${qs}` : ''}`, { scroll: false });
  };

  return { filters, apiParams, setFilters };
}

function FilterFields({ draft, set }: { draft: Filters; set: (k: FilterKey, v: string) => void }) {
  const countries = useMemo(countryOptions, []);
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-sm font-medium">Type</legend>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['', ...LISTING_TYPES].map((t) => (
            <button
              key={t || 'any'}
              type="button"
              aria-pressed={(draft.type ?? '') === t}
              onClick={() => set('type', t)}
              className={cn(
                'rounded-full border px-3 py-1 text-sm',
                (draft.type ?? '') === t
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'hover:border-foreground/30',
              )}
            >
              {t ? TYPE_LABEL[t] : 'Any'}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <span className="text-sm font-medium" id="price-label">
          Price
        </span>
        <div
          className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2"
          aria-labelledby="price-label"
        >
          <Input
            aria-label="Minimum price"
            inputMode="decimal"
            placeholder="Min"
            value={draft.minPrice ?? ''}
            onChange={(e) => set('minPrice', e.target.value.replace(/[^\d.]/g, ''))}
          />
          <span className="text-muted-foreground">–</span>
          <Input
            aria-label="Maximum price"
            inputMode="decimal"
            placeholder="Max"
            value={draft.maxPrice ?? ''}
            onChange={(e) => set('maxPrice', e.target.value.replace(/[^\d.]/g, ''))}
          />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          In the listing&apos;s own currency ({CURRENCIES.slice(0, 3).join(', ')}…)
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <div className="space-y-1.5">
          <Label htmlFor="f-country">Country</Label>
          <NativeSelect
            id="f-country"
            value={draft.country ?? ''}
            onChange={(e) => set('country', e.target.value)}
          >
            <option value="">Anywhere</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="f-city">City</Label>
          <Input
            id="f-city"
            value={draft.city ?? ''}
            onChange={(e) => set('city', e.target.value)}
          />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Seller</legend>
        <label className="mt-2 flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[hsl(var(--primary))]"
            checked={draft.verified === 'true'}
            onChange={(e) => set('verified', e.target.checked ? 'true' : '')}
          />
          Verified sellers only
        </label>
        <label className="mt-2 flex items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[hsl(var(--primary))]"
            checked={draft.rating === '4'}
            onChange={(e) => set('rating', e.target.checked ? '4' : '')}
          />
          Rated 4★ and up
        </label>
      </fieldset>
    </div>
  );
}

export function SortSelect() {
  const { filters, setFilters } = useFilterParams();
  const sorts = LISTING_SORTS.filter((s) => s !== 'relevance' || filters.q);
  return (
    <NativeSelect
      aria-label="Sort by"
      className="h-9 w-auto min-w-40"
      value={filters.sort ?? (filters.q ? 'relevance' : 'newest')}
      onChange={(e) => setFilters({ ...filters, sort: e.target.value })}
    >
      {sorts.map((s) => (
        <option key={s} value={s}>
          {SORT_LABEL[s]}
        </option>
      ))}
    </NativeSelect>
  );
}

/**
 * Desktop: an always-visible column that applies as you go.
 * Mobile: a bottom sheet with an explicit "Show results", so the grid
 * doesn't refetch behind the sheet on every keystroke.
 */
export function ListingFilters({ variant }: { variant: 'sidebar' | 'sheet' }) {
  const { filters, setFilters } = useFilterParams();
  const [draft, setDraft] = useState<Filters>(filters);
  const [open, setOpen] = useState(false);
  const active = FILTER_KEYS.filter((k) => k !== 'q' && k !== 'sort' && filters[k]).length;

  // Sidebar: URL → draft when something else (search box, Clear) changes the URL...
  useEffect(() => {
    if (variant === 'sidebar') setDraft(filters);
  }, [filters, variant]);
  // ...and draft → URL after typing settles, so price/city don't refetch per keystroke.
  useEffect(() => {
    if (variant !== 'sidebar') return;
    const t = setTimeout(() => {
      if (FILTER_KEYS.some((k) => (draft[k] ?? '') !== (filters[k] ?? ''))) setFilters(draft);
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to edits
  }, [draft]);

  if (variant === 'sidebar') {
    return (
      <aside aria-label="Filters" className="hidden lg:block">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Filters</h2>
          {active > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setFilters({ q: filters.q, sort: filters.sort })}
            >
              Clear
            </button>
          )}
        </div>
        <div className="mt-4">
          <FilterFields draft={draft} set={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} />
        </div>
      </aside>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) setDraft(filters);
        setOpen(o);
      }}
    >
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 lg:hidden">
          <SlidersHorizontal className="size-4" />
          Filters
          {active > 0 && (
            <span className="grid size-5 place-items-center rounded-full bg-primary text-[11px] text-primary-foreground">
              {active}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl">
        <SheetHeader className="text-left">
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription className="sr-only">Narrow down listings</SheetDescription>
        </SheetHeader>
        <div className="mt-5">
          <FilterFields draft={draft} set={(k, v) => setDraft((d) => ({ ...d, [k]: v }))} />
        </div>
        <div className="sticky bottom-0 -mx-6 mt-6 flex gap-2 border-t bg-background px-6 py-3">
          <Button
            variant="ghost"
            onClick={() => setDraft({ q: filters.q, sort: filters.sort })}
            className="gap-1"
          >
            <X className="size-4" /> Reset
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              setFilters(draft);
              setOpen(false);
            }}
          >
            Show results
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
