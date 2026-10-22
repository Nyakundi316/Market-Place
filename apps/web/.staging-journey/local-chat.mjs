// Reproduces "chat not working" on the local app. node local-chat.mjs <listing path> <seller email>
import { chromium, devices } from '@playwright/test';

const BASE = 'http://localhost:3002';
const [LISTING, SELLER] = process.argv.slice(2);
const phone = { ...devices['Pixel 7'], viewport: { width: 375, height: 740 }, locale: 'en-KE', timezoneId: 'Africa/Nairobi', baseURL: BASE };
const log = (s) => console.log(s);

function instrument(page, who) {
  page.on('websocket', (ws) => {
    log(`[${who}] websocket open ${ws.url().split('?')[0]}`);
    ws.on('socketerror', (e) => log(`[${who}] websocket error: ${e}`));
    ws.on('close', () => log(`[${who}] websocket closed`));
    ws.on('framereceived', (f) => /^4[0-4]/.test(String(f.payload)) && log(`[${who}] ← ${String(f.payload).slice(0, 140)}`));
  });
  page.on('console', (m) => ['error', 'warning'].includes(m.type()) && log(`[${who}] console.${m.type()}: ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => log(`[${who}] page error: ${e.message.slice(0, 160)}`));
  page.on('response', (r) => r.status() >= 400 && log(`[${who}] HTTP ${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`));
}

async function mailLink(to) {
  for (let i = 0; i < 20; i++) {
    const { items } = await (await fetch(`http://localhost:8025/api/v2/search?kind=to&query=${encodeURIComponent(to)}`)).json();
    const body = items[0]?.Content.Body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
    const link = body && /https?:\/\/[^\s"<>]+token=[\w-]+/.exec(body)?.[0];
    if (link) return new URL(link).pathname + new URL(link).search;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email for ${to}`);
}

const browser = await chromium.launch();

// Seller, logged in and sitting in the inbox
const seller = await (await browser.newContext(phone)).newPage();
instrument(seller, 'seller');
await seller.goto('/login');
await seller.getByLabel('Email').fill(SELLER);
await seller.getByLabel('Password', { exact: true }).fill('correct horse battery');
await seller.getByRole('button', { name: 'Log in' }).click();
await seller.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
await seller.goto('/chat', { waitUntil: 'networkidle' });
log('[seller] in the inbox');

// A new buyer
const buyer = await (await browser.newContext(phone)).newPage();
instrument(buyer, 'buyer');
const email = `local-buyer-${Date.now()}@e2e.local`;
await buyer.goto('/signup');
await buyer.getByLabel('Email').fill(email);
await buyer.getByLabel('Password', { exact: true }).fill('correct horse battery');
await buyer.getByRole('button', { name: 'Create account' }).click();
await buyer.waitForURL(/\/onboarding/, { timeout: 30_000 });
await buyer.goto(await mailLink(email), { waitUntil: 'networkidle' });
await buyer.goto('/onboarding');
await buyer.getByLabel('Display name').fill('Baraka Buyer');
await buyer.getByLabel('Username').fill(`baraka${Date.now().toString(36)}`);
await buyer.getByRole('radio', { name: 'Buying' }).check({ force: true });
await buyer.getByRole('button', { name: 'Continue' }).click();
await buyer.getByRole('heading', { name: 'Where do you trade?' }).waitFor();
log('[buyer] signed up and confirmed');

await buyer.goto(LISTING, { waitUntil: 'networkidle' });
await buyer.getByRole('link', { name: 'Chat', exact: true }).filter({ visible: true }).click();
await buyer.waitForURL(/\/chat\//, { timeout: 30_000 });
await buyer.waitForLoadState('networkidle');
log(`[buyer] thread open: ${buyer.url().replace(BASE, '')}`);
const box = buyer.getByLabel('Message', { exact: true });
await box.click();
await box.fill('Habari! Is the A54 still available?');
await box.press('Enter');
const sent = await buyer.getByRole('log', { name: 'Messages' }).getByText('Sent', { exact: true }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
log(`[buyer] message acknowledged ("Sent"): ${sent}`);
await buyer.screenshot({ path: '.staging-journey/results/local/chat-buyer.png' });

const arrived = await seller.getByRole('link', { name: /Baraka Buyer/ }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
log(`[seller] thread appeared in the inbox live: ${arrived}`);
await seller.screenshot({ path: '.staging-journey/results/local/chat-seller.png' });
await browser.close();
