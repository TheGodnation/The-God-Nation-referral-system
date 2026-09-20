import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createAdmin, createLeader, setWhatsAppSettings } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function loginAsAdmin(agent: ReturnType<typeof request.agent>, email: string, password: string) {
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return csrf;
}

async function referAndRegister(referralCode: string, whatsapp: string, name: string) {
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: referralCode, lang: 'en' });
  const res = await agent
    .post('/api/registrations')
    .set('X-CSRF-Token', csrf)
    .send({ name, whatsapp, language: 'en', pathway: 'TRAINING' });
  return { agent, registrationId: res.body.registrationId as string };
}

describe('Acceptance Test — Admin Leaders list shows referred/joined counts', () => {
  it('counts referrals and WhatsApp joins per Leader, excluding test data by default', async () => {
    await setWhatsAppSettings('https://wa.example/en-community', 'https://wa.example/fr-community');
    await createAdmin('admin-leader-counts@test.local', 'AdminPass123!');
    await createLeader('Mary Ngu', 'mary-counts@example.com', 'MARYCOUNT1');

    // Two real referrals for Mary: one clicks through to WhatsApp, one doesn't.
    const { agent: a1, registrationId: r1 } = await referAndRegister('MARYCOUNT1', '+237670006001', 'Clicked Person');
    await a1.get(`/api/registrations/${r1}/whatsapp`);
    await referAndRegister('MARYCOUNT1', '+237670006002', 'Unclicked Person');

    const admin = request.agent(app);
    const csrf = await loginAsAdmin(admin, 'admin-leader-counts@test.local', 'AdminPass123!');
    void csrf;

    // createLeader/referral-visit fixtures are isTestData — must opt in to see them.
    const withoutTestData = await admin.get('/api/admin/leaders?pageSize=100');
    const maryHidden = withoutTestData.body.items.find((l: any) => l.referralCode === 'MARYCOUNT1');
    expect(maryHidden.referredCount).toBe(0);
    expect(maryHidden.whatsappJoinedCount).toBe(0);

    const res = await admin.get('/api/admin/leaders?pageSize=100&includeTestData=true');
    expect(res.status).toBe(200);
    const mary = res.body.items.find((l: any) => l.referralCode === 'MARYCOUNT1');
    expect(mary.referredCount).toBe(2);
    expect(mary.whatsappJoinedCount).toBe(1);
  });

  it('requires Admin authentication', async () => {
    const res = await request(app).get('/api/admin/leaders');
    expect(res.status).toBe(401);
  });
});
