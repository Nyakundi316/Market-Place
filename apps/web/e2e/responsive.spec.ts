import type { Page } from '@playwright/test';
import { postListing, verifiedUser } from './fixtures';
import {
  adminCredentials,
  clearRateLimits,
  expect,
  logIn,
  signUp,
  test,
  uniqueHandle,
} from './support';

/**
 * §11: every screen at 375 / 768 / 1280 without sideways scrolling, with the
 * main nav reachable on app pages. The other specs exercise behaviour at 375
 * and 1280; this one is about layout, including the 768 tablet width they skip.
 */
const WIDTHS = [375, 768, 1280] as const;

test.beforeEach(() => clearRateLimits());

/** Anything poking past the right edge that no scroll/clip container is holding. */
async function overflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const vw = root.clientWidth;
    const held = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (getComputedStyle(p).overflowX !== 'visible') return true;
      }
      return false;
    };
    const offenders: string[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      const box = el.getBoundingClientRect();
      if (!box.width || !box.height || (box.right <= vw + 1 && box.left >= -1)) continue;
      if (getComputedStyle(el).visibility === 'hidden' || held(el)) continue;
      const cls = [...el.classList].slice(0, 4).join('.');
      const text = (el.textContent ?? '').trim().slice(0, 30);
      offenders.push(
        `${el.tagName.toLowerCase()}${cls && `.${cls}`} [${Math.round(box.left)}→${Math.round(box.right)}] "${text}"`,
      );
    }
    return { scroll: root.scrollWidth - vw, offenders: offenders.slice(0, 6) };
  });
}

async function sweep(page: Page, paths: string[], opts: { nav?: boolean } = {}) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 740 : 900 });
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator('main, [role="main"]').first()).toBeVisible();
      // Let entrance animations land; looping ones (pulses, skeletons) never finish.
      await page.evaluate(() =>
        Promise.race([
          Promise.all(
            document
              .getAnimations()
              .filter((a) => a.effect?.getTiming().iterations !== Infinity)
              .map((a) => a.finished.catch(() => undefined)),
          ),
          new Promise((r) => setTimeout(r, 2_000)),
        ]),
      );

      const result = await overflow(page);
      expect(result, `${path} at ${width}px`).toEqual({ scroll: 0, offenders: [] });
      if (opts.nav) {
        await expect(
          page.getByRole('navigation', { name: 'Main' }).filter({ visible: true }),
          `${path} at ${width}px: main nav`,
        ).toHaveCount(1);
      }
    }
  }
}

test('public and auth pages', async ({ page }) => {
  // The landing hands off to /signup if left alone; one tap stands it down for the tab.
  const signUpLink = page.getByRole('banner').getByRole('link', { name: 'Sign up' });
  await page.goto('/');
  await expect(signUpLink).toHaveAttribute('data-handoff', 'holding', { timeout: 10_000 });
  await page.mouse.click(4, 200);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 740 : 900 });
    await page.goto('/');
    await expect(signUpLink).toHaveAttribute('data-handoff', 'off');
    expect(await overflow(page), `/ at ${width}px`).toEqual({ scroll: 0, offenders: [] });
  }

  await sweep(page, ['/signup', '/login', '/forgot-password', '/offline']);
});

test('onboarding', async ({ page }) => {
  await signUp(page);
  await sweep(page, ['/onboarding']);
});

test('signed-in buyer and seller pages', async ({ page, browser }) => {
  test.slow(); // two verified accounts and a listing with photos

  const seller = await verifiedUser(page, 'Juma Electronics');
  const title = `Pixel 7 ${uniqueHandle()}`;
  await postListing(page, title, '45000');
  const listing = new URL(page.url()).pathname;

  // A real thread, so /chat and /chat/[id] have content to lay out.
  const buyer = await browser.newPage();
  await verifiedUser(buyer, 'Achieng Buyer', 'Buying');
  await buyer.goto(listing);
  await buyer.getByRole('link', { name: 'Chat', exact: true }).filter({ visible: true }).click();
  await expect(buyer).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
  await buyer.getByLabel('Message', { exact: true }).fill('Is it still available?');
  await buyer.getByLabel('Message', { exact: true }).press('Enter');
  await expect(
    buyer.getByRole('log', { name: 'Messages' }).getByText('Sent', { exact: true }),
  ).toBeVisible();
  const thread = new URL(buyer.url()).pathname;
  await buyer.close();

  await page.goto('/chat');
  await expect(page.getByRole('link', { name: /Achieng Buyer/ })).toBeVisible();

  await sweep(
    page,
    [
      '/feed',
      listing,
      `/u/${seller}`,
      '/search?q=Pixel',
      '/c/electronics',
      '/create',
      '/seller',
      '/saved',
      '/deals',
      '/settings',
      '/chat',
      thread,
    ],
    { nav: true },
  );
});

test('admin pages', async ({ page }) => {
  const admin = adminCredentials();
  await logIn(page, admin.email, admin.password);
  await sweep(
    page,
    [
      '/admin',
      '/admin/reports',
      '/admin/disputes',
      '/admin/verifications',
      '/admin/users',
      '/admin/audit',
    ],
    { nav: true },
  );
});
