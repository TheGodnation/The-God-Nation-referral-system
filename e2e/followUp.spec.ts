import { test, expect, type Page } from '@playwright/test';

// Final Targeted E2E Phase — Follow-Up / Follow-Up Attention.
//
// Covers, through real authenticated Leader browser sessions:
//   A. The main "My Follow-Up" workflow — view an own assignment, log a
//      real contact through the real UI, see it in history.
//   B. The full Follow-Up Attention classification/precedence matrix,
//      verified by real UI display of pre-seeded, deterministic data
//      (the classification RULE itself is already exhaustively unit/
//      integration-tested server-side in followUpAttention.test.ts — this
//      phase's job is to verify the Leader's own real UI displays it
//      correctly, not to re-derive the rule).
//   C. Leader-vs-Leader authorization isolation, including direct,
//      authenticated server requests (never merely UI absence).
//
// -------------------------------------------------------------------------
// WHY TWO NEW TEST-ONLY LEADER LOGINS WERE ADDED — read before changing
// -------------------------------------------------------------------------
// Follow-Up authorization is scoped to the ACTING Leader's own
// RoleAssignment, so a genuine "Leader A cannot see Leader B's follow-up"
// proof needs two separate, real, loggable-in Leader sessions, each
// holding an ACTIVE RoleAssignment for a DIFFERENT Community. Neither
// existing test Leader could be used: Mary Ngu's linked Person is
// isTestData:true, invisible to the Admin UI's Role-Assignment
// person-search picker (the already-documented limitation); John Tabi
// must stay unlinked, since headquartersMedia.spec.ts's own authorization
// check depends on that. server/prisma/seed.ts's new SEED_E2E_FOLLOWUP
// fixture creates two dedicated test Leaders instead and grants their
// RoleAssignments directly in the seed script (not through that broken
// picker) — see that fixture's own comment for the full reasoning. This
// does not fix or route around the picker bug; it remains exactly as
// broken for any isTestData:true Person.
//
// Member-side Follow-Up (a Member's own read-only view of who follows
// them, GET /api/member/me/follow-ups) is not covered here — it remains
// unverified through a genuine Member magic-link session in this
// environment, for the same already-documented reason as every other
// Member-side surface (no usable email delivery in this sandbox).

async function csrfHeader(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'csrf_token')?.value;
  return token ? { 'x-csrf-token': token } : {};
}

