import dotenv from 'dotenv';
import path from 'path';
// override: true is essential here — without it, dotenv refuses to
// overwrite a DATABASE_URL that may already be present in process.env
// (e.g. inherited from the shell or another loaded .env), which would
// silently point the test suite at the DEVELOPMENT database and TRUNCATE it.
dotenv.config({ path: path.resolve(__dirname, '../../.env.test'), override: true });

import { execSync } from 'child_process';
import { beforeAll, beforeEach, afterAll } from 'vitest';
import { prisma } from '../lib/prisma';

// Hard safety guard: never let this suite run (and TRUNCATE) against
// anything that isn't clearly a test database.
if (!/test/i.test(process.env.DATABASE_URL || '')) {
  throw new Error(
    `Refusing to run tests: DATABASE_URL does not look like a test database: ${process.env.DATABASE_URL}`,
  );
}

beforeAll(() => {
  execSync('npx prisma migrate deploy --schema=prisma/schema.prisma', {
    cwd: path.resolve(__dirname, '../..'),
    env: process.env,
    stdio: 'inherit',
  });
});

beforeEach(async () => {
  // Truncate all app tables between tests for isolation, preserving schema.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog", "Event", "ReferralRelationship", "Registration",
      "ReferralVisit", "ReferralCode", "LoginAttempt", "Session", "Settings", "User"
    RESTART IDENTITY CASCADE;
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});
