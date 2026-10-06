import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createLeader, setWhatsAppSettings } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function referAndRegister(referralCode: string, whatsapp: string, name: string) {
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  await agent
    .post('/api/referrals/visit')
    .set('X-CSRF-Token', csrf)
    .send({ ref: referralCode, lang: 'en' });
  const res = await agent
    .post('/api/registrations')
    .set('X-CSRF-Token', csrf)
    .send({ name, whatsapp, language: 'en', pathway: 'TRAINING' });
  return { agent, registrationId: res.body.registrationId as string };
}

describe('Acceptance Test — Leader referrals show WhatsApp join status', () => {
  it('marks only registrations that actually clicked through to WhatsApp', async () => {
    await setWhatsAppSettings('https://wa.example/en-community', 'https://wa.example/fr-community');
    await createLeader('Mary Ngu', 'mary-wa-status@example.com', 'MARYWA1');

    const { agent: joinedAgent, registrationId: joinedId } = await referAndRegister(
      'MARYWA1',
      '+237670005001',
      'Joined Person',
    );
    // Same agent/cookie that registered clicks through — records WHATSAPP_CLICKED.
    const clickRes = await joinedAgent.get(`/api/registrations/${joinedId}/whatsapp`);
    expect(clickRes.status).toBe(302);

    await referAndRegister('MARYWA1', '+237670005002', 'Not Yet Person');

    const leaderAgent = request.agent(app);
    const { csrf: leaderCsrf } = await bootstrap(leaderAgent);
    await leaderAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ email: 'mary-wa-status@example.com', password: 'password123' });

    const res = await leaderAgent.get('/api/leader/referrals?pageSize=20');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);

    const joined = res.body.items.find((i: any) => i.name === 'Joined Person');
    const notYet = res.body.items.find((i: any) => i.name === 'Not Yet Person');
    expect(joined.whatsappJoined).toBe(true);
    expect(notYet.whatsappJoined).toBe(false);
  });
});
