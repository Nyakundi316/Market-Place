import type { MetadataRoute } from 'next';
import { absolute, PRIVATE_PATHS } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  // Only production gets crawled; previews and staging stay out of the index.
  // Staging is a production build on https too, so DEPLOY_ENV tells them apart.
  const live =
    process.env.NODE_ENV === 'production' &&
    process.env.WEB_URL?.startsWith('https://') &&
    (process.env.DEPLOY_ENV ?? 'production') === 'production';
  return {
    rules: live
      ? [{ userAgent: '*', allow: '/', disallow: ['/api/', ...PRIVATE_PATHS] }]
      : [{ userAgent: '*', disallow: '/' }],
    sitemap: absolute('/sitemap.xml'),
  };
}
