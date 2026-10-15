import type { ListingDetailDto } from '@markethub/shared';
import type { Metadata } from 'next';
import { JsonLd } from '@/components/json-ld';
import { formatPrice } from '@/lib/format';
import { listingJsonLd } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';
import { ListingView } from './listing-view';

type Props = { params: { slug: string } };

const load = (slug: string) =>
  serverGet<ListingDetailDto>(`/listings/${encodeURIComponent(slug)}`, 30);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const l = await load(params.slug);
  // Drafts 404 for the anonymous server fetch; the owner still sees them client-side.
  if (!l) return { title: 'Listing', robots: { index: false } };
  const description = `${formatPrice(l)} · ${[l.city, l.country].filter(Boolean).join(', ')} — ${l.description.slice(0, 140)}`;
  return {
    title: l.title,
    description,
    alternates: { canonical: `/l/${l.slug}` },
    // Sold listings stay reachable (orders link to them) but drop out of results.
    robots: l.status === 'active' ? undefined : { index: false },
    openGraph: {
      title: l.title,
      description,
      type: 'website',
      images: l.images[0] ? [{ url: l.images[0].url }] : undefined,
    },
  };
}

export default async function ListingPage({ params }: Props) {
  const initial = await load(params.slug);
  return (
    <>
      {initial && <JsonLd data={listingJsonLd(initial)} />}
      <ListingView slug={params.slug} initial={initial} />
    </>
  );
}
