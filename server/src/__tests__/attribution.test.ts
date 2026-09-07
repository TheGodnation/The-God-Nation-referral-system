import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

describe('Acceptance Test — Mary to John (latest visit wins)', () => {
  it('attributes to John when John clicks after Mary, using John visit for marketing fields', async () => {
    const { user: mary, referralCode: maryCode } = await createLeader('Mary Ngu', 'mary@example.com', 'MARY7X2');
    const { user: john, referralCode: johnCode } = await createLeader('John Tabi', 'john@example.com', 'JOHN8K4');

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    await agent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', csrf)
      .send({ ref: 'MARY7X2', lang: 'en', utmSource: 'facebook', utmCampaign: 'A' });

    await agent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', csrf)
      .send({ ref: 'JOHN8K4', lang: 'en' }); // no UTM on John's visit

    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Two Visits', whatsapp: '+237670000010', language: 'en', pathway: 'TRAINING' });

    expect(regRes.status).toBe(201);

    const registration = await prisma.registration.findUnique({
      where: { id: regRes.body.registrationId },
    });
    expect(registration!.utmSource).toBeNull(); // must NOT fall back to Mary's older UTM
    expect(registration!.utmCampaign).toBeNull();

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: regRes.body.registrationId },
    });
    expect(relationship!.leaderId).toBe(john.id);
    expect(relationship!.leaderId).not.toBe(mary.id);

    const visits = await prisma.referralVisit.findMany({ orderBy: { timestamp: 'asc' } });
    expect(visits).toHaveLength(2);
  });

  it('selects Campaign B when John visit carries its own UTM after Mary + Campaign A', async () => {
    await createLeader('Mary Ngu', 'mary2@example.com', 'MARY7X3');
    const { user: john } = await createLeader('John Tabi', 'john2@example.com', 'JOHN8K5');

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    await agent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', csrf)
      .send({ ref: 'MARY7X3', lang: 'en', utmSource: 'facebook', utmCampaign: 'A' });

    await agent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', csrf)
      .send({ ref: 'JOHN8K5', lang: 'en', utmSource: 'facebook', utmCampaign: 'B' });

    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Campaign Test', whatsapp: '+237670000011', language: 'en', pathway: 'TRAINING' });

    const registration = await prisma.registration.findUnique({
      where: { id: regRes.body.registrationId },
    });
    expect(registration!.utmCampaign).toBe('B');

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: regRes.body.registrationId },
    });
    expect(relationship!.leaderId).toBe(john.id);
  });
});

describe('Acceptance Test — permanent attribution is immutable', () => {
  it('keeps Mary as the permanent Leader even after a later John click', async () => {
    const { user: mary } = await createLeader('Mary Ngu', 'mary3@example.com', 'MARY7X4');
    await createLeader('John Tabi', 'john3@example.com', 'JOHN8K6');

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: 'MARY7X4', lang: 'en' });

    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Permanent Test', whatsapp: '+237670000012', language: 'en', pathway: 'TRAINING' });

    // John clicks later using the SAME visitor.
    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: 'JOHN8K6', lang: 'en' });

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: regRes.body.registrationId },
    });
    expect(relationship!.leaderId).toBe(mary.id);
  });
});

describe('Acceptance Test — language switch does not change attribution', () => {
  it('keeps Mary as Leader when the visitor switches to French before registering', async () => {
    const { user: mary } = await createLeader('Mary Ngu', 'mary4@example.com', 'MARY7X5');

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: 'MARY7X5', lang: 'en' });

    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Lang Switch', whatsapp: '+237670000013', language: 'fr', pathway: 'TRAINING' });

    const registration = await prisma.registration.findUnique({
      where: { id: regRes.body.registrationId },
    });
    expect(registration!.language).toBe('fr');

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: regRes.body.registrationId },
    });
    expect(relationship!.leaderId).toBe(mary.id);
  });
});

