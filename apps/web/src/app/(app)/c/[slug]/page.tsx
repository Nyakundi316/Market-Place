import type { CategoryDetailDto } from '@markethub/shared';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CategoryChips } from '@/components/listings/category-chips';
import { ListingBrowser } from '@/components/listings/listing-browser';
import { ListingGridSkeleton } from '@/components/listings/listing-grid';
import { serverGet } from '@/lib/server-api';

type Props = { params: { slug: string } };

const load = (slug: string) =>
  serverGet<CategoryDetailDto>(`/categories/${encodeURIComponent(slug)}`, 300);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = await load(params.slug);
  if (!c) return { title: 'Category not found' };
  return {
    title: c.name,
    description: c.description ?? `Buy and sell ${c.name.toLowerCase()} on MarketHub with escrow.`,
    alternates: { canonical: `/c/${c.slug}` },
  };
}

export default async function CategoryPage({ params }: Props) {
  const c = await load(params.slug);
  if (!c) notFound();

  // A leaf shows its siblings so people can hop across without going back up.
  const parent = c.parent;
  const chips = c.children.length ? c.children : parent ? await siblingsOf(parent.slug) : [];

  return (
    <div className="animate-rise-in">
      <nav
        aria-label="Breadcrumb"
        className="flex items-center gap-1 text-xs text-muted-foreground"
      >
        <Link href="/feed" className="hover:text-foreground">
          Discover
        </Link>
        {parent && (
          <>
            <ChevronRight className="size-3" aria-hidden />
            <Link href={`/c/${parent.slug}`} className="hover:text-foreground">
              {parent.name}
            </Link>
          </>
        )}
      </nav>
      <h1 className="mt-1.5 text-2xl font-semibold tracking-tight lg:text-3xl">{c.name}</h1>
      {c.description && (
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">{c.description}</p>
      )}

      {chips.length > 0 && (
        <div className="mt-5">
          <CategoryChips
            categories={chips}
            activeSlug={c.children.length ? undefined : c.slug}
            allHref={`/c/${parent && !c.children.length ? parent.slug : c.slug}`}
            allLabel={`All ${parent && !c.children.length ? parent.name : c.name}`}
          />
        </div>
      )}

      <Suspense fallback={<ListingGridSkeleton />}>
        <ListingBrowser fixed={{ categoryId: c.id }} />
      </Suspense>
    </div>
  );
}

async function siblingsOf(parentSlug: string) {
  return (await load(parentSlug))?.children ?? [];
}
