import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { createAdmin, createLeader, createRegistrationFixture } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function loginAsAdmin(agent: ReturnType<typeof request.agent>, email: string, password: string) {
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return csrf;
}

async function referAndRegister(referralCode: string, whatsapp: string, name: string) {
  const agent = request.agent(app);
  const { csrf, visitorId } = await bootstrap(agent);
  await agent.post('/api/referrals/visit').set('X-CSRF-Token', csrf).send({ ref: referralCode, lang: 'en' });
  return createRegistrationFixture(visitorId, { name, whatsapp, language: 'en', pathway: 'TRAINING' });
}

describe('Acceptance Test — Admin Leaders list shows referred counts', () => {
  it('counts referrals per Leader, excluding test data by default', async () => {
    await createAdmin('admin-leader-counts@test.local', 'AdminPass123!');
    await createLeader('Mary Ngu', 'mary-counts@example.com', 'MARYCOUNT1');

    await referAndRegister('MARYCOUNT1', '+237670006001', 'Clicked Person');
    await referAndRegister('MARYCOUNT1', '+237670006002', 'Unclicked Person');

    const admin = request.agent(app);
    await loginAsAdmin(admin, 'admin-leader-counts@test.local', 'AdminPass123!');

    // createLeader/referral-visit fixtures are isTestData — must opt in to see them.
    const withoutTestData = await admin.get('/api/admin/leaders?pageSize=100');
    const maryHidden = withoutTestData.body.items.find((l: any) => l.referralCode === 'MARYCOUNT1');
    expect(maryHidden.referredCount).toBe(0);

    const res = await admin.get('/api/admin/leaders?pageSize=100&includeTestData=true');
    expect(res.status).toBe(200);
    const mary = res.body.items.find((l: any) => l.referralCode === 'MARYCOUNT1');
    expect(mary.referredCount).toBe(2);
  });

  it('requires Admin authentication', async () => {
    const res = await request(app).get('/api/admin/leaders');
    expect(res.status).toBe(401);
  });
});
