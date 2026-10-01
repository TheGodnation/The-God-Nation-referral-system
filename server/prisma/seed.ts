import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { backfillPersonsFromRegistrations } from '../src/lib/personBackfill';

const prisma = new PrismaClient();

async function main() {
  // -------------------------------------------------------------------
  // Admin bootstrap — cryptographically random password, printed once.
  // -------------------------------------------------------------------
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@thegodnation.org';
  const existingAdmin = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existingAdmin) {
    const adminPassword = crypto.randomBytes(18).toString('base64url');
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    await prisma.user.create({
      data: {
        name: 'System Administrator',
        email: adminEmail,
        passwordHash,
        role: 'ADMIN',
        active: true,
        mustChangePassword: true,
      },
    });

    console.log('\n================ ADMIN BOOTSTRAP ================');
    console.log(`  Email:    ${adminEmail}`);
    console.log(`  Password: ${adminPassword}`);
    console.log('  (This password is shown ONLY once. Store it safely.)');
    console.log('===================================================\n');
  } else {
    console.log(`Admin user already exists (${adminEmail}) — skipping bootstrap.`);
  }

  // -------------------------------------------------------------------
  // Default Settings row (WhatsApp URLs left empty until Admin configures)
  // -------------------------------------------------------------------
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      whatsappUrlEn: process.env.SEED_WHATSAPP_URL_EN || 'https://chat.whatsapp.com/EXAMPLE-EN',
      whatsappUrlFr: process.env.SEED_WHATSAPP_URL_FR || 'https://chat.whatsapp.com/EXAMPLE-FR',
    },
    update: {},
  });

  // -------------------------------------------------------------------
  // Test Leaders — Mary Ngu (MARY7X2) and John Tabi (JOHN8K4)
  // -------------------------------------------------------------------
  const testLeaders = [
    { name: 'Mary Ngu', email: 'mary.ngu@example.com', code: 'MARY7X2' },
    { name: 'John Tabi', email: 'john.tabi@example.com', code: 'JOHN8K4' },
  ];

  for (const leader of testLeaders) {
    const existing = await prisma.user.findUnique({ where: { email: leader.email } });
    if (existing) {
      console.log(`Test leader already exists: ${leader.name}`);
      continue;
    }

    const password = 'password123'; // Test/dev-only leader credentials.
    const passwordHash = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        name: leader.name,
        email: leader.email,
        passwordHash,
        role: 'LEADER',
        active: true,
        isTestData: true,
      },
    });

    await prisma.referralCode.create({
      data: {
        code: leader.code,
        leaderId: user.id,
        active: true,
        isTestData: true,
      },
    });

    console.log(`Created test leader ${leader.name} <${leader.email}> / code ${leader.code} / password: ${password}`);
  }

  // -------------------------------------------------------------------
  // E2E-only deterministic Admin fixture — opt-in via SEED_E2E_ADMIN=true.
  // Mirrors the Test Leaders block above exactly: a fixed, clearly-fake
  // email/password so Playwright's Admin login journey has a deterministic
  // account to log in as, without ever touching the real Admin bootstrap
  // above (different email, different code path). Inert unless
  // SEED_E2E_ADMIN is explicitly set — a normal/staging/production seed
  // run never sets it. isTestData: true, mustChangePassword: false, and
  // the test.local email domain all mark this unmistakably as a
  // test-only fixture, never a real Admin account — see e2e/README.md.
  // -------------------------------------------------------------------
  if (process.env.SEED_E2E_ADMIN === 'true') {
    const e2eAdminEmail = 'e2e-admin@test.local';
    const existingE2EAdmin = await prisma.user.findUnique({ where: { email: e2eAdminEmail } });

    if (!existingE2EAdmin) {
      const e2eAdminPassword = 'E2EAdminTest123!'; // Test/E2E-only — never a real credential.
      const passwordHash = await bcrypt.hash(e2eAdminPassword, 12);

      await prisma.user.create({
        data: {
          name: 'E2E Test Admin',
          email: e2eAdminEmail,
          passwordHash,
          role: 'ADMIN',
          active: true,
          isTestData: true,
          mustChangePassword: false,
        },
      });

      console.log(`Created E2E test admin <${e2eAdminEmail}> / password: ${e2eAdminPassword}`);
    } else {
      console.log(`E2E test admin already exists (${e2eAdminEmail}) — skipping.`);
    }
  }

  // -------------------------------------------------------------------
  // Phase 3A: link every existing Registration to its Person identity.
  // Idempotent — safe to run on every deploy.
  // -------------------------------------------------------------------
  const { linked } = await backfillPersonsFromRegistrations();
  console.log(`Person backfill: linked ${linked} registration(s) to a Person.`);

  console.log('\nSeed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
