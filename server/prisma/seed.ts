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
  // E2E Phase 3 — Headquarters Post Media recipient fixture, opt-in via
  // SEED_E2E_MEDIA=true. The Test Leaders above have no linked Person (by
  // design — see that block's own comment), so Mary Ngu cannot otherwise
  // qualify as a Headquarters Post recipient. This block links her to a
  // dedicated Person and gives that Person an ACTIVE membership in a
  // dedicated, clearly-test-only Community, so
  // e2e/headquartersMedia.spec.ts has a deterministic, already-authorized
  // recipient to log in as. It supplies only the underlying data — the
  // HeadquartersPost itself and its Community targeting are created by
  // the E2E test through the real Admin UI, never here. Inert unless
  // SEED_E2E_MEDIA is explicitly set — a normal/staging/production seed
  // run never sets it, so no other Leader/Person/Community behavior is
  // affected. isTestData: true throughout; never touches the real
  // bootstrap Admin or any non-test data.
  // -------------------------------------------------------------------
  if (process.env.SEED_E2E_MEDIA === 'true') {
    const leaderEmail = 'mary.ngu@example.com';
    const leader = await prisma.user.findUnique({ where: { email: leaderEmail } });

    if (!leader) {
      console.warn('SEED_E2E_MEDIA=true but test Leader Mary Ngu does not exist — skipping media recipient fixture.');
    } else {
      const communityName = 'E2E Media Community';
      let community = await prisma.community.findFirst({ where: { name: communityName } });
      if (!community) {
        community = await prisma.community.create({ data: { name: communityName } });
      }

      let person = leader.personId ? await prisma.person.findUnique({ where: { id: leader.personId } }) : null;
      if (!person) {
        person = await prisma.person.create({
          data: { name: 'Mary Ngu (E2E)', whatsappNumber: '+237600000001', isTestData: true },
        });
        await prisma.user.update({ where: { id: leader.id }, data: { personId: person.id } });
      }

      const existingMembership = await prisma.communityMembership.findFirst({
        where: { personId: person.id, communityId: community.id },
      });
      if (!existingMembership) {
        await prisma.communityMembership.create({
          data: { personId: person.id, communityId: community.id, status: 'ACTIVE' },
        });
      } else if (existingMembership.status !== 'ACTIVE') {
        await prisma.communityMembership.update({ where: { id: existingMembership.id }, data: { status: 'ACTIVE' } });
      }

      console.log(
        `E2E media recipient fixture ready: Leader <${leaderEmail}> linked to Person <${person.id}>, ACTIVE in Community "${communityName}" (${community.id}).`,
      );
    }
  }

  // -------------------------------------------------------------------
  // Final Targeted E2E Phase — Follow-Up / Follow-Up Attention fixture,
  // opt-in via SEED_E2E_FOLLOWUP=true.
  //
  // Follow-Up authorization is scoped to the ACTING Leader's own
  // RoleAssignment (see lib/leadership.ts's findActiveScopedRole), so a
  // genuine "Leader A cannot see Leader B's follow-up" E2E proof needs TWO
  // separate, real, loggable-in Leader sessions, each holding an ACTIVE
  // RoleAssignment for a DIFFERENT Community. Neither existing test Leader
  // can be used for this: Mary Ngu's linked Person is isTestData:true, so
  // she is invisible to the Admin UI's Role-Assignment person-search picker
  // (the already-documented limitation — see e2e/README.md); John Tabi must
  // stay unlinked, since headquartersMedia.spec.ts's own authorization
  // check already depends on that. This fixture creates two NEW,
  // dedicated, test-only Leader accounts instead, and grants their
  // RoleAssignments directly here (the same direct-Prisma-write convention
  // already used by SEED_E2E_MEDIA above for Person-linking and Community
  // membership) rather than through that broken picker — this does not fix
  // or route around the picker bug itself (it remains exactly as broken
  // for any isTestData:true Person, Mary Ngu included), it only avoids
  // depending on it for THIS fixture's own precondition setup, so the E2E
  // spec can exercise the real Follow-Up UI/API on top of real,
  // already-authorized Leader sessions. Inert unless SEED_E2E_FOLLOWUP is
  // explicitly set; isTestData: true throughout; never touches Mary Ngu,
  // John Tabi, the real bootstrap Admin, or any other existing fixture.
  // -------------------------------------------------------------------
  if (process.env.SEED_E2E_FOLLOWUP === 'true') {
    const admin = await prisma.user.findUnique({ where: { email: adminEmail } });
    const existingLeaderA = await prisma.user.findUnique({ where: { email: 'e2e-followup-leader-a@test.local' } });

    if (!admin) {
      console.warn('SEED_E2E_FOLLOWUP=true but the bootstrap Admin does not exist yet — skipping Follow-Up fixture.');
    } else if (existingLeaderA) {
      console.log('E2E Follow-Up fixture already exists — skipping.');
    } else {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const now = Date.now();
      const yesterday = new Date(now - DAY_MS);
      const inThirtyDays = new Date(now + 30 * DAY_MS);

      async function createLeader(email: string, personName: string, personWhatsapp: string, communityName: string) {
        const passwordHash = await bcrypt.hash('E2EFollowUpTest123!', 12);
        const user = await prisma.user.create({
          data: { name: personName, email, passwordHash, role: 'LEADER', active: true, isTestData: true, mustChangePassword: false },
        });
        const person = await prisma.person.create({ data: { name: personName, whatsappNumber: personWhatsapp, isTestData: true } });
        await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
        const community = await prisma.community.create({ data: { name: communityName } });
        await prisma.roleAssignment.create({
          data: { personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id, assignedByUserId: admin!.id },
        });
        return { user, person, community };
      }

      const leaderA = await createLeader(
        'e2e-followup-leader-a@test.local',
        'E2E FollowUp Leader A',
        '+237680000001',
        'E2E FollowUp Community A',
      );
      const leaderB = await createLeader(
        'e2e-followup-leader-b@test.local',
        'E2E FollowUp Leader B',
        '+237680000002',
        'E2E FollowUp Community B',
      );

      async function createFollowedPerson(name: string, whatsapp: string, communityId: string) {
        const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp, isTestData: true } });
        await prisma.communityMembership.create({ data: { personId: person.id, communityId, status: 'ACTIVE' } });
        return person;
      }

      // Person A — the main-coverage follow-up: deliberately left with zero
      // contacts here (NOT_YET_CONTACTED) so the E2E spec logs the first
      // contact on it live, through the real "Log a Contact" UI form.
      const personA = await createFollowedPerson('E2E FollowUp Person A', '+237680000003', leaderA.community.id);
      await prisma.followUpAssignment.create({
        data: {
          followerId: leaderA.person.id,
          followedPersonId: personA.id,
          contextType: 'COMMUNITY',
          contextId: leaderA.community.id,
          assignedByUserId: admin.id,
        },
      });

      // Person B — Leader B's own assignment, used only to prove Leader
      // A/B isolation. Already GOOD + far-future next-follow-up so Leader
      // B's own Attention section is genuinely empty (the empty-state case).
      const personB = await createFollowedPerson('E2E FollowUp Person B', '+237680000004', leaderB.community.id);
      const assignmentB = await prisma.followUpAssignment.create({
        data: {
          followerId: leaderB.person.id,
          followedPersonId: personB.id,
          contextType: 'COMMUNITY',
          contextId: leaderB.community.id,
          assignedByUserId: admin.id,
        },
      });
      await prisma.followUpContact.create({
        data: {
          followUpAssignmentId: assignmentB.id,
          wellbeingStatus: 'GOOD',
          contactedAt: yesterday,
          nextFollowUpDate: inThirtyDays,
          loggedByUserId: admin.id,
        },
      });

      // Follow-Up Attention matrix — every case the Final Targeted E2E
      // Phase asks for, all under Leader A / Community A. Each contact's
      // contactedAt is set explicitly (never left to default `now()`) so
      // "latest contact" ordering is deterministic, never dependent on
      // real wall-clock timing between these sequential creates.
      async function createAttentionCase(
        name: string,
        whatsapp: string,
        contacts: { wellbeingStatus: 'GOOD' | 'NEEDS_ATTENTION' | 'EMERGENCY' | 'UNABLE_TO_REACH'; contactedAt: Date; nextFollowUpDate: Date | null }[],
        status: 'ACTIVE' | 'CLOSED' = 'ACTIVE',
      ) {
        const person = await createFollowedPerson(name, whatsapp, leaderA.community.id);
        const assignment = await prisma.followUpAssignment.create({
          data: {
            followerId: leaderA.person.id,
            followedPersonId: person.id,
            contextType: 'COMMUNITY',
            contextId: leaderA.community.id,
            assignedByUserId: admin.id,
            ...(status === 'CLOSED' ? { status: 'CLOSED', closedAt: new Date(), closedByUserId: admin.id, closeReason: 'E2E fixture' } : {}),
          },
        });
        for (const c of contacts) {
          await prisma.followUpContact.create({
            data: { followUpAssignmentId: assignment.id, loggedByUserId: admin.id, ...c },
          });
        }
        return { person, assignment };
      }

      // 1. EMERGENCY (also proves Emergency takes precedence over Overdue —
      // this one contact is both EMERGENCY and overdue at once).
      await createAttentionCase('E2E FollowUp Emergency', '+237680000011', [
        { wellbeingStatus: 'EMERGENCY', contactedAt: yesterday, nextFollowUpDate: yesterday },
      ]);
      // 2. NEEDS_ATTENTION, also overdue — proves it still wins over Overdue.
      await createAttentionCase('E2E FollowUp NeedsAttention', '+237680000012', [
        { wellbeingStatus: 'NEEDS_ATTENTION', contactedAt: yesterday, nextFollowUpDate: yesterday },
      ]);
      // 3. UNABLE_TO_REACH, also overdue — proves it still wins over Overdue.
      await createAttentionCase('E2E FollowUp UnableToReach', '+237680000013', [
        { wellbeingStatus: 'UNABLE_TO_REACH', contactedAt: yesterday, nextFollowUpDate: yesterday },
      ]);
      // 4. Pure OVERDUE: GOOD wellbeing, but the next-follow-up date has passed.
      await createAttentionCase('E2E FollowUp Overdue', '+237680000014', [
        { wellbeingStatus: 'GOOD', contactedAt: yesterday, nextFollowUpDate: yesterday },
      ]);
      // 5. NOT_YET_CONTACTED: zero contacts at all.
      await createAttentionCase('E2E FollowUp NotYetContacted', '+237680000015', []);
      // 6. GOOD, future next-follow-up — the non-attention control case.
      await createAttentionCase('E2E FollowUp Good', '+237680000016', [
        { wellbeingStatus: 'GOOD', contactedAt: yesterday, nextFollowUpDate: inThirtyDays },
      ]);
      // 7. A newer GOOD/future contact must supersede an older EMERGENCY
      // one — only the latest contact is ever classified.
      await createAttentionCase('E2E FollowUp NewerSupersedesOlder', '+237680000017', [
        { wellbeingStatus: 'EMERGENCY', contactedAt: new Date(now - 3 * DAY_MS), nextFollowUpDate: null },
        { wellbeingStatus: 'GOOD', contactedAt: new Date(now - 1 * DAY_MS), nextFollowUpDate: inThirtyDays },
      ]);
      // 8. An old, by-then-overdue contact must not resurface once a newer
      // contact with a future date exists.
      await createAttentionCase('E2E FollowUp OldOverdueNotResurfaced', '+237680000018', [
        { wellbeingStatus: 'GOOD', contactedAt: new Date(now - 3 * DAY_MS), nextFollowUpDate: new Date(now - 2 * DAY_MS) },
        { wellbeingStatus: 'GOOD', contactedAt: new Date(now - 1 * DAY_MS), nextFollowUpDate: inThirtyDays },
      ]);
      // 9. CLOSED assignment that would otherwise classify as EMERGENCY —
      // proves a closed/inactive assignment is excluded from Attention.
      await createAttentionCase(
        'E2E FollowUp ClosedEmergency',
        '+237680000019',
        [{ wellbeingStatus: 'EMERGENCY', contactedAt: yesterday, nextFollowUpDate: yesterday }],
        'CLOSED',
      );

      console.log(
        `E2E Follow-Up fixture ready: Leader A <${leaderA.user.email}> / Community "${leaderA.community.name}" (${leaderA.community.id}); ` +
          `Leader B <${leaderB.user.email}> / Community "${leaderB.community.name}" (${leaderB.community.id}); password for both: E2EFollowUpTest123!`,
      );
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
