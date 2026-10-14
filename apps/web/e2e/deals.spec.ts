import { postListing, verifiedUser } from './fixtures';
import { clearRateLimits, expect, test, uniqueHandle } from './support';

test.beforeEach(() => clearRateLimits());

/**
 * Offer → counter → accept → checkout → order, live across two browsers.
 * Shipping and delivery need a paid order (Phase 5), so the run ends with the
 * seller cancelling the unpaid order; the API e2e suite covers ship/deliver.
 */
test('negotiate in chat, check out, and cancel the unpaid order', async ({ page, browser }) => {
  test.slow();

  await verifiedUser(page, 'Wanjiku Gadgets');
  const title = `Galaxy S23 ${uniqueHandle()}`;
  await postListing(page, title, '45000');
  const listingUrl = page.url();

  const buyer = await browser.newPage();
  await verifiedUser(buyer, 'Otieno Buyer', 'Buying');
  await buyer.goto(listingUrl);
  await buyer.getByRole('link', { name: 'Make offer' }).filter({ visible: true }).click();

  // The listing CTA opens the thread with the offer sheet up, prefilled at the asking price.
  const offerSheet = buyer.getByRole('dialog', { name: 'Make an offer' });
  await expect(offerSheet.getByLabel(/Price each/)).toHaveValue('45000.00');
  await offerSheet.getByLabel(/Price each/).fill('40000');
  await expect(offerSheet.getByText('KES 40,000', { exact: true })).toBeVisible();
  await offerSheet.getByLabel(/Note/).fill('Can collect today');
  await offerSheet.getByRole('button', { name: 'Send offer' }).click();
  await expect(offerSheet).toBeHidden();

  const buyerLog = buyer.getByRole('log', { name: 'Messages' });
  const buyerFirst = buyerLog.getByRole('article', { name: 'Your offer' });
  await expect(buyerFirst.getByText('KES 40,000')).toBeVisible();
  await expect(buyerFirst.getByText('Waiting for them')).toBeVisible();

  // Seller: the bell has it; following it lands in the thread.
  const bell = page
    .getByRole('button', { name: /Notifications, 1 unread/ })
    .filter({ visible: true });
  await expect(bell).toBeVisible();
  await bell.click();
  await page.getByRole('menuitem', { name: /offered KES 40,000\.00/ }).click();
  await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);

  const sellerLog = page.getByRole('log', { name: 'Messages' });
  const incoming = sellerLog.getByRole('article', { name: 'Their offer' });
  await expect(incoming.getByText('Can collect today')).toBeVisible();
  await incoming.getByRole('button', { name: 'Counter' }).click();
  const counterSheet = page.getByRole('dialog', { name: 'Counter-offer' });
  await expect(counterSheet.getByLabel(/Price each/)).toHaveValue('40000.00');
  await counterSheet.getByLabel(/Price each/).fill('43000');
  await counterSheet.getByRole('button', { name: 'Send counter' }).click();
  await expect(counterSheet).toBeHidden();

  // Buyer sees both changes live: theirs is countered, the counter is actionable.
  await expect(buyerFirst.getByText('Countered')).toBeVisible();
  const counter = buyerLog.getByRole('article', { name: 'Their offer' });
  await expect(counter.getByText('Counter-offer')).toBeVisible();
  await expect(counter.getByText('KES 43,000')).toBeVisible();
  await counter.getByRole('button', { name: 'Accept' }).click();
  await expect(counter.getByText('Accepted')).toBeVisible();
  await expect(buyerLog.getByText('You accepted the offer')).toBeVisible();
  await expect(sellerLog.getByText('Otieno Buyer accepted the offer')).toBeVisible();
  await expect(
    sellerLog
      .getByRole('article', { name: 'Your offer' })
      .getByText('Waiting for the buyer to check out'),
  ).toBeVisible();

  // Checkout → order page.
  await counter.getByRole('button', { name: 'Check out' }).click();
  const checkout = buyer.getByRole('dialog', { name: 'Checkout' });
  await expect(checkout.getByText('KES 43,000').last()).toBeVisible();
  await checkout.getByText('Delivery', { exact: true }).click();
  await expect(checkout.getByLabel('Full name')).toHaveValue('Otieno Buyer');
  await checkout.getByText('Pick up', { exact: true }).click(); // back to pickup: no address needed
  await checkout.getByRole('button', { name: 'Place order' }).click();
  await expect(buyer).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
  const orderNumber = (await buyer.getByRole('heading', { level: 1 }).textContent())!;
  expect(orderNumber).toMatch(/^ORD-\d{4}-\d{6,}$/);
  await expect(buyer.getByText('Pay KES 43,000 to confirm this order')).toBeVisible();
  await expect(buyer.getByText('Awaiting payment').first()).toBeVisible();

  // The chat now links to the order instead of checkout.
  await buyer.goBack();
  await expect(buyerLog.getByText(`Order ${orderNumber} placed`)).toBeVisible();
  await buyerLog.getByRole('link', { name: 'View order' }).click();
  await expect(buyer.getByRole('heading', { name: orderNumber })).toBeVisible();

  // Seller: the order is under Selling with their net after the 2% fee.
  await page.goto('/deals?tab=selling');
  await page.getByRole('link', { name: new RegExp(title) }).click();
  await expect(page.getByRole('heading', { name: orderNumber })).toBeVisible();
  await expect(page.getByText('KES 42,140')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel order' }).click();
  const cancel = page.getByRole('dialog', { name: 'Cancel this order?' });
  await cancel.getByLabel(/Reason/).fill('Sold it in the shop');
  await cancel.getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByText('Order cancelled')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel order' })).toHaveCount(0);

  // The buyer's open order page catches up without a reload.
  await expect(buyer.getByText('Cancelled').first()).toBeVisible();
  await expect(buyer.getByText(/Pay KES/)).toHaveCount(0);
  await buyer.close();
});
