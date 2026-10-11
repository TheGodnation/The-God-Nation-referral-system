import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Geography Retirement Step 5B — retires the remaining organizational
// Geography assignment/authorization layer. GeographicAssignment (the whole
// model/table) and RoleAssignment.geographyId are both removed entirely
// (see the 20260930105022_retire_geographic_assignment_and_role_geography
// migration): SCOPED_LEADER is Community-scoped only, and GET
// /api/leader/roster no longer has a Geography branch. This file tests the
// rejection behavior and security properties that change as a direct
// result; existing Community-context leadership/roster/messaging/resource
// behavior is already exhaustively covered by roleAssignment.test.ts,
// leaderRoster.test.ts, privateMessaging.test.ts, and
// resourceAccessGrants.test.ts — none of those files construct a
// Geography-scoped role any more and are unaffected by this step.
//
// Final Geography Retirement later removed the Geography model itself —
// every "a Geography id" test below now uses a fabricated random UUID
// (crypto.randomUUID()) rather than a real Geography row, since no such row
// can exist any more; the security property under test (a non-Community
// identifier can never grant authority) is unchanged and, if anything,
// stronger now that the id cannot even belong to a real retired-model row.
// The diagnostic describe block that used to close this file was removed
// along with GET /api/admin/diagnostics/geography-dependencies itself.
const app = createApp();

let ipCounter = 50000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.97.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makePerson(whatsappNumber: string, name = 'Geo Assignment Retirement Person', overrides: Record<string, unknown> = {}) {
  return prisma.person.create({ data: { name, whatsappNumber, ...overrides } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

/** Creates a Leader User linked to a fresh Person with an ACTIVE
 * SCOPED_LEADER RoleAssignment for the given exact Community, then logs in. */
async function setupScopedLeader(n: number, communityId: string) {
  const email = `leader-garetire${n}@test.local`;
  const { user } = await createLeader(`Geo Assignment Retirement Leader ${n}`, email, `GAR${n}CODE`);
  const person = await makePerson(`+237677${String(n).padStart(6, '0')}`, `Geo Assignment Retirement Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

describe('Geography Retirement Step 5B — GeographicAssignment retirement', () => {
  it('1. GeographicAssignment no longer exists as a Prisma model at all', () => {
    expect((prisma as any).geographicAssignment).toBeUndefined();
  });

  it('2-4. No endpoint exists to create, update, or delete a GeographicAssignment — the route is gone entirely (404)', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-garetire-noroute@test.local');
    const person = await makePerson('+237677900001', 'No Route Person');

    const res = await agent
      .put(`/api/admin/people/${person.id}/geographic-assignment`)
      .set('X-CSRF-Token', csrf)
      .send({ geographyId: crypto.randomUUID() });

    expect(res.status).toBe(404);
  });

  it('5. GeographicAssignment cannot exist at the database level — the table itself no longer exists', async () => {
    await expect(prisma.$queryRawUnsafe('SELECT 1 FROM "GeographicAssignment" LIMIT 1')).rejects.toThrow();
  });
});

describe('Geography Retirement Step 5B — RoleAssignment Geography scope retirement', () => {
  it('6. RoleAssignment.geographyId no longer exists as a database column', async () => {
    await expect(prisma.$queryRawUnsafe('SELECT "geographyId" FROM "RoleAssignment" LIMIT 1')).rejects.toThrow();
  });

  it('7. Geography-scoped Leader creation is rejected — geographyId alone is not a valid substitute for communityId', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-garetire-geo-only@test.local');
    const person = await makePerson('+237677900002', 'Geo Only Candidate');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', geographyId: crypto.randomUUID() });

    expect(res.status).toBe(400);
  });

  it('8. Community Leader creation still succeeds', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-garetire-community@test.local');
    const person = await makePerson('+237677900003', 'Community Candidate');
    const community = await makeCommunity('GAR Community A');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });

    expect(res.status).toBe(201);
    expect(res.body.communityId).toBe(community.id);
  });

  it('9. Multiple active Community Leaders still work for the same Community', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-garetire-multi@test.local');
    const community = await makeCommunity('GAR Community B');
    const personA = await makePerson('+237677900004', 'Leader A');
    const personB = await makePerson('+237677900005', 'Leader B');

    const resA = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: personA.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    const resB = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: personB.id, roleType: 'SCOPED_LEADER', communityId: community.id });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    const active = await prisma.roleAssignment.count({ where: { communityId: community.id, status: 'ACTIVE' } });
    expect(active).toBe(2);
  });

  it('10. Community Leader removal/status behavior remains correct', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-garetire-end@test.local');
    const community = await makeCommunity('GAR Community C');
    const person = await makePerson('+237677900006', 'Ending Leader');

    const created = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    const ended = await agent.patch(`/api/admin/role-assignments/${created.body.id}/end`).set('X-CSRF-Token', csrf).send({});

    expect(ended.status).toBe(200);
    expect(ended.body.status).toBe('ENDED');
  });
});

describe('Geography Retirement Step 5B — roster retirement', () => {
  it('11. Geography roster access is rejected outright (400) — scopeType only accepts COMMUNITY', async () => {
    const community = await makeCommunity('GAR Community D');
    const { agent } = await setupScopedLeader(1, community.id);

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${crypto.randomUUID()}`);
    expect(res.status).toBe(400);
  });

  it('12. A non-Community id cannot be substituted for a Community id to obtain roster access', async () => {
    const community = await makeCommunity('GAR Community E');
    const { agent } = await setupScopedLeader(2, community.id);

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${crypto.randomUUID()}`);
    expect(res.status).toBe(403);
  });

  it('13. Community roster access remains correct', async () => {
    const community = await makeCommunity('GAR Community F');
    const { agent } = await setupScopedLeader(3, community.id);
    const member = await makePerson('+237677900007', 'Roster Member');
    await prisma.communityMembership.create({ data: { personId: member.id, communityId: community.id } });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.personId)).toContain(member.id);
  });

  it('14. Cross-Community roster access remains blocked', async () => {
    const communityA = await makeCommunity('GAR Community G-A');
    const communityB = await makeCommunity('GAR Community G-B');
    const { agent } = await setupScopedLeader(4, communityA.id);

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${communityB.id}`);
    expect(res.status).toBe(403);
  });
});

