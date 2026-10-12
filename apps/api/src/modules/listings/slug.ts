import { randomBytes } from 'node:crypto';

/** "iPhone 13 — 128GB (Blue)!" → "iphone-13-128gb-blue" */
export function slugify(text: string, maxLength = 60): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/, '');
}

/** Listing slugs get a random suffix: titles repeat, and guessable slugs leak drafts. */
export const listingSlug = (title: string) =>
  `${slugify(title) || 'listing'}-${randomBytes(4).toString('hex')}`;