describe('Attribution correction — organic/non-referral fallback', () => {
  it('Case A: a referral-qualified visit alone supplies both Leader and marketing fields', async () => {
    const { user: mary } = await createLeader('Mary Ngu', 'mary-a@example.com', 'MARYCASEA');

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    await agent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', csrf)
      .send({ ref: 'MARYCASEA', lang: 'en', utmSource: 'facebook', utmCampaign: 'A' });

    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Case A', whatsapp: '+237670000020', language: 'en', pathway: 'TRAINING' });

    const registration = await prisma.registration.findUnique({ where: { id: regRes.body.registrationId } });
    expect(registration!.utmSource).toBe('facebook');
    expect(registration!.utmCampaign).toBe('A');

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: regRes.body.registrationId },
    });
    expect(relationship!.leaderId).toBe(mary.id);
  });

  it('Case C: a later non-referral campaign visit does NOT overwrite the earlier referral-qualified visit', async () => {
    const { user: mary } = await createLeader('Mary Ngu', 'mary-c@example.com', 'MARYCASEC');

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    // Mary's referral-qualified visit, carrying its own marketing fields.
    await agent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', csrf)
      .send({ ref: 'MARYCASEC', lang: 'en', utmSource: 'facebook', utmCampaign: 'mary-campaign' });

    // A LATER non-referral (organic) campaign visit — no ref code at all.
    await agent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', csrf)
      .send({ lang: 'en', utmSource: 'instagram', utmCampaign: 'organic-later' });

    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Case C', whatsapp: '+237670000021', language: 'en', pathway: 'TRAINING' });

    const registration = await prisma.registration.findUnique({ where: { id: regRes.body.registrationId } });
    // Marketing fields must still be Mary's — never overwritten by the later organic visit.
    expect(registration!.utmSource).toBe('facebook');
    expect(registration!.utmCampaign).toBe('mary-campaign');

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: regRes.body.registrationId },
    });
    expect(relationship!.leaderId).toBe(mary.id);

    const visits = await prisma.referralVisit.findMany();
    expect(visits).toHaveLength(2); // both visits remain in history
  });

  it('Case D: a purely organic/non-referral visit supplies marketing fields but no Leader attribution', async () => {
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    await agent
      .post('/api/referrals/visit')
      .set('X-CSRF-Token', csrf)
      .send({ lang: 'en', utmSource: 'facebook', utmCampaign: 'organic-only', landingPage: '/promo' });

    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Case D', whatsapp: '+237670000022', language: 'en', pathway: 'TRAINING' });

    expect(regRes.status).toBe(201);

    const registration = await prisma.registration.findUnique({ where: { id: regRes.body.registrationId } });
    expect(registration!.utmSource).toBe('facebook');
    expect(registration!.utmCampaign).toBe('organic-only');
    expect(registration!.landingPage).toBe('/promo');

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: regRes.body.registrationId },
    });
    expect(relationship).toBeNull(); // no Leader — never fabricate attribution from an organic visit
  });

  it('produces neither Leader nor marketing attribution when there is no visit at all', async () => {
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);

    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'No Visit', whatsapp: '+237670000023', language: 'en', pathway: 'TRAINING' });

    expect(regRes.status).toBe(201);
    const registration = await prisma.registration.findUnique({ where: { id: regRes.body.registrationId } });
    expect(registration!.utmSource).toBeNull();
    expect(registration!.utmCampaign).toBeNull();
    expect(registration!.utmMedium).toBeNull();
    expect(registration!.landingPage).toBeNull();

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: regRes.body.registrationId },
    });
    expect(relationship).toBeNull();
  });

  it('preserves isTestData from the fallback (organic) visit, not just the primary path', async () => {
    const agent = request.agent(app);
    const { csrf, visitorId } = await bootstrap(agent);

    // Directly create an organic, isTestData=true visit (simulating a QA visit).
    await prisma.referralVisit.create({
      data: {
        visitorId,
        referralCodeId: null,
        language: 'en',
        utmSource: 'qa-source',
        isTestData: true,
      },
    });

    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'QA Organic', whatsapp: '+237670000024', language: 'en', pathway: 'TRAINING' });

    const registration = await prisma.registration.findUnique({ where: { id: regRes.body.registrationId } });
    expect(registration!.utmSource).toBe('qa-source');
    expect(registration!.isTestData).toBe(true);
  });
});

describe('Acceptance Test — expired attribution', () => {
  it('succeeds with no Leader attribution when the only visit is older than 30 days', async () => {
    const { referralCode } = await createLeader('Mary Ngu', 'mary5@example.com', 'MARY7X6');

    const agent = request.agent(app);
    const { csrf, visitorId } = await bootstrap(agent);

    // Create an old visit directly (35 days ago).
    await prisma.referralVisit.create({
      data: {
        visitorId,
        referralCodeId: referralCode.id,
        language: 'en',
        timestamp: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000),
      },
    });

    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Expired Test', whatsapp: '+237670000014', language: 'en', pathway: 'TRAINING' });

    expect(regRes.status).toBe(201); // succeeds — expiration is not an error

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: regRes.body.registrationId },
    });
    expect(relationship).toBeNull();
  });
});
