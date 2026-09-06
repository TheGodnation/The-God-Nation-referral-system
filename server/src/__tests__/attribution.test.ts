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
      .send({ name: 'Two Visits', whatsapp: '+237670000010', language: 'en' });

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
      .send({ name: 'Campaign Test', whatsapp: '+237670000011', language: 'en' });

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
      .send({ name: 'Permanent Test', whatsapp: '+237670000012', language: 'en' });

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
      .send({ name: 'Lang Switch', whatsapp: '+237670000013', language: 'fr' });

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
      .send({ name: 'Expired Test', whatsapp: '+237670000014', language: 'en' });

    expect(regRes.status).toBe(201); // succeeds — expiration is not an error

    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: regRes.body.registrationId },
    });
    expect(relationship).toBeNull();
  });
});
