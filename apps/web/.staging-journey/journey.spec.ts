import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { devices, expect, test, type Page } from '@playwright/test';
import { png, postListing } from '../e2e/fixtures';
import { createProfile, logIn, signUp, uniqueHandle } from '../e2e/support';

const FLY = 'C:/Users/Admin/.fly/bin/flyctl.exe';
const BASE = 'https://markethub-web-staging.fly.dev';
// A phone set up the way most users' are: English (Kenya), Nairobi time
const phone = {
  ...devices['Pixel 7'],
  viewport: { width: 375, height: 740 },
  locale: 'en-KE',
  timezoneId: 'Africa/Nairobi',
  baseURL: BASE,
};

const results: { step: string; ok: boolean; note?: string }[] = [];
const problems: string[] = [];

/** Runs one check and records it; a failure is noted, never the end of the sweep. */
async function check(step: string, page: Page, fn: () => Promise<unknown>) {
  try {
    await fn();
    results.push({ step, ok: true });
  } catch (e) {
    const shown = await page
      .locator('[role="alert"], [data-sonner-toast], [role="dialog"] [role="status"]')
      .allInnerTexts()
      .catch(() => []);
    const said = shown.map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const why = String((e as Error).message).split('\n').find((l) => l.trim()) ?? 'failed';
    results.push({ step, ok: false, note: why + (said.length ? ` | page says: ${said.join(' / ')}` : '') });
    await page
      .screenshot({ path: `./results/x-${step.replace(/\W+/g, '-').slice(0, 40)}.png`, fullPage: true })
      .catch(() => {});
  }
}

/** Stands in for clicking the confirmation email, which staging can only send to the Resend owner. */
function confirmEmail(email: string) {
  const js = `const {PrismaClient}=require("@prisma/client");const db=new PrismaClient();
db.user.update({where:{email:${JSON.stringify(email)}},data:{isEmailVerified:true},select:{email:true}})
.then(u=>console.log("confirmed "+u.email)).finally(()=>db.$disconnect());`;
  const b64 = Buffer.from(js).toString('base64');
  const out = execFileSync(
    FLY,
    ['ssh', 'console', '-a', 'markethub-api-staging', '-C', `sh -c 'cd /app && echo ${b64} | base64 -d | node'`],
    { encoding: 'utf8' },
  );
  expect(out).toContain(`confirmed ${email}`);
}

