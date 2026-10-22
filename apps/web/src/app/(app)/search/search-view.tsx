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
        className="relative lg:max-w-2xl"
      >
        <Search
          className="pointer-events-none absolute left-0 top-1/2 size-5 -translate-y-1/2 text-muted-foreground lg:size-6"
          aria-hidden
        />
        {/* The query is the page's headline: serif on a rule, no box. Focus thickens the rule. */}
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          aria-label="Search listings"
          placeholder="What are you looking for?"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={100}
          className="h-14 w-full rounded-none border-b-2 border-foreground bg-transparent pl-8 pr-10 font-display text-xl outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:shadow-[0_2px_0_hsl(var(--primary))] focus-visible:ring-0 focus-visible:ring-offset-0 sm:text-2xl lg:h-16 lg:pl-10 lg:text-4xl [&::-webkit-search-cancel-button]:hidden"
        />
        {text && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setText('');
              input.current?.focus();
            }}
            className="absolute right-0 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        )}
      </form>

      <ListingBrowser
        toolbar={
          filters.q ? (
            // On a phone the query above already says it, and this would truncate to "Result…".
            <p className="mr-2 truncate text-sm text-muted-foreground max-sm:hidden">
              Results for <span className="font-medium text-foreground">“{filters.q}”</span>
            </p>
          ) : null
        }
      />
    </div>
  );
}
