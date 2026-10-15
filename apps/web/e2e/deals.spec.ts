import { postListing, verifiedUser } from './fixtures';
import { clearRateLimits, expect, test, uniqueHandle } from './support';

test.beforeEach(() => clearRateLimits());

/**
 * The whole deal, live across two browsers: offer → counter → accept →
 * checkout → pay (sandbox gateway, a decline then a success) → ship →
 * confirm → the seller adds payout details and the escrow is released.
 */
test('negotiate, pay into escrow, ship, confirm, and get paid out', async ({ page, browser }) => {
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
  await expect(page.getByText(/Waiting for Otieno Buyer to pay/)).toBeVisible();

  // Buyer pays (sandbox gateway): a decline first, then a good card.
  await buyer.getByRole('button', { name: 'Pay now' }).click();
  const payment = buyer.getByRole('dialog', { name: 'Pay KES 43,000' });
  await payment.getByLabel('Card number').fill('4000 0000 0000 0002');
  await payment.getByRole('button', { name: /^Pay KES/ }).click();
  await expect(payment.getByText(/Card declined/)).toBeVisible();
  await payment.getByLabel('Card number').fill('4242 4242 4242 4242');
  await payment.getByRole('button', { name: /^Pay KES/ }).click();
  await expect(payment).toBeHidden();
  await expect(buyer.getByText('Paid · in escrow').first()).toBeVisible({ timeout: 15_000 });

  // The seller's open page flips live; they ship with a tracking number.
  await expect(page.getByText('Paid · in escrow').first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Mark as shipped' }).click();
  const ship = page.getByRole('dialog', { name: 'Mark as shipped' });
  await ship.getByLabel(/Tracking number/).fill('G4S-55102');
  await ship.getByRole('button', { name: 'Mark as shipped' }).click();
  await expect(page.getByText('Shipped').first()).toBeVisible();

  // Buyer sees it shipped and confirms receipt.
  await expect(buyer.getByText('Tracking G4S-55102')).toBeVisible({ timeout: 15_000 });
  await buyer.getByRole('button', { name: 'I received it' }).click();
  await buyer
    .getByRole('dialog', { name: 'Confirm you received it?' })
    .getByRole('button', { name: 'I received it' })
    .click();
  await expect(buyer.getByText('Completed').first()).toBeVisible();

  // Seller has no payout account yet: the money waits and the page says how to get it.
  const orderUrl = page.url();
  await page.getByRole('link', { name: 'Add payout details' }).click({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/settings#payouts$/);
  await page.getByRole('button', { name: 'Add bank or mobile money' }).click();
  await page.getByLabel('Bank or wallet').selectOption({ label: 'Sandbox Bank' });
  await page.getByLabel('Account or phone number').fill('0123456789');
  await page.getByRole('button', { name: 'Save payout account' }).click();
  await expect(page.getByText('Sandbox Bank ····6789')).toBeVisible();
  await expect(page.getByText('Ready for payouts')).toBeVisible();

  await page.goto(orderUrl);
  await expect(page.getByText('Paid out to your payout account.')).toBeVisible({ timeout: 15_000 });
  await buyer.close();
});
