import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

describe('Acceptance Test — referral code change', () => {
  it('deactivates the old code, creates a new one, and preserves history', async () => {
    const { user: mary, referralCode: oldCode } = await createLeader('Mary Ngu', 'mary@example.com', 'MARY7X2');
    await createAdmin('admin@test.local', 'AdminPass123!');

    // Historical visit + registration under the OLD code.
    const visitorAgent = request.agent(app);
    const { csrf: visitorCsrf } = await bootstrap(visitorAgent);
    await visitorAgent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', visitorCsrf)
      .send({ ref: 'MARY7X2', lang: 'en' });
    const regRes = await visitorAgent
      .post('/api/registrations')
      .set('X-CSRF-Token', visitorCsrf)
      .send({ name: 'Historical', whatsapp: '+237670000030', language: 'en', pathway: 'TRAINING' });
    const registrationId = regRes.body.registrationId;

    // Admin changes Mary's referral code.
    const adminAgent = request.agent(app);
    const { csrf: adminCsrf } = await bootstrap(adminAgent);
    await adminAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', adminCsrf)
      .send({ email: 'admin@test.local', password: 'AdminPass123!' });

    const patchRes = await adminAgent
      .patch(`/api/admin/leaders/${mary.id}`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ referralCode: 'MARYNEW1' });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.referralCode).toBe('MARYNEW1');

    const refreshedOld = await prisma.referralCode.findUnique({ where: { id: oldCode.id } });
    expect(refreshedOld!.active).toBe(false);
    expect(refreshedOld!.deactivatedAt).not.toBeNull();

    const newCode = await prisma.referralCode.findUnique({ where: { code: 'MARYNEW1' } });
    expect(newCode).toBeTruthy();
    expect(newCode!.leaderId).toBe(mary.id);
    expect(newCode!.active).toBe(true);

    // Historical visit still points at the OLD (now inactive) code.
    const historicalVisit = await prisma.referralVisit.findFirst({ where: { referralCodeId: oldCode.id } });
    expect(historicalVisit).toBeTruthy();

    // Historical relationship still attached to Mary's user ID.
    const relationship = await prisma.referralRelationship.findUnique({ where: { registrationId } });
    expect(relationship!.leaderId).toBe(mary.id);

    // Duplicate-code error on a second leader.
    await createLeader('John Tabi', 'john@example.com', 'JOHN8K4');
    const dupRes = await adminAgent
      .patch(`/api/admin/leaders/${mary.id}`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ referralCode: 'JOHN8K4' });
    expect(dupRes.status).toBe(409);
    expect(dupRes.body.error).toBe('This referral code is already assigned.');
  });
});
