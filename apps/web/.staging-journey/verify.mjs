// Before/after for the three bugs the sweep found. node verify.mjs <base url>
import { execFileSync } from 'node:child_process';
import { chromium, devices } from '@playwright/test';

const BASE = process.argv[2];
const LISTING = '/l/phone-screen-repairs-e2emvgz3ek4avr-683a61ea';
const kenyanPhone = { ...devices['Pixel 7'], viewport: { width: 375, height: 740 }, locale: 'en-KE', timezoneId: 'Africa/Nairobi' };
const browser = await chromium.launch();
const ctx = await browser.newContext({ ...kenyanPhone, baseURL: BASE });

// 1. Hydration, with the phone's clock 3 minutes off the server's
for (const path of [LISTING, '/search?q=repairs', '/c/repairs', '/u/e2emvgz2130p6k', '/feed']) {
  const page = await ctx.newPage();
  await page.clock.install({ time: Date.now() + 3 * 60_000 });
  await page.clock.resume();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.match(/#\d+/)?.[0] ?? e.message.slice(0, 50)));
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  console.log(`hydration ${path.padEnd(48)} ${errors.length ? 'ERRORS ' + errors.join(',') : 'clean'}`);
  await page.close();
}

// 2. Category chips stay one line
{
  const page = await ctx.newPage();
  await page.goto('/feed');
  const heights = await page.getByRole('navigation', { name: 'Categories' }).getByRole('link').evaluateAll((els) =>
    els.map((e) => [e.textContent, Math.round(e.getBoundingClientRect().height)]),
  );
  const tall = heights.filter(([, h]) => h > heights[0][1]);
  console.log(`chips: ${heights.length} chips, ${tall.length ? 'taller than one line: ' + JSON.stringify(tall) : 'all one line (' + heights[0][1] + 'px)'}`);
  await page.close();
}

// 3. Offer sheet fits the screen with a long title
{
  const page = await ctx.newPage();
  const email = `journey-verify-${Date.now()}@staging-journey.test`;
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('correct horse battery');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL(/\/onboarding/, { timeout: 20_000 });
  const js = `const {PrismaClient}=require("@prisma/client");const db=new PrismaClient();db.user.update({where:{email:${JSON.stringify(email)}},data:{isEmailVerified:true}}).then(()=>console.log("ok")).finally(()=>db.$disconnect());`;
  execFileSync('C:/Users/Admin/.fly/bin/flyctl.exe', ['ssh', 'console', '-a', 'markethub-api-staging', '-C', `sh -c 'cd /app && echo ${Buffer.from(js).toString('base64')} | base64 -d | node'`]);
  await page.goto('/onboarding');
  await page.getByLabel('Display name').fill('Verify Buyer');
  await page.getByLabel('Username').fill(`verify${Date.now().toString(36)}`);
  await page.getByRole('radio', { name: 'Buying' }).check({ force: true });
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('heading', { name: 'Where do you trade?' }).waitFor();
  await page.goto(LISTING);
  await page.getByRole('link', { name: 'Make offer' }).filter({ visible: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Make an offer' });
  await sheet.waitFor();
  await page.waitForTimeout(600); // slide-in animation
  const m = await sheet.evaluate((el) => {
    const send = [...el.querySelectorAll('button')].find((b) => b.textContent.includes('Send offer'));
    return { scrollW: el.scrollWidth, clientW: el.clientWidth, scrollLeft: el.scrollLeft, sendRight: Math.round(send.getBoundingClientRect().right), vw: innerWidth };
  });
  const ok = m.scrollW <= m.clientW && m.scrollLeft === 0 && m.sendRight <= m.vw;
  console.log(`offer sheet: ${ok ? 'fits' : 'OVERFLOWS'} ${JSON.stringify(m)}`);
  await page.screenshot({ path: `.staging-journey/results/offer-sheet-${new URL(BASE).port || 'staging'}.png` });
}
await browser.close();