test.describe('Follow-Up journey', () => {
  test('Leader A logs a real contact and sees the full Attention matrix; Leader B is isolated from Leader A\'s follow-ups', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // -----------------------------------------------------------------
    // Leader A — main coverage + Attention matrix
    // -----------------------------------------------------------------
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Leader & Admin Login' })).toBeVisible();
    await page.locator('#email').fill('e2e-followup-leader-a@test.local');
    await page.locator('#password').fill('E2EFollowUpTest123!');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/leader\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Leader Dashboard' })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'My Follow-Up', level: 2 })).toBeVisible();

    // A. Open Person A's own assignment and log a real contact through the
    // real "Log a Contact" form. Scoped to the plain follow-up list (the
    // LAST <ul> in the card), since Person A — not yet contacted — also
    // legitimately appears a second time in the "Needs Attention" card
    // above it (the first <ul>) until the contact below is logged.
    const followUpCard = page
      .getByRole('heading', { name: 'My Follow-Up', level: 2 })
      .locator('xpath=ancestor::div[contains(@class,"card")][1]');
    const mainList = followUpCard.locator('ul').last();
    const personARow = mainList.locator('li', { hasText: 'E2E FollowUp Person A' });
    await expect(personARow).toBeVisible();

    // Registered BEFORE the click that triggers it — openDetail() fires
    // this GET as soon as the "View" button is clicked.
    const contactsRequestPromise = page.waitForRequest(
      (req) => /\/api\/leader\/follow-ups\/[^/]+\/contacts$/.test(req.url()) && req.method() === 'GET',
    );
    await personARow.getByRole('button', { name: 'View' }).click();
    const contactsRequest = await contactsRequestPromise;
    const personAAssignmentId = contactsRequest.url().match(/follow-ups\/([^/]+)\/contacts/)![1];

    await expect(page.getByRole('heading', { name: 'E2E FollowUp Person A' })).toBeVisible();
    await expect(page.getByText('No contacts logged yet.')).toBeVisible();

    // Scoped to the "Log a Contact" form specifically: this detail view
    // also embeds the Follow-Up Conversation panel, which has its own,
    // separate <textarea> composer.
    const logContactForm = page.getByRole('heading', { name: 'Log a Contact', level: 3 }).locator('xpath=..');
    await logContactForm.locator('textarea').fill('E2E Final Phase contact.');
    await logContactForm.getByRole('button', { name: 'Log Contact' }).click();
    await expect(page.getByText('E2E Final Phase contact.')).toBeVisible();
    await expect(page.getByText('No contacts logged yet.')).toHaveCount(0);

    await page.getByRole('button', { name: '← Back to My Follow-Up' }).click();

    // B. Attention matrix — scoped to the "Needs Attention" card itself,
    // since every one of these same people/names also appears a second
    // time in the plain follow-up list below it.
    const attentionHeading = page.getByRole('heading', { name: 'Needs Attention', level: 3 });
    await expect(attentionHeading).toBeVisible();
    const attentionCard = attentionHeading.locator('xpath=..');

    await expect(attentionCard.getByText('E2E FollowUp Emergency')).toBeVisible();
    await expect(attentionCard.getByText('Emergency', { exact: true })).toBeVisible();

    await expect(attentionCard.getByText('E2E FollowUp NeedsAttention')).toBeVisible();
    await expect(attentionCard.getByText('Needs attention', { exact: true })).toBeVisible();

    await expect(attentionCard.getByText('E2E FollowUp UnableToReach')).toBeVisible();
    await expect(attentionCard.getByText('Unable to reach', { exact: true })).toBeVisible();

    await expect(attentionCard.getByText('E2E FollowUp Overdue')).toBeVisible();
    await expect(attentionCard.getByText('Overdue', { exact: true })).toBeVisible();

    await expect(attentionCard.getByText('E2E FollowUp NotYetContacted')).toBeVisible();
    // "Not yet contacted" is literally both this reason's badge text AND
    // the "no contact yet" info line shown for the same zero-contact
    // entry — .first() avoids a strict-mode ambiguity between the two,
    // while still proving the text is genuinely present.
    await expect(attentionCard.getByText('Not yet contacted', { exact: true }).first()).toBeVisible();

    // Non-attention / superseded / closed cases must NOT appear here.
    await expect(attentionCard.getByText('E2E FollowUp Good')).toHaveCount(0);
    await expect(attentionCard.getByText('E2E FollowUp NewerSupersedesOlder')).toHaveCount(0);
    await expect(attentionCard.getByText('E2E FollowUp OldOverdueNotResurfaced')).toHaveCount(0);
    await expect(attentionCard.getByText('E2E FollowUp ClosedEmergency')).toHaveCount(0);
    // Person A is now GOOD with no next-follow-up date (the contact just
    // logged live) — also correctly absent from Attention.
    await expect(attentionCard.getByText('E2E FollowUp Person A')).toHaveCount(0);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // -----------------------------------------------------------------
    // Leader B — isolation (UI absence + real server-enforced boundaries)
    // -----------------------------------------------------------------
    await page.locator('#email').fill('e2e-followup-leader-b@test.local');
    await page.locator('#password').fill('E2EFollowUpTest123!');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/leader\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Leader Dashboard' })).toBeVisible();

    await expect(page.getByText('E2E FollowUp Person B')).toBeVisible();
    // None of Leader A's people are visible anywhere on Leader B's own
    // dashboard — the strongest UI-level isolation statement available.
    await expect(page.getByText('E2E FollowUp Person A')).toHaveCount(0);
    await expect(page.getByText('E2E FollowUp Emergency')).toHaveCount(0);

    // Empty state: Person B's own single contact is GOOD with a far-future
    // next-follow-up date, so Leader B's own Attention section is empty.
    const attentionHeadingB = page.getByRole('heading', { name: 'Needs Attention', level: 3 });
    const attentionCardB = attentionHeadingB.locator('xpath=..');
    await expect(attentionCardB.getByText('Nothing needs your attention right now.')).toBeVisible();

    // Server-enforced isolation, not merely hidden by the UI: Leader B,
    // genuinely authenticated, is still rejected when substituting Leader
    // A's own assignment id — 404, matching the route's own "never let a
    // non-owner distinguish absent from unauthorized" design.
    const headers = await csrfHeader(page);

    const crossLeaderRead = await page.request.get(`/api/leader/follow-ups/${personAAssignmentId}/contacts`);
    expect(crossLeaderRead.status()).toBe(404);

    const crossLeaderWrite = await page.request.post(`/api/leader/follow-ups/${personAAssignmentId}/contacts`, {
      headers,
      data: { wellbeingStatus: 'GOOD' },
    });
    expect(crossLeaderWrite.status()).toBe(404);

    // No client-supplied identity/scope can bypass authorization: Leader B
    // attempts to create a follow-up naming Leader A's own Community as
    // the context — rejected because Leader B holds no RoleAssignment for
    // it, regardless of what the request body claims.
    const bypassAttempt = await page.request.post('/api/leader/follow-ups', {
      headers,
      data: {
        followedPersonId: '00000000-0000-0000-0000-000000000000',
        contextType: 'COMMUNITY',
        contextId: '00000000-0000-0000-0000-000000000000',
      },
    });
    expect(bypassAttempt.status()).toBe(403);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
