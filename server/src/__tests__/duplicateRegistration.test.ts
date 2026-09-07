import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

describe('Acceptance Test — duplicate registration', () => {
  it('rejects a second registration with the same normalized WhatsApp number', async () => {
    await createLeader('Mary Ngu', 'mary@example.com', 'MARY7X2');

    const agent1 = request.agent(app);
    const { csrf: csrf1 } = await bootstrap(agent1);
    const first = await agent1
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf1)
      .send({ name: 'First', whatsapp: '+237670000020', language: 'en', pathway: 'TRAINING' });
    expect(first.status).toBe(201);

    const agent2 = request.agent(app);
    const { csrf: csrf2 } = await bootstrap(agent2);
    const second = await agent2
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf2)
      // Same number, different formatting — normalization must still catch it.
      .send({ name: 'Second', whatsapp: '00237670000020', language: 'en', pathway: 'TRAINING' });

    expect(second.status).toBe(409);
    expect(second.body.error).toBe('This WhatsApp number may have already been used to register. If you entered the wrong number, please correct it and try again. If you have not yet been added to the WhatsApp group, please contact us so that we can assist you and add you manually.');

    const all = await prisma.registration.findMany({ where: { normalizedWhatsApp: '+237670000020' } });
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('First');

    const relationships = await prisma.referralRelationship.findMany({});
    expect(relationships).toHaveLength(0); // no leader was attributed in this test, none created either way
  });
});

describe('Acceptance Test — concurrent duplicate registration', () => {
  it('lets exactly one concurrent request succeed and never returns a 500', async () => {
    const agentA = request.agent(app);
    const agentB = request.agent(app);
    const { csrf: csrfA } = await bootstrap(agentA);
    const { csrf: csrfB } = await bootstrap(agentB);

    const payload = { name: 'Racer', whatsapp: '+237670000099', language: 'en' as const, pathway: 'TRAINING' as const };

    const [resA, resB] = await Promise.all([
      agentA.post('/api/registrations').set('X-CSRF-Token', csrfA).send(payload),
      agentB.post('/api/registrations').set('X-CSRF-Token', csrfB).send(payload),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(resA.status).not.toBe(500);
    expect(resB.status).not.toBe(500);

    const winner = resA.status === 201 ? resA : resB;
    const loser = resA.status === 409 ? resA : resB;
    expect(loser.body.error).toBe('This WhatsApp number may have already been used to register. If you entered the wrong number, please correct it and try again. If you have not yet been added to the WhatsApp group, please contact us so that we can assist you and add you manually.');

    const registrations = await prisma.registration.findMany({
      where: { normalizedWhatsApp: '+237670000099' },
    });
    expect(registrations).toHaveLength(1);
    expect(registrations[0].id).toBe(winner.body.registrationId);
  });
});
