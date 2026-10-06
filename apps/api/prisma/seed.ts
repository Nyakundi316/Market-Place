import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { emailSchema } from '@markethub/shared';
import { hashPassword } from '../src/modules/auth/password';

// Reference data only — safe to run in every environment, and idempotent (§0: no fake data in prod).

type Node = { name: string; slug: string; icon: string; children?: [string, string][] };

export const CATEGORY_TREE: Node[] = [
  {
    name: 'Electronics',
    slug: 'electronics',
    icon: 'smartphone',
    children: [
      ['Phones & Tablets', 'phones-tablets'],
      ['Laptops & Computers', 'laptops-computers'],
      ['TV & Audio', 'tv-audio'],
      ['Cameras', 'cameras'],
      ['Gaming', 'gaming'],
      ['Accessories', 'electronics-accessories'],
    ],
  },
  {
    name: 'Vehicles',
    slug: 'vehicles',
    icon: 'car',
    children: [
      ['Cars', 'cars'],
      ['Motorbikes', 'motorbikes'],
      ['Trucks & Buses', 'trucks-buses'],
      ['Parts & Accessories', 'vehicle-parts'],
    ],
  },
  {
    name: 'Property',
    slug: 'property',
    icon: 'home',
    children: [
      ['For Rent', 'property-rent'],
      ['For Sale', 'property-sale'],
      ['Land & Plots', 'land-plots'],
      ['Short Stays', 'short-stays'],
    ],
  },
  {
    name: 'Home & Garden',
    slug: 'home-garden',
    icon: 'sofa',
    children: [
      ['Furniture', 'furniture'],
      ['Appliances', 'appliances'],
      ['Kitchen', 'kitchen'],
      ['Garden & Outdoor', 'garden-outdoor'],
    ],
  },
  {
    name: 'Fashion',
    slug: 'fashion',
    icon: 'shirt',
    children: [
      ["Men's Clothing", 'mens-clothing'],
      ["Women's Clothing", 'womens-clothing'],
      ['Shoes', 'shoes'],
      ['Bags', 'bags'],
      ['Jewellery & Watches', 'jewellery-watches'],
    ],
  },
  {
    name: 'Health & Beauty',
    slug: 'health-beauty',
    icon: 'sparkles',
    children: [
      ['Skincare', 'skincare'],
      ['Hair', 'hair'],
      ['Fragrance', 'fragrance'],
      ['Fitness', 'fitness'],
    ],
  },
  {
    name: 'Baby & Kids',
    slug: 'baby-kids',
    icon: 'baby',
    children: [
      ['Toys', 'toys'],
      ['Kids Clothing', 'kids-clothing'],
      ['Strollers & Gear', 'baby-gear'],
    ],
  },
  {
    name: 'Agriculture',
    slug: 'agriculture',
    icon: 'sprout',
    children: [
      ['Livestock', 'livestock'],
      ['Produce', 'produce'],
      ['Farm Equipment', 'farm-equipment'],
      ['Seeds & Inputs', 'seeds-inputs'],
    ],
  },
  {
    name: 'Services',
    slug: 'services',
    icon: 'wrench',
    children: [
      ['Repairs', 'repairs'],
      ['Cleaning', 'cleaning'],
      ['Tutoring & Lessons', 'tutoring'],
      ['Events & Catering', 'events-catering'],
      ['Design & Tech', 'design-tech'],
      ['Moving & Delivery', 'moving-delivery'],
      ['Beauty Services', 'beauty-services'],
    ],
  },
  {
    name: 'Jobs',
    slug: 'jobs',
    icon: 'briefcase',
    children: [
      ['Full-time', 'jobs-full-time'],
      ['Part-time', 'jobs-part-time'],
      ['Freelance & Gigs', 'jobs-freelance'],
      ['Internships', 'internships'],
    ],
  },
];

export async function seedCategories(db: PrismaClient) {
  for (const [i, root] of CATEGORY_TREE.entries()) {
    const parent = await db.category.upsert({
      where: { slug: root.slug },
      update: { name: root.name, icon: root.icon, sortOrder: i, parentId: null },
      create: { name: root.name, slug: root.slug, icon: root.icon, sortOrder: i },
    });
    for (const [j, [name, slug]] of (root.children ?? []).entries()) {
      await db.category.upsert({
        where: { slug },
        update: { name, sortOrder: j, parentId: parent.id },
        create: { name, slug, sortOrder: j, parentId: parent.id },
      });
    }
  }
}

const adminInput = z.object({
  email: emailSchema,
  password: z.string().min(12, 'SEED_ADMIN_PASSWORD must be at least 12 characters'),
});

/** Creates the admin once. Never overwrites an existing password — rotate via reset flow. */
export async function seedAdmin(db: PrismaClient, raw: { email?: string; password?: string }) {
  const { email, password } = adminInput.parse(raw);
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'admin')
      throw new Error(`${email} exists but is not an admin; refusing to promote silently`);
    return existing;
  }
  return db.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: 'admin',
      isEmailVerified: true,
      profile: { create: { displayName: 'MarketHub Admin', username: 'admin' } },
    },
  });
}

async function main() {
  const db = new PrismaClient();
  try {
    await seedCategories(db);
    const admin = await seedAdmin(db, {
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
    });
    const categories = await db.category.count();
    console.warn(`Seeded ${categories} categories; admin = ${admin.email}`);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
