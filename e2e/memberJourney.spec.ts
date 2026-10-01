import { test, expect } from '@playwright/test';

// E2E Phase 4 — Member Journey.
//
// MEMBER MAGIC-LINK E2E LIMITATION (read before changing this file):
// Member authentication is a passwordless magic-link flow
// (POST /api/member/auth/request-link -> emails a one-time token link ->
// POST /api/member/auth/consume). The raw token is never persisted (only
// its hash is stored in MemberLoginToken) and is never returned by any API
// response or rendered in any UI — it exists ONLY inside the email body
// sent via EmailService.sendMemberLoginLink (Resend). This environment has
// no RESEND_API_KEY configured (same class of gap as the Cloudflare R2
// credentials gap documented for headquartersMedia.spec.ts) and no
// mailbox-reading tooling (Mailhog/Mailpit/Mailosaur/etc). Existing server
// integration tests only get around this with `vi.spyOn(EmailService, ...)`
// INSIDE the same Node process as the test — that technique is unavailable
// to a genuine browser-driven E2E test hitting a real, separately-running
// server.
//
// Per explicit instruction, this suite does NOT work around that boundary:
// no raw-token exposure was added to server/src/routes/memberAuth.ts, no
// test-only authentication bypass was added, no Resend credentials or
// third-party inbox service were added, and the real Member authentication
// flow was not changed or weakened in any way.
//
// This test therefore verifies only the real, publicly reachable boundary
// of that flow: opening the actual Member Sign In page, submitting the
// real request-link form (through the UI, not a direct API call) with a
// synthetic identifier, and verifying the server's real response and the
// generic confirmation message shown to the user. It does not claim that
// Member login succeeds, and it does not attempt to reach the Member
// Dashboard. The entire authenticated Member journey — Dashboard, Profile,
// Communities, Headquarters Posts, Resources, Notifications, logout, and
// any downstream Member authorization behavior — remains UNVERIFIED
// through a genuine authenticated browser session in this environment.
// Closing that gap requires either real email delivery reachable from this
// environment, or a deliberate future decision to add a test-only
// authentication bypass — neither of which this phase is permitted to do.
//
// No new seed fixture was added for this spec: the request-link endpoint
// returns the exact same generic response whether or not the submitted
// WhatsApp number matches an existing Person (by design — see
// server/src/routes/memberAuth.ts), so a synthetic, clearly-fake
// identifier exercises the real boundary being tested without requiring
// any backing database row.
test.describe('Member magic-link request boundary', () => {
  test('Member submits the real sign-in request through the UI and sees the generic confirmation', async ({ page }) => {
    await page.goto('/member/login');
    await expect(page.getByRole('heading', { name: 'Member Sign In' })).toBeVisible();

    await page.getByLabel('WhatsApp Number').fill('+237600000099');
    await page.getByLabel('Email').fill('e2e-member-boundary@test.local');

    const requestLinkResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/member/auth/request-link') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Send Sign-In Link' }).click();
    const requestLinkResponse = await requestLinkResponsePromise;

    // The real server endpoint was genuinely reached and responded
    // successfully — this is the actual application boundary, not a mock.
    expect(requestLinkResponse.ok()).toBeTruthy();
    const body = await requestLinkResponse.json();
    expect(body.message).toBe(
      'If that WhatsApp number is registered, a sign-in link has been sent to the email you provided.',
    );

    await expect(page.getByRole('status')).toHaveText(
      'If that WhatsApp number is registered, a sign-in link has been sent to the email you provided.',
    );

    // Stop here. The real one-time token now exists only inside an email
    // this environment cannot send or read — see the file-level comment
    // above. Continuing past this point would require bypassing real
    // Member authentication, which this phase does not do.
  });
});
