import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, createRegistrationFixture } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

describe('Registration.pathway', () => {
  it('accepts TRAINING and DISCOVER_GROW, rejects anything else', async () => {
    const agentA = request.agent(app);
    const { visitorId: visitorA } = await bootstrap(agentA);
    const resA = await createRegistrationFixture(visitorA, { name: 'Training User', whatsapp: '+237670001001', language: 'en', pathway: 'TRAINING' });
    expect(resA.status).toBe(201);
    expect(resA.body.pathway).toBe('TRAINING');

    const agentB = request.agent(app);
    const { visitorId: visitorB } = await bootstrap(agentB);
    const resB = await createRegistrationFixture(visitorB, { name: 'Discover User', whatsapp: '+237670001002', language: 'en', pathway: 'DISCOVER_GROW' });
    expect(resB.status).toBe(201);
    expect(resB.body.pathway).toBe('DISCOVER_GROW');
  });

  it('does not let pathway influence Leader attribution', async () => {
    const { user: mary } = await createLeader('Mary Ngu', 'mary-pw@example.com', 'MARYPW1');

    const agent = request.agent(app);
    const { csrf, visitorId } = await bootstrap(agent);
    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: 'MARYPW1', lang: 'en' });

    const regRes = await createRegistrationFixture(visitorId, { name: 'Discover via Mary', whatsapp: '+237670001004', language: 'en', pathway: 'DISCOVER_GROW' });

    expect(regRes.status).toBe(201);
    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: regRes.body.registrationId },
    });
    expect(relationship!.leaderId).toBe(mary.id); // pathway never overrides attribution
  });
});
