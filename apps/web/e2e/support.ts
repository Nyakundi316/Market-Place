import { connect } from 'node:net';
import { test as base, expect, type Page } from '@playwright/test';

const REDIS = new URL(
  process.env.E2E_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://localhost:6379',
);
const MAILHOG = process.env.E2E_MAILHOG_URL ?? 'http://localhost:8025';

/**
 * §11: zero browser console errors. Chrome logs every 4xx as "Failed to load
 * resource", which the sad-path tests trigger on purpose, so those are skipped.
 */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
          errors.push(m.text());
        }
      });
      await use();
      expect(errors, 'browser console errors').toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export const uniqueEmail = (label: string) =>
  `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@e2e.local`;

export const uniqueHandle = () =>
  `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/**
 * Every test signs up from the same IP, which would trip the auth bucket
 * (10/min, §9). Deletes only `rl:*` keys, over raw RESP so the web app
 * doesn't need a Redis client just for tests.
 */
export function clearRateLimits(): Promise<void> {
  const db = REDIS.pathname.slice(1) || '0';
  const lua = "for _,k in ipairs(redis.call('keys','rl:*')) do redis.call('del',k) end";
  const cmd = (...args: string[]) =>
    `*${args.length}\r\n${args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('')}`;

  return new Promise((resolve, reject) => {
    const sock = connect(Number(REDIS.port || 6379), REDIS.hostname);
    let replies = 0;
    sock.on('data', (chunk) => {
      replies += chunk
        .toString()
        .split('\r\n')
        .filter((l) => /^[+:\-$]/.test(l)).length;
      if (chunk.toString().startsWith('-')) reject(new Error(chunk.toString()));
      if (replies >= 2) sock.end(() => resolve());
    });
    sock.on('error', reject);
    sock.write(cmd('SELECT', db) + cmd('EVAL', lua, '0'));
  });
}

interface MailhogItem {
  Content: { Headers: { Subject: string[] }; Body: string };
}

/** Newest link in a mail to `to` whose subject matches, as a same-origin path. */
export async function mailLink(to: string, subject: RegExp): Promise<string> {
  const url = `${MAILHOG}/api/v2/search?kind=to&query=${encodeURIComponent(to)}`;
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const { items } = (await (await fetch(url)).json()) as { items: MailhogItem[] };
        const hit = items.find((m) => subject.test(m.Content.Headers.Subject[0] ?? ''));
        // Bodies are quoted-printable: undo soft breaks and =3D first.
        const body = hit?.Content.Body.replace(/=\r?\n/g, '').replace(/=3D/g, '=');
        link = body && /https?:\/\/[^\s"<>]+token=[\w-]+/.exec(body)?.[0];
        return link;
      },
      { timeout: 10_000 },
    )
    .toBeTruthy();
  const parsed = new URL(link!);
  return parsed.pathname + parsed.search;
}

export async function signUp(page: Page, opts: { email?: string; password?: string } = {}) {
  const email = opts.email ?? uniqueEmail('user');
  const password = opts.password ?? 'correct horse battery';
  await page.goto('/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  // argon2id is slow on purpose; the first hash on a cold API takes ~5s.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 });
  return { email, password };
}

/** Finishes step 1 only; the rest is skippable. */
export async function createProfile(
  page: Page,
  displayName = 'Wanjiru Test',
  role?: 'Buying' | 'Selling' | 'Both',
) {
  const username = uniqueHandle();
  await page.getByLabel('Display name').fill(displayName);
  await page.getByLabel('Username').fill(username);
  if (role) await page.getByRole('radio', { name: role }).check({ force: true });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Where do you trade?' })).toBeVisible();
  return username;
}
