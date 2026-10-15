import type { MetadataRoute } from 'next';
import { absolute, PRIVATE_PATHS } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  // Only production gets crawled; previews and staging stay out of the index.
  const live = process.env.NODE_ENV === 'production' && process.env.WEB_URL?.startsWith('https://');
  return {
    rules: live
      ? [{ userAgent: '*', allow: '/', disallow: ['/api/', ...PRIVATE_PATHS] }]
      : [{ userAgent: '*', disallow: '/' }],
    sitemap: absolute('/sitemap.xml'),
  };
}
