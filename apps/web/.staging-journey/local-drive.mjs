// Drives the local app (web :3002, api :3001) like a person on a Kenyan phone. node local-drive.mjs
import { mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { chromium, devices } from '@playwright/test';

const BASE = 'http://localhost:3002';
const OUT = '.staging-journey/results/local';
mkdirSync(OUT, { recursive: true });

// A small solid-colour PNG, the same idea as e2e/fixtures png()
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
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
const ctx = await browser.newContext({
  ...devices['Pixel 7'],
  viewport: { width: 375, height: 740 },
  locale: 'en-KE',
  timezoneId: 'Africa/Nairobi',
  baseURL: BASE,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`${new URL(page.url()).pathname}: ${e.message.slice(0, 90)}`));
page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`console: ${m.text().slice(0, 120)}`));
const step = (s) => console.log(`• ${s}`);

// Browse, signed out
await page.goto('/feed', { waitUntil: 'networkidle' });
const chips = await page.getByRole('navigation', { name: 'Categories' }).getByRole('link').evaluateAll((els) =>
  new Set(els.map((e) => Math.round(e.getBoundingClientRect().height))).size,
);
step(`Discover: ${await page.locator('main a[href^="/l/"]').count()} listing links, chip heights all equal: ${chips === 1}`);
await page.screenshot({ path: `${OUT}/1-discover.png` });

// The title link is stretched over the whole card; that's what a tap lands on
await page.locator('main a[href^="/l/"][class*="after:inset-0"]').first().click();
await page.waitForURL(/\/l\//);
await page.waitForLoadState('networkidle');
step(`Opened listing: "${await page.getByRole('heading', { level: 1 }).innerText()}"`);
await page.screenshot({ path: `${OUT}/2-listing.png` });

// Sign up, confirm by email, onboard as a seller
const email = `local-run-${Date.now()}@e2e.local`;
await page.goto('/signup');
await page.getByLabel('Email').fill(email);
await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
await page.getByRole('button', { name: 'Create account' }).click();
await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
await page.goto(await mailLink(email));
await page.waitForLoadState('networkidle');
step(`Signed up ${email}, confirmed via the Mailhog link`);
await page.goto('/onboarding');
await page.getByLabel('Display name').fill('Akinyi Local');
await page.getByLabel('Username').fill(`akinyi${Date.now().toString(36)}`);
await page.getByRole('radio', { name: 'Selling' }).check({ force: true });
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByLabel('Country').selectOption('KE');
await page.getByLabel('City or town').fill('Kisumu');
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByRole('button', { name: 'Skip for now' }).click();
await page.waitForURL(/\/feed$/);
step('Onboarded as a seller in Kisumu');

// Post an item with two photos (uploads go to SeaweedFS locally)
const title = `Samsung Galaxy A54 ${Date.now().toString(36)}`;
await page.goto('/create');
await page.getByRole('radio', { name: /Item/ }).check({ force: true });
await page.getByRole('button', { name: 'Electronics', exact: true }).click();
await page.getByRole('button', { name: 'Phones & Tablets' }).click();
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByLabel('Title').fill(title);
await page.getByLabel('Description').fill('128 GB, always in a case, battery holds a full day. Charger and box included.');
await page.getByLabel('Condition').selectOption('good');
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByLabel('Choose photos').setInputFiles([
  { name: 'front.png', mimeType: 'image/png', buffer: png(64, 48, [15, 123, 95]) },
  { name: 'back.png', mimeType: 'image/png', buffer: png(48, 64, [242, 169, 59]) },
]);
await page.getByLabel('Uploading').first().waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
await page.getByText('Cover', { exact: true }).waitFor({ timeout: 30_000 });
step('Two photos uploaded');
await page.screenshot({ path: `${OUT}/3-photos-step.png` });
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByLabel('Price', { exact: true }).fill('32000');
await page.getByRole('button', { name: 'Continue' }).click();
await page.getByRole('button', { name: 'Publish' }).click();
await page.waitForURL(/\/l\/[a-z0-9-]+$/, { timeout: 30_000 });
await page.waitForLoadState('networkidle');
const decoded = await page.locator('main img').evaluateAll((imgs) => imgs.filter((i) => i.complete && i.naturalWidth > 0).length);
step(`Published ${page.url().replace(BASE, '')}, ${decoded} photo(s) showing`);
await page.screenshot({ path: `${OUT}/4-published.png`, fullPage: true });

// Desktop look at the same listing
const desk = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'en-KE', timezoneId: 'Africa/Nairobi' });
desk.on('pageerror', (e) => errors.push(`desktop: ${e.message.slice(0, 90)}`));
await desk.goto(page.url(), { waitUntil: 'networkidle' });
await desk.screenshot({ path: `${OUT}/5-listing-desktop.png` });
step('Desktop listing page captured');

console.log(`\nerrors in the browser (${errors.length}):\n  ${errors.join('\n  ') || 'none'}`);
await browser.close();
