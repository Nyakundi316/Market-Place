import { defineConfig, devices } from '@playwright/test';

// One-off: a real user's first session on staging, at phone width. Not part of the suite.
export default defineConfig({
  testDir: '.',
  timeout: 900_000,
  workers: 1,
  reporter: 'list',
  outputDir: './results',
  use: {
    ...devices['Pixel 7'],
    viewport: { width: 375, height: 740 },
    locale: 'en-KE',
    timezoneId: 'Africa/Nairobi',
    baseURL: 'https://markethub-web-staging.fly.dev',
    // A click on a button that never enables (an upload that failed) used to wait out the
    // whole test. Fail the step instead and move on.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'on',
  },
});
