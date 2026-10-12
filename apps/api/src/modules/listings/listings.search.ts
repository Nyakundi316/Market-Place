import { BadRequestException } from '@nestjs/common';
import type { ListingQuery, ListingSort } from '@markethub/shared';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.module';

/**
 * Cursor = base64url JSON of the last row's sort key. Keyset for newest and
 * price sorts; relevance scores aren't stable keys, so it pages by offset,
 * capped so deep pages can't become expensive scans.
 */
type Cursor = { t: string; id: string } | { p: string; id: string } | { o: number };
const MAX_RELEVANCE_OFFSET = 1000;

const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

function decode(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString()) as Cursor;
    if (typeof c === 'object' && c !== null) return c;
  } catch {
    /* fall through */
  }
  throw new BadRequestException({ message: 'Invalid cursor', fields: { cursor: ['Invalid'] } });
}

const UUID = /^[0-9a-f-]{36}$/i;

export function resolveSort(q: ListingQuery): ListingSort {
  const sort = q.sort ?? (q.q ? 'relevance' : 'newest');
  return sort === 'relevance' && !q.q ? 'newest' : sort;
}

const PRICE = Prisma.sql`coalesce(l.price, l.price_min)`;

interface Row {
  id: string;
  published_at: Date | null;
  price_key: Prisma.Decimal | null;
}

/** Ids of matching active listings in display order, plus the next cursor. */
export async function searchListingIds(db: PrismaService, q: ListingQuery) {
  const sort = resolveSort(q);
  const cursor = decode(q.cursor);
  const tsq = q.q ? Prisma.sql`websearch_to_tsquery('english', ${q.q})` : null;

  // Time-expired rows drop out immediately; the listing:expire job flips their status later.
  const where: Prisma.Sql[] = [
    Prisma.sql`l.status = 'active'`,
    Prisma.sql`(l.expires_at IS NULL OR l.expires_at > now())`,
  ];
  if (q.q && tsq) {
    // Full-text for words, trigram word-similarity for typos ("iphnoe").
    where.push(Prisma.sql`(l.search_vector @@ ${tsq} OR ${q.q} <% l.title)`);
  }
  if (q.categoryId) {
    where.push(
      Prisma.sql`l.category_id IN (SELECT id FROM categories WHERE id = ${q.categoryId}::uuid OR parent_id = ${q.categoryId}::uuid)`,
    );
  }
  if (q.type) where.push(Prisma.sql`l.type = ${q.type}::"ListingType"`);
  if (q.minPrice) where.push(Prisma.sql`coalesce(l.price, l.price_max) >= ${q.minPrice}::numeric`);
  if (q.maxPrice) where.push(Prisma.sql`${PRICE} <= ${q.maxPrice}::numeric`);
  if (q.country) where.push(Prisma.sql`l.country = ${q.country}`);
  if (q.city) where.push(Prisma.sql`lower(l.city) = lower(${q.city})`);
  if (q.rating !== undefined) where.push(Prisma.sql`p.rating_avg >= ${q.rating}`);
  if (q.verified) where.push(Prisma.sql`(p.id_verified OR p.business_verified)`);
  if (q.sellerId) where.push(Prisma.sql`l.seller_id = ${q.sellerId}::uuid`);
  if (q.featured) where.push(Prisma.sql`l.is_featured AND l.featured_until > now()`);

  let order: Prisma.Sql;
  let offset = 0;
  switch (sort) {
    case 'relevance':
      order = Prisma.sql`ts_rank(l.search_vector, ${tsq}) * 2 + word_similarity(${q.q}, l.title) DESC, l.id`;
      if (cursor && 'o' in cursor)
        offset = Math.min(Math.max(0, Math.floor(cursor.o)), MAX_RELEVANCE_OFFSET);
      break;
    case 'price_asc':
    case 'price_desc': {
      const dir = sort === 'price_asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
      order = Prisma.sql`${PRICE} ${dir}, l.id ${dir}`;
      if (cursor && 'p' in cursor && UUID.test(cursor.id)) {
        where.push(
          sort === 'price_asc'
            ? Prisma.sql`(${PRICE}, l.id) > (${cursor.p}::numeric, ${cursor.id}::uuid)`
            : Prisma.sql`(${PRICE}, l.id) < (${cursor.p}::numeric, ${cursor.id}::uuid)`,
        );
      }
      break;
    }
    default:
      order = Prisma.sql`l.published_at DESC, l.id DESC`;
      if (cursor && 't' in cursor && UUID.test(cursor.id)) {
        where.push(
          Prisma.sql`(l.published_at, l.id) < (${cursor.t}::timestamp, ${cursor.id}::uuid)`,
        );
      }
  }

  const rows = await db.$queryRaw<Row[]>`
    SELECT l.id, l.published_at, ${PRICE} AS price_key
    FROM listings l
    JOIN users u ON u.id = l.seller_id AND u.is_active AND NOT u.is_banned
    JOIN profiles p ON p.user_id = l.seller_id
    WHERE ${Prisma.join(where, ' AND ')}
    ORDER BY ${order}
    LIMIT ${q.limit + 1} OFFSET ${offset}`;

  const page = rows.slice(0, q.limit);
  const last = page.at(-1);
  let nextCursor: string | null = null;
  if (rows.length > q.limit && last) {
    if (sort === 'relevance')
      nextCursor =
        offset + q.limit <= MAX_RELEVANCE_OFFSET ? encode({ o: offset + q.limit }) : null;
    else if (sort === 'newest')
      nextCursor = encode({ t: last.published_at!.toISOString(), id: last.id });
    else nextCursor = encode({ p: last.price_key!.toString(), id: last.id });
  }
  return { ids: page.map((r) => r.id), nextCursor };
}
