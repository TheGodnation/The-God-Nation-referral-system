import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

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
