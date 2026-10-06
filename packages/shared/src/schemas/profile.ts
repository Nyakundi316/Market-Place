import { z } from 'zod';

// Names that would let someone pose as staff or the platform itself.
// 'admin' itself is taken by the seeded admin account.
const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'markethub',
  'support',
  'help',
  'moderator',
  'mod',
  'staff',
  'official',
  'security',
  'billing',
  'payments',
  'escrow',
  'system',
  'root',
  'me',
]);

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(
    /^[a-z0-9](?:[a-z0-9_]*[a-z0-9])?$/,
    'Letters, numbers and underscores; no leading/trailing underscore',
  )
  .refine((u) => !RESERVED_USERNAMES.has(u), 'That username is reserved');

const url = z.string().trim().url().max(500);
const shortText = (max: number) => z.string().trim().max(max);

export const socialsSchema = z
  .object({
    twitter: url,
    linkedin: url,
    instagram: url,
    facebook: url,
    tiktok: url,
  })
  .partial()
  .strict();

export const updateProfileSchema = z
  .object({
    displayName: shortText(60).min(1),
    username: usernameSchema,
    bio: shortText(500),
    profession: shortText(80),
    company: shortText(80),
    website: url.or(z.literal('')),
    country: z.string().length(2).toUpperCase(), // ISO 3166-1 alpha-2
    city: shortText(80),
    phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +254712345678'),
    socials: socialsSchema,
    role: z.enum(['buyer', 'seller', 'both']),
  })
  .partial()
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
