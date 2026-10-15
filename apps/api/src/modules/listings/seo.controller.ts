import { Controller, Get } from '@nestjs/common';
import type { SitemapDto } from '@markethub/shared';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../prisma/prisma.module';

/** Google's per-file cap is 50k URLs; leave room for categories, profiles and static pages. */
const MAX_LISTINGS = 45_000;
const MAX_PROFILES = 4_000;

/**
 * §10 Phase 7 SEO: everything the web sitemap needs in one call, instead of
 * the web server paging through search. Public and cheap; the web caches it.
 */
@Public()
@Controller('seo')
export class SeoController {
  constructor(private readonly db: PrismaService) {}

  @Get('sitemap')
  async sitemap(): Promise<SitemapDto> {
    const visibleSeller = { isBanned: false, isActive: true };
    const [listings, categories, profiles] = await Promise.all([
      this.db.listing.findMany({
        where: { status: 'active', seller: visibleSeller },
        select: { slug: true, updatedAt: true },
        orderBy: { publishedAt: 'desc' },
        take: MAX_LISTINGS,
      }),
      this.db.category.findMany({
        where: { isActive: true },
        select: { slug: true, updatedAt: true },
      }),
      // Only people with something live: empty profiles are thin content.
      this.db.profile.findMany({
        where: { listingsCount: { gt: 0 }, user: visibleSeller },
        select: { username: true, updatedAt: true },
        orderBy: { listingsCount: 'desc' },
        take: MAX_PROFILES,
      }),
    ]);
    const iso = (d: Date) => d.toISOString();
    return {
      listings: listings.map((l) => ({ slug: l.slug, updatedAt: iso(l.updatedAt) })),
      categories: categories.map((c) => ({ slug: c.slug, updatedAt: iso(c.updatedAt) })),
      profiles: profiles.map((p) => ({ username: p.username, updatedAt: iso(p.updatedAt) })),
    };
  }
}
