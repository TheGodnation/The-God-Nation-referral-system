import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function loginAsAdmin(email = 'admin-people@test.local', password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

describe('Phase 3A — Admin People management', () => {
  it('creates a Person, views it, edits it, and finds it via search', async () => {
    const { agent, csrf } = await loginAsAdmin();

    const created = await agent
      .post('/api/admin/people')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Grace Mbeki', whatsappNumber: '+237670004001', email: 'grace@example.com', preferredLanguage: 'fr' });
    expect(created.status).toBe(201);
    expect(created.body.whatsappNumber).toBe('+237670004001');
    expect(created.body.preferredLanguage).toBe('fr');

    const detail = await agent.get(`/api/admin/people/${created.body.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.name).toBe('Grace Mbeki');
    expect(detail.body.geographicAssignment).toBeNull();
    expect(detail.body.communityMemberships).toEqual([]);

    const edited = await agent
      .patch(`/api/admin/people/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Grace M. Mbeki' });
    expect(edited.status).toBe(200);
    expect(edited.body.name).toBe('Grace M. Mbeki');

    const search = await agent.get('/api/admin/people?search=Grace');
    expect(search.status).toBe(200);
    expect(search.body.items.some((p: any) => p.id === created.body.id)).toBe(true);
  });

  it('rejects a duplicate WhatsApp number and an invalid one', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-people-dup@test.local');
    const first = await agent
      .post('/api/admin/people')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'First', whatsappNumber: '+237670004002' });
    expect(first.status).toBe(201);

    const duplicate = await agent
      .post('/api/admin/people')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Second', whatsappNumber: '+237670004002' });
    expect(duplicate.status).toBe(409);

    const invalid = await agent
      .post('/api/admin/people')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Bad Number', whatsappNumber: 'not-a-number' });
    expect(invalid.status).toBe(400);
  });

  it('requires Admin authorization and never exposes People data publicly', async () => {
    const anon = request.agent(app);
    const { csrf } = await bootstrap(anon);

    const anonList = await anon.get('/api/admin/people');
    expect(anonList.status).toBe(401);
    const anonCreate = await anon
      .post('/api/admin/people')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Nope', whatsappNumber: '+237670004003' });
    expect(anonCreate.status).toBe(401);

    // No public, unauthenticated route exists for member data at all.
    const publicAttempt = await anon.get('/api/people');
    expect(publicAttempt.status).toBe(404);

    await createLeader('People Leader', 'leader-people@example.com', 'PPLLD1');
    const leaderAgent = request.agent(app);
    const { csrf: leaderCsrf } = await bootstrap(leaderAgent);
    await leaderAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ email: 'leader-people@example.com', password: 'password123' });
    const leaderList = await leaderAgent.get('/api/admin/people');
    expect(leaderList.status).toBe(403);
  });

  it('includes test-data Person rows only when includeTestData=true, matching the rest of the dashboard', async () => {
    const { agent } = await loginAsAdmin('admin-people-testdata@test.local');
    await prisma.person.create({
      data: { name: 'Test Data Person', whatsappNumber: '+237670004004', isTestData: true },
    });

    const withoutFlag = await agent.get('/api/admin/people?search=Test Data Person');
    expect(withoutFlag.body.items).toHaveLength(0);

    const withFlag = await agent.get('/api/admin/people?search=Test Data Person&includeTestData=true');
    expect(withFlag.body.items).toHaveLength(1);
  });
});
