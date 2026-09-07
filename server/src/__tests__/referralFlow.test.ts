import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, setWhatsAppSettings } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

describe('Acceptance Test 1 — Mary basic flow', () => {
  it('runs the full referral -> registration -> whatsapp -> dashboard flow', async () => {
    await setWhatsAppSettings('https://wa.example/en-community', 'https://wa.example/fr-community');
    const { user: mary, referralCode } = await createLeader('Mary Ngu', 'mary.ngu@example.com', 'MARY7X2');
    expect(referralCode.code).toBe('MARY7X2');

    const agent = request.agent(app);
    const { csrf, visitorId: visitorCookie } = await bootstrap(agent);

    // Cookie must contain ONLY the opaque id — no referral code / leader id.
    expect(visitorCookie).not.toMatch(/MARY7X2/i);
    expect(visitorCookie).not.toMatch(new RegExp(mary.id));

    // Visitor opens Mary's English referral link.
    const visitRes = await agent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', csrf)
      .send({ ref: 'MARY7X2', lang: 'en', utmSource: 'facebook', utmCampaign: 'launch' });

    expect(visitRes.status).toBe(201);
    expect(visitRes.body.attributed).toBe(true);

    const visits = await prisma.referralVisit.findMany({ where: { visitorId: visitorCookie } });
    expect(visits).toHaveLength(1);
    expect(visits[0].referralCodeId).toBe(referralCode.id);

    // Registration
    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Visitor One', whatsapp: '+237670000001', language: 'en', pathway: 'TRAINING' });

    expect(regRes.status).toBe(201);
    const registrationId = regRes.body.registrationId;
    expect(registrationId).toBeTruthy();

    const registration = await prisma.registration.findUnique({ where: { id: registrationId } });
    expect(registration).toBeTruthy();
    expect(registration!.normalizedWhatsApp).toBe('+237670000001'); // E.164
    expect(registration!.utmSource).toBe('facebook');
    expect(registration!.utmCampaign).toBe('launch');
    expect(registration!.visitorId).toBe(visitorCookie);

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId },
    });
    expect(relationship).toBeTruthy();
    expect(relationship!.leaderId).toBe(mary.id);

    // WhatsApp redirect — authorized (matching visitor cookie already in agent jar).
    const waRes = await agent.get(`/api/registrations/${registrationId}/whatsapp`);
    expect(waRes.status).toBe(302);
    expect(waRes.headers.location).toBe('https://wa.example/en-community');

    const events = await prisma.event.findMany({ where: { registrationId } });
    const clickEvent = events.find((e) => e.type === 'WHATSAPP_CLICKED');
    expect(clickEvent).toBeTruthy();

    // Leader dashboard reflects the activity.
    const leaderAgent = request.agent(app);
    const { csrf: leaderCsrf } = await bootstrap(leaderAgent);
    const loginRes = await leaderAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ email: 'mary.ngu@example.com', password: 'password123' });
    expect(loginRes.status).toBe(200);

    const dashRes = await leaderAgent.get('/api/leader/dashboard');
    expect(dashRes.status).toBe(200);
    expect(dashRes.body.referralCode).toBe('MARY7X2');
    expect(dashRes.body.stats.totalVisits).toBe(1);
    expect(dashRes.body.stats.registrations).toBe(1);
    expect(dashRes.body.stats.whatsappClicks).toBe(1);

    // Admin dashboard reflects the activity.
    const adminEmail = 'admin-flow@test.local';
    await prisma.user.create({
      data: {
        name: 'Admin Flow',
        email: adminEmail,
        passwordHash: await (await import('bcryptjs')).default.hash('AdminPass123!', 10),
        role: 'ADMIN',
      },
    });
    const adminAgent = request.agent(app);
    const { csrf: adminCsrf } = await bootstrap(adminAgent);
    await adminAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', adminCsrf)
      .send({ email: adminEmail, password: 'AdminPass123!' });

    // Test leader/registration data is isTestData=true, so it must be
    // included explicitly to show up in (test-data-excluding) analytics.
    const adminDash = await adminAgent.get('/api/admin/dashboard?includeTestData=true');
    expect(adminDash.status).toBe(200);
    expect(adminDash.body.registrations).toBeGreaterThanOrEqual(1);
    expect(adminDash.body.whatsappClicks).toBeGreaterThanOrEqual(1);
  });
});
