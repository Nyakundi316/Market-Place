import { PrismaClient } from '@prisma/client';

// Exercises the raw-SQL migration (§3 triggers + CHECKs) against markethub_test.
const db = new PrismaClient();
const tag = `t${Date.now()}`;

async function makeUser(name: string) {
  return db.user.create({
    data: {
      email: `${name}-${tag}@test.local`,
      profile: { create: { displayName: name, username: `${name}_${tag}` } },
    },
  });
}

describe('db triggers & constraints', () => {
  let seller: { id: string };
  let buyer: { id: string };
  let listing: { id: string };

  beforeAll(async () => {
    [seller, buyer] = await Promise.all([makeUser('seller'), makeUser('buyer')]);
    const category = await db.category.create({ data: { name: 'Phones', slug: `phones-${tag}` } });
    listing = await db.listing.create({
      data: {
        sellerId: seller.id,
        categoryId: category.id,
        type: 'product',
        title: 'Refurbished iPhone 13',
        slug: `iphone-${tag}`,
        description: 'Battery health 91 percent, comes with charger',
        currency: 'KES',
        price: '45000',
      },
    });
  });

  afterAll(() => db.$disconnect());

  it('listings_search_vector: title ranks above description', async () => {
    const rows = await db.$queryRaw<{ title_hit: number; desc_hit: number }[]>`
      SELECT ts_rank(search_vector, to_tsquery('english', 'iphone'))  AS title_hit,
             ts_rank(search_vector, to_tsquery('english', 'charger')) AS desc_hit
      FROM listings WHERE id = ${listing.id}::uuid`;
    expect(rows[0]!.title_hit).toBeGreaterThan(rows[0]!.desc_hit);
    expect(rows[0]!.desc_hit).toBeGreaterThan(0);
  });

  it('listings_search_vector: updates when the title changes', async () => {
    await db.listing.update({ where: { id: listing.id }, data: { title: 'Samsung Galaxy S22' } });
    const [hit] = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM listings
      WHERE id = ${listing.id}::uuid AND search_vector @@ to_tsquery('english', 'galaxy')`;
    expect(Number(hit!.n)).toBe(1);
  });

  it('update_conversation_on_message: bumps the recipient unread + last message', async () => {
    const convo = await db.conversation.create({
      data: { listingId: listing.id, buyerId: buyer.id, sellerId: seller.id },
    });
    const msg = await db.message.create({
      data: { conversationId: convo.id, senderId: buyer.id, body: 'Is it available?' },
    });
    const after = await db.conversation.findUniqueOrThrow({ where: { id: convo.id } });
    expect(after).toMatchObject({ sellerUnread: 1, buyerUnread: 0, lastMessageId: msg.id });
    expect(after.lastMessageAt?.getTime()).toBe(msg.createdAt.getTime());
  });

  it('refresh_profile_rating: averages visible reviews and reacts to hide/delete', async () => {
    const mkOrder = (n: number) =>
      db.order.create({
        data: {
          orderNumber: `ORD-2026-${tag.slice(-5)}${n}`,
          listingId: listing.id,
          buyerId: buyer.id,
          sellerId: seller.id,
          quantity: 1,
          unitPrice: '100',
          subtotal: '100',
          platformFee: '2',
          total: '102',
          currency: 'KES',
        },
      });
    const [o1, o2] = await Promise.all([mkOrder(1), mkOrder(2)]);
    const r1 = await db.review.create({
      data: { orderId: o1.id, raterId: buyer.id, rateeId: seller.id, rating: 5 },
    });
    await db.review.create({
      data: { orderId: o2.id, raterId: buyer.id, rateeId: seller.id, rating: 2 },
    });

    const profile = () => db.profile.findUniqueOrThrow({ where: { userId: seller.id } });
    expect(await profile()).toMatchObject({ ratingCount: 2 });
    expect((await profile()).ratingAvg.toFixed(2)).toBe('3.50');

    await db.review.update({ where: { id: r1.id }, data: { isVisible: false } });
    expect((await profile()).ratingAvg.toFixed(2)).toBe('2.00');

    await db.review.deleteMany({ where: { rateeId: seller.id } });
    expect(await profile()).toMatchObject({ ratingCount: 0 });
  });

  it('rejects self-reviews, out-of-range ratings and negative money', async () => {
    const order = await db.order.findFirstOrThrow({ where: { sellerId: seller.id } });
    await expect(
      db.review.create({
        data: { orderId: order.id, raterId: seller.id, rateeId: seller.id, rating: 4 },
      }),
    ).rejects.toThrow(/reviews_rater_not_ratee/);
    await expect(
      db.review.create({
        data: { orderId: order.id, raterId: buyer.id, rateeId: seller.id, rating: 6 },
      }),
    ).rejects.toThrow(/reviews_rating_range/);
    await expect(
      db.transaction.create({
        data: {
          orderId: order.id,
          userId: buyer.id,
          type: 'charge',
          amount: '-1',
          currency: 'KES',
          gateway: 'stripe',
          idempotencyKey: `neg-${tag}`,
        },
      }),
    ).rejects.toThrow(/transactions_amount_nonneg/);
  });

  it('citext: email uniqueness is case-insensitive', async () => {
    await expect(db.user.create({ data: { email: `BUYER-${tag}@TEST.local` } })).rejects.toThrow(
      /Unique constraint/,
    );
  });
});
