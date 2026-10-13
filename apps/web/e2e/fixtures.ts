import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { createProfile, expect, mailLink, signUp } from './support';

/** A real (tiny, solid-colour) PNG so the browser can decode and resize it. */
export function png(width = 64, height = 48, rgb = [15, 123, 95]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(width).fill(rgb).flat())]);
  const raw = Buffer.concat(Array(height).fill(row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Verified user with a profile (selling by default), signed in on `page`. */
export async function verifiedUser(
  page: Page,
  displayName = 'Juma Electronics',
  role: 'Buying' | 'Selling' | 'Both' = 'Selling',
) {
  const { email } = await signUp(page);
  await page.goto(await mailLink(email, /confirm|verify/i));
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await page.goto('/onboarding');
  const username = await createProfile(page, displayName, role);
  await page.getByLabel('Country').selectOption('KE');
  await page.getByLabel('City or town').fill('Nairobi');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/feed$/);
  return username;
}

export async function postListing(page: Page, title: string, price: string) {
  await page.goto('/create');
  await page.getByRole('radio', { name: /Item/ }).check({ force: true });
  await page.getByRole('button', { name: 'Electronics', exact: true }).click();
  await page.getByRole('button', { name: 'Phones & Tablets' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByLabel('Title').fill(title);
  await page
    .getByLabel('Description')
    .fill('Bought in March, always in a case. Battery health 92%. Box and charger included.');
  await page.getByLabel('Condition').selectOption('like_new');
  await page.getByLabel('Add a tag').fill('unlocked');
  await page.getByLabel('Add a tag').press('Enter');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Photos step: nothing yet → still allowed to move on, publish will enforce it.
  await page.getByLabel('Choose photos').setInputFiles([
    { name: 'front.png', mimeType: 'image/png', buffer: png() },
    { name: 'back.png', mimeType: 'image/png', buffer: png(48, 64, [242, 169, 59]) },
  ]);
  await expect(page.getByLabel('Uploading')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText('Cover', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByLabel('Country')).toHaveValue('KE'); // prefilled from profile
  await page.getByLabel('Price', { exact: true }).fill(price);
  await page.getByRole('button', { name: 'Continue' }).click();

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page).toHaveURL(/\/l\/[a-z0-9-]+$/, { timeout: 15_000 });
}
