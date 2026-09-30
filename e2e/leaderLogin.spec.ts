import { test, expect } from '@playwright/test';

// First minimal E2E slice: Leader login -> Leader Dashboard -> logout ->
// back to login. Uses the fixed-credential test Leader already created by
// server/prisma/seed.ts (mary.ngu@example.com / password123, isTestData:
// true) — no new fixtures are created by this test. Must be run against a
// server started with server/.env.test (DATABASE_URL pointing at the
// isolated godnation_test database) that has already been seeded; see
// e2e/README.md.
test.describe('Leader login', () => {
  test('logs in, sees the Leader Dashboard, and logs out back to login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Leader & Admin Login' })).toBeVisible();

    await page.locator('#email').fill('mary.ngu@example.com');
    await page.locator('#password').fill('password123');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL(/\/leader\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Leader Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Leader & Admin Login' })).toBeVisible();
  });
});
