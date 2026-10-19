/**
 * Load-test fixtures (§10 Phase 7, k6). Creates N verified users with
 * profiles, two live listings for every other user, and one conversation per
 * buyer/seller pair, then writes load/fixtures.json for the k6 scripts.
 *
 *   pnpm --filter api seed:load -- --users 200 [--out /tmp/fixtures.json]
 *
 * Refuses to run against production. Staging is a production build too, so it
 * runs only where DEPLOY_ENV=staging says so. Users are marked by email domain
 * (@load.markethub.test, never mailed) so `--clean` can remove them again.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

const DOMAIN = 'load.markethub.test';

function arg(name: string, fallback: number) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : fallback;
}

async function clean(db: PrismaClient) {
  const users = await db.user.findMany({
    where: { email: { endsWith: `@${DOMAIN}` } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (!ids.length) return 0;
  // Children first; load users only ever chat, favourite and list.
  await db.message.deleteMany({ where: { senderId: { in: ids } } });
  await db.conversation.deleteMany({
    where: { OR: [{ buyerId: { in: ids } }, { sellerId: { in: ids } }] },
  });
  await db.favorite.deleteMany({ where: { userId: { in: ids } } });
  await db.listingImage.deleteMany({ where: { listing: { sellerId: { in: ids } } } });
  await db.listing.deleteMany({ where: { sellerId: { in: ids } } });
  await db.notification.deleteMany({ where: { userId: { in: ids } } });
  await db.refreshToken.deleteMany({ where: { userId: { in: ids } } });
  await db.profile.deleteMany({ where: { userId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  return ids.length;
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.DEPLOY_ENV !== 'staging') {
    throw new Error('Refusing to seed load-test users in production');
  }
  const db = new PrismaClient();
  try {
    const removed = await clean(db);
    if (process.argv.includes('--clean')) {
      console.warn(`Removed ${removed} load-test users`);
      return;
    }

    const count = Math.max(2, arg('users', 100));
    const category = await db.category.findFirst({
      where: { parentId: { not: null }, isActive: true },
      select: { id: true },
    });
    if (!category) throw new Error('Run the normal seed first (needs categories)');

    const run = Date.now().toString(36);
    const users: { id: string }[] = [];
    for (let i = 0; i < count; i++) {
      users.push(
        await db.user.create({
          data: {
            email: `load-${run}-${i}@${DOMAIN}`,
            role: 'both',
            isEmailVerified: true,
            profile: {
              create: {
                displayName: `Load User ${i}`,
                username: `load${run}${i}`,
                country: 'KE',
                city: 'Nairobi',
              },
            },
          },
          select: { id: true },
        }),
      );
    }

    const words = ['bike', 'phone', 'sofa', 'laptop', 'camera', 'guitar', 'shoes', 'desk'];
    const listings: { slug: string; sellerId: string }[] = [];
    const conversations: { id: string; buyerId: string; sellerId: string }[] = [];
    for (let i = 1; i < users.length; i += 2) {
      const seller = users[i]!;
      const buyer = users[i - 1]!;
      for (let n = 0; n < 2; n++) {
        const word = words[(i + n) % words.length]!;
        const slug = `load-${run}-${i}-${n}`;
        const l = await db.listing.create({
          data: {
            sellerId: seller.id,
            categoryId: category.id,
            type: 'product',
            title: `Load test ${word} ${i}-${n}`,
            slug,
            description: `A ${word} listed by the load-test seed. Not a real item; safe to ignore.`,
            price: 1000 + i * 10 + n,
            currency: 'KES',
            stock: 1000,
            status: 'active',
            publishedAt: new Date(),
          },
        });
        listings.push({ slug: l.slug, sellerId: seller.id });
        if (n === 0) {
          const c = await db.conversation.create({
            data: {
              listingId: l.id,
              buyerId: buyer.id,
              sellerId: seller.id,
              lastMessageAt: new Date(),
            },
          });
          conversations.push({ id: c.id, buyerId: buyer.id, sellerId: seller.id });
        }
      }
    }

    // Inside the deployed image the repo's load/ folder doesn't exist; pass --out there.
    const outAt = process.argv.indexOf('--out');
    const out =
      outAt > -1
        ? resolve(process.argv[outAt + 1]!)
        : resolve(__dirname, '../../../load/fixtures.json');
    mkdirSync(resolve(out, '..'), { recursive: true });
    // Ids only: k6 signs short-lived access tokens for them itself.
    writeFileSync(
      out,
      JSON.stringify(
        { users: users.map((u) => u.id), listings, conversations, terms: words },
        null,
        2,
      ),
    );
    console.warn(
      `Seeded ${users.length} users, ${listings.length} listings, ${conversations.length} conversations → ${out}`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
