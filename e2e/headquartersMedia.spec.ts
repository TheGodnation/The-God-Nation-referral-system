import path from 'path';
import { test, expect } from '@playwright/test';

// E2E Phase 3 — Headquarters Post Media. Covers the real Admin UI flow for
// creating a Headquarters Post, attaching media through the actual
// authorize -> direct-upload -> finalize lifecycle, publishing, and an
// authorized recipient (the seeded test Leader) viewing the published post.
//
// Uses the existing deterministic fixtures only:
//   - Admin: e2e-admin@test.local / E2EAdminTest123! (seed.ts, SEED_E2E_ADMIN=true)
//   - Recipient: mary.ngu@example.com / password123 (seed.ts, always present),
//     linked to a dedicated Person + ACTIVE membership in a dedicated
//     "E2E Media Community" by seed.ts's own SEED_E2E_MEDIA=true fixture —
//     see that block's comment for exactly what it does and why.
//
// IMPORTANT — real object storage boundary: this suite's execution
// environment has no Cloudflare R2 credentials configured and its network
// egress to Cloudflare is blocked by policy (confirmed before writing this
// test — see e2e/README.md). The real authorize/upload/finalize lifecycle
// is therefore expected to stop at the authorize call with a 503 "Media
// uploads are not available right now." response here — that response IS
// the correct, intended application behavior for an environment with no
// storage configured (lib/storage.ts's own isStorageConfigured() check),
// not a bug and not something this test works around. This test is
// written to pass either way: if it ever runs somewhere R2 IS reachable
// (real credentials + egress allowed), the same file exercises the full
// real upload/publish/signed-download/image-rendering path; here, it
// verifies everything up to that real network boundary and then continues
// the rest of the journey (publish, recipient text, comments, reactions)
// without media, printing a clear note about what could not be verified.
const TEST_IMAGE_PATH = path.join(__dirname, 'fixtures', 'test-image.png');
const TARGET_COMMUNITY_NAME = 'E2E Media Community';

function uniquePostTitle(): string {
  return `E2E Media Test Post ${Date.now()}`;
}

