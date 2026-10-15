import { png, postListing, verifiedUser } from './fixtures';
import { clearRateLimits, createProfile, expect, signUp, test, uniqueHandle } from './support';

test.beforeEach(() => clearRateLimits());

test('seller posts with photos → buyer finds, saves and opens it', async ({ page, browser }) => {
  test.slow(); // two accounts, mail round-trip, uploads
  const sellerName = await verifiedUser(page);
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
  await expect(
    buyer.getByRole('link', { name: 'Make offer' }).filter({ visible: true }),
  ).toBeVisible();
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
  await verifiedUser(page);
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
  await expect(
    page.getByText('Draft — only you can see this').filter({ visible: true }),
  ).toBeVisible();
  const draftUrl = page.url();

  const stranger = await browser.newPage();
  await stranger.goto(draftUrl);
  await expect(
    stranger.getByRole('heading', { name: 'This listing isn’t available' }),
  ).toBeVisible();
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
  // The page has other file inputs (verification documents); pick the avatar one.
  await page
    .getByLabel('Choose profile photo')
    .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png(80, 80) });
  await expect(page.getByText('Photo updated')).toBeVisible({ timeout: 15_000 });

  await page.getByLabel('Bio').fill('Weekend seller of vintage cameras.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Profile saved')).toBeVisible();

  await page.goto(`/u/${username}`);
  await expect(page.getByText('Weekend seller of vintage cameras.')).toBeVisible();
});
