import { randomUUID } from 'node:crypto';
import { postListing, verifiedUser } from './fixtures';
import { clearRateLimits, createProfile, expect, signUp, test, uniqueHandle } from './support';

test.beforeEach(() => clearRateLimits());

test('buyer messages a seller from a listing; both sides update live', async ({
  page,
  browser,
}) => {
  test.slow(); // two accounts, two mail round-trips, a listing with photos

  await verifiedUser(page, 'Juma Electronics');
  const title = `Pixel 7 ${uniqueHandle()}`;
  await postListing(page, title, '45000');
  const listingUrl = page.url();
  await page.goto('/chat');
  await expect(page.getByText('No chats yet')).toBeVisible();

  const buyer = await browser.newPage();
  await verifiedUser(buyer, 'Achieng Buyer', 'Buying');
  await buyer.goto(listingUrl);
  await buyer.getByRole('link', { name: 'Chat', exact: true }).filter({ visible: true }).click();
  await expect(buyer).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  const buyerThread = buyer.getByRole('region', { name: 'Conversation', exact: true });
  await expect(buyerThread.getByText(title)).toBeVisible(); // the listing stays pinned in view

  // click() checks nothing covers the box (the mobile tab bar once did); fill() wouldn't.
  await buyer.getByLabel('Message', { exact: true }).click();
  await buyer.getByLabel('Message', { exact: true }).fill('Hi! Is the Pixel still available?');
  await buyer.getByLabel('Message', { exact: true }).press('Enter');
  const buyerLog = buyer.getByRole('log', { name: 'Messages' });
  await expect(buyerLog.getByText('Hi! Is the Pixel still available?')).toBeVisible();
  await expect(buyerLog.getByText('Sent', { exact: true })).toBeVisible();

  // The seller's inbox picks it up without a reload, with an unread badge.
  const row = page.getByRole('link', { name: /Achieng Buyer/ });
  await expect(row).toBeVisible();
  await expect(row.getByLabel('1 unread')).toBeVisible();
  await row.click();
  const sellerLog = page.getByRole('log', { name: 'Messages' });
  await expect(sellerLog.getByText('Hi! Is the Pixel still available?')).toBeVisible();

  // Opening it sends a read receipt; the seller is shown as online.
  await expect(buyerLog.getByText('Seen', { exact: true })).toBeVisible();
  await expect(buyerThread.getByText('Online', { exact: true })).toBeVisible();

  await page
    .getByLabel('Message', { exact: true })
    .pressSequentially('Yes, still available', { delay: 40 });
  await expect(buyerThread.getByText('typing…')).toBeVisible();
  await page.getByLabel('Message', { exact: true }).press('Enter');
  await expect(buyerLog.getByText('Yes, still available')).toBeVisible();
  await expect(buyerThread.getByText('typing…')).toHaveCount(0);

  // History survives a reload, and "Chat" on the listing reopens the same conversation.
  const threadUrl = buyer.url();
  await buyer.reload();
  await expect(buyerLog.getByText('Hi! Is the Pixel still available?')).toBeVisible();
  await expect(buyerLog.getByText('Yes, still available')).toBeVisible();
  await buyer.goto(listingUrl);
  await buyer.getByRole('link', { name: 'Chat', exact: true }).filter({ visible: true }).click();
  await expect(buyer).toHaveURL(threadUrl);
  await buyer.close();
});

test('chatting needs a confirmed email', async ({ page }) => {
  await signUp(page);
  await createProfile(page, 'Unconfirmed Buyer');
  await page.goto(`/chat/new?listing=${randomUUID()}`);
  await expect(page.getByText('Confirm your email to send messages')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Account settings' })).toBeVisible();
});
