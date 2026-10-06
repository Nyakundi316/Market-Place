import { PackageOpen } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Discover' };

export default function FeedPage() {
  return (
    <div className="animate-rise-in">
      <h1 className="text-2xl font-semibold tracking-tight lg:text-3xl">Discover</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Fresh listings from verified sellers near you.
      </p>

      {/* Empty marketplace state — listings land in the next phase. */}
      <section className="mt-10 grid gap-6 rounded-xl border border-dashed bg-card p-6 sm:grid-cols-[auto_1fr] sm:items-center lg:mt-14 lg:max-w-2xl lg:p-8">
        <span className="grid size-14 place-items-center rounded-full bg-secondary text-primary">
          <PackageOpen className="size-7" strokeWidth={1.5} />
        </span>
        <div>
          <h2 className="font-semibold">Nothing listed yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Be the first — post a product or service and buyers can chat and pay you through escrow.
          </p>
          <Button asChild className="mt-4">
            <Link href="/create">Post a listing</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
