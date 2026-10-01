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

Covers the Leader and Admin login/dashboard/logout journeys today. Member
login (passwordless, email-link based) is deliberately not covered yet,
nor is any Community/Follow-Up/Resource fixture — see the E2E readiness
audit for why.