describe('Geography Retirement Step 5B — People / authority', () => {
  it('15. Geography cannot assign organizational membership — the endpoint that used to do this is gone', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-garetire-noassign@test.local');
    const person = await makePerson('+237677900008', 'No Assign Person');

    const res = await agent
      .put(`/api/admin/people/${person.id}/geographic-assignment`)
      .set('X-CSRF-Token', csrf)
      .send({ geographyId: crypto.randomUUID() });
    expect(res.status).toBe(404);

    const detail = await agent.get(`/api/admin/people/${person.id}`);
    expect(detail.body.communityMemberships).toEqual([]);
  });

  it('16. Geography cannot grant Leader authority — no route accepts geographyId to create a role', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-garetire-noauth@test.local');
    const person = await makePerson('+237677900009', 'No Auth Person');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', geographyId: crypto.randomUUID() });
    expect(res.status).toBe(400);

    const roles = await prisma.roleAssignment.count({ where: { personId: person.id } });
    expect(roles).toBe(0);
  });

  it('17. Descriptive location fields do not grant authority — a Leader linked to a fully-located Person, but with no RoleAssignment, still cannot access any roster', async () => {
    const community = await makeCommunity('GAR Community H');
    const email = 'leader-located@test.local';
    const { user } = await createLeader('Located Leader', email, 'GARLOCATED');
    const person = await makePerson('+237677900010', 'Located Person', {
      locationCountry: 'Cameroon',
      locationCity: 'Douala',
      locationArea: 'Bonapriso',
    });
    await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(403);
  });

  it('18. Community membership remains authoritative for roster population', async () => {
    const community = await makeCommunity('GAR Community I');
    const { agent } = await setupScopedLeader(5, community.id);
    const memberWithLocation = await makePerson('+237677900011', 'Member With Location', {
      locationCountry: 'Nigeria',
    });
    const memberWithout = await makePerson('+237677900012', 'Member Without Location');
    await prisma.communityMembership.create({ data: { personId: memberWithLocation.id, communityId: community.id } });
    await prisma.communityMembership.create({ data: { personId: memberWithout.id, communityId: community.id } });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(memberWithLocation.id);
    expect(ids).toContain(memberWithout.id);
  });
});

