import { test, expect, type Page, type Locator } from '@playwright/test';

// E2E Phase 5 — Community & Membership Journey.
//
// Covers, through the real Admin UI wherever a real UI path exists:
//   A. Admin creates a Community under the existing root Community.
//   B. Admin adds a Person as an ordinary Community member.
//   C. Admin grants a Person Community-scoped leadership (RoleAssignment).
//   D. Admin-side proof that membership/leadership are exact-scoped (a
//      Person in Community A is never implicitly "in" Community B just
//      because they share a parent).
//   E. The atomic Community membership move (A -> B), and proof it never
//      touches the Person's RoleAssignment.
//   F. Real, server-enforced authorization boundaries for an authenticated
//      Leader session with no relationship to a given Community.
//
// -------------------------------------------------------------------------
// TWO DISCOVERED LIMITATIONS — read before changing this file
// -------------------------------------------------------------------------
//
// (1) Role-assignment grant cannot target either named test Leader.
// The Admin UI's "Grant Role Assignment" person-picker and "Link Person to
// Leader" picker both call GET /api/admin/people?search=, which
// unconditionally excludes isTestData:true Persons (unlike the main People
// list, this search never respects the "include test data" checkbox).
// Our only two loggable-in test Leaders are Mary Ngu and John Tabi:
//   - Mary Ngu's linked Person (server/prisma/seed.ts's SEED_E2E_MEDIA
//     fixture) is isTestData:true -> invisible to that picker.
//   - John Tabi has no linked Person, and e2e/headquartersMedia.spec.ts's
//     own "Authorization check" step already depends on him staying
//     unlinked (it asserts 401 specifically because he has none) -- this
//     spec must not link him without breaking that existing, passing test.
//   - Creating a brand-new Leader via the Admin UI only sends an emailed
//     setup link, blocked by the same no-email-delivery gap documented in
//     e2e/memberJourney.spec.ts.
// Resolution (explicitly approved): grant the RoleAssignment to a brand
// new, live-created Person (isTestData:false by default, so it IS visible
// to that picker) instead of either named test Leader. This Person has no
// login, so there is no way to open an authenticated browser session as
// "the Community's own Leader" in this environment -- the positive case
// ("the assigned Leader's own Dashboard shows the Community they lead, and
// they can post under a LEADERS_ONLY policy") is therefore NOT verified
// here and is called out explicitly in this suite's own assertions/final
// report, not silently assumed.
//
// (2) No genuine authenticated Member session (carried over from Phase 4).
// Mary Ngu's real Leader login is used instead, given an ordinary
// CommunityMembership in Community A (separately from the new Person's
// leadership there) -- this makes her a real, server-side "connected but
// not a leader" actor, which IS enough to verify LEADERS_ONLY's negative
// case (a connected non-leader cannot post) with a real, authenticated
// request. It is not a substitute for the genuine Member-facing UI/journey,
// which remains unverified in this environment for the same reason as
// Phase 4: no readable email delivery for the magic-link flow.
//
// Communities A and B are created as children of the existing
// "E2E Media Community" root (itself created by SEED_E2E_MEDIA in Phase 3)
// rather than inventing a brand-new root -- satisfying "create a Community
// under the existing root" using a fixture that already exists. No new
// seed fixture was added for this phase: every Community/Person/
// membership/role-assignment used here is created live, through the real
// Admin UI, during the test itself.
//
// Geography is never touched: no Geography record, no geographic Leader,
// no location-based authorization anywhere in this spec.
//
// (3) Running the full Playwright suite can trip the real generalApiLimiter.
// This spec exercises a materially larger admin surface (two Communities, a
// Person, a RoleAssignment, two detail-view inspections, an atomic move)
// than this suite's other specs, each firing several requests. Measured
// directly: the pre-existing four specs alone already consume roughly 190
// of the production generalApiLimiter's 300-requests-per-60-seconds-per-IP
// budget (server/src/lib/rateLimit.ts) when run back to back, leaving too
// little headroom for this fifth spec's own realistic request volume in the
// same 60-second window — this was reproduced deterministically on repeated
// fresh-server runs, not a transient flake. Every spec, including this one,
// passes reliably alone and in the pre-existing four-spec baseline; it is
// specifically the combined five-spec run, completing in under 20 seconds,
// that can exceed the limiter. This is not a defect in any spec's logic,
// and this file does not reduce its real UI coverage, pad in artificial
// sleeps, or ask for the production rate limit to be raised just to dodge
// it — see e2e/README.md for the measured numbers and current status.

