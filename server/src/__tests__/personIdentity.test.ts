import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, createAdmin, createRegistrationFixture } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function register(whatsapp: string, name = 'Test Person', email?: string) {
  const agent = request.agent(app);
  const { visitorId } = await bootstrap(agent);
  return createRegistrationFixture(visitorId, { name, whatsapp, language: 'en', pathway: 'TRAINING', email });
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

    const reg = await createRegistrationFixture(visitorId, { name: 'Attributed Person', whatsapp: '+237670001006', language: 'en', pathway: 'TRAINING' });
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
