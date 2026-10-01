# E2E tests (Playwright)

Local test environment only. Do not run against staging or production —
`playwright.config.ts` / `globalSetup.ts` refuse to run unless `BASE_URL`
resolves to `localhost`/`127.0.0.1`.

## Prerequisites

1. Start the server against the isolated **test** database, matching the
   same `DATABASE_URL` convention already used by `server/src/__tests__/setup.ts`:

   ```bash
   cd server
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/godnation_test?schema=public" \
     NODE_ENV=test \
     npx prisma migrate deploy
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/godnation_test?schema=public" \
     SEED_E2E_ADMIN=true \
     SEED_E2E_MEDIA=true \
     npm run seed
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/godnation_test?schema=public" \
     PORT=4000 \
     npm run dev
   ```

   This seeds the fixed-credential test Leader (`mary.ngu@example.com` /
   `password123`) that `e2e/leaderLogin.spec.ts` logs in as.

   `SEED_E2E_ADMIN=true` additionally creates a deterministic, test-only
   Admin fixture (`e2e-admin@test.local` / `E2EAdminTest123!`,
   `isTestData: true`) that `e2e/adminLogin.spec.ts` logs in as — a
   completely separate account from the real bootstrap Admin created
   earlier in the same seed script. Omit this flag and the fixture is
   simply never created; a normal/staging/production seed run never sets
   it, so the real Admin bootstrap is always unaffected.

   `SEED_E2E_MEDIA=true` additionally links the test Leader Mary Ngu to a
   dedicated Person and gives that Person an ACTIVE membership in a
   dedicated "E2E Media Community" — the Test Leaders above have no
   linked Person by design, so without this fixture Mary Ngu cannot
   qualify as a Headquarters Post recipient. `e2e/headquartersMedia.spec.ts`
   uses this to log in as an already-authorized recipient; it creates the
   Headquarters Post itself (and its Community targeting) through the
   real Admin UI, never via this fixture. Omit this flag and the fixture
   is simply never created; a normal/staging/production seed run never
   sets it.

2. In a second terminal, start the client dev server:

   ```bash
   cd client
   npm run dev
   ```

## Running the suite

```bash
npm run test:e2e
```

`BASE_URL` defaults to `http://localhost:5173`. Override it only with
another local URL if needed — a non-local `BASE_URL` is rejected before any
test runs.

## Scope

Covers the Leader and Admin login/dashboard/logout journeys, and the
Headquarters Post media lifecycle (`headquartersMedia.spec.ts`: Admin
creates/targets/publishes a post, attempts a real media attach through the
browser upload workflow, and an authorized Leader views the result).
Member login (passwordless, email-link based) is deliberately not covered
yet, nor is any Follow-Up/Resource fixture.

### Known environment limitation — R2 object storage

`headquartersMedia.spec.ts` exercises the real Admin media-attach workflow
(file picker -> authorize API -> direct upload -> finalize), but this
sandbox has no Cloudflare R2 credentials configured and its network egress
to Cloudflare is blocked by policy. The authorize call correctly reaches
the server and correctly receives `503 Media uploads are not available
right now` (the real, intended behavior of `lib/storage.ts`'s
`isStorageConfigured()` check when no credentials are present — not a bug,
not mocked, not bypassed). The test is written to pass either way: it
verifies the 503 boundary here, and would exercise the full real
upload/publish/signed-download/image-rendering path automatically if ever
run somewhere R2 is actually reachable (real credentials configured,
egress to `*.r2.cloudflarestorage.com` allowed). **The real R2 PUT and
signed-GET/browser-rendering round trip remains unverified in any
environment this test has actually been run in so far** — closing that
gap requires running this spec where R2 connectivity exists.
