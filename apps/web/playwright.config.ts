import { defineConfig, devices } from '@playwright/test';

const CI = Boolean(process.env.CI);
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
const API = process.env.E2E_API_URL ?? 'http://localhost:3001';

/**
 * Locally this reuses `pnpm dev` servers if they're up (dev DB, unique users
 * per test). CI builds first and starts both apps against the test DB.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // one IP shares the auth rate-limit bucket (§9)
  workers: 1,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: WEB,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      // §0's 375px floor (iPhone SE / mini). Pixel 7 keeps it on Chromium with touch;
      // devices['iPhone SE'] would switch to WebKit, which CI doesn't install.
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 375, height: 667 } },
      testIgnore: /responsive\.spec/,
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
      testIgnore: /responsive\.spec/,
    },
    // Sets its own widths (375/768/1280, §11), so it runs once rather than per project.
    { name: 'responsive', use: { ...devices['Desktop Chrome'] }, testMatch: /responsive\.spec/ },
  ],
  webServer: [
    {
      command: CI ? 'node dist/main.js' : 'pnpm dev',
      cwd: '../api',
      url: `${API}/health`,
      reuseExistingServer: !CI,
      timeout: 180_000,
      stdout: 'ignore',
    },
    {
      command: CI ? 'pnpm start' : 'pnpm dev',
      url: WEB,
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
  ],
});