test.describe('Headquarters Post media lifecycle', () => {
  test('Admin creates a post, attaches media through the real UI, publishes it, and an authorized Leader views the result', async ({
    page,
  }) => {
    const postTitle = uniquePostTitle();
    const postBody = 'This post verifies the Headquarters Post media lifecycle end-to-end.';

    // ---------------------------------------------------------------
    // A. Admin login (existing deterministic E2E Admin fixture)
    // ---------------------------------------------------------------
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Leader & Admin Login' })).toBeVisible();
    await page.locator('#email').fill('e2e-admin@test.local');
    await page.locator('#password').fill('E2EAdminTest123!');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();

    // ---------------------------------------------------------------
    // B. Create a Headquarters Post via the real Admin UI
    // ---------------------------------------------------------------
    await page.getByRole('button', { name: 'Headquarters Posts' }).click();
    await expect(page.getByRole('heading', { name: 'Headquarters Posts' })).toBeVisible();

    await page.getByRole('button', { name: '+ New Post' }).click();
    await page.getByLabel('Title (English)').fill(postTitle);
    await page.getByLabel('Body (English)').fill(postBody);

    // Target the dedicated E2E Community (exact-match targeting, not
    // network-wide) — this is the "Selected Communities" audience mode,
    // already the default, selected explicitly here for clarity.
    await page.getByLabel('Selected Communities').check();
    await page.getByPlaceholder('Search communities by name').fill(TARGET_COMMUNITY_NAME);
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('combobox').selectOption({ label: TARGET_COMMUNITY_NAME });
    await page.getByRole('button', { name: 'Add Community' }).click();

    await page.getByRole('button', { name: 'Create Draft' }).click();
    const postRow = page.locator('tr', { hasText: postTitle });
    await expect(postRow).toBeVisible();

    // ---------------------------------------------------------------
    // C. Attach media through the real browser upload workflow — never
    // bypassed by calling the API directly.
    // ---------------------------------------------------------------
    await postRow.getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByText('No media attached yet.')).toBeVisible();

    const authorizeResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/media/authorize') && res.request().method() === 'POST',
    );
    // Real OS-level file picker interaction with the small synthetic fixture.
    await page.locator('input[type="file"]').setInputFiles(TEST_IMAGE_PATH);
    const authorizeResponse = await authorizeResponsePromise;

    let fullRoundTripVerified = false;

    if (authorizeResponse.ok()) {
      // ---- Real R2 is reachable in this environment: exercise the full
      // upload -> finalize -> publish -> signed-download -> rendering path.
      // The finalize call isn't captured via a separate waitForResponse
      // (registering it only after authorize resolves would risk missing
      // it — the browser can complete the whole PUT+finalize chain before
      // the next listener is attached); the UI assertions below only
      // become true once finalize has actually succeeded, which is what
      // actually matters here.
      await expect(page.getByText(/test-image\.png/)).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/\(Image\)/)).toBeVisible();
      fullRoundTripVerified = true;
    } else {
      // ---- Documented environment boundary: no R2 credentials / egress
      // blocked. The authorize call was genuinely reached and the server
      // correctly responded that storage isn't configured — this is the
      // real application boundary, not a mock or bypass.
      expect(authorizeResponse.status()).toBe(503);
      await expect(page.getByText('Media uploads are not available right now.')).toBeVisible();
      console.log(
        '[headquartersMedia.spec.ts] R2 object storage is not configured/reachable in this environment ' +
          '(authorize responded 503 as designed). Skipping real upload/finalize/image-rendering assertions. ' +
          'A follow-up run in an environment with real R2 connectivity is required to verify that path.',
      );
    }

    // Close the edit form without further title/body changes. Two buttons
    // are named "Cancel" while the form is open (the header's own
    // "+ New Post"/"Cancel" toggle, and the form's own dedicated Cancel
    // button) — the form's own is always the last one in DOM order.
    await page.getByRole('button', { name: 'Cancel' }).last().click();

    // ---------------------------------------------------------------
    // D. Publish using the real UI
    // ---------------------------------------------------------------
    await postRow.getByRole('button', { name: 'Publish' }).click();
    await expect(postRow.getByText('Published')).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // ---------------------------------------------------------------
    // E. Recipient journey — authorized Leader (existing deterministic
    // fixture, linked to the target Community by seed.ts's SEED_E2E_MEDIA
    // fixture)
    // ---------------------------------------------------------------
    await page.locator('#email').fill('mary.ngu@example.com');
    await page.locator('#password').fill('password123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/leader\/dashboard$/);

    const listItem = page.locator('li', { hasText: postTitle });
    await expect(listItem).toBeVisible();
    await listItem.getByRole('button', { name: 'Read More' }).click();

    // Existing post text is visible regardless of the media outcome.
    await expect(page.getByText(postBody)).toBeVisible();

    if (fullRoundTripVerified) {
      // The browser must successfully retrieve the signed media URL and
      // render a real <img>, not merely a filename/metadata string.
      const img = page.getByAltText('Image attached to this post');
      await expect(img).toBeVisible();
      const src = await img.getAttribute('src');
      expect(src).toBeTruthy();
      const imgResponse = await page.request.get(src!);
      expect(imgResponse.ok()).toBeTruthy();
      expect(imgResponse.headers()['content-type']).toContain('image');
    } else {
      // No media was ever finalized in this environment, so none is
      // rendered — confirms media absence doesn't fabricate a broken UI.
      await expect(page.getByAltText('Image attached to this post')).toHaveCount(0);
    }

    // ---------------------------------------------------------------
    // F. Existing post functionality regression — comments and reactions
    // still work on a post that went through the media attach attempt.
    // ---------------------------------------------------------------
    await expect(page.getByText('No comments yet.')).toBeVisible();
    await page.getByPlaceholder('Write a comment…').fill('E2E regression comment.');
    await page.getByRole('button', { name: 'Post Comment' }).click();
    await expect(page.getByText('E2E regression comment.')).toBeVisible();

    await page.getByRole('button', { name: 'React' }).click();
    await expect(page.getByRole('button', { name: 'Reacted' })).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // ---------------------------------------------------------------
    // G. Authorization check — an existing, already-seeded Leader
    // (John Tabi) with no linked Person at all cannot reach the
    // recipient surface for this (or any) Headquarters Post. This reuses
    // existing seed data — no new fixture was created for this check.
    // Documented limitation: this proves the "no Person link at all"
    // boundary (401), not the finer-grained "linked Person, wrong
    // audience" boundary (404) — the latter would need a second
    // Person+Community fixture, which was deliberately not added to keep
    // this phase's fixture surface minimal, per instruction.
    // ---------------------------------------------------------------
    await page.locator('#email').fill('john.tabi@example.com');
    await page.locator('#password').fill('password123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/leader\/dashboard$/);

    const unauthorizedResponse = await page.request.get('/api/me/headquarters-posts');
    expect(unauthorizedResponse.status()).toBe(401);
  });
});
