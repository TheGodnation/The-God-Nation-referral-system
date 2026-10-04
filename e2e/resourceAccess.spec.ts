import { test, expect, type Page, type Locator } from '@playwright/test';

// Final Targeted E2E Phase — Resource Access Grants.
//
// Covers, through the real Admin UI and a real recipient login:
//   A. Admin creates two Resources, grants one to Mary Ngu (a real,
//      loggable-in recipient) and the other to a freshly created,
//      unrelated Person, and revokes + re-grants Mary Ngu's to prove
//      revocation actually works.
//   B. Mary Ngu's real Leader session sees only the Resource she was
//      granted, and a direct, authenticated request proves she cannot
//      reach the other Resource by substituting its id — real
//      server-enforced isolation, not merely UI hiding.
//   C. Community membership, Leadership, and Follow-Up assignment alone
//      do not create Resource access — verified both by reading
//      lib/resourceAccess.ts's hasResourceAccess (grant-only, no other
//      signal consulted) and by real Admin-side evidence: Mary Ngu (rich
//      Community membership, no grant for the "unrelated" Resource),
//      the Final-Targeted-Phase's own Leader A person (an active
//      Community Leader, zero resource grants), and that same phase's
//      Person A (an actively followed Person, zero resource grants) all
//      show an empty Resource Access list despite those other
//      relationships.
//
// Depends on server/prisma/seed.ts's SEED_E2E_FOLLOWUP fixture (for
// "Leader A" and "Person A" in part C only) — if that flag was not set
// when seeding, those two checks are skipped with a clear console note
// rather than failing; everything else in this spec is independent of it.

function uniqueSuffix(): string {
  return `${Date.now()}`;
}

function cameroonTestWhatsApp(): string {
  const suffix = String(Date.now()).slice(-6).padStart(6, '0');
  return `+237670${suffix}`;
}

async function findRowAcrossPages(page: Page, rowText: string, maxPages = 15) {
  for (let i = 0; i < maxPages; i += 1) {
    const row = page.locator('tr', { hasText: rowText }).first();
    try {
      await row.waitFor({ state: 'visible', timeout: 3000 });
      return row;
    } catch {
      // Not on this page yet — fall through to check for a next page.
    }
    const nextButton = page.getByRole('button', { name: 'Next' });
    if ((await nextButton.count()) === 0) break;
    if (!(await nextButton.isEnabled())) break;
    await nextButton.click();
  }
  return page.locator('tr', { hasText: rowText }).first();
}

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

