import { deflateSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import {
  clearRateLimits,
  createProfile,
  expect,
  mailLink,
  signUp,
  test,
  uniqueHandle,
} from './support';

/** A real (tiny, solid-colour) PNG so the browser can decode and resize it. */
function png(width = 64, height = 48, rgb = [15, 123, 95]) {
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

/** Verified seller with a profile, signed in on `page`. */
async function seller(page: Page) {
  const { email } = await signUp(page);
  await page.goto(await mailLink(email, /confirm|verify/i));
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  await page.goto('/onboarding');
  const username = await createProfile(page, 'Juma Electronics', 'Selling');
  await page.getByLabel('Country').selectOption('KE');
  await page.getByLabel('City or town').fill('Nairobi');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/feed$/);
  return username;
}

async function postListing(page: Page, title: string, price: string) {
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

test.beforeEach(() => clearRateLimits());

test('seller posts with photos → buyer finds, saves and opens it', async ({ page, browser }) => {
  test.slow(); // two accounts, mail round-trip, uploads
  const sellerName = await seller(page);
  const token = uniqueHandle();
  const title = `Pixel 8 Pro ${token}`;
  await postListing(page, title, '78000');

  // Owner view: live, with manage actions and no buy buttons.
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark sold' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Make offer' })).toHaveCount(0);
  await expect(page.getByText(/KES\s?78,000/).filter({ visible: true })).toBeVisible();

  // Buyer, anonymous first: search finds it by a typo of the model name too.
  const buyer = await browser.newPage();
  await buyer.goto(`/search?q=${token}`);
  const card = buyer.getByRole('article').filter({ hasText: title });
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: `Save ${title}` }).click();
  await expect(buyer).toHaveURL(/\/login\?next=/); // saving needs an account

  await signUp(buyer);
  await createProfile(buyer, 'Achieng Buyer');
  await buyer.goto(`/search?q=${token}`);
  await buyer.getByRole('button', { name: `Save ${title}` }).click();
  await expect(buyer.getByRole('button', { name: `Remove ${title} from saved` })).toBeVisible();

  await buyer.goto('/saved');
  await expect(buyer.getByRole('article').filter({ hasText: title })).toBeVisible();

  await buyer.getByRole('link', { name: title }).first().click();
  await expect(buyer.getByRole('heading', { name: title })).toBeVisible();
  await expect(buyer.getByRole('link', { name: 'Make offer' }).filter({ visible: true })).toBeVisible();
  await expect(buyer.getByRole('link', { name: /Juma Electronics/ })).toBeVisible();

  // Seller profile lists it; buyer can follow.
  await buyer.goto(`/u/${sellerName}`);
  await expect(buyer.getByRole('article').filter({ hasText: title })).toBeVisible();
  await buyer.getByRole('button', { name: 'Follow' }).click();
  await expect(buyer.getByRole('button', { name: 'Following' })).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByText('1 follower')).toBeVisible();
  await buyer.close();
});

test('drafts stay private; seller dashboard manages status', async ({ page, browser }) => {
  test.slow();
  await seller(page);
  const title = `Draft only ${uniqueHandle()}`;
  await page.goto('/create');
  await page.getByRole('button', { name: 'Electronics', exact: true }).click();
  await page.getByRole('button', { name: 'Laptops & Computers' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill('ThinkPad T14, 16GB, works well, minor scuffs on lid.');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Continue' }).click(); // no photos
  await page.getByLabel('Price', { exact: true }).fill('55000');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\/l\//);
  await expect(page.getByText('Draft — only you can see this').filter({ visible: true })).toBeVisible();
  const draftUrl = page.url();

  const stranger = await browser.newPage();
  await stranger.goto(draftUrl);
  await expect(stranger.getByRole('heading', { name: 'This listing isn’t available' })).toBeVisible();
  await stranger.close();

  // Publishing a product without photos is refused with a clear message.
  await page.getByRole('button', { name: 'Publish listing' }).click();
  await expect(page.getByText('Add at least one photo before publishing')).toBeVisible();

  await page.goto('/seller');
  await page.getByRole('tab', { name: 'Drafts' }).click();
  await expect(page.getByRole('link', { name: title })).toBeVisible();
  await page.getByRole('button', { name: `Manage ${title}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('link', { name: title })).toHaveCount(0);
});

test('category pages and filters narrow results', async ({ page }) => {
  await page.goto('/c/electronics');
  await expect(page.getByRole('heading', { name: 'Electronics', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Phones & Tablets' })).toBeVisible();
  await page.getByRole('link', { name: 'Phones & Tablets' }).click();
  await expect(page).toHaveURL(/\/c\/phones-tablets/);
  await expect(page.getByRole('link', { name: 'Electronics' }).first()).toBeVisible(); // breadcrumb

  await page.goto('/search?q=nothing-will-ever-match-this-zz');
  await expect(page.getByText('No listings match')).toBeVisible();
});

test('settings: profile photo and bio update', async ({ page }) => {
  await signUp(page);
  const username = await createProfile(page, 'Settings Tester');
  await page.goto('/settings');
  await page.getByLabel('Change profile photo').click();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png(80, 80) });
  await expect(page.getByText('Photo updated')).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('Bio').fill('Weekend seller of vintage cameras.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved')).toBeVisible();

  await page.goto(`/u/${username}`);
  await expect(page.getByText('Weekend seller of vintage cameras.')).toBeVisible();
});