function uniqueSuffix(): string {
  return `${Date.now()}`;
}

function cameroonTestWhatsApp(): string {
  // "670" is a real, already-proven-valid Cameroon mobile prefix in this
  // database's own existing test data (+237670005001/+237670005002) --
  // libphonenumber validates against actual CM numbering-plan prefixes, so
  // an arbitrary "6XXXXXXXX" shape is not guaranteed to pass.
  const suffix = String(Date.now()).slice(-6).padStart(6, '0');
  return `+237670${suffix}`;
}

// Finds a table row by its visible text, paging forward with the real
// "Next" control if it isn't on the currently displayed page. Makes this
// suite robust against an admin list accumulating rows across many prior
// E2E runs in the same long-lived test database, without relying on any
// search feature the admin list itself doesn't have.
async function findRowAcrossPages(page: Page, rowText: string, maxPages = 15) {
  for (let i = 0; i < maxPages; i += 1) {
    const row = page.locator('tr', { hasText: rowText }).first();
    try {
      // Bounded wait per page: tolerates the brief re-fetch after a create
      // action without ever blocking on a "Next" button that may not exist
      // at all (a single page of results renders no pagination controls).
      await row.waitFor({ state: 'visible', timeout: 3000 });
      return row;
    } catch {
      // Not on this page — fall through to check for a next page.
    }
    const nextButton = page.getByRole('button', { name: 'Next' });
    if ((await nextButton.count()) === 0) break;
    if (!(await nextButton.isEnabled())) break;
    await nextButton.click();
  }
  return page.locator('tr', { hasText: rowText }).first();
}

// Fills a SearchPicker's own input, searches, and picks a result — scoped
// to that SearchPicker's own root element (the input's immediate parent),
// never to the whole page. Several admin screens used in this journey have
// an unrelated <select> combobox always on the page at the same time (the
// Person-edit form's "Preferred Language" select, the Role Assignments
// tab's "Filter Status" select) — an unscoped `getByRole('combobox')` can
// resolve to one of those instead of the SearchPicker's own result list.
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

async function csrfHeader(page: Page): Promise<Record<string, string>> {
  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'csrf_token')?.value;
  return token ? { 'x-csrf-token': token } : {};
}

