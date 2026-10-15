import { png, postListing, verifiedUser } from './fixtures';
import { adminCredentials, clearRateLimits, expect, logIn, test, uniqueHandle } from './support';

test.beforeEach(() => clearRateLimits());

test('a reported listing is removed from the admin panel', async ({ page, browser }) => {
  test.slow();
  await verifiedUser(page, 'Shady Seller');
  const title = `Too-good iPhone ${uniqueHandle()}`;
  await postListing(page, title, '5000');
  const listingUrl = page.url();

  const buyer = await browser.newPage();
  await verifiedUser(buyer, 'Careful Buyer', 'Buying');
  await buyer.goto(listingUrl);
  await buyer.getByRole('button', { name: 'Report listing' }).click();
  const dialog = buyer.getByRole('dialog', { name: 'Report this listing' });
  await dialog.getByLabel('Scam or fraud').check();
  await dialog.getByLabel(/Details/).fill('Asked me to pay by M-Pesa outside the app');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(buyer.getByText('Thanks — our team will take a look')).toBeVisible();

  const admin = await browser.newPage();
  const { email, password } = adminCredentials();
  await logIn(admin, email, password);
  await admin.goto('/admin/reports');
  const card = admin.getByRole('listitem').filter({ hasText: title });
  await expect(card.getByText('Scam or fraud')).toBeVisible();
  await expect(card.getByText(/Asked me to pay by M-Pesa/)).toBeVisible();
  await card.getByRole('button', { name: 'Remove listing' }).click();
  const confirm = admin.getByRole('dialog', { name: 'Remove this listing?' });
  await confirm.getByLabel(/Reason/).fill('Payment outside the platform');
  await confirm.getByRole('button', { name: 'Remove listing' }).click();
  await expect(admin.getByText('Report resolved')).toBeVisible();
  await expect(admin.getByRole('listitem').filter({ hasText: title })).toHaveCount(0);

  // Gone for buyers; the seller is told why.
  await buyer.reload();
  await expect(buyer.getByText(/not found|isn.t available/i).first()).toBeVisible();
  await page.goto('/feed');
  await page
    .getByRole('button', { name: /Notifications, \d+ unread/ })
    .filter({ visible: true })
    .click();
  await expect(page.getByRole('menuitem', { name: new RegExp(`${title}.*removed`) })).toBeVisible();

  await buyer.close();
  await admin.close();
});

test('ID verification: submit documents, admin approves, badge appears', async ({
  page,
  browser,
}) => {
  test.slow();
  const username = await verifiedUser(page, 'Amina Verified');
  await page.goto('/settings#verification');
  await page
    .getByLabel('Choose ID photos')
    .setInputFiles([{ name: 'id-front.png', mimeType: 'image/png', buffer: png(120, 80) }]);
  await expect(page.getByText('id-front.png')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Submit for review' }).first().click();
  await expect(page.getByText(/Submitted — we usually review/)).toBeVisible();

  const admin = await browser.newPage();
  const { email, password } = adminCredentials();
  await logIn(admin, email, password);
  await admin.goto('/admin/verifications');
  const card = admin.getByRole('listitem').filter({ hasText: 'Amina Verified' }).first();
  await expect(card.getByRole('img', { name: 'Document 1' })).toBeVisible();
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByText('Approved')).toBeVisible();

  await page.goto(`/u/${username}`);
  await expect(page.getByText('ID verified').first()).toBeVisible();
  await admin.close();
});
