import { defineConfig, devices } from '@playwright/test';

// First minimal E2E layer — STAGING CODEBASE, LOCAL TEST ENVIRONMENT ONLY.
//
// This config only ever drives a browser against BASE_URL, hard-defaulted
// to the local Vite dev server. e2e/globalSetup.ts enforces that BASE_URL
// can only ever resolve to localhost/127.0.0.1 — it refuses to run
// otherwise, so this suite can never be accidentally pointed at staging or
// production, however BASE_URL is set.
//
// The app itself must be started against the existing, isolated test
// database (server/.env.test -> godnation_test) and seeded (npm run seed)
// before running these tests — the same DATABASE_URL safety convention
// already enforced by server/src/__tests__/setup.ts. globalSetup also
// checks DATABASE_URL when it happens to be present in this process's own
// environment, for the same reason.
//
// Chromium only, no CI wiring. This execution environment already has a
// Chromium build pre-installed outside Playwright's own managed browser
// cache; PLAYWRIGHT_CHROMIUM_PATH lets that be used directly (see
// launchOptions.executablePath below) instead of downloading a browser —
// unset on a normal machine, where Playwright's own installed browser
// (`npx playwright install chromium`) is used as usual.
const DEFAULT_BASE_URL = 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  globalSetup: require.resolve('./e2e/globalSetup'),
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || DEFAULT_BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
        },
      },
    },
  ],
});
