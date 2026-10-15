import type { ListingDetailDto, PublicProfileDto } from '@markethub/shared';

/** Absolute origin for canonical URLs, sitemaps and JSON-LD. Server-side only. */
export const SITE_URL = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
export const absolute = (path: string) => `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;

/** Pages behind sign-in: never indexed, never in the sitemap. */
export const PRIVATE_PATHS = [
  '/chat',
  '/deals',
  '/orders',
  '/saved',
  '/seller',
  '/settings',
  '/create',
  '/onboarding',
  '/admin',
  '/auth',
  '/verify-email',
  '/reset-password',
];

type Json = Record<string, unknown>;

/** WebSite + Organization, with the sitelinks search box pointing at /search. */
export function siteJsonLd(): Json[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'MarketHub',
      url: SITE_URL,
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${SITE_URL}/search?q={search_term_string}` },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'MarketHub',
      url: SITE_URL,
      logo: absolute('/icon.png'),
    },
  ];
}

const AVAILABILITY: Record<string, string> = {
  active: 'https://schema.org/InStock',
  sold: 'https://schema.org/SoldOut',
};
const CONDITION: Record<string, string> = {
  new: 'https://schema.org/NewCondition',
  like_new: 'https://schema.org/UsedCondition',
  good: 'https://schema.org/UsedCondition',
  fair: 'https://schema.org/UsedCondition',
  for_parts: 'https://schema.org/DamagedCondition',
};

/**
 * Product + Offer for a listing (services use Service). No aggregateRating:
 * our ratings are about the seller, not the item, and Google treats
 * seller ratings on product markup as misleading.
 */
export function listingJsonLd(l: ListingDetailDto): Json[] {
  const url = absolute(`/l/${l.slug}`);
  const price = l.price ?? (l.isPriceRange ? l.priceMin : null);
  const seller = {
    '@type': l.seller.businessVerified ? 'Organization' : 'Person',
    name: l.seller.displayName,
    url: absolute(`/u/${l.seller.username}`),
  };
  const offer =
    price && (l.type === 'product' || l.type === 'service')
      ? {
          '@type': 'Offer',
          url,
          price,
          priceCurrency: l.currency,
          availability: AVAILABILITY[l.status] ?? 'https://schema.org/Discontinued',
          ...(l.condition && { itemCondition: CONDITION[l.condition] }),
          seller,
        }
      : undefined;

  const crumbs = [
    l.category.parent && { name: l.category.parent.name, path: `/c/${l.category.parent.slug}` },
    { name: l.category.name, path: `/c/${l.category.slug}` },
    { name: l.title, path: `/l/${l.slug}` },
  ].filter((c): c is { name: string; path: string } => !!c);

  return [
    {
      '@context': 'https://schema.org',
      '@type': l.type === 'service' ? 'Service' : 'Product',
      name: l.title,
      description: l.description.slice(0, 5000),
      url,
      image: l.images.map((i) => i.url),
      category: l.category.name,
      ...(l.type === 'service' ? { provider: seller } : {}),
      ...(offer && { offers: offer }),
    },
    breadcrumbJsonLd(crumbs),
  ];
}

export function breadcrumbJsonLd(crumbs: { name: string; path: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: absolute(c.path),
    })),
  };
}

export function profileJsonLd(p: PublicProfileDto): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': p.businessVerified ? 'Organization' : 'Person',
      name: p.displayName,
      alternateName: `@${p.username}`,
      url: absolute(`/u/${p.username}`),
      ...(p.avatarUrl && { image: p.avatarUrl }),
      ...(p.bio && { description: p.bio }),
    },
  };
}

/**
 * Serialises for a <script type="application/ld+json">. Escapes `<` so a
 * listing titled "</script><script>…" can't break out (§9 XSS).
 */
export function jsonLdString(data: Json | Json[]) {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