test.describe('Community & Membership journey', () => {
  test('Admin creates Communities, assigns membership and leadership, proves exact scoping, moves membership, and a connected non-leader Community member is denied Leader-only posting', async ({
    page,
  }) => {
    // This journey has far more sequential UI steps than this suite's other
    // specs (two Communities, a Person, a RoleAssignment, an isolation
    // check, an atomic move, then a second login) — the default 30s test
    // timeout is not enough.
    test.setTimeout(120_000);

    const ts = uniqueSuffix();
    const personName = `E2E Phase5 Leader ${ts}`;
    const personWhatsapp = cameroonTestWhatsApp();
    const communityAName = `E2E Community A ${ts}`;
    const communityBName = `E2E Community B ${ts}`;

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

    // Mary Ngu's existing Person is isTestData:true (Phase 3's SEED_E2E_MEDIA
    // fixture) -- without this, the People list/search below would never
    // find her at all.
    await page.getByText('Include test data (QA)').click();

    // -----------------------------------------------------------------
    // A. Admin creates a Person who will hold the new Community's leadership
    // -----------------------------------------------------------------
    await page.getByRole('button', { name: 'People' }).click();
    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();

    await page.getByRole('button', { name: '+ New Person' }).click();
    await page.getByPlaceholder('Full name').fill(personName);
    await page.getByPlaceholder('WhatsApp number (e.g. +237 6XX XXX XXX)').fill(personWhatsapp);
    await page.getByRole('button', { name: 'Create Person' }).click();
    await expect(page.locator('tr', { hasText: personName })).toBeVisible();

    // -----------------------------------------------------------------
    // B. Admin creates two Communities under the existing root Community
    // -----------------------------------------------------------------
    await page.getByRole('button', { name: 'Communities' }).click();
    await expect(page.getByRole('heading', { name: 'National Headquarters' })).toBeVisible();

    const rootRow = await findRowAcrossPages(page, 'E2E Media Community');
    await expect(rootRow).toBeVisible();
    await rootRow.getByRole('button', { name: 'Open' }).click();

    await page.getByRole('button', { name: '+ New Community' }).click();
    await page.getByPlaceholder('Community name').fill(communityAName);
    const createAResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/admin/communities') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create' }).click();
    const communityA = await (await createAResponsePromise).json();
    const rowA = await findRowAcrossPages(page, communityAName);
    await expect(rowA).toBeVisible();

    await page.getByRole('button', { name: '+ New Community' }).click();
    await page.getByPlaceholder('Community name').fill(communityBName);
    const createBResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/admin/communities') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Create' }).click();
    const communityB = await (await createBResponsePromise).json();
    const rowB = await findRowAcrossPages(page, communityBName);
    await expect(rowB).toBeVisible();

    // Community A is set to Leaders-only posting, for the posting-policy
    // check later in this test.
    const rowAForPolicy = await findRowAcrossPages(page, communityAName);
    await rowAForPolicy.getByRole('button', { name: 'Set to Leaders only' }).click();
    await expect((await findRowAcrossPages(page, communityAName)).getByText('Leaders only')).toBeVisible();

    // -----------------------------------------------------------------
    // C. Member assignment — the new Person joins Community A as an
    // ordinary member (Section 5)
    // -----------------------------------------------------------------
    await page.getByRole('button', { name: 'People' }).click();
    await (await findRowAcrossPages(page, personName)).getByRole('button', { name: 'View' }).click();
    await expect(page.getByRole('heading', { name: 'Community Memberships' })).toBeVisible();

    await pickFromSearchPicker(page, 'Search communities by name', communityAName, communityAName, 'Add');
    const newPersonMembershipRow = page.locator('li', { hasText: communityAName });
    await expect(newPersonMembershipRow).toBeVisible();
    await expect(newPersonMembershipRow.getByText('Active')).toBeVisible();

    // -----------------------------------------------------------------
    // D. Leader assignment — the new Person is granted Community-scoped
    // leadership over Community A only (Section 6)
    // -----------------------------------------------------------------
    await page.getByRole('button', { name: 'Role Assignments' }).click();
    await expect(page.getByRole('heading', { name: 'Role Assignments' })).toBeVisible();

    await page.getByRole('button', { name: '+ New Assignment' }).click();
    await pickFromSearchPicker(
      page,
      'Search by name or WhatsApp number',
      personName,
      `${personName} (${personWhatsapp})`,
      'Select',
    );
    await pickFromSearchPicker(page, 'Search communities by name', communityAName, communityAName, 'Select');

    await page.getByRole('button', { name: 'Create Assignment' }).click();
    const assignmentRow = page.locator('tr', { hasText: personName });
    await expect(assignmentRow).toBeVisible();
    await expect(assignmentRow.getByText(`Community: ${communityAName}`)).toBeVisible();
    await expect(assignmentRow.getByText('Active')).toBeVisible();

    // -----------------------------------------------------------------
    // E. Membership isolation / data isolation (Sections 9 & 12) — the new
    // Person's Community Memberships show exactly Community A, never B,
    // despite A and B sharing the same parent. Stays on this one detail
    // view into step G below (the atomic move) rather than navigating away
    // and back, to keep this already request-heavy journey's own request
    // volume down — this suite's specs share a real, production-faithful
    // per-IP request-rate limiter (see generalApiLimiter in
    // server/src/lib/rateLimit.ts), and re-opening a Person's detail view
    // fires three requests (detail, training progress, resource access)
    // every time.
    // -----------------------------------------------------------------
    await page.getByRole('button', { name: 'People' }).click();
    await (await findRowAcrossPages(page, personName)).getByRole('button', { name: 'View' }).click();
    await expect(page.getByText(`${communityAName} —`)).toBeVisible();
    await expect(page.getByText(`${communityBName} —`)).toHaveCount(0);

    // -----------------------------------------------------------------
    // G. Community membership move (Section 11) — atomic move of the new
    // Person's membership from Community A to Community B. Still the same
    // detail view opened for step E above.
    // -----------------------------------------------------------------
    const membershipRowA = page.locator('li', { hasText: communityAName });
    await membershipRowA.getByRole('button', { name: 'Move' }).click();

    // Scoped to the move panel itself: the bottom of this same card always
    // renders its OWN "Add Community" SearchPicker with the identical
    // "Search communities by name" placeholder, so an unscoped lookup here
    // would be ambiguous between the two.
    const movePanel = page.locator('li', { hasText: `Current Community: ${communityAName}` });
    await expect(movePanel.getByText('Destination Community')).toBeVisible();
    await pickFromSearchPicker(movePanel, 'Search communities by name', communityBName, communityBName, 'Select Destination');
    await movePanel.getByRole('button', { name: 'Confirm Move' }).click();
    await expect(page.getByText('Member moved successfully.')).toBeVisible();

    // Never a state with both an ACTIVE A and an ACTIVE B, and never zero
    // active memberships either: exactly one ACTIVE row (B), the other
    // (A) now INACTIVE — not removed.
    const rowAfterMoveA = page.locator('li', { hasText: communityAName });
    const rowAfterMoveB = page.locator('li', { hasText: communityBName });
    await expect(rowAfterMoveA.getByText('Inactive')).toBeVisible();
    await expect(rowAfterMoveB.getByText('Active')).toBeVisible();

    // The membership move touches ONLY CommunityMembership — the Person's
    // RoleAssignment (leadership) for Community A must be completely
    // unaffected.
    await page.getByRole('button', { name: 'Role Assignments' }).click();
    const assignmentRowAfterMove = page.locator('tr', { hasText: personName });
    await expect(assignmentRowAfterMove).toBeVisible();
    await expect(assignmentRowAfterMove.getByText(`Community: ${communityAName}`)).toBeVisible();
    await expect(assignmentRowAfterMove.getByText('Active')).toBeVisible();

    // -----------------------------------------------------------------
    // F. Mary Ngu (existing, real Leader login) also joins Community A as
    // an ordinary member — a genuine "connected but not a leader" actor,
    // used below to verify LEADERS_ONLY's negative case with a real
    // authenticated request (see limitation (2) above for why this
    // substitutes for a genuine Member session here).
    // -----------------------------------------------------------------
    await page.getByRole('button', { name: 'People' }).click();
    await page.getByPlaceholder('Search by name, WhatsApp, or email').fill('Mary Ngu');
    await page.getByRole('button', { name: 'Search' }).click();
    await (await findRowAcrossPages(page, 'Mary Ngu')).getByRole('button', { name: 'View' }).click();
    await pickFromSearchPicker(page, 'Search communities by name', communityAName, communityAName, 'Add');
    await expect(page.getByText(`${communityAName} —`)).toBeVisible();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // -----------------------------------------------------------------
    // H. Leader authorization isolation (Section 10) and the LEADERS_ONLY
    // posting-policy negative case (Section 8) — real, authenticated
    // requests as Mary Ngu, a genuine Leader with no RoleAssignment
    // anywhere and only an ordinary CommunityMembership in Community A.
    // -----------------------------------------------------------------
    await page.locator('#email').fill('mary.ngu@example.com');
    await page.locator('#password').fill('password123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/leader\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Leader Dashboard' })).toBeVisible();

    // Mary Ngu holds no RoleAssignment anywhere, so the Leader-only
    // "My Members" panel and every LeaderCommunityConversations panel are
    // absent entirely — neither Community A nor B's own conversation
    // surface is ever shown to a Leader who doesn't lead them.
    await expect(page.getByText('My Members')).toHaveCount(0);
    await expect(page.getByText(`${communityAName} — Conversation`)).toHaveCount(0);
    await expect(page.getByText(`${communityBName} — Conversation`)).toHaveCount(0);

    const headers = await csrfHeader(page);

    // Community A: Mary Ngu IS a connected member (can read, sees
    // canPost:false under LEADERS_ONLY), but is NOT its leader, so posting
    // is correctly denied.
    const readA = await page.request.get(`/api/communities/${communityA.id}/conversation/messages`);
    expect(readA.ok()).toBeTruthy();
    const readABody = await readA.json();
    expect(readABody.canPost).toBe(false);

    const postA = await page.request.post(`/api/communities/${communityA.id}/conversation/messages`, {
      headers,
      data: { body: 'This should be rejected under Leaders-only policy.' },
    });
    expect(postA.status()).toBe(403);

    // Community B: Mary Ngu has no relationship to it at all (no
    // membership, no leadership) — the exact-scope guarantee means she has
    // no access whatsoever, not merely a posting restriction.
    const readB = await page.request.get(`/api/communities/${communityB.id}/conversation/messages`);
    expect(readB.status()).toBe(403);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
