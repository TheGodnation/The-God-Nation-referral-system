import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.73.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makePerson(whatsappNumber: string, name = 'Role Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function makeGeography(name: string, type = 'REGION', countryCode = 'CM') {
  return prisma.geography.create({ data: { name, type, countryCode } });
}

describe('Phase 3D — RoleAssignment', () => {
  it('lets an Admin create a Community-scoped SCOPED_LEADER assignment', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role1@test.local');
    const person = await makePerson('+237672000001');
    const community = await makeCommunity('Role Test Community 1');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });

    expect(res.status).toBe(201);
    expect(res.body.communityId).toBe(community.id);
    expect(res.body.geographyId).toBeNull();
    expect(res.body.status).toBe('ACTIVE');
  });

  it('lets an Admin create a Geography-scoped SCOPED_LEADER assignment', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role2@test.local');
    const person = await makePerson('+237672000002');
    const geography = await makeGeography('Role Test Geography 2');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', geographyId: geography.id });

    expect(res.status).toBe(201);
    expect(res.body.geographyId).toBe(geography.id);
    expect(res.body.communityId).toBeNull();
  });

  it('rejects an assignment with both communityId and geographyId', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role3@test.local');
    const person = await makePerson('+237672000003');
    const community = await makeCommunity('Role Test Community 3');
    const geography = await makeGeography('Role Test Geography 3');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id, geographyId: geography.id });

    expect(res.status).toBe(400);
  });

  it('rejects an assignment with neither communityId nor geographyId', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role4@test.local');
    const person = await makePerson('+237672000004');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER' });

    expect(res.status).toBe(400);
  });

  it('rejects an invalid roleType', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role5@test.local');
    const person = await makePerson('+237672000005');
    const community = await makeCommunity('Role Test Community 5');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SUPER_LEADER', communityId: community.id });

    expect(res.status).toBe(400);
  });

  it('rejects a duplicate active assignment for the same Person and Community', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role6@test.local');
    const person = await makePerson('+237672000006');
    const community = await makeCommunity('Role Test Community 6');

    const first = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    expect(first.status).toBe(201);

    const second = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    expect(second.status).toBe(409);
  });

  it('rejects a duplicate active assignment for the same Person and Geography', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role7@test.local');
    const person = await makePerson('+237672000007');
    const geography = await makeGeography('Role Test Geography 7');

    const first = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', geographyId: geography.id });
    expect(first.status).toBe(201);

    const second = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', geographyId: geography.id });
    expect(second.status).toBe(409);
  });

  it('allows the same Person to hold distinct Community and Geography scopes simultaneously', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role8@test.local');
    const person = await makePerson('+237672000008');
    const community = await makeCommunity('Role Test Community 8');
    const geography = await makeGeography('Role Test Geography 8');

    const communityRes = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    expect(communityRes.status).toBe(201);

    const geographyRes = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', geographyId: geography.id });
    expect(geographyRes.status).toBe(201);

    const active = await prisma.roleAssignment.count({ where: { personId: person.id, status: 'ACTIVE' } });
    expect(active).toBe(2);
  });

  it('lets an Admin end an active role assignment', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role9@test.local');
    const person = await makePerson('+237672000009');
    const community = await makeCommunity('Role Test Community 9');

    const created = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });

    const ended = await agent.patch(`/api/admin/role-assignments/${created.body.id}/end`).set('X-CSRF-Token', csrf).send({});
    expect(ended.status).toBe(200);
    expect(ended.body.status).toBe('ENDED');
    expect(ended.body.endedAt).toBeTruthy();

    // Never hard-deleted.
    const row = await prisma.roleAssignment.findUnique({ where: { id: created.body.id } });
    expect(row).toBeTruthy();
  });

  it('rejects ending an already-ended role assignment', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role10@test.local');
    const person = await makePerson('+237672000010');
    const community = await makeCommunity('Role Test Community 10');

    const created = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    await agent.patch(`/api/admin/role-assignments/${created.body.id}/end`).set('X-CSRF-Token', csrf).send({});

    const secondEnd = await agent.patch(`/api/admin/role-assignments/${created.body.id}/end`).set('X-CSRF-Token', csrf).send({});
    expect(secondEnd.status).toBe(409);
  });

  it('allows re-creating a role for the same Person+Community after the prior one ended', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role11@test.local');
    const person = await makePerson('+237672000011');
    const community = await makeCommunity('Role Test Community 11');

    const first = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    await agent.patch(`/api/admin/role-assignments/${first.body.id}/end`).set('X-CSRF-Token', csrf).send({});

    const second = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    expect(second.status).toBe(201);

    const count = await prisma.roleAssignment.count({ where: { personId: person.id, communityId: community.id } });
    expect(count).toBe(2);
  });

  it('rejects a nonexistent Person', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role12@test.local');
    const community = await makeCommunity('Role Test Community 12');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: 'nonexistent', roleType: 'SCOPED_LEADER', communityId: community.id });

    expect(res.status).toBe(400);
  });

  it('rejects a nonexistent Community/Geography target', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role13@test.local');
    const person = await makePerson('+237672000013');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: 'nonexistent' });

    expect(res.status).toBe(400);
  });

  it('is Admin-only — a Leader cannot create a role assignment', async () => {
    // No Leader route exists for role-assignments at all; confirm it 404s
    // as an unrecognized path under /api/leader rather than being reachable.
    const anon = agentWithUniqueIp();
    const { csrf } = await bootstrap(anon as any);
    const res = await anon.post('/api/leader/role-assignments').set('X-CSRF-Token', csrf).send({});
    expect([401, 404]).toContain(res.status);
  });

  it('a concurrent duplicate create is safely constrained to exactly one active row', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role14@test.local');
    const person = await makePerson('+237672000014');
    const community = await makeCommunity('Role Test Community 14');

    const [resA, resB] = await Promise.all([
      agent.post('/api/admin/role-assignments').set('X-CSRF-Token', csrf).send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id }),
      agent.post('/api/admin/role-assignments').set('X-CSRF-Token', csrf).send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const activeCount = await prisma.roleAssignment.count({ where: { personId: person.id, communityId: community.id, status: 'ACTIVE' } });
    expect(activeCount).toBe(1);
  });

  it('lists role assignments with person/scope/status/assignedBy details', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-role15@test.local');
    const person = await makePerson('+237672000015', 'List Test Person');
    const community = await makeCommunity('Role Test Community 15');

    await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });

    const list = await agent.get('/api/admin/role-assignments');
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    const row = list.body.items.find((r: any) => r.personId === person.id);
    expect(row.person.name).toBe('List Test Person');
    expect(row.community.id).toBe(community.id);
    expect(row.assignedBy.email).toBe('admin-role15@test.local');
  });
});