function watch(page: Page, who: string) {
  page.on('requestfailed', (r) => {
    if (!/fonts\.|analytics|sentry/.test(r.url()))
      problems.push(`[${who}] request failed: ${r.method()} ${r.url().split('?')[0]} (${r.failure()?.errorText})`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !/\/api\/auth\/refresh|\/api\/me$/.test(r.url()))
      problems.push(`[${who}] HTTP ${r.status()}: ${r.request().method()} ${r.url().split('?')[0]}`);
  });
  page.on('pageerror', (e) => problems.push(`[${who}] page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource'))
      problems.push(`[${who}] console: ${m.text().slice(0, 200)}`);
  });
}

async function fits(page: Page) {
  const { scroll, width } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    width: window.innerWidth,
  }));
  expect(scroll, `sideways scroll at ${width}px`).toBeLessThanOrEqual(width);
}

async function onboard(page: Page, name: string, role: 'Buying' | 'Selling') {
  const email = `journey-${role.toLowerCase()}-${Date.now()}@staging-journey.test`;
  const { password } = await signUp(page, { email });
  confirmEmail(email);
  await page.goto('/onboarding');
  const username = await createProfile(page, name, role);
  await page.getByLabel('Country').selectOption('KE');
  await page.getByLabel('City or town').fill('Nairobi');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page).toHaveURL(/\/feed$/);
  return { username, email, password };
}

test('staging sweep: public pages, seller, buyer, desktop', async ({ page, browser }) => {
  watch(page, 'seller');
  try {
    // ── Signed out, phone width ──────────────────────────────────────────
    for (const [path, status] of [
      ['/', 200],
      ['/search?q=phone', 200],
      ['/c/services', 200],
      ['/login', 200],
      ['/signup', 200],
      ['/forgot-password', 200],
      ['/offline', 200],
      ['/no-such-page-here', 404],
    ] as const) {
      await check(`public ${path}`, page, async () => {
        const res = await page.goto(path);
        expect(res?.status(), 'status').toBe(status);
        await expect(page.locator('main, [role="main"]').first()).toBeVisible();
        await fits(page);
      });
    }
    await check('robots.txt closed, sitemap and manifest served', page, async () => {
      const robots = await page.request.get('/robots.txt');
      expect(await robots.text()).toContain('Disallow: /');
      expect((await page.request.get('/sitemap.xml')).status()).toBe(200);
      expect((await page.request.get('/manifest.webmanifest')).status()).toBe(200);
    });
    await check('signed-out /deals bounces to login', page, async () => {
      await page.goto('/deals');
      await expect(page).toHaveURL(/\/login/);
    });

    // ── Seller ───────────────────────────────────────────────────────────
    const seller = await onboard(page, 'Wanjiru Staging', 'Selling');

    await check('settings: bio saves', page, async () => {
      await page.goto('/settings');
      await page.getByLabel('Bio').fill('Staging sweep seller.');
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByText('Profile saved')).toBeVisible();
    });
    await check('settings: profile photo upload', page, async () => {
      await page.goto('/settings');
      await page.getByLabel('Change profile photo').click();
      await page
        .getByLabel('Choose profile photo')
        .setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png(80, 80) });
      await expect(page.getByText('Photo updated')).toBeVisible({ timeout: 20_000 });
    });
    await check('settings: ID document upload + submit', page, async () => {
      await page.goto('/settings#verification');
      await page
        .getByLabel('Choose ID photos')
        .setInputFiles([{ name: 'id-front.png', mimeType: 'image/png', buffer: png(120, 80) }]);
      await expect(page.getByText('id-front.png')).toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: 'Submit for review' }).first().click();
      await expect(page.getByText(/Submitted — we usually review/)).toBeVisible();
    });
    await check('item listing with photos', page, () => postListing(page, `Pixel 7 ${uniqueHandle()}`, '45000'));

    // A service needs no photo, so the buyer side can be tested whatever uploads do.
    const title = `Phone screen repairs ${uniqueHandle()}`;
    await page.goto('/create');
    await page.getByRole('radio', { name: /Service/ }).check({ force: true });
    await page.getByRole('button', { name: 'Services', exact: true }).click();
    await page.getByRole('button', { name: 'Repairs', exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Title').fill(title);
    await page
      .getByLabel('Description')
      .fill('Screens and batteries for most phones, same day in Nairobi CBD. Three months on parts.');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click(); // photos: optional here
    await page.getByLabel('Price', { exact: true }).fill('2500');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page).toHaveURL(/\/l\/[a-z0-9-]+$/, { timeout: 15_000 });
    const listingUrl = page.url();
    results.push({ step: 'service listing published (no photo)', ok: true });

    await check('listing page', page, async () => {
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      await fits(page);
    });
    await check('public profile shows bio + listing', page, async () => {
      await page.goto(`/u/${seller.username}`);
      await expect(page.getByText('Staging sweep seller.')).toBeVisible();
      await expect(page.getByText(title).first()).toBeVisible();
    });
    await check('seller dashboard lists it', page, async () => {
      await page.goto('/seller');
      await expect(page.getByText(title).first()).toBeVisible();
      await fits(page);
    });

    // ── Buyer ────────────────────────────────────────────────────────────
    const buyerContext = await browser.newContext(phone);
    const buyer = await buyerContext.newPage();
    watch(buyer, 'buyer');
    const shopper = await onboard(buyer, 'Otieno Staging', 'Buying');

    await check('search finds it', buyer, async () => {
      await buyer.goto(`/search?q=${encodeURIComponent(title)}`);
      await expect(buyer.getByText(title).first()).toBeVisible({ timeout: 15_000 });
    });
    await check('category page lists it', buyer, async () => {
      await buyer.goto('/c/repairs');
      await expect(buyer.getByText(title).first()).toBeVisible();
    });
    await check('save → Saved', buyer, async () => {
      // A tap before hydration does nothing on any server-rendered page; wait like a person would
      await buyer.goto(listingUrl, { waitUntil: 'networkidle' });
      await buyer.getByRole('button', { name: `Save ${title}` }).first().click();
      await expect(buyer.getByRole('button', { name: `Remove ${title} from saved` }).first()).toBeVisible();
      await buyer.goto('/saved');
      await expect(buyer.getByText(title).first()).toBeVisible();
    });

    const buyerLog = buyer.getByRole('log', { name: 'Messages' });
    const sellerLog = page.getByRole('log', { name: 'Messages' });
    await check('buyer starts a chat', buyer, async () => {
      await buyer.goto(listingUrl);
      await buyer.getByRole('link', { name: 'Chat', exact: true }).filter({ visible: true }).click();
      await expect(buyer).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);
      const box = buyer.getByLabel('Message', { exact: true });
      await box.click();
      await box.fill('Hi! Can you do a Pixel 7 screen today?');
      await box.press('Enter');
      await expect(buyerLog.getByText('Sent', { exact: true }).first()).toBeVisible();
    });
    await check('seller sees the thread and message', page, async () => {
      await page.goto('/chat');
      await page.getByRole('link', { name: /Otieno Staging/ }).click({ timeout: 15_000 });
      await expect(sellerLog.getByText('Can you do a Pixel 7 screen today?')).toBeVisible();
    });
    await check('seller reply reaches the buyer live', buyer, async () => {
      const box = page.getByLabel('Message', { exact: true });
      await box.click();
      await box.fill('Yes, bring it by 3pm.');
      await box.press('Enter');
      await expect(buyerLog.getByText('Yes, bring it by 3pm.')).toBeVisible({ timeout: 10_000 });
    });
    await check('chat photo', buyer, async () => {
      await buyer
        .getByLabel('Choose photos to send')
        .setInputFiles([{ name: 'crack.png', mimeType: 'image/png', buffer: png(64, 64, [200, 40, 40]) }]);
      await expect(buyer.getByLabel('Uploading')).toHaveCount(0, { timeout: 20_000 });
      await buyer.getByLabel('Message', { exact: true }).press('Enter');
      await expect(buyerLog.locator('img[src*="r2.dev"]').first()).toBeVisible({ timeout: 15_000 });
    });

    await check('offer → seller accepts', buyer, async () => {
      await buyer.goto(listingUrl);
      await buyer.getByRole('link', { name: 'Make offer' }).filter({ visible: true }).click();
      const sheet = buyer.getByRole('dialog', { name: 'Make an offer' });
      await sheet.getByLabel(/price/i).first().fill('2200');
      await sheet.getByRole('button', { name: 'Send offer' }).click();
      const incoming = sellerLog.getByRole('article', { name: 'Their offer' });
      await incoming.getByRole('button', { name: 'Accept' }).click({ timeout: 15_000 });
      await expect(incoming.getByText('Accepted')).toBeVisible();
    });
    await check('checkout → order', buyer, async () => {
      await buyer.goto(listingUrl);
      await buyer.getByRole('link', { name: 'Chat', exact: true }).filter({ visible: true }).click();
      const mine = buyerLog.getByRole('article', { name: 'Your offer' });
      await mine.getByRole('button', { name: 'Check out' }).click();
      const checkout = buyer.getByRole('dialog', { name: 'Checkout' });
      await checkout.getByText('In person', { exact: true }).click();
      await checkout.getByRole('button', { name: 'Place order' }).click();
      await expect(buyer).toHaveURL(/\/orders\/[0-9a-f-]{36}$/);
    });
    await check('Pay now → Paystack checkout', buyer, async () => {
      await buyer.getByRole('button', { name: 'Pay now' }).click();
      const pay = buyer.getByRole('dialog', { name: /Pay KES/ });
      const go = pay.getByRole('button', { name: /Continue to Paystack/ });
      try {
        await expect(go).toBeVisible({ timeout: 20_000 });
      } catch {
        throw new Error(`no Paystack session; dialog says: ${(await pay.innerText()).replace(/\s+/g, ' ')}`);
      }
      await go.click();
      await expect(buyer).toHaveURL(/checkout\.paystack\.com/, { timeout: 20_000 });
      await buyer.screenshot({ path: './results/paystack.png' });
    });
    await check('seller notifications', page, async () => {
      await page.goto('/feed');
      const bell = page.getByRole('button', { name: /^Notifications/ });
      await expect(bell, `bell says "${await bell.getAttribute('aria-label')}"`).toHaveAccessibleName(/\d+ unread/);
    });
    await check('deals page shows the order', buyer, async () => {
      await buyer.goto('/deals');
      await expect(buyer.getByText(title).first()).toBeVisible();
      await fits(buyer);
    });

    await check('log out', buyer, async () => {
      await buyer.goto('/feed');
      await buyer.getByRole('button', { name: 'Account menu' }).click();
      await buyer.getByRole('menuitem', { name: 'Log out' }).click();
      await expect(buyer.getByRole('link', { name: 'Log in' }).first()).toBeVisible();
    });
    await check('forgot password', buyer, async () => {
      await buyer.goto('/forgot-password');
      await buyer.getByLabel('Email').fill(shopper.email);
      await buyer.getByRole('button', { name: 'Send reset link' }).click();
      await expect(buyer.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
    });
    await check('log back in', buyer, () => logIn(buyer, shopper.email, shopper.password));

    // ── Desktop, signed out ──────────────────────────────────────────────
    const desk = await browser.newPage({ viewport: { width: 1280, height: 800 }, baseURL: BASE });
    watch(desk, 'desktop');
    for (const path of ['/', '/search?q=repairs', new URL(listingUrl).pathname, `/u/${seller.username}`, '/c/services']) {
      await check(`desktop ${path}`, desk, async () => {
        expect((await desk.goto(path))?.status(), 'status').toBe(200);
        await expect(desk.locator('main, [role="main"]').first()).toBeVisible();
        await fits(desk);
      });
    }
    console.log(`\nlisting: ${listingUrl}`);
  } finally {
    const counts = new Map<string, number>();
    for (const p of problems) counts.set(p, (counts.get(p) ?? 0) + 1);
    const report = [
      ...results.map((r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.step}${r.note ? `\n        ${r.note}` : ''}`),
      '',
      `network/console problems (${problems.length}):`,
      ...[...counts].map(([p, n]) => `  ${n > 1 ? `${n}× ` : ''}${p}`),
    ].join('\n');
    writeFileSync('./results/report.txt', report);
    console.log(`\n${report}`);
  }
});
