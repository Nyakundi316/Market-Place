import type { SitemapDto } from '@markethub/shared';
import type { MetadataRoute } from 'next';
import { absolute } from '@/lib/seo';
import { serverGet } from '@/lib/server-api';

// Rebuilt hourly; the API caps it under Google's 50k-URL limit.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const data = await serverGet<SitemapDto>('/seo/sitemap', revalidate).catch(() => null);
  const fixed: MetadataRoute.Sitemap = [
    { url: absolute('/'), changeFrequency: 'daily', priority: 1 },
    { url: absolute('/feed'), changeFrequency: 'hourly', priority: 0.9 },
    { url: absolute('/search'), changeFrequency: 'daily', priority: 0.5 },
  ];
  if (!data) return fixed; // API down: still serve something valid

  return [
    ...fixed,
    ...data.categories.map((c) => ({
      url: absolute(`/c/${c.slug}`),
      lastModified: c.updatedAt,
      changeFrequency: 'daily' as const,
      priority: 0.8,
    })),
    ...data.listings.map((l) => ({
      url: absolute(`/l/${l.slug}`),
      lastModified: l.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...data.profiles.map((p) => ({
      url: absolute(`/u/${p.username}`),
      lastModified: p.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.4,
    })),
  ];
}
