import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  checkPricing,
  type CreateListingInput,
  type CursorPage,
  type FavoriteStateDto,
  LISTING_TTL_DAYS,
  type ListingCardDto,
  type ListingDetailDto,
  type ListingQuery,
  type MyListingsQuery,
  type UpdateListingInput,
} from '@markethub/shared';
import { Prisma, type Listing } from '@prisma/client';
import type Redis from 'ioredis';
import { z } from 'zod';
import type { RequestUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.module';
import { InjectRedis } from '../../redis/redis.module';
import { AuditService } from '../audit/audit.service';
import { UploadsService } from '../uploads/uploads.service';
import { slugify, listingSlug } from './slug';
import { cardInclude, detailInclude, toCard, toDetail } from './listings.mapper';
import { searchListingIds } from './listings.search';

const DAY_MS = 86_400_000;
const PUBLIC_STATUSES = new Set(['active', 'sold']);
type Tx = Prisma.TransactionClient;

const money = (d: Prisma.Decimal | null) => (d === null ? null : d.toFixed(2));

@Injectable()
export class ListingsService {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  // ─── Reads ──────────────────────────────────────────────────────────────

  async search(q: ListingQuery, viewer: RequestUser | null): Promise<CursorPage<ListingCardDto>> {
    const { ids, nextCursor } = await searchListingIds(this.db, q);
    return { items: await this.cards(ids, viewer?.id ?? null), nextCursor };
  }

  /** Hydrates ids into cards, preserving order. */
  async cards(ids: string[], viewerId: string | null): Promise<ListingCardDto[]> {
    if (!ids.length) return [];
    const [rows, favs] = await Promise.all([
      this.db.listing.findMany({ where: { id: { in: ids } }, include: cardInclude }),
      viewerId
        ? this.db.favorite.findMany({
            where: { userId: viewerId, listingId: { in: ids } },
            select: { listingId: true },
          })
        : null,
    ]);
    const favSet = favs ? new Set(favs.map((f) => f.listingId)) : undefined;
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [toCard(row, favSet)] : [];
    });
  }

  async mine(userId: string, q: MyListingsQuery): Promise<CursorPage<ListingCardDto>> {
    const rows = await this.db.listing.findMany({
      where: { sellerId: userId, status: q.status ?? { not: 'removed' } },
      include: cardInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor && { cursor: { id: q.cursor }, skip: 1 }),
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => toCard(r)),
      nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
    };
  }

  /**
   * Active and sold listings are public; drafts and expired ones only exist
   * for their owner; removed ones for nobody. Views count once per viewer per hour.
   */
  async bySlug(slug: string, viewer: RequestUser | null, ip?: string): Promise<ListingDetailDto> {
    const l = await this.db.listing.findUnique({
      where: { slug },
      include: {
        ...detailInclude,
        seller: { select: { id: true, profile: true, isBanned: true } },
      },
    });
    const isOwner = Boolean(viewer && l && viewer.id === l.sellerId);
    if (
      !l ||
      l.status === 'removed' ||
      (!isOwner && (!PUBLIC_STATUSES.has(l.status) || l.seller.isBanned))
    ) {
      throw new NotFoundException('Listing not found');
    }

    if (!isOwner) {
      const fresh = await this.redis
        .set(`view:${l.id}:${viewer?.id ?? ip ?? 'anon'}`, '1', 'EX', 3600, 'NX')
        .catch(() => null);
      if (fresh) {
        // Raw update so a view doesn't bump updated_at.
        await this.db
          .$executeRaw`UPDATE listings SET views_count = views_count + 1 WHERE id = ${l.id}::uuid`;
        l.viewsCount += 1;
      }
    }

    const favorited = viewer
      ? Boolean(
          await this.db.favorite.findUnique({
            where: { userId_listingId: { userId: viewer.id, listingId: l.id } },
          }),
        )
      : null;
    return toDetail(l, viewer?.id ?? null, favorited);
  }

  // ─── Writes ─────────────────────────────────────────────────────────────

  async create(user: RequestUser, input: CreateListingInput): Promise<ListingDetailDto> {
    const profile = await this.db.profile.findUnique({ where: { userId: user.id } });
    if (!profile) throw new ForbiddenException('Finish setting up your profile first');
    if (user.role === 'buyer' && input.type !== 'request') {
      throw new ForbiddenException(
        'Switch to a selling account to post products, services or jobs',
      );
    }
    await this.assertCategory(input.categoryId);
    await this.uploads.assertUploaded(imageUrls(input.images), user.id, 'listing');

    const { images, tags, ...fields } = input;
    const created = await this.db.$transaction(async (tx) => {
      const l = await tx.listing.create({
        data: {
          ...fields,
          ...pricingColumns(input),
          sellerId: user.id,
          slug: listingSlug(input.title),
          images: { create: images.map((img, i) => ({ ...img, sortOrder: i })) },
        },
      });
      await this.attachTags(tx, l.id, tags);
      return l;
    });
    return this.detailFor(created.id, user.id);
  }

  async update(
    id: string,
    user: RequestUser,
    input: UpdateListingInput,
  ): Promise<ListingDetailDto> {
    const l = await this.owned(id, user.id);
    if (input.status === 'sold' && l.status !== 'active') {
      throw new ConflictException('Only live listings can be marked as sold');
    }
    if (input.type && input.type !== 'request' && user.role === 'buyer') {
      throw new ForbiddenException(
        'Switch to a selling account to post products, services or jobs',
      );
    }
    if (input.categoryId) await this.assertCategory(input.categoryId);

    // Pricing is validated against the merged row, since a PATCH may touch only part of it.
    const merged = {
      isPriceRange: input.isPriceRange ?? l.isPriceRange,
      price: input.price !== undefined ? input.price : money(l.price),
      priceMin: input.priceMin !== undefined ? input.priceMin : money(l.priceMin),
      priceMax: input.priceMax !== undefined ? input.priceMax : money(l.priceMax),
    };
    const fields: Record<string, string[]> = {};
    checkPricing(merged, {
      addIssue: (i: { path?: (string | number)[]; message?: string }) =>
        (fields[i.path?.join('.') ?? '_'] ??= []).push(i.message ?? 'Invalid'),
    } as unknown as z.RefinementCtx);
    if (Object.keys(fields).length) {
      throw new BadRequestException({ message: 'Validation failed', fields });
    }

    const { images, tags, status, ...columns } = input;
    if (images) {
      const existing = new Set(
        (await this.db.listingImage.findMany({ where: { listingId: id } })).flatMap((i) =>
          [i.url, i.thumbUrl].filter(Boolean),
        ),
      );
      const fresh = imageUrls(images).filter((u) => !existing.has(u));
      await this.uploads.assertUploaded(fresh, user.id, 'listing');
    }

    await this.db.$transaction(async (tx) => {
      await tx.listing.update({
        where: { id },
        data: {
          ...columns,
          ...pricingColumns(merged),
          ...(status && { status }),
          // A new title gets a new slug; the old link 404s rather than leaking stale text.
          ...(columns.title && columns.title !== l.title && { slug: listingSlug(columns.title) }),
        },
      });
      if (images) {
        await tx.listingImage.deleteMany({ where: { listingId: id } });
        await tx.listingImage.createMany({
          data: images.map((img, i) => ({ ...img, listingId: id, sortOrder: i })),
        });
      }
      if (tags) await this.attachTags(tx, id, tags);
      if (status) await this.refreshListingsCount(tx, user.id);
    });
    return this.detailFor(id, user.id);
  }

  /** Draft or expired → active for LISTING_TTL_DAYS. Needs a verified email (§0 trust). */
  async publish(id: string, user: RequestUser): Promise<ListingDetailDto> {
    const l = await this.owned(id, user.id);
    if (l.status !== 'draft' && l.status !== 'expired') {
      throw new ConflictException(`A ${l.status} listing can't be published`);
    }
    if (l.type === 'product' && !(await this.db.listingImage.count({ where: { listingId: id } }))) {
      throw new BadRequestException({
        message: 'Add at least one photo before publishing',
        fields: { images: ['Required'] },
      });
    }
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      await tx.listing.update({
        where: { id },
        data: {
          status: 'active',
          publishedAt: now,
          expiresAt: new Date(now.getTime() + LISTING_TTL_DAYS * DAY_MS),
        },
      });
      await this.refreshListingsCount(tx, user.id);
    });
    return this.detailFor(id, user.id);
  }

  /**
   * Pins a live listing to the featured strip. Free for now — there's no paid
   * boost product yet (see PROGRESS decisions); one boost at a time.
   */
  async boost(id: string, user: RequestUser, days: number, ip?: string) {
    const l = await this.owned(id, user.id);
    if (l.status !== 'active') throw new ConflictException('Only live listings can be boosted');
    if (l.isFeatured && l.featuredUntil && l.featuredUntil > new Date()) {
      throw new ConflictException('This listing is already boosted');
    }
    const featuredUntil = new Date(Date.now() + days * DAY_MS);
    await this.db.$transaction([
      this.db.listing.update({ where: { id }, data: { isFeatured: true, featuredUntil } }),
      this.db.auditLog.create({
        data: {
          actorId: user.id,
          action: 'listing.boost',
          entityType: 'listing',
          entityId: id,
          metadata: { days, featuredUntil: featuredUntil.toISOString() },
          ipAddress: ip,
        },
      }),
    ]);
    return this.detailFor(id, user.id);
  }

  /** Soft delete: orders and chats keep pointing at the row. */
  async remove(id: string, userId: string) {
    await this.owned(id, userId);
    await this.db.$transaction(async (tx) => {
      await tx.listing.update({ where: { id }, data: { status: 'removed', isFeatured: false } });
      await this.refreshListingsCount(tx, userId);
    });
  }

  async favorite(id: string, userId: string, on: boolean): Promise<FavoriteStateDto> {
    const l = await this.db.listing.findUnique({ where: { id } });
    if (!l || !PUBLIC_STATUSES.has(l.status)) throw new NotFoundException('Listing not found');
    if (on && l.sellerId === userId)
      throw new BadRequestException("You can't favourite your own listing");

    const updated = await this.db.$transaction(async (tx) => {
      const changed = on
        ? (
            await tx.favorite.createMany({
              data: [{ userId, listingId: id }],
              skipDuplicates: true,
            })
          ).count
        : (await tx.favorite.deleteMany({ where: { userId, listingId: id } })).count;
      if (!changed) return l;
      // Raw so favouriting doesn't count as an edit (updated_at).
      await tx.$executeRaw`UPDATE listings SET favorites_count = greatest(0, favorites_count + ${on ? 1 : -1}) WHERE id = ${id}::uuid`;
      return tx.listing.findUniqueOrThrow({ where: { id } });
    });
    return { favorited: on, favoritesCount: updated.favoritesCount };
  }

  async favorites(userId: string, q: { cursor?: string; limit: number }) {
    const rows = await this.db.favorite.findMany({
      where: { userId, listing: { status: { in: ['active', 'sold'] } } },
      orderBy: [{ createdAt: 'desc' }, { listingId: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor && { cursor: { userId_listingId: { userId, listingId: q.cursor } }, skip: 1 }),
    });
    const page = rows.slice(0, q.limit);
    return {
      items: await this.cards(
        page.map((f) => f.listingId),
        userId,
      ),
      nextCursor: rows.length > q.limit ? page.at(-1)!.listingId : null,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async owned(id: string, userId: string): Promise<Listing> {
    const l = await this.db.listing.findUnique({ where: { id } });
    if (!l || l.status === 'removed') throw new NotFoundException('Listing not found');
    if (l.sellerId !== userId) throw new ForbiddenException('Not your listing');
    return l;
  }

  private async detailFor(id: string, viewerId: string) {
    const l = await this.db.listing.findUniqueOrThrow({ where: { id }, include: detailInclude });
    return toDetail(l, viewerId, null);
  }

  /** Listings go in leaves: a top-level category with subcategories is too vague. */
  private async assertCategory(categoryId: string) {
    const c = await this.db.category.findUnique({
      where: { id: categoryId },
      include: { _count: { select: { children: { where: { isActive: true } } } } },
    });
    if (!c || !c.isActive) {
      throw new BadRequestException({
        message: 'Unknown category',
        fields: { categoryId: ['Unknown'] },
      });
    }
    if (c._count.children > 0) {
      throw new BadRequestException({
        message: 'Pick a subcategory',
        fields: { categoryId: ['Pick a subcategory'] },
      });
    }
  }

  /** Replaces a listing's tags and keeps Tag.useCount in step. */
  private async attachTags(tx: Tx, listingId: string, names: string[]) {
    const old = await tx.listingTag.findMany({ where: { listingId }, select: { tagId: true } });
    if (old.length) {
      await tx.listingTag.deleteMany({ where: { listingId } });
      await tx.tag.updateMany({
        where: { id: { in: old.map((t) => t.tagId) } },
        data: { useCount: { decrement: 1 } },
      });
    }
    for (const name of names) {
      const slug = slugify(name, 40);
      if (!slug) continue;
      const tag = await tx.tag.upsert({
        where: { slug },
        create: { name, slug, useCount: 1 },
        update: { useCount: { increment: 1 } },
      });
      await tx.listingTag.createMany({
        data: [{ listingId, tagId: tag.id }],
        skipDuplicates: true,
      });
    }
  }

  /** profile.listingsCount = live listings, recounted on every status change. */
  private async refreshListingsCount(tx: Tx, sellerId: string) {
    const count = await tx.listing.count({ where: { sellerId, status: 'active' } });
    await tx.profile.updateMany({ where: { userId: sellerId }, data: { listingsCount: count } });
  }
}

function imageUrls(images: { url: string; thumbUrl?: string }[]) {
  return images.flatMap((i) => (i.thumbUrl ? [i.url, i.thumbUrl] : [i.url]));
}

/** Clears whichever pricing columns don't apply to the chosen mode. */
function pricingColumns(p: {
  isPriceRange?: boolean;
  price?: string | null;
  priceMin?: string | null;
  priceMax?: string | null;
}) {
  return p.isPriceRange
    ? { isPriceRange: true, price: null, priceMin: p.priceMin, priceMax: p.priceMax }
    : { isPriceRange: false, price: p.price, priceMin: null, priceMax: null };
}
