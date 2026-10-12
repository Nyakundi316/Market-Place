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
    { name: 'mobile', use: { ...devices['Pixel 7'] } }, // 412px — mobile-first (§0)
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
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
