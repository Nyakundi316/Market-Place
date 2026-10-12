import type { CategoryNodeDto } from '@markethub/shared';
import { Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { CategoryChips } from '@/components/listings/category-chips';
import { serverGet } from '@/lib/server-api';
import { FeedListings } from './feed-listings';

export const metadata: Metadata = { title: 'Discover' };

export default async function FeedPage() {
  const categories = (await serverGet<CategoryNodeDto[]>('/categories', 300)) ?? [];
  return (
    <div className="animate-rise-in">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">Discover</h1>
          <p className="mt-1 text-sm text-muted-foreground">Fresh from sellers near you.</p>
        </div>
      </div>

      <Link
        href="/search"
        className="mt-5 flex h-11 items-center gap-2.5 rounded-lg border bg-card px-3.5 text-sm text-muted-foreground shadow-card transition-colors hover:border-foreground/30 lg:max-w-md"
      >
        <Search className="size-4" aria-hidden />
        Search phones, sofas, plumbers…
      </Link>

      <div className="mt-5">
        <CategoryChips categories={categories} />
      </div>

      <FeedListings />
    </div>
  );
}
