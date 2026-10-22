import type { CategoryNodeDto } from '@markethub/shared';
import type { Metadata } from 'next';
import { CategoryChips } from '@/components/listings/category-chips';
import { serverGet } from '@/lib/server-api';
import { FeedListings } from './feed-listings';

export const metadata: Metadata = { title: 'Discover' };

export default async function FeedPage() {
  const categories = (await serverGet<CategoryNodeDto[]>('/categories', 300)) ?? [];
  return (
    <div>
      <header className="grid gap-x-12 gap-y-3 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-end">
        <div className="animate-rise-in">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Discover
          </p>
          <h1 className="text-balance mt-2 max-w-xl font-display text-[2rem] font-medium leading-[1.05] tracking-tight sm:text-4xl lg:text-[3.25rem]">
            Fresh from sellers near you.
          </h1>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground lg:border-l lg:pb-1.5 lg:pl-5">
          Chat with the seller, agree a price, and pay through escrow. Sellers are paid only after
          you confirm delivery.
        </p>
      </header>

      <div className="mt-6 lg:mt-8">
        <CategoryChips categories={categories} />
      </div>

      <FeedListings />
    </div>
  );
}
