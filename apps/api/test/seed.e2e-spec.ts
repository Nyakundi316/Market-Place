import { PrismaClient } from '@prisma/client';
import { CATEGORY_TREE, seedAdmin, seedCategories } from '../prisma/seed';
import { verifyPassword } from '../src/modules/auth/password';

const db = new PrismaClient();
const email = `seed-admin-${Date.now()}@test.local`;

describe('seed', () => {
  afterAll(async () => {
    await db.user.deleteMany({ where: { email } });
    await db.$disconnect();
  });

  it('builds a two-level category tree and is idempotent', async () => {
    await seedCategories(db);
    const first = await db.category.count();
    await seedCategories(db);
    expect(await db.category.count()).toBe(first);

    const phones = await db.category.findUniqueOrThrow({
      where: { slug: 'phones-tablets' },
      include: { parent: true },
    });
    expect(phones.parent?.slug).toBe('electronics');
    const roots = await db.category.findMany({
      where: { slug: { in: CATEGORY_TREE.map((c) => c.slug) } },
    });
    expect(roots).toHaveLength(CATEGORY_TREE.length);
    expect(roots.every((r) => r.parentId === null)).toBe(true);
  });

  it('creates a verified admin with an argon2id hash, once', async () => {
    // username 'admin' is unique; clear a leftover from a previous dev seed of this DB
    await db.profile.deleteMany({ where: { username: 'admin', user: { email: { not: email } } } });

    const admin = await seedAdmin(db, { email, password: 'a-long-admin-password' });
    expect(admin).toMatchObject({ role: 'admin', isEmailVerified: true });
    expect(await verifyPassword(admin.passwordHash!, 'a-long-admin-password')).toBe(true);

    const again = await seedAdmin(db, { email, password: 'different-password-123' });
    expect(again.passwordHash).toBe(admin.passwordHash);
  });

  it('refuses a weak password and refuses to promote an existing non-admin', async () => {
    await expect(seedAdmin(db, { email: 'x@test.local', password: 'short' })).rejects.toThrow(
      /12 characters/,
    );

    const buyerEmail = `buyer-${Date.now()}@test.local`;
    await db.user.create({ data: { email: buyerEmail } });
    await expect(
      seedAdmin(db, { email: buyerEmail, password: 'a-long-admin-password' }),
    ).rejects.toThrow(/not an admin/);
    await db.user.delete({ where: { email: buyerEmail } });
  });
});