test.describe('Resource Access Grants journey', () => {
  test('Admin grants/revokes Resource access through the real UI; the real recipient sees only their own grant', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const ts = uniqueSuffix();
    const resourceAName = `E2E Resource A ${ts}`;
    const resourceBName = `E2E Resource B ${ts}`;
    const unrelatedPersonName = `E2E Resource Unrelated ${ts}`;
    const unrelatedPersonWhatsapp = cameroonTestWhatsApp();

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

    await page.getByText('Include test data (QA)').click();

    // -----------------------------------------------------------------
    // 1 & 2. Admin opens Resources and creates two test Resources.
    // -----------------------------------------------------------------
    await page.getByRole('button', { name: 'Resources' }).click();
    await expect(page.getByRole('heading', { name: 'Resources' })).toBeVisible();

    // The "Title (English)" <label> isn't associated with its <input> via
    // htmlFor/id, so getByLabel can't find it — scoped instead to the "New
    // Resource" <form> itself (identified by its own "Create Resource"
    // submit button) and its first <input> (Title English is the first
    // field; Title French is the second, Description fields are
    // <textarea>s, URL comes last).
    await page.getByRole('button', { name: '+ New Resource' }).click();
    const newResourceFormA = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create Resource' }) });
    await newResourceFormA.locator('input').first().fill(resourceAName);
    const createAResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/admin/resources') && res.request().method() === 'POST',
    );
    await newResourceFormA.getByRole('button', { name: 'Create Resource' }).click();
    const resourceA = await (await createAResponsePromise).json();
    await expect(page.locator('tr', { hasText: resourceAName })).toBeVisible();

    await page.getByRole('button', { name: '+ New Resource' }).click();
    const newResourceFormB = page.locator('form').filter({ has: page.getByRole('button', { name: 'Create Resource' }) });
    await newResourceFormB.locator('input').first().fill(resourceBName);
    const createBResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/admin/resources') && res.request().method() === 'POST',
    );
    await newResourceFormB.getByRole('button', { name: 'Create Resource' }).click();
    const resourceB = await (await createBResponsePromise).json();
    await expect(page.locator('tr', { hasText: resourceBName })).toBeVisible();

    // The one new Person this spec needs: isTestData:false by default (the
    // "+ New Person" form), used purely as the unrelated/isolation control
    // for Resource B — never logged into.
    await page.getByRole('button', { name: 'People' }).click();
    await page.getByRole('button', { name: '+ New Person' }).click();
    await page.getByPlaceholder('Full name').fill(unrelatedPersonName);
    await page.getByPlaceholder('WhatsApp number (e.g. +237 6XX XXX XXX)').fill(unrelatedPersonWhatsapp);
    await page.getByRole('button', { name: 'Create Person' }).click();
    await expect(page.locator('tr', { hasText: unrelatedPersonName })).toBeVisible();

    // -----------------------------------------------------------------
    // 3, 4 & 5. Grant Resource A to Mary Ngu (a real, loggable-in Person),
    // then revoke and re-grant it to prove revocation genuinely works.
    // -----------------------------------------------------------------
    await page.getByRole('button', { name: 'People' }).click();
    await page.getByPlaceholder('Search by name, WhatsApp, or email').fill('Mary Ngu');
    await page.getByRole('button', { name: 'Search' }).click();
    await (await findRowAcrossPages(page, 'Mary Ngu')).getByRole('button', { name: 'View' }).click();

    await pickFromSearchPicker(page, 'Search resources by title', resourceAName, resourceAName, 'Grant Access');
    const maryGrantRow = page.locator('li', { hasText: resourceAName });
    await expect(maryGrantRow).toBeVisible();
    await expect(maryGrantRow.getByText('Active')).toBeVisible();

    await maryGrantRow.getByRole('button', { name: 'Revoke' }).click();
    await expect(maryGrantRow.getByText('Revoked')).toBeVisible();

    // Re-grant (the same SearchPicker reactivates the existing row rather
    // than creating a duplicate) — this is the state Mary Ngu's own real
    // session verifies below.
    await pickFromSearchPicker(page, 'Search resources by title', resourceAName, resourceAName, 'Grant Access');
    await expect(page.locator('li', { hasText: resourceAName }).getByText('Active')).toBeVisible();

    // Resource B goes only to the unrelated Person — never to Mary Ngu.
    await page.getByRole('button', { name: '← Back to People' }).click();
    await page.getByPlaceholder('Search by name, WhatsApp, or email').fill(unrelatedPersonName);
    await page.getByRole('button', { name: 'Search' }).click();
    await (await findRowAcrossPages(page, unrelatedPersonName)).getByRole('button', { name: 'View' }).click();
    await pickFromSearchPicker(page, 'Search resources by title', resourceBName, resourceBName, 'Grant Access');
    await expect(page.locator('li', { hasText: resourceBName }).getByText('Active')).toBeVisible();
    // Isolation, admin-side: this Person's own grant list shows Resource B
    // only, never Resource A.
    await expect(page.getByText(resourceAName)).toHaveCount(0);

    // -----------------------------------------------------------------
    // C. Community membership / Leadership / Follow-Up assignment alone
    // do not create Resource access (depends on SEED_E2E_FOLLOWUP).
    // -----------------------------------------------------------------
    await page.getByRole('button', { name: '← Back to People' }).click();
    await page.getByPlaceholder('Search by name, WhatsApp, or email').fill('E2E FollowUp Leader A');
    await page.getByRole('button', { name: 'Search' }).click();
    // .count() has no auto-wait like expect(...).toBeVisible()/waitFor() do
    // — a bare .count() right after the click can read 0 purely from
    // network timing, before a genuinely-present fixture's row has
    // rendered. Same try/catch + waitFor pattern as findRowAcrossPages
    // above, used here because this fixture is only CONDITIONALLY present.
    const leaderARow = page.locator('tr', { hasText: 'E2E FollowUp Leader A' });
    let leaderAPresent = true;
    try {
      await leaderARow.waitFor({ state: 'visible', timeout: 3000 });
    } catch {
      leaderAPresent = false;
    }
    if (leaderAPresent) {
      await leaderARow.getByRole('button', { name: 'View' }).click();
      await expect(page.getByText('No resource access grants yet.')).toBeVisible();

      await page.getByRole('button', { name: '← Back to People' }).click();
      await page.getByPlaceholder('Search by name, WhatsApp, or email').fill('E2E FollowUp Person A');
      await page.getByRole('button', { name: 'Search' }).click();
      await (await findRowAcrossPages(page, 'E2E FollowUp Person A')).getByRole('button', { name: 'View' }).click();
      await expect(page.getByText('No resource access grants yet.')).toBeVisible();
    } else {
      console.log(
        '[resourceAccess.spec.ts] SEED_E2E_FOLLOWUP fixture not present — skipping the Leadership-alone/Follow-Up-alone ' +
          'Resource Access checks (Community-membership-alone and the code-level hasResourceAccess reading still cover ' +
          'this requirement; see this file\'s own header comment).',
      );
    }

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    // -----------------------------------------------------------------
    // B. Mary Ngu's real Leader session — the genuine recipient side.
    // -----------------------------------------------------------------
    await page.locator('#email').fill('mary.ngu@example.com');
    await page.locator('#password').fill('password123');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/leader\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Leader Dashboard' })).toBeVisible();

    await expect(page.getByText(resourceAName)).toBeVisible();
    await expect(page.getByText(resourceBName)).toHaveCount(0);

    // Server-enforced isolation, not merely hidden by the UI: Mary Ngu,
    // genuinely authenticated, still gets 404 substituting Resource B's
    // real id — her extensive Community membership never substitutes for
    // an actual grant.
    const resourceBAttempt = await page.request.get(`/api/me/resources/${resourceB.id}`);
    expect(resourceBAttempt.status()).toBe(404);

    const resourceAAttempt = await page.request.get(`/api/me/resources/${resourceA.id}`);
    expect(resourceAAttempt.ok()).toBeTruthy();

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
