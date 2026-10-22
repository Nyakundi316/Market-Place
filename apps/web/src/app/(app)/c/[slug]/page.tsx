import type { CategoryDetailDto } from '@markethub/shared';
import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { CategoryChips } from '@/components/listings/category-chips';
import { ListingBrowser } from '@/components/listings/listing-browser';
import { ListingGridSkeleton } from '@/components/listings/listing-grid';
import { JsonLd } from '@/components/json-ld';
import { breadcrumbJsonLd } from '@/lib/seo';
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
      <JsonLd
        data={breadcrumbJsonLd([
          ...(parent ? [{ name: parent.name, path: `/c/${parent.slug}` }] : []),
          { name: c.name, path: `/c/${c.slug}` },
        ])}
      />
      {/* Same masthead as Discover: kicker + serif title, the blurb ruled off to the side. */}
      <header className="grid gap-x-12 gap-y-3 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-end">
        <div>
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground"
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
          <h1 className="text-balance mt-2 font-display text-[2rem] font-medium leading-[1.05] tracking-tight sm:text-4xl lg:text-5xl">
            {c.name}
          </h1>
        </div>
        {c.description && (
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground lg:border-l lg:pb-1.5 lg:pl-5">
            {c.description}
          </p>
        )}
      </header>

      {chips.length > 0 && (
        <div className="mt-6 lg:mt-8">
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
