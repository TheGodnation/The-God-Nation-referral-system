import { test, expect } from '@playwright/test';

// Second minimal E2E slice: Admin login -> Admin Dashboard -> logout ->
// back to login. Mirrors leaderLogin.spec.ts exactly. Uses the
// deterministic E2E-only Admin fixture created by server/prisma/seed.ts
// when run with SEED_E2E_ADMIN=true (e2e-admin@test.local /
// E2EAdminTest123!, isTestData: true) — never the real bootstrap Admin
// account, and no new fixture is created by this test itself. Must be
// run against a server started with server/.env.test (DATABASE_URL
// pointing at the isolated godnation_test database) that has already
// been seeded with SEED_E2E_ADMIN=true; see e2e/README.md.
test.describe('Admin login', () => {
  test('logs in, sees the Admin Dashboard, and logs out back to login', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Leader & Admin Login' })).toBeVisible();

    await page.locator('#email').fill('e2e-admin@test.local');
    await page.locator('#password').fill('E2EAdminTest123!');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Leader & Admin Login' })).toBeVisible();
  });
});
