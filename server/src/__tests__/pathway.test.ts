import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, setWhatsAppSettings } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

describe('Registration.pathway', () => {
  it('accepts TRAINING and DISCOVER_GROW, rejects anything else', async () => {
    const agentA = request.agent(app);
    const { csrf: csrfA } = await bootstrap(agentA);
    const resA = await agentA
      .post('/api/registrations')
      .set('X-CSRF-Token', csrfA)
      .send({ name: 'Training User', whatsapp: '+237670001001', language: 'en', pathway: 'TRAINING' });
    expect(resA.status).toBe(201);
    expect(resA.body.pathway).toBe('TRAINING');

    const agentB = request.agent(app);
    const { csrf: csrfB } = await bootstrap(agentB);
    const resB = await agentB
      .post('/api/registrations')
      .set('X-CSRF-Token', csrfB)
      .send({ name: 'Discover User', whatsapp: '+237670001002', language: 'en', pathway: 'DISCOVER_GROW' });
    expect(resB.status).toBe(201);
    expect(resB.body.pathway).toBe('DISCOVER_GROW');

    const agentC = request.agent(app);
    const { csrf: csrfC } = await bootstrap(agentC);
    const resC = await agentC
      .post('/api/registrations')
      .set('X-CSRF-Token', csrfC)
      .send({ name: 'Bad Pathway', whatsapp: '+237670001003', language: 'en', pathway: 'NOT_A_REAL_PATHWAY' });
    expect(resC.status).toBe(400);
  });

  it('does not let pathway influence Leader attribution', async () => {
    const { user: mary } = await createLeader('Mary Ngu', 'mary-pw@example.com', 'MARYPW1');

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: 'MARYPW1', lang: 'en' });

    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Discover via Mary', whatsapp: '+237670001004', language: 'en', pathway: 'DISCOVER_GROW' });

    expect(regRes.status).toBe(201);
    const relationship = await prisma.referralRelationship.findUnique({
      where: { registrationId: regRes.body.registrationId },
    });
    expect(relationship!.leaderId).toBe(mary.id); // pathway never overrides attribution
  });
});

describe('WhatsApp redirect — four destinations', () => {
  async function registerAndRedirect(pathway: 'TRAINING' | 'DISCOVER_GROW', language: 'en' | 'fr', whatsapp: string) {
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Dest Test', whatsapp, language, pathway });
    const redirectRes = await agent.get(`/api/registrations/${regRes.body.registrationId}/whatsapp`);
    return redirectRes;
  }

  it('routes TRAINING+en, TRAINING+fr, DISCOVER_GROW+en, DISCOVER_GROW+fr to their own configured URL', async () => {
    await setWhatsAppSettings(
      'https://wa.example/training-en',
      'https://wa.example/training-fr',
      'https://wa.example/discover-en',
      'https://wa.example/discover-fr',
    );

    const trainingEn = await registerAndRedirect('TRAINING', 'en', '+237670002001');
    expect(trainingEn.status).toBe(302);
    expect(trainingEn.headers.location).toBe('https://wa.example/training-en');

    const trainingFr = await registerAndRedirect('TRAINING', 'fr', '+237670002002');
    expect(trainingFr.status).toBe(302);
    expect(trainingFr.headers.location).toBe('https://wa.example/training-fr');

    const discoverEn = await registerAndRedirect('DISCOVER_GROW', 'en', '+237670002003');
    expect(discoverEn.status).toBe(302);
    expect(discoverEn.headers.location).toBe('https://wa.example/discover-en');

    const discoverFr = await registerAndRedirect('DISCOVER_GROW', 'fr', '+237670002004');
    expect(discoverFr.status).toBe(302);
    expect(discoverFr.headers.location).toBe('https://wa.example/discover-fr');
  });

  it('records WHATSAPP_CLICKED before redirecting, for any pathway', async () => {
    await setWhatsAppSettings(
      'https://wa.example/training-en',
      'https://wa.example/training-fr',
      'https://wa.example/discover-en',
      'https://wa.example/discover-fr',
    );
    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Click Test', whatsapp: '+237670002005', language: 'en', pathway: 'DISCOVER_GROW' });

    await agent.get(`/api/registrations/${regRes.body.registrationId}/whatsapp`);

    const events = await prisma.event.findMany({
      where: { registrationId: regRes.body.registrationId, type: 'WHATSAPP_CLICKED' },
    });
    expect(events).toHaveLength(1);
  });
});
