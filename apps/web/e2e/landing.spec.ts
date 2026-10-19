import { clearRateLimits, expect, test, uniqueEmail } from './support';

test.beforeEach(() => clearRateLimits());

test('the brief pours out of the pill and drains back on Escape', async ({ page }) => {
  await page.goto('/');
  const pill = page.getByRole('button', { name: "What's MarketHub?" });
  await pill.click();

  const brief = page.getByRole('dialog', { name: /money waits until you.re happy/ });
  await expect(brief).toBeVisible();
  await expect(pill).toHaveAttribute('aria-expanded', 'true');
  await expect(brief.getByRole('link', { name: 'Browse listings' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(brief).toBeHidden();
  await expect(pill).toHaveAttribute('aria-expanded', 'false');
  await expect(pill).toBeFocused();
});

test('left alone, the landing moves on to sign-up once the intro has played', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/signup$/, { timeout: 10_000 });

  // only once per tab: Back must not bounce straight to /signup again
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(7_000);
  await expect(page).toHaveURL(/\/$/);
});

test('touching the page keeps the landing where it is', async ({ page }) => {
  await page.goto('/');
  // Tap once the countdown runs, so the tap can't land before hydration under load.
  const signUp = page.getByRole('banner').getByRole('link', { name: 'Sign up' });
  await expect(signUp).toHaveAttribute('data-handoff', 'holding', { timeout: 10_000 });
  await page.mouse.click(10, 300);
  await expect(signUp).toHaveAttribute('data-handoff', 'off');
  await page.waitForTimeout(5_000);
  await expect(page).toHaveURL(/\/$/);
});

test('the landing hands off to the sign-up card; its tabs keep ?next', async ({ page }) => {
  const email = uniqueEmail('landing');
  await page.goto('/');
  await page.getByRole('banner').getByRole('link', { name: 'Sign up' }).click();
  await expect(page).toHaveURL(/\/signup$/);

  const tabs = page.getByRole('navigation', { name: 'Sign up or log in' });
  await expect(tabs.getByRole('link', { name: 'Sign up' })).toHaveAttribute('aria-current', 'page');

  await page.goto('/signup?next=%2Fcreate');
  await tabs.getByRole('link', { name: 'Log in' }).click();
  await expect(page).toHaveURL(/\/login\?next=%2Fcreate$/);
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible();

  await tabs.getByRole('link', { name: 'Sign up' }).click();
  // The log-in card also has an Email field; filling before the swap types into the old form.
  await expect(page).toHaveURL(/\/signup\?next=%2Fcreate$/);
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  // argon2id is slow on purpose; the first hash on a cold API takes ~5s.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
});
