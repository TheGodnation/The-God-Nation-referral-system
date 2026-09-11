import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { setWhatsAppSettings } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

describe('Acceptance Test — WhatsApp redirect authorization', () => {
  it('rejects a mismatched visitor cookie, allows a missing cookie, and allows the correct one', async () => {
    await setWhatsAppSettings('https://wa.example/en', 'https://wa.example/fr');

    const agent = request.agent(app);
    const { csrf } = await bootstrap(agent);
    const regRes = await agent
      .post('/api/registrations')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Auth Test', whatsapp: '+237670000040', language: 'en', pathway: 'TRAINING' });
    const registrationId = regRes.body.registrationId;

    // No WHATSAPP_CLICKED events should exist yet.
    const eventsBefore = await prisma.event.findMany({
      where: { registrationId, type: 'WHATSAPP_CLICKED' },
    });
    expect(eventsBefore).toHaveLength(0);

    // Wrong visitor cookie: a completely different agent/session — always
    // rejected, since browsing as a different visitor must never trigger
    // someone else's click event or redirect.
    const otherAgent = request.agent(app);
    await bootstrap(otherAgent);
    const wrongRes = await otherAgent.get(`/api/registrations/${registrationId}/whatsapp`);
    expect(wrongRes.status).toBe(403);
    expect(wrongRes.status).not.toBe(302);

    // Missing visitor cookie entirely (raw request, no cookie jar) — this is
    // deliberately allowed: it's the same link embedded in the registration
    // confirmation and WhatsApp-reminder emails, which may be opened on a
    // different device/browser/app than the one used to register.
    const missingRes = await request(app).get(`/api/registrations/${registrationId}/whatsapp`);
    expect(missingRes.status).toBe(302);
    expect(missingRes.headers.location).toBe('https://wa.example/en');

    const eventsAfterMissing = await prisma.event.findMany({
      where: { registrationId, type: 'WHATSAPP_CLICKED' },
    });
    expect(eventsAfterMissing).toHaveLength(1);

    // Correct, matching visitor cookie: also allowed.
    const okRes = await agent.get(`/api/registrations/${registrationId}/whatsapp`);
    expect(okRes.status).toBe(302);
    expect(okRes.headers.location).toBe('https://wa.example/en');

    const eventsAfter = await prisma.event.findMany({
      where: { registrationId, type: 'WHATSAPP_CLICKED' },
    });
    expect(eventsAfter).toHaveLength(2);
  });

  it('rejects an unknown registration id', async () => {
    const agent = request.agent(app);
    await bootstrap(agent);
    const res = await agent.get('/api/registrations/does-not-exist/whatsapp');
    expect(res.status).toBe(404);
  });
});
