'use client';

import type { CategoryDto } from '@markethub/shared';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Horizontal, scrollable chip row. Mobile lets it bleed to the screen edge
 * (negative margin) so it reads as scrollable rather than cut off.
 */
export function CategoryChips({
  categories,
  activeSlug,
  allHref,
  allLabel = 'All',
}: {
  categories: Pick<CategoryDto, 'id' | 'name' | 'slug'>[];
  activeSlug?: string;
  allHref?: string;
  allLabel?: string;
}) {
  const chip = (active: boolean) =>
    cn(
      'shrink-0 snap-start rounded-full border px-3.5 py-1.5 text-sm transition-colors',
      active
        ? 'border-foreground bg-foreground text-background'
        : 'bg-card hover:border-foreground/40',
    );
  return (
    <nav aria-label="Categories" className="-mx-4 lg:mx-0">
      <ul className="flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:flex-wrap lg:px-0">
        {allHref && (
          <li>
            <Link
              href={allHref}
              className={chip(!activeSlug)}
              aria-current={!activeSlug ? 'page' : undefined}
            >
              {allLabel}
            </Link>
          </li>
        )}
        {categories.map((c) => (
          <li key={c.id}>
            <Link
              href={`/c/${c.slug}`}
              className={chip(c.slug === activeSlug)}
              aria-current={c.slug === activeSlug ? 'page' : undefined}
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