describe('Geography Retirement Step 5B — Follow-Up boundary (unchanged since Step 5A)', () => {
  it('23. Follow-Up remains Community-only', async () => {
    const community = await makeCommunity('GAR Community J');
    const { agent, csrf } = await setupScopedLeader(6, community.id);
    const followed = await makePerson('+237677900013', 'Followed Person');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(res.status).toBe(201);
  });

  it('24. Geography cannot create Follow-Ups', async () => {
    const community = await makeCommunity('GAR Community K');
    const { agent, csrf } = await setupScopedLeader(7, community.id);
    const followed = await makePerson('+237677900014', 'Followed Person 2');

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'GEOGRAPHY', contextId: crypto.randomUUID() });
    expect(res.status).toBe(400);
  });

  it('25. Follow-Up Attention remains correct', async () => {
    const community = await makeCommunity('GAR Community L');
    const { agent, csrf } = await setupScopedLeader(8, community.id);
    const followed = await makePerson('+237677900015', 'Followed Person 3');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const created = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(created.status).toBe(201);

    const attention = await agent.get('/api/leader/follow-ups/attention');
    expect(attention.status).toBe(200);
    expect(attention.body.items.some((i: any) => i.followUpAssignmentId === created.body.id)).toBe(true);
  });

  it('26. Community Follow-Up reassignment remains correct', async () => {
    const community = await makeCommunity('GAR Community M');
    const { agent, csrf } = await setupScopedLeader(9, community.id);
    const { person: newFollower } = await setupScopedLeader(10, community.id);
    const followed = await makePerson('+237677900016', 'Followed Person 4');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const created = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(created.status).toBe(201);

    const reassign = await agent
      .post(`/api/leader/follow-ups/${created.body.id}/reassign`)
      .set('X-CSRF-Token', csrf)
      .send({ newFollowerId: newFollower.id });
    expect(reassign.status).toBe(200);
  });
});

describe('Geography Retirement Step 5B — security', () => {
  it('27. No client-supplied Geography id can grant authority via the role-assignments endpoint', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-garetire-security1@test.local');
    const person = await makePerson('+237677900017', 'Security Person 1');
    const community = await makeCommunity('GAR Community N');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id, geographyId: crypto.randomUUID() });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('geographyId');
  });

  it('28. No location field can substitute for Community membership when requesting scoped-people', async () => {
    const community = await makeCommunity('GAR Community O');
    const { agent } = await setupScopedLeader(11, community.id);
    const outOfScope = await makePerson('+237677900018', 'Out Of Scope Person', { locationCountry: 'Cameroon' });
    void outOfScope;

    const res = await agent.get(`/api/leader/scoped-people?contextType=COMMUNITY&contextId=${community.id}&search=Out`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((p: any) => p.id)).not.toContain(outOfScope.id);
  });

  it('29. No cross-Community access is introduced by this retirement', async () => {
    const communityA = await makeCommunity('GAR Community P-A');
    const communityB = await makeCommunity('GAR Community P-B');
    const { agent } = await setupScopedLeader(12, communityA.id);
    const memberB = await makePerson('+237677900019', 'Member B');
    await prisma.communityMembership.create({ data: { personId: memberB.id, communityId: communityB.id } });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${communityA.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.personId)).not.toContain(memberB.id);
  });

  it('30. No cross-Leader access is introduced by this retirement', async () => {
    const community = await makeCommunity('GAR Community Q');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(13, community.id);
    const { agent: agentB } = await setupScopedLeader(14, community.id);
    const followed = await makePerson('+237677900020', 'Followed Person 5');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const createdFU = await agentA
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrfA)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(createdFU.status).toBe(201);

    const listB = await agentB.get('/api/leader/follow-ups');
    expect(listB.body.items.length).toBe(0);
  });
});
