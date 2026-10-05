import { test, expect, type Page, type Locator } from '@playwright/test';

// E2E Phase 6 — Private Messaging Journey.
//
// Covers, through the real Admin/Leader UI wherever a real UI path exists:
//   A. Admin initiates two separate private conversations (one via
//      SELECTED_COMMUNITY targeting the existing "E2E Media Community",
//      one via SELECTED_MEMBERS targeting a freshly created Person) and
//      sends a message in each.
//   B. Admin's own inbox shows both conversations with the correct,
//      non-leaked message content in each.
//   C. Mary Ngu (the real recipient behind "E2E Media Community") logs in
//      for real and sees the message, replies, and has it marked read.
//   D. Server-enforced isolation: Mary Ngu cannot reach the OTHER
//      conversation by substituting its id, and a Leader with no Community
//      leadership role cannot initiate a private conversation at all —
//      verified with real, authenticated requests against the real server.
//
// -------------------------------------------------------------------------
// DISCOVERED / CARRIED-OVER LIMITATIONS — read before changing this file
// -------------------------------------------------------------------------
//
// (1) Recipient-side Member verification (Section 8's "Member journey
// limitation"). Private Messaging's "Member" side (PrivateConversation.
// memberPersonId) is keyed purely by Person id, not by requiring an actual
// Member magic-link session — so unlike the blocked Member Dashboard
// journey (Phase 4), this phase CAN verify genuine recipient-side behavior:
// Mary Ngu's existing, already-linked Person (from Phase 3's
// SEED_E2E_MEDIA fixture) is a real, eligible private-message recipient,
// and she has a real password login. This spec uses that to verify the
// recipient actually sees the message, can reply, and the unread/read
// cursor is enforced server-side — all through her genuine Leader Dashboard
// session (the same shared <PrivateMessages> component the Member
// Dashboard also uses). What remains unverified is the Member Dashboard's
// OWN rendering of this feature specifically (its layout is identical
// code, but was never opened via a genuine Member magic-link session in
// this environment, per Phase 4's still-unresolved email-delivery gap) —
// not the underlying authorization or data correctness, which this spec
// does verify for real.
//
// (2) Leader-authorized-messaging positive case is not verifiable here.
// The same isTestData:true-exclusion in the Admin "Grant Role Assignment"
// picker documented in Phase 5 (limitation 3) means neither named test
// Leader can be given a NEW Community leadership role through the real
// Admin UI without reusing a brand-new, non-login Person (as Phase 5 did).
// Since initiating a Leader-side private message requires an authenticated
// LEADER SESSION that also holds that exact leadership, and Mary Ngu (our
// only usable real Leader login here — John Tabi stays intentionally
// unlinked, per Phase 3's own existing test) currently holds zero
// RoleAssignments, there is no real browser session in this environment
// that is simultaneously (a) loggable-in and (b) an authorized Community
// Leader. This spec therefore verifies the NEGATIVE path with a real
// session instead: Mary Ngu, holding no Community leadership at all, is
// correctly denied by both the UI (StartPrivateMessage renders "You do not
// currently lead any Community." with no way to even attempt sending) and
// the server (a direct, authenticated POST to
// /api/leader/private-messages/conversations still returns 403
// server-side, regardless of what personId is requested — proving this
// isn't merely a UI-level restriction). The more specific "Leader DOES
// lead Community A but is denied for Community B" variant is not
// verifiable here for the same root cause as Phase 5's limitation 3, and
// is not re-solved in this E2E-only phase.
//
// (3) Full-suite rate-limiter interaction (carried over from Phase 5,
// limitation 4). This spec adds two Admin-initiated sends plus a Leader
// login with a full Dashboard mount — see e2e/README.md for the measured
// interaction and why it is not treated as an application defect.
//
// No new seed fixture was added. The only new data is one Person created
// live via the real Admin "+ New Person" form (isTestData:false by
// default), used purely as an "unrelated recipient" for the isolation
// checks — Mary Ngu's existing state and John Tabi's existing unlinked
// state are both left untouched.

function uniqueSuffix(): string {
  return `${Date.now()}`;
}

function cameroonTestWhatsApp(): string {
  // Same proven-valid Cameroon mobile prefix used in Phase 5
  // (+237670005001/+237670005002 already exist in this database).
  const suffix = String(Date.now()).slice(-6).padStart(6, '0');
  return `+237670${suffix}`;
}

async function csrfHeader(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'csrf_token')?.value;
  return token ? { 'x-csrf-token': token } : {};
}

