import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.72.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) {
    wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', ip);
  }
  return wrapped;
}

async function loginAsAdmin(email: string, password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

async function loginAsLeader(name: string, email: string, code: string, password = 'password123') {
  const { user } = await createLeader(name, email, code, password);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf, user };
}

async function makePerson(whatsappNumber: string, name = 'Link Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

describe('Phase 3D — Leader User to Person linking', () => {
  it('lets an Admin link a Leader User to a Person', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-link1@test.local');
    const { user: leader } = await createLeader('Leader One', 'leader-link1@test.local', 'LINK001');
    const person = await makePerson('+237671000001');

    const res = await agent
      .patch(`/api/admin/leaders/${leader.id}/link-person`)
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id });

    expect(res.status).toBe(200);
    expect(res.body.personId).toBe(person.id);

    const updated = await prisma.user.findUnique({ where: { id: leader.id } });
    expect(updated!.personId).toBe(person.id);
  });

  it('rejects a non-Admin attempting to link', async () => {
    const { agent, csrf } = await loginAsLeader('Leader NonAdmin', 'leader-link2@test.local', 'LINK002');
    const { user: otherLeader } = await createLeader('Leader Target', 'leader-link2b@test.local', 'LINK002B');
    const person = await makePerson('+237671000002');

    const res = await agent
      .patch(`/api/admin/leaders/${otherLeader.id}/link-person`)
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id });

    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated attempts to link', async () => {
    const { user: leader } = await createLeader('Leader Unauth', 'leader-link3@test.local', 'LINK003');
    const person = await makePerson('+237671000003');
    const anon = agentWithUniqueIp();
    const { csrf } = await bootstrap(anon as any);

    const res = await anon
      .patch(`/api/admin/leaders/${leader.id}/link-person`)
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id });

    expect(res.status).toBe(401);
  });

  it('rejects linking through the Leader endpoint when the target User is an ADMIN', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-link4@test.local');
    const targetAdmin = await createAdmin('admin-link4-target@test.local');
    const person = await makePerson('+237671000004');

    const res = await agent
      .patch(`/api/admin/leaders/${targetAdmin.id}/link-person`)
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id });

    expect(res.status).toBe(400);
  });

  it('rejects an invalid Person id', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-link5@test.local');
    const { user: leader } = await createLeader('Leader Five', 'leader-link5@test.local', 'LINK005');

    const res = await agent
      .patch(`/api/admin/leaders/${leader.id}/link-person`)
      .set('X-CSRF-Token', csrf)
      .send({ personId: 'nonexistent-person-id' });

    expect(res.status).toBe(400);
  });

  it('rejects a nonexistent target User', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-link6@test.local');
    const person = await makePerson('+237671000006');

    const res = await agent
      .patch('/api/admin/leaders/nonexistent-user-id/link-person')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id });

    expect(res.status).toBe(404);
  });

  it('rejects linking a Person already linked to another User', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-link7@test.local');
    const { user: leaderA } = await createLeader('Leader Seven A', 'leader-link7a@test.local', 'LINK007A');
    const { user: leaderB } = await createLeader('Leader Seven B', 'leader-link7b@test.local', 'LINK007B');
    const person = await makePerson('+237671000007');

    const first = await agent
      .patch(`/api/admin/leaders/${leaderA.id}/link-person`)
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id });
    expect(first.status).toBe(200);

    const second = await agent
      .patch(`/api/admin/leaders/${leaderB.id}/link-person`)
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id });
    expect(second.status).toBe(409);
  });

  it('repeated valid link with the same Person is idempotent; a different Person is a conflict', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-link8@test.local');
    const { user: leader } = await createLeader('Leader Eight', 'leader-link8@test.local', 'LINK008');
    const personA = await makePerson('+237671000008');
    const personB = await makePerson('+237671000108');

    const first = await agent
      .patch(`/api/admin/leaders/${leader.id}/link-person`)
      .set('X-CSRF-Token', csrf)
      .send({ personId: personA.id });
    expect(first.status).toBe(200);

    const repeat = await agent
      .patch(`/api/admin/leaders/${leader.id}/link-person`)
      .set('X-CSRF-Token', csrf)
      .send({ personId: personA.id });
    expect(repeat.status).toBe(200);

    const differentPerson = await agent
      .patch(`/api/admin/leaders/${leader.id}/link-person`)
      .set('X-CSRF-Token', csrf)
      .send({ personId: personB.id });
    expect(differentPerson.status).toBe(409);
  });

  it('creates an audit entry for the link action', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-link9@test.local');
    const { user: leader } = await createLeader('Leader Nine', 'leader-link9@test.local', 'LINK009');
    const person = await makePerson('+237671000009');

    await agent
      .patch(`/api/admin/leaders/${leader.id}/link-person`)
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id });

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'LEADER_PERSON_LINKED', targetType: 'User', targetId: leader.id },
    });
    expect(audit).toBeTruthy();
  });

  it('enforces User.personId uniqueness at the database level under a concurrent race', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-link10@test.local');
    const { user: leaderA } = await createLeader('Leader Ten A', 'leader-link10a@test.local', 'LINK010A');
    const { user: leaderB } = await createLeader('Leader Ten B', 'leader-link10b@test.local', 'LINK010B');
    const person = await makePerson('+237671000010');

    const [resA, resB] = await Promise.all([
      agent.patch(`/api/admin/leaders/${leaderA.id}/link-person`).set('X-CSRF-Token', csrf).send({ personId: person.id }),
      agent.patch(`/api/admin/leaders/${leaderB.id}/link-person`).set('X-CSRF-Token', csrf).send({ personId: person.id }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    const linkedCount = await prisma.user.count({ where: { personId: person.id } });
    expect(linkedCount).toBe(1);
  });

  it('lets an Admin without a Person perform the link action', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-link11@test.local');
    const adminUser = await prisma.user.findUnique({ where: { email: 'admin-link11@test.local' } });
    expect(adminUser!.personId).toBeNull();

    const { user: leader } = await createLeader('Leader Eleven', 'leader-link11@test.local', 'LINK011');
    const person = await makePerson('+237671000011');

    const res = await agent
      .patch(`/api/admin/leaders/${leader.id}/link-person`)
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id });

    expect(res.status).toBe(200);
  });
});
