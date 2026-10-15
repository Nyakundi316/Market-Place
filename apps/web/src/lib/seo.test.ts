import type { ListingDetailDto } from '@markethub/shared';
import { describe, expect, it } from 'vitest';
import { jsonLdString, listingJsonLd } from './seo';

const listing = {
  slug: 'pixel-7',
  title: 'Pixel 7 </script><script>alert(1)</script>',
  description: 'Clean, boxed.',
  type: 'product',
  status: 'active',
  price: '45000.00',
  isPriceRange: false,
  priceMin: null,
  currency: 'KES',
  condition: 'like_new',
  images: [{ url: 'https://cdn.test/a.webp' }],
  category: {
    name: 'Phones',
    slug: 'phones',
    parent: { name: 'Electronics', slug: 'electronics' },
  },
  seller: { displayName: 'Juma', username: 'juma', businessVerified: false },
} as unknown as ListingDetailDto;

type ProductLd = { offers?: { availability: string } };
type CrumbsLd = { itemListElement: { name: string }[] };

describe('structured data', () => {
  it('describes a listing as a Product with an Offer and breadcrumbs', () => {
    const [product, crumbs] = listingJsonLd(listing) as [ProductLd, CrumbsLd];
    expect(product).toMatchObject({
      '@type': 'Product',
      offers: {
        price: '45000.00',
        priceCurrency: 'KES',
        availability: 'https://schema.org/InStock',
        itemCondition: 'https://schema.org/UsedCondition',
        seller: { '@type': 'Person', name: 'Juma' },
      },
    });
    expect(product).not.toHaveProperty('aggregateRating');
    expect(crumbs.itemListElement.map((c) => c.name)).toEqual([
      'Electronics',
      'Phones',
      listing.title,
    ]);
  });

  it('marks sold listings and drops the offer without a price', () => {
    const [sold] = listingJsonLd({ ...listing, status: 'sold' }) as ProductLd[];
    expect(sold!.offers!.availability).toBe('https://schema.org/SoldOut');
    const [onRequest] = listingJsonLd({ ...listing, price: null }) as ProductLd[];
    expect(onRequest).not.toHaveProperty('offers');
  });

  it('cannot be used to break out of the script tag', () => {
    const out = jsonLdString(listingJsonLd(listing));
    expect(out).not.toContain('</script>');
    expect(JSON.parse(out)[0].name).toBe(listing.title);
  });
});
