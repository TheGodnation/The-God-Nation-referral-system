import type { FullConfig } from '@playwright/test';

// Hard safety guard for this local-only E2E suite. Mirrors the exact
// convention already established by server/src/__tests__/setup.ts (which
// refuses to run — and TRUNCATE — anything that isn't clearly a test
// database): this refuses to run against anything that isn't clearly a
// local target.
//
// BASE_URL is the one thing every test in this suite actually depends on
// (Playwright only ever talks to it over HTTP), so restricting its host is
// the real enforcement point — it makes it structurally impossible to point
// this suite at staging or production, regardless of how BASE_URL ends up
// set. The DATABASE_URL check below is a secondary, best-effort check for
// the case where it happens to also be present in this process's own
// environment (e.g. exported alongside BASE_URL by whoever runs the suite);
// Playwright itself never touches the database.
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL as string | undefined;

  let host: string;
  try {
    host = new URL(baseURL ?? '').hostname;
  } catch {
    throw new Error(`Refusing to run E2E tests: BASE_URL is not a valid URL: ${baseURL}`);
  }

  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(
      `Refusing to run E2E tests: BASE_URL must be localhost/127.0.0.1 for this local-only suite ` +
        `(got "${baseURL}"). This suite must never run against staging or production.`,
    );
  }

  if (process.env.DATABASE_URL && !/test/i.test(process.env.DATABASE_URL)) {
    throw new Error(
      `Refusing to run E2E tests: DATABASE_URL does not look like a test database: ${process.env.DATABASE_URL}`,
    );
  }
}
