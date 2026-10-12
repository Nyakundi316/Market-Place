import { z } from 'zod';
import { cursorQuerySchema } from './pagination';
import { countrySchema } from './profile';

export const LISTING_TYPES = ['product', 'service', 'job', 'request'] as const;
export const CONDITIONS = ['new', 'like_new', 'good', 'fair', 'for_parts'] as const;
export const CONTACT_PREFS = ['chat', 'phone', 'both'] as const;
export const LISTING_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc'] as const;
// What Stripe and Paystack can both settle in our launch markets.
export const CURRENCIES = ['KES', 'NGN', 'GHS', 'ZAR', 'UGX', 'TZS', 'USD', 'EUR', 'GBP'] as const;

export const MAX_LISTING_IMAGES = 10;
export const MAX_LISTING_TAGS = 10;
export const LISTING_TTL_DAYS = 30;

/**
 * Money crosses the wire as a decimal string ("1500.00") so it never passes
 * through a float. Accepts numbers from forms; Decimal(14,2) in Postgres.
 */
export const moneySchema = z
  .union([z.number(), z.string().trim()])
  .transform(String)
  .pipe(
    z
      .string()
      .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount with at most 2 decimals')
      .refine((v) => Number(v) > 0, 'Must be more than zero'),
  )
  .transform((v) => Number(v).toFixed(2));

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Lowercase words separated by hyphens');

// ─── Categories ─────────────────────────────────────────────────────────────

export const createCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    slug: slugSchema.optional(),
    parentId: z.string().uuid().nullable().optional(),
    icon: z.string().trim().max(40).optional(),
    description: z.string().trim().max(300).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const updateCategorySchema = createCategorySchema.partial().strict();

// ─── Listings ───────────────────────────────────────────────────────────────

const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(30)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N} &'-]*$/u, 'Letters, numbers, spaces and hyphens');

export const listingImageInputSchema = z.object({
  url: z.string().url().max(500),
  thumbUrl: z.string().url().max(500).optional(),
});

const listingFields = {
  categoryId: z.string().uuid(),
  type: z.enum(LISTING_TYPES),
  title: z.string().trim().min(5, 'At least 5 characters').max(120),
  description: z.string().trim().min(20, 'Tell buyers a bit more (20+ characters)').max(5000),
  price: moneySchema.nullable(),
  currency: z.enum(CURRENCIES),
  isNegotiable: z.boolean(),
  isPriceRange: z.boolean(),
  priceMin: moneySchema.nullable(),
  priceMax: moneySchema.nullable(),
  stock: z.number().int().min(0).max(1_000_000).nullable(),
  condition: z.enum(CONDITIONS).nullable(),
  country: countrySchema,
  city: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  contactPref: z.enum(CONTACT_PREFS),
  tags: z
    .array(tagSchema)
    .max(MAX_LISTING_TAGS)
    .transform((t) => [...new Set(t)]),
  images: z.array(listingImageInputSchema).max(MAX_LISTING_IMAGES),
};

type PriceShape = {
  isPriceRange?: boolean;
  price?: string | null;
  priceMin?: string | null;
  priceMax?: string | null;
};

/** A listing is priced either at one amount or as a min–max range. */
function checkPricing(v: PriceShape, ctx: z.RefinementCtx) {
  if (v.isPriceRange) {
    if (!v.priceMin) ctx.addIssue({ code: 'custom', path: ['priceMin'], message: 'Required' });
    if (!v.priceMax) ctx.addIssue({ code: 'custom', path: ['priceMax'], message: 'Required' });
    if (v.priceMin && v.priceMax && Number(v.priceMin) > Number(v.priceMax)) {
      ctx.addIssue({ code: 'custom', path: ['priceMax'], message: 'Must be at least the minimum' });
    }
  } else if (v.isPriceRange === false && !v.price) {
    ctx.addIssue({ code: 'custom', path: ['price'], message: 'Set a price' });
  }
}

export const createListingSchema = z
  .object(listingFields)
  .partial({
    price: true,
    isNegotiable: true,
    isPriceRange: true,
    priceMin: true,
    priceMax: true,
    stock: true,
    condition: true,
    lat: true,
    lng: true,
    contactPref: true,
    tags: true,
    images: true,
  })
  .strict()
  .transform((v) => ({
    ...v,
    isPriceRange: v.isPriceRange ?? false,
    isNegotiable: v.isNegotiable ?? true,
    contactPref: v.contactPref ?? 'chat',
    tags: v.tags ?? [],
    images: v.images ?? [],
  }))
  .superRefine(checkPricing);

/** Pricing rules are re-checked server-side against the merged row. */
export const updateListingSchema = z
  .object({ ...listingFields, status: z.enum(['sold']) })
  .partial()
  .strict();

const boolParam = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listingQuerySchema = cursorQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  categoryId: z.string().uuid().optional(),
  type: z.enum(LISTING_TYPES).optional(),
  minPrice: moneySchema.optional(),
  maxPrice: moneySchema.optional(),
  country: countrySchema.optional(),
  city: z.string().trim().max(80).optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  verified: boolParam.optional(),
  sellerId: z.string().uuid().optional(),
  sort: z.enum(LISTING_SORTS).optional(),
});

export const myListingsQuerySchema = cursorQuerySchema.extend({
  status: z.enum(['draft', 'pending', 'active', 'sold', 'expired', 'removed']).optional(),
});

export const boostListingSchema = z.object({ days: z.number().int().min(1).max(30).default(7) });

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateListingInput = z.infer<typeof createListingSchema>;
export type CreateListingForm = z.input<typeof createListingSchema>;
export type UpdateListingInput = z.infer<typeof updateListingSchema>;
export type ListingQuery = z.infer<typeof listingQuerySchema>;
export type MyListingsQuery = z.infer<typeof myListingsQuerySchema>;
export type ListingType = (typeof LISTING_TYPES)[number];
export type Condition = (typeof CONDITIONS)[number];
export type Currency = (typeof CURRENCIES)[number];
export type ListingSort = (typeof LISTING_SORTS)[number];
export { checkPricing };
