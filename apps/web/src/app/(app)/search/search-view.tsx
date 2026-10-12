'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ListingBrowser } from '@/components/listings/listing-browser';
import { useFilterParams } from '@/components/listings/listing-filters';

export function SearchView() {
  const { filters, setFilters } = useFilterParams();
  const [text, setText] = useState(filters.q ?? '');
  const input = useRef<HTMLInputElement>(null);

  // Typing settles for 350ms before it becomes ?q= (and a request).
  useEffect(() => {
    const t = setTimeout(() => {
      if ((filters.q ?? '') !== text.trim()) {
        // A new query means relevance again, unless the user chose a sort.
        setFilters({ ...filters, q: text.trim(), sort: text.trim() ? filters.sort : undefined });
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [text]);

  useEffect(() => {
    if (!filters.q) input.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- focus on first render only
  }, []);

  return (
    <div>
      <h1 className="sr-only">Search listings</h1>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setFilters({ ...filters, q: text.trim() });
          input.current?.blur();
        }}
        className="relative lg:max-w-xl"
      >
        <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          aria-label="Search listings"
          placeholder="What are you looking for?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={100}
          className="h-12 w-full rounded-lg border bg-card pl-10 pr-10 text-base shadow-card outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden"
        />
        {text && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setText('');
              input.current?.focus();
            }}
            className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        )}
      </form>

      <ListingBrowser
        toolbar={
          filters.q ? (
            <p className="mr-2 truncate text-sm text-muted-foreground">
              Results for <span className="font-medium text-foreground">“{filters.q}”</span>
            </p>
          ) : null
        }
      />
    </div>
  );
}
