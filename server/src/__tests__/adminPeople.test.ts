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

  it("edits a Person's profile email without touching their separate sign-in email", async () => {
    const { agent, csrf } = await loginAsAdmin('admin-people-signin-a@test.local');
    const person = await prisma.person.create({
      data: { name: 'Grace Signin', whatsappNumber: '+237670004005' },
    });
    await prisma.memberAccount.create({ data: { personId: person.id, email: 'grace-signin@example.com' } });

    const edited = await agent
      .patch(`/api/admin/people/${person.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ email: 'grace-profile-only@example.com' });
    expect(edited.status).toBe(200);

    const detail = await agent.get(`/api/admin/people/${person.id}`);
    expect(detail.body.email).toBe('grace-profile-only@example.com');
    expect(detail.body.memberAccount.email).toBe('grace-signin@example.com');
  });

  it('updates the actual sign-in email via the dedicated route, rejects a duplicate, and 404s with no account', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-people-signin-b@test.local');
    const person = await prisma.person.create({
      data: { name: 'John Signin', whatsappNumber: '+237670004006' },
    });
    await prisma.memberAccount.create({ data: { personId: person.id, email: 'john-old@example.com' } });

    const otherPerson = await prisma.person.create({
      data: { name: 'Other Signin', whatsappNumber: '+237670004007' },
    });
    await prisma.memberAccount.create({ data: { personId: otherPerson.id, email: 'taken@example.com' } });

    const duplicate = await agent
      .patch(`/api/admin/people/${person.id}/sign-in-email`)
      .set('X-CSRF-Token', csrf)
      .send({ email: 'taken@example.com' });
    expect(duplicate.status).toBe(409);

    const updated = await agent
      .patch(`/api/admin/people/${person.id}/sign-in-email`)
      .set('X-CSRF-Token', csrf)
      .send({ email: 'john-new@example.com' });
    expect(updated.status).toBe(200);
    expect(updated.body.email).toBe('john-new@example.com');

    const detail = await agent.get(`/api/admin/people/${person.id}`);
    expect(detail.body.memberAccount.email).toBe('john-new@example.com');
    expect(detail.body.email).toBeNull(); // the plain profile email was never set/changed

    const noAccountPerson = await prisma.person.create({
      data: { name: 'No Account', whatsappNumber: '+237670004008' },
    });
    const noAccount = await agent
      .patch(`/api/admin/people/${noAccountPerson.id}/sign-in-email`)
      .set('X-CSRF-Token', csrf)
      .send({ email: 'whoever@example.com' });
    expect(noAccount.status).toBe(404);
  });

  it('deletes a Person and everything cascaded from it, and 404s for a second delete', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-people-delete@test.local');
    const community = await prisma.community.create({ data: { name: 'Delete Cascade Test Community' } });
    const person = await prisma.person.create({
      data: { name: 'Delete Me', whatsappNumber: '+237670004009' },
    });
    await prisma.memberAccount.create({ data: { personId: person.id, email: 'delete-me@example.com' } });
    await prisma.communityMembership.create({
      data: { personId: person.id, communityId: community.id, status: 'ACTIVE' },
    });

    const del = await agent.delete(`/api/admin/people/${person.id}`).set('X-CSRF-Token', csrf);
    expect(del.status).toBe(204);

    const gone = await prisma.person.findUnique({ where: { id: person.id } });
    expect(gone).toBeNull();
    const accountGone = await prisma.memberAccount.findUnique({ where: { personId: person.id } });
    expect(accountGone).toBeNull();

    const secondDelete = await agent.delete(`/api/admin/people/${person.id}`).set('X-CSRF-Token', csrf);
    expect(secondDelete.status).toBe(404);
  });
});
