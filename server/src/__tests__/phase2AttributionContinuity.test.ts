import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, setWhatsAppSettings } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

// Section 12: a visitor arriving via a referral link who then browses the
// new Phase 2 public content pages before registering must keep their
// original referral attribution — Phase 2 pages must not touch the visitor
// cookie, the ReferralVisit record, or the eventual ReferralRelationship.
describe('Phase 2 — referral attribution survives browsing public content pages', () => {
  it('keeps the original referral attribution intact after visiting Phase 2 pages and the Contact form', async () => {
    await setWhatsAppSettings('https://wa.example/en-community', 'https://wa.example/fr-community');
    const { user: leader, referralCode } = await createLeader('Mary Referral', 'mary-phase2@example.com', 'MARY7X2');

    const agent = request.agent(app);
    const { csrf, visitorId } = await bootstrap(agent);

    // 1. Visitor arrives via /join?ref=MARY7X2&lang=en.
    const visit = await agent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', csrf)
      .send({ ref: 'MARY7X2', lang: 'en' });
    expect(visit.status).toBe(201);
    expect(visit.body.attributed).toBe(true);

    // A published Phase 2 page for the visitor to browse.
    const page = await prisma.contentPage.create({
      data: {
        type: 'PAGE',
        slug: 'vision-continuity',
        titleEn: 'Our Vision',
        bodyEn: 'Reaching every nation.',
        published: true,
        publishedAt: new Date(),
      },
    });

    // 2. Visitor continues browsing — opens the new public content list and
    // the individual page, using the SAME agent/cookie jar.
    const list = await agent.get('/api/content-pages?type=PAGE');
    expect(list.status).toBe(200);
    const single = await agent.get(`/api/content-pages/${page.slug}`);
    expect(single.status).toBe(200);

    // The visitor_id cookie must be completely unchanged by browsing these
    // pages — no competing identity, no cookie rotation.
    const visitorCookieAfterBrowsing = (single.headers['set-cookie'] || []).find((c: string) =>
      c.startsWith('visitor_id='),
    );
    expect(visitorCookieAfterBrowsing).toBeUndefined();

    // 3. Visitor eventually registers.
    const reg = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Continuity Visitor', whatsapp: '+237670000099', language: 'en', pathway: 'TRAINING' });
    expect(reg.status).toBe(201);
    const registrationId = reg.body.registrationId;

    // 4. Original referral attribution remains correct.
    const relationship = await prisma.referralRelationship.findUnique({ where: { registrationId } });
    expect(relationship).toBeTruthy();
    expect(relationship!.leaderId).toBe(leader.id);
    expect(relationship!.referralCodeId).toBe(referralCode.id);

    const registration = await prisma.registration.findUnique({ where: { id: registrationId } });
    expect(registration!.visitorId).toBe(visitorId);

    // Existing WhatsApp redirect security chain still works for this
    // visitor/registration pair after browsing Phase 2 pages in between.
    const waRes = await agent.get(`/api/registrations/${registrationId}/whatsapp`);
    expect(waRes.status).toBe(302);
    expect(waRes.headers.location).toBe('https://wa.example/en-community');

    // Only one ReferralVisit was ever created — Phase 2 browsing did not
    // create a competing visit or attribution identity.
    const visits = await prisma.referralVisit.findMany({ where: { visitorId } });
    expect(visits).toHaveLength(1);
  });

  it('does not interfere with attribution when the visitor also submits the Contact form while browsing', async () => {
    await setWhatsAppSettings('https://wa.example/en-community', 'https://wa.example/fr-community');
    const { user: leader, referralCode } = await createLeader('Paul Referral', 'paul-phase2@example.com', 'PAUL9Z1');

    const agent = request.agent(app);
    const { csrf, visitorId } = await bootstrap(agent);

    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: 'PAUL9Z1', lang: 'en' });

    const contact = await agent
      .post('/api/contact')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Curious Visitor', email: 'curious@example.com', message: 'Question before registering.', language: 'en' });
    expect(contact.status).toBe(201);

    const reg = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Curious Visitor', whatsapp: '+237670000098', language: 'en', pathway: 'TRAINING' });
    expect(reg.status).toBe(201);

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: reg.body.registrationId },
    });
    expect(relationship!.leaderId).toBe(leader.id);
    expect(relationship!.referralCodeId).toBe(referralCode.id);

    const registration = await prisma.registration.findUnique({ where: { id: reg.body.registrationId } });
    expect(registration!.visitorId).toBe(visitorId);
  });
});
