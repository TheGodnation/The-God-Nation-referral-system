import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { backfillPersonsFromRegistrations } from '../lib/personBackfill';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function register(whatsapp: string, name = 'Test Person', email?: string) {
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  return agent
    .post('/api/registrations')
    .set('X-CSRF-Token', csrf)
    .send({ name, whatsapp, language: 'en', pathway: 'TRAINING', email });
}

describe('Phase 3A — Person identity linking', () => {
  it('Case 1/2: a new registration creates exactly one linked Person', async () => {
    const res = await register('+237670001001', 'Alice One');
    expect(res.status).toBe(201);

    const registration = await prisma.registration.findUnique({ where: { id: res.body.registrationId } });
    expect(registration!.personId).not.toBeNull();

    const person = await prisma.person.findUnique({ where: { id: registration!.personId! } });
    expect(person).toBeTruthy();
    expect(person!.whatsappNumber).toBe(registration!.normalizedWhatsApp);
    expect(person!.name).toBe('Alice One');

    const personCount = await prisma.person.count({ where: { whatsappNumber: registration!.normalizedWhatsApp } });
    expect(personCount).toBe(1);
  });

  it('Case 4: existing Registration data is untouched by backfill (simulating pre-Phase-3A rows)', async () => {
    // Simulate a Registration created before Phase 3A existed, by inserting
    // one directly with personId left null (bypassing the connectOrCreate
    // now present in the registration route).
    const pre = await prisma.registration.create({
      data: {
        visitorId: 'legacy-visitor-1',
        normalizedWhatsApp: '+237670001002',
        name: 'Legacy Person',
        email: 'legacy@example.com',
        language: 'fr',
        pathway: 'DISCOVER_GROW',
        utmSource: 'legacy-source',
      },
    });
    expect(pre.personId).toBeNull();

    const { linked } = await backfillPersonsFromRegistrations();
    expect(linked).toBeGreaterThanOrEqual(1);

    const after = await prisma.registration.findUnique({ where: { id: pre.id } });
    // Every pre-existing field is exactly as it was.
    expect(after!.normalizedWhatsApp).toBe('+237670001002');
    expect(after!.name).toBe('Legacy Person');
    expect(after!.email).toBe('legacy@example.com');
    expect(after!.language).toBe('fr');
    expect(after!.pathway).toBe('DISCOVER_GROW');
    expect(after!.utmSource).toBe('legacy-source');
    expect(after!.visitorId).toBe('legacy-visitor-1');
    // Only personId changed.
    expect(after!.personId).not.toBeNull();

    const person = await prisma.person.findUnique({ where: { id: after!.personId! } });
    expect(person!.whatsappNumber).toBe('+237670001002');
    expect(person!.name).toBe('Legacy Person');
    expect(person!.preferredLanguage).toBe('fr');
  });

  it('Case 3: running the backfill twice never creates duplicate People', async () => {
    await prisma.registration.create({
      data: {
        visitorId: 'legacy-visitor-2',
        normalizedWhatsApp: '+237670001003',
        name: 'Repeat Backfill',
        language: 'en',
        pathway: 'TRAINING',
      },
    });

    const first = await backfillPersonsFromRegistrations();
    expect(first.linked).toBe(1);
    const second = await backfillPersonsFromRegistrations();
    expect(second.linked).toBe(0);

    const people = await prisma.person.findMany({ where: { whatsappNumber: '+237670001003' } });
    expect(people).toHaveLength(1);
  });

  it('Case 6/7: an existing User is never auto-linked by email similarity, and stays valid with personId null', async () => {
    const shared = 'shared@example.com';
    const leader = await createLeader('Email Match Leader', shared, 'EMAILM1');
    const reg = await register('+237670001004', 'Different Human Same Email', shared);
    // The registration already linked its own Person inline at creation —
    // confirm that, then run the backfill again to prove it changes
    // nothing further (in particular, it must never touch User.personId).
    const registration = await prisma.registration.findUnique({ where: { id: reg.body.registrationId } });
    expect(registration!.personId).not.toBeNull();

    const { linked } = await backfillPersonsFromRegistrations();
    expect(linked).toBe(0);

    // The backfill only ever touches Registration rows — it must never
    // write to User.personId based on an email match.
    const userAfter = await prisma.user.findUnique({ where: { id: leader.user.id } });
    expect(userAfter!.personId).toBeNull();

    // The User remains fully valid and usable with personId still null.
    expect(userAfter!.email).toBe(shared);
    expect(userAfter!.role).toBe('LEADER');
  });

  it('Case 5: an existing User CAN be linked to a Person once a genuine relationship is established (manual admin action)', async () => {
    const reg = await register('+237670001005', 'Genuinely Linked Person');
    const registration = await prisma.registration.findUnique({ where: { id: reg.body.registrationId } });
    const admin = await createAdmin('admin-link-check@test.local', 'AdminPass123!');

    // Simulates the one safe, explicit linking path: an Admin (or a future
    // feature) sets User.personId directly, never an automated email guess.
    const updated = await prisma.user.update({
      where: { id: admin.id },
      data: { personId: registration!.personId },
    });
    expect(updated.personId).toBe(registration!.personId);
  });

  it('Case 8/9: ReferralRelationship and attribution are unaffected by Person linking', async () => {
    const { user: leader, referralCode } = await createLeader('Referral Leader', 'referral-leader@example.com', 'REFLNK1');

    const agent = request.agent(app);
    const { csrf, visitorId } = await bootstrap(agent);
    const visit = await agent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', csrf)
      .send({ ref: 'REFLNK1', lang: 'en' });
    expect(visit.status).toBe(201);

    const reg = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Attributed Person', whatsapp: '+237670001006', language: 'en', pathway: 'TRAINING' });
    expect(reg.status).toBe(201);

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: reg.body.registrationId },
    });
    expect(relationship!.leaderId).toBe(leader.id);
    expect(relationship!.referralCodeId).toBe(referralCode.id);

    const registration = await prisma.registration.findUnique({ where: { id: reg.body.registrationId } });
    expect(registration!.visitorId).toBe(visitorId);
    // Person linkage happened alongside, without altering attribution.
    expect(registration!.personId).not.toBeNull();
  });

  it('Case 10/11: new registrations behave exactly as before, including duplicate-WhatsApp rejection', async () => {
    const whatsapp = '+237670001007';
    const first = await register(whatsapp, 'First Try');
    expect(first.status).toBe(201);
    expect(first.body).toHaveProperty('registrationId');
    expect(first.body).toHaveProperty('language', 'en');
    expect(first.body).toHaveProperty('pathway', 'TRAINING');
    expect(first.body).toHaveProperty('confirmationEmailSent');

    const duplicate = await register(whatsapp, 'Second Try');
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('DUPLICATE_WHATSAPP');

    // Still exactly one Person for this number — the duplicate attempt
    // never reached Person creation since the Registration insert itself
    // failed first (existing uniqueness behavior, unchanged).
    const people = await prisma.person.findMany({ where: { whatsappNumber: whatsapp } });
    expect(people).toHaveLength(1);
  });
});