// Fills a SearchPicker's own input, searches, and picks a result — scoped
// to that SearchPicker's own root element (the input's immediate parent),
// never to the whole page. Same defensive pattern as Phase 5's
// communityMembership.spec.ts (an unscoped `getByRole('combobox')` risks
// resolving to an unrelated <select> elsewhere on the same page).
async function pickFromSearchPicker(
  scope: Page | Locator,
  placeholder: string,
  query: string,
  optionLabel: string,
  actionLabel: string,
) {
  const input = scope.getByPlaceholder(placeholder);
  await input.fill(query);
  const container = input.locator('xpath=..');
  await container.getByRole('button', { name: 'Search' }).click();
  await container.getByRole('combobox').selectOption({ label: optionLabel });
  await container.getByRole('button', { name: actionLabel }).click();
}

test.describe('Private Messaging journey', () => {
  test('Admin initiates private conversations through the real UI, the real recipient sees and replies, and server-side isolation holds', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const ts = uniqueSuffix();
    const unrelatedPersonName = `E2E PM Unrelated ${ts}`;
    const unrelatedPersonWhatsapp = cameroonTestWhatsApp();
    const toMaryBody = `E2E Phase 6 message to Mary Ngu ${ts}`;
    const toUnrelatedBody = `E2E Phase 6 unrelated conversation message ${ts}`;
    const maryReplyBody = `E2E Phase 6 Mary Ngu reply ${ts}`;

    // -----------------------------------------------------------------
    // Admin login
    // -----------------------------------------------------------------
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Leader & Admin Login' })).toBeVisible();
    await page.locator('#email').fill('e2e-admin@test.local');
    await page.locator('#password').fill('E2EAdminTest123!');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Admin Dashboard' })).toBeVisible();

    // -----------------------------------------------------------------
    // Create the one "unrelated recipient" Person this spec needs, via the
    // real Admin "+ New Person" form (isTestData:false by default, so it
    // IS discoverable in the SELECTED_MEMBERS picker below — unlike Mary
    // Ngu's own isTestData:true Person, per limitation 2 above).
    // -----------------------------------------------------------------
    await page.getByRole('button', { name: 'People' }).click();
    await page.getByRole('button', { name: '+ New Person' }).click();
    await page.getByPlaceholder('Full name').fill(unrelatedPersonName);
    await page.getByPlaceholder('WhatsApp number (e.g. +237 6XX XXX XXX)').fill(unrelatedPersonWhatsapp);
    await page.getByRole('button', { name: 'Create Person' }).click();
    await expect(page.locator('tr', { hasText: unrelatedPersonName })).toBeVisible();

    // -----------------------------------------------------------------
    // 1 & 2. Admin opens the existing Private Messaging area and initiates
    // a conversation via SELECTED_COMMUNITY, targeting the existing
    // "E2E Media Community" (Phase 3's fixture) — its one existing ACTIVE
    // member is Mary Ngu's Person, so this reaches a real, loggable-in
    // recipient without needing the broken isTestData-excluding people
    // search (see limitation 2).
    // -----------------------------------------------------------------
    await page.getByRole('button', { name: 'Private Messages' }).click();
    // Two headings legitimately say "Private Messages" here: the tab's own
    // section heading, and the embedded shared <PrivateMessages> inbox's
    // title (shown via alwaysShow once its own conversations fetch
    // resolves) — .first() targets the tab heading, which is what signals
    // the tab actually navigated.
    await expect(page.getByRole('heading', { name: 'Private Messages' }).first()).toBeVisible();

    await page.getByRole('radio', { name: 'Selected Community' }).check();
    await pickFromSearchPicker(page, 'Search communities by name', 'E2E Media Community', 'E2E Media Community', 'Select');
    // The Admin compose textarea has a visible "Message" label but no
    // htmlFor/id association (a pre-existing gap in the app's own markup,
    // not something this E2E-only phase modifies) — `<textarea>` is the
    // only one on this page at this point, so the element type alone is
    // an unambiguous, non-brittle locator here.
    await page.locator('textarea').fill(toMaryBody);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(/Message sent to \d+ recipient/)).toBeVisible();

    // 3. Correct recipient targeting via SELECTED_MEMBERS, to the freshly
    // created unrelated Person — used below purely as the isolation
    // control, never logged into.
    await page.getByRole('radio', { name: 'Selected members' }).check();
    await pickFromSearchPicker(page, 'Search people by name', unrelatedPersonName, unrelatedPersonName, 'Add Member');
    await page.locator('textarea').fill(toUnrelatedBody);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(/Message sent to \d+ recipient/)).toBeVisible();

    // -----------------------------------------------------------------
    // 4 & 9. The embedded inbox below only loads once on mount, so switch
    // tabs away and back to force a fresh fetch and see both just-created
    // conversations with their own, non-leaked content.
    // -----------------------------------------------------------------
    await page.getByRole('button', { name: 'Communities' }).click();
    await page.getByRole('button', { name: 'Private Messages' }).click();

    const maryRowAdmin = page.locator('li', { hasText: 'Mary Ngu (E2E)' });
    await expect(maryRowAdmin).toBeVisible();
    await maryRowAdmin.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByText(toMaryBody)).toBeVisible();
    await expect(page.getByText(toUnrelatedBody)).toHaveCount(0);
    await page.getByRole('button', { name: 'Back' }).click();

    const unrelatedRowAdmin = page.locator('li', { hasText: unrelatedPersonName });
    await expect(unrelatedRowAdmin).toBeVisible();
    const unrelatedMessagesRequestPromise = page.waitForRequest(
      (req) => /\/api\/private-messages\/conversations\/[^/]+\/messages$/.test(req.url()) && req.method() === 'GET',
    );
    await unrelatedRowAdmin.getByRole('button', { name: 'Open' }).click();
    const unrelatedMessagesRequest = await unrelatedMessagesRequestPromise;
    const unrelatedConversationId = unrelatedMessagesRequest.url().match(/conversations\/([^/]+)\/messages/)![1];
    await expect(page.getByText(toUnrelatedBody)).toBeVisible();
    await expect(page.getByText(toMaryBody)).toHaveCount(0);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // -----------------------------------------------------------------
    // C. Mary Ngu's real Leader login — the genuine recipient side of the
    // SELECTED_COMMUNITY conversation above (see limitation 1).
    // -----------------------------------------------------------------
    await page.locator('#email').fill('mary.ngu@example.com');
    await page.locator('#password').fill('password123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/leader\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Leader Dashboard' })).toBeVisible();

    // 10. Unread behavior: the conversation shows an unread badge before
    // it's opened.
    const maryConversationRow = page.locator('li', { hasText: 'Central Authority' });
    await expect(maryConversationRow).toBeVisible();
    await expect(maryConversationRow.getByText('1', { exact: true })).toBeVisible();

    await maryConversationRow.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByText(toMaryBody)).toBeVisible();
    // Message isolation: the unrelated conversation's own content never
    // appears inside this one.
    await expect(page.getByText(toUnrelatedBody)).toHaveCount(0);

    // 6. Sending a message — Mary Ngu replies for real.
    await page.getByPlaceholder('Write a message…').fill(maryReplyBody);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(maryReplyBody)).toBeVisible();

    await page.getByRole('button', { name: 'Back' }).click();
    await page.reload();

    // Read behavior: after opening (which marks it read server-side) and
    // reloading fresh from the server, the unread badge is gone.
    const maryConversationRowAfterRead = page.locator('li', { hasText: 'Central Authority' });
    await expect(maryConversationRowAfterRead).toBeVisible();
    await expect(maryConversationRowAfterRead.getByText('1', { exact: true })).toHaveCount(0);

    // -----------------------------------------------------------------
    // D(i). Leader authorization negative case (Section 4 / limitation 2):
    // Mary Ngu holds zero RoleAssignments, so the real UI never even offers
    // a way to attempt sending — and the server independently rejects a
    // direct, authenticated attempt regardless of which personId is named,
    // proving this is enforced server-side, not merely hidden by the UI.
    // -----------------------------------------------------------------
    // Scoped to this specific card: "Organizational Leadership
    // Recommendations" elsewhere on this same Dashboard shows the exact
    // same English text ("You do not currently lead any Community.") for
    // its own, unrelated empty state — an unscoped text lookup is
    // ambiguous between the two.
    const startPrivateMessageHeading = page.getByRole('heading', { name: 'Message a Member' });
    await expect(startPrivateMessageHeading).toBeVisible();
    const startPrivateMessageCard = startPrivateMessageHeading.locator('xpath=..');
    await expect(startPrivateMessageCard.getByText('You do not currently lead any Community.')).toBeVisible();

    const headers = await csrfHeader(page);
    const unauthorizedLeaderSend = await page.request.post('/api/leader/private-messages/conversations', {
      headers,
      data: { personIds: ['00000000-0000-0000-0000-000000000000'], body: 'Should be rejected.' },
    });
    expect(unauthorizedLeaderSend.status()).toBe(403);

    // -----------------------------------------------------------------
    // D(ii). Conversation participant isolation / id-substitution (Section
    // 5): Mary Ngu is a real, authenticated participant of HER OWN
    // conversation, but has no relationship whatsoever to the unrelated
    // conversation — substituting its real id must still be rejected
    // server-side. 404, not 403, per routes/privateMessages.ts's own
    // "never let a non-participant distinguish absent from unauthorized"
    // design — confirmed directly against that exact behavior here.
    const unrelatedAccessAttempt = await page.request.get(`/api/private-messages/conversations/${unrelatedConversationId}/messages`);
    expect(unrelatedAccessAttempt.status()).toBe(404);

    // The unrelated conversation also never appears in Mary Ngu's own
    // conversation list at the UI level.
    await expect(page.getByText(unrelatedPersonName)).toHaveCount(0);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
