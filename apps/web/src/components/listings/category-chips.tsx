'use client';

import type { CategoryDto } from '@markethub/shared';
import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * A ruled, newspaper-style section rail. It never wraps: it scrolls sideways
 * and fades out at the right edge so the overflow reads as "more", not as cut off.
 * On mobile it bleeds to the screen edge.
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
  const tab = (active: boolean) =>
    cn(
      'relative block whitespace-nowrap py-3 text-sm transition-colors',
      active
        ? 'font-medium text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground'
        : 'text-muted-foreground hover:text-foreground',
    );
  return (
    <nav aria-label="Categories" className="-mx-4 border-y lg:mx-0">
      <ul className="flex gap-6 overflow-x-auto px-4 [mask-image:linear-gradient(to_right,#000_calc(100%-3rem),transparent)] [scrollbar-width:none] lg:gap-7 lg:px-0">
        {allHref && (
          <li className="shrink-0">
            <Link
              href={allHref}
              className={tab(!activeSlug)}
              aria-current={!activeSlug ? 'page' : undefined}
            >
              {allLabel}
            </Link>
          </li>
        )}
        {categories.map((c) => (
          <li key={c.id} className="shrink-0">
            <Link
              href={`/c/${c.slug}`}
              className={tab(c.slug === activeSlug)}
              aria-current={c.slug === activeSlug ? 'page' : undefined}
            >
              {c.name}
            </Link>
          </li>
        ))}
        {/* Room for the last tab to scroll clear of the fade. */}
        <li aria-hidden className="w-6 shrink-0" />
      </ul>
    </nav>
  );
}
