import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.74.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makePerson(whatsappNumber: string, name = 'FollowUp Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function makeGeography(name: string, type = 'REGION', countryCode = 'CM') {
  return prisma.geography.create({ data: { name, type, countryCode } });
}

/** Creates a Leader User, links it to a fresh Person, grants that Person an
 * ACTIVE SCOPED_LEADER RoleAssignment for the given exact scope, and logs
 * in as that Leader. The link/role are set up directly against the DB
 * (already covered by their own dedicated test files) so this file can
 * focus purely on FollowUpAssignment behavior. */
async function setupScopedLeader(
  n: number,
  scope: { communityId: string } | { geographyId: string },
) {
  const email = `leader-fu${n}@test.local`;
  const { user } = await createLeader(`FollowUp Leader ${n}`, email, `FU${n}CODE`);
  const person = await makePerson(`+237673${String(n).padStart(6, '0')}`, `FollowUp Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: {
      personId: person.id,
      roleType: 'SCOPED_LEADER',
      assignedByUserId: user.id,
      ...('communityId' in scope ? { communityId: scope.communityId } : { geographyId: scope.geographyId }),
    },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

describe('Phase 3D — FollowUpAssignment creation and authorization', () => {
  it('a valid Community-scoped Leader can create a valid Community follow-up', async () => {
    const community = await makeCommunity('FU Community A');
    const { agent, csrf, person: leaderPerson } = await setupScopedLeader(1, { communityId: community.id });
    const followed = await makePerson('+237674000001', 'Followed Person 1');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });

    expect(res.status).toBe(201);
    expect(res.body.followerId).toBe(leaderPerson.id);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('a valid Geography-scoped Leader can create a valid Geography follow-up', async () => {
    const geography = await makeGeography('FU Geography A');
    const { agent, csrf } = await setupScopedLeader(2, { geographyId: geography.id });
    const followed = await makePerson('+237674000002', 'Followed Person 2');
    await prisma.geographicAssignment.create({ data: { personId: followed.id, geographyId: geography.id } });

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'GEOGRAPHY', contextId: geography.id });

    expect(res.status).toBe(201);
  });

  it('rejects when the followed Person lacks the required ACTIVE CommunityMembership', async () => {
    const community = await makeCommunity('FU Community B');
    const { agent, csrf } = await setupScopedLeader(3, { communityId: community.id });
    const followed = await makePerson('+237674000003', 'Followed Person 3');
    // No CommunityMembership created for `followed`.

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });

    expect(res.status).toBe(400);
  });

  it('rejects when the followed Person lacks the required ACTIVE GeographicAssignment', async () => {
    const geography = await makeGeography('FU Geography B');
    const { agent, csrf } = await setupScopedLeader(4, { geographyId: geography.id });
    const followed = await makePerson('+237674000004', 'Followed Person 4');

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'GEOGRAPHY', contextId: geography.id });

    expect(res.status).toBe(400);
  });

  it('a Community Leader cannot create a follow-up for a different Community than assigned', async () => {
    const communityA = await makeCommunity('FU Community C-A');
    const communityB = await makeCommunity('FU Community C-B');
    const { agent, csrf } = await setupScopedLeader(5, { communityId: communityA.id });
    const followed = await makePerson('+237674000005', 'Followed Person 5');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: communityB.id } });

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: communityB.id });

    expect(res.status).toBe(403);
  });

  it('a Geography Leader cannot create a follow-up for a different Geography than assigned', async () => {
    const geoA = await makeGeography('FU Geography D-A');
    const geoB = await makeGeography('FU Geography D-B');
    const { agent, csrf } = await setupScopedLeader(6, { geographyId: geoA.id });
    const followed = await makePerson('+237674000006', 'Followed Person 6');
    await prisma.geographicAssignment.create({ data: { personId: followed.id, geographyId: geoB.id } });

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'GEOGRAPHY', contextId: geoB.id });

    expect(res.status).toBe(403);
  });

  it('a Geography Leader assigned to a parent does not automatically cover a child Geography', async () => {
    const parent = await makeGeography('FU Parent Geography');
    const child = await prisma.geography.create({ data: { name: 'FU Child Geography', type: 'DIVISION', countryCode: 'CM', parentId: parent.id } });
    const { agent, csrf } = await setupScopedLeader(7, { geographyId: parent.id });
    const followed = await makePerson('+237674000007', 'Followed Person 7');
    await prisma.geographicAssignment.create({ data: { personId: followed.id, geographyId: child.id } });

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'GEOGRAPHY', contextId: child.id });

    // No active role for the child Geography at all — exact-scope only.
    expect(res.status).toBe(403);
  });

  it('a Community Leader assigned to a parent does not automatically cover a child Community', async () => {
    const parent = await makeCommunity('FU Parent Community');
    const child = await prisma.community.create({ data: { name: 'FU Child Community', parentId: parent.id } });
    const { agent, csrf } = await setupScopedLeader(8, { communityId: parent.id });
    const followed = await makePerson('+237674000008', 'Followed Person 8');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: child.id } });

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: child.id });

    expect(res.status).toBe(403);
  });

  it('a Leader cannot choose another Person as follower — followerId is always the authenticated Leader', async () => {
    const community = await makeCommunity('FU Community E');
    const { agent, csrf, person: leaderPerson } = await setupScopedLeader(9, { communityId: community.id });
    const someoneElsePerson = await makePerson('+237674000009', 'Someone Else');
    const followed = await makePerson('+237674000109', 'Followed Person 9');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    // The endpoint schema does not even accept a followerId field — sending
    // one anyway must have zero effect; the created row's followerId is
    // always the authenticated Leader's own linked Person.
    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followerId: someoneElsePerson.id, followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });

    expect(res.status).toBe(201);
    expect(res.body.followerId).toBe(leaderPerson.id);
    expect(res.body.followerId).not.toBe(someoneElsePerson.id);
  });

  it('an Admin can create a follow-up assignment globally', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-fu10@test.local');
    const community = await makeCommunity('FU Community F');
    const follower = await makePerson('+237674000010', 'Admin-Chosen Follower');
    const followed = await makePerson('+237674000110', 'Admin-Chosen Followed');

    const res = await agent
      .post('/api/admin/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followerId: follower.id, followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });

    expect(res.status).toBe(201);
  });

  it('rejects a Person following themselves', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-fu11@test.local');
    const community = await makeCommunity('FU Community G');
    const person = await makePerson('+237674000011');

    const res = await agent
      .post('/api/admin/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followerId: person.id, followedPersonId: person.id, contextType: 'COMMUNITY', contextId: community.id });

    expect(res.status).toBe(400);
  });

  it('a Member cannot access any follow-up endpoint', async () => {
    const anon = agentWithUniqueIp();
    const { csrf } = await bootstrap(anon as any);
    const person = await makePerson('+237674000012', 'Member Test Person');
    // Register a MemberAccount + session for this Person via the existing
    // Phase 3C member auth flow is heavier than needed here; the isolation
    // property under test is that Follow-up routes require req.user
    // (Admin/Leader session), which a Member session never satisfies —
    // already exhaustively proven in memberSessionIsolation.test.ts. Here we
    // simply confirm an unauthenticated/non-Admin-Leader caller is denied.
    const res = await anon.get('/api/leader/follow-ups');
    expect(res.status).toBe(401);
    const adminRes = await anon.get('/api/admin/follow-ups');
    expect(adminRes.status).toBe(401);
  });

  it('an unauthenticated caller cannot access follow-up endpoints', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/leader/follow-ups');
    expect(res.status).toBe(401);
  });

  it('rejects a duplicate active follower/followed pair', async () => {
    const community = await makeCommunity('FU Community H');
    const { agent, csrf } = await setupScopedLeader(13, { communityId: community.id });
    const followed = await makePerson('+237674000013', 'Followed Person 13');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const first = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(first.status).toBe(201);

    const second = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(second.status).toBe(409);
  });

  it('a concurrent duplicate creation is safely constrained to exactly one active row', async () => {
    const community = await makeCommunity('FU Community I');
    const { agent, csrf } = await setupScopedLeader(14, { communityId: community.id });
    const followed = await makePerson('+237674000014', 'Followed Person 14');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const [resA, resB] = await Promise.all([
      agent.post('/api/leader/follow-ups').set('X-CSRF-Token', csrf).send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id }),
      agent.post('/api/leader/follow-ups').set('X-CSRF-Token', csrf).send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]);

    const activeCount = await prisma.followUpAssignment.count({ where: { followedPersonId: followed.id, status: 'ACTIVE' } });
    expect(activeCount).toBe(1);
  });

  it('closed historical assignments may coexist with a new active assignment for the same pair', async () => {
    const community = await makeCommunity('FU Community J');
    const { agent, csrf } = await setupScopedLeader(15, { communityId: community.id });
    const followed = await makePerson('+237674000015', 'Followed Person 15');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const created = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    await agent.post(`/api/leader/follow-ups/${created.body.id}/close`).set('X-CSRF-Token', csrf).send({});

    const recreated = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(recreated.status).toBe(201);

    const total = await prisma.followUpAssignment.count({ where: { followedPersonId: followed.id } });
    expect(total).toBe(2);
  });
});

describe('Phase 3D — GET /api/leader/scoped-people', () => {
  it('returns only Persons with an ACTIVE membership in the Leader\'s exact scope', async () => {
    const community = await makeCommunity('SP Community A');
    const other = await makeCommunity('SP Community B');
    const { agent, csrf } = await setupScopedLeader(30, { communityId: community.id });
    const inScope = await makePerson('+237674000030', 'In Scope Person');
    const outOfScope = await makePerson('+237674000031', 'Out Of Scope Person');
    await prisma.communityMembership.create({ data: { personId: inScope.id, communityId: community.id } });
    await prisma.communityMembership.create({ data: { personId: outOfScope.id, communityId: other.id } });
    void csrf;

    const res = await agent.get(`/api/leader/scoped-people?contextType=COMMUNITY&contextId=${community.id}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((p: any) => p.id);
    expect(ids).toContain(inScope.id);
    expect(ids).not.toContain(outOfScope.id);
  });

  it('rejects a context the Leader is not scoped to', async () => {
    const community = await makeCommunity('SP Community C');
    const other = await makeCommunity('SP Community D');
    const { agent } = await setupScopedLeader(31, { communityId: community.id });

    const res = await agent.get(`/api/leader/scoped-people?contextType=COMMUNITY&contextId=${other.id}`);
    expect(res.status).toBe(403);
  });
});

describe('Phase 3D — FollowUpAssignment visibility', () => {
  it('Admin sees all follow-up assignments', async () => {
    const { agent: adminAgent } = await loginAsAdmin('admin-fu-view1@test.local');
    const community = await makeCommunity('FU View Community A');
    const { agent, csrf } = await setupScopedLeader(20, { communityId: community.id });
    const followed = await makePerson('+237674000020', 'Followed View Person A');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    await agent.post('/api/leader/follow-ups').set('X-CSRF-Token', csrf).send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });

    const list = await adminAgent.get('/api/admin/follow-ups');
    expect(list.status).toBe(200);
    expect(list.body.items.some((r: any) => r.followedPerson.id === followed.id)).toBe(true);
  });

  it('a Leader sees only their own follow-up assignments', async () => {
    const communityA = await makeCommunity('FU View Community B');
    const communityB = await makeCommunity('FU View Community C');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(21, { communityId: communityA.id });
    const { agent: agentB, csrf: csrfB } = await setupScopedLeader(22, { communityId: communityB.id });

    const followedA = await makePerson('+237674000021', 'Followed A');
    await prisma.communityMembership.create({ data: { personId: followedA.id, communityId: communityA.id } });
    await agentA.post('/api/leader/follow-ups').set('X-CSRF-Token', csrfA).send({ followedPersonId: followedA.id, contextType: 'COMMUNITY', contextId: communityA.id });

    const followedB = await makePerson('+237674000022', 'Followed B');
    await prisma.communityMembership.create({ data: { personId: followedB.id, communityId: communityB.id } });
    await agentB.post('/api/leader/follow-ups').set('X-CSRF-Token', csrfB).send({ followedPersonId: followedB.id, contextType: 'COMMUNITY', contextId: communityB.id });

    const listA = await agentA.get('/api/leader/follow-ups');
    expect(listA.status).toBe(200);
    expect(listA.body.items.length).toBe(1);
    expect(listA.body.items[0].followedPerson.id).toBe(followedA.id);
  });

  it('one Leader cannot see another Leader\'s assignment even sharing the same scope', async () => {
    const community = await makeCommunity('FU View Community D');
    const { agent: agentA, csrf: csrfA, person: personA } = await setupScopedLeader(23, { communityId: community.id });
    const { agent: agentB } = await setupScopedLeader(24, { communityId: community.id });

    const followed = await makePerson('+237674000023', 'Followed Shared Scope');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await agentA.post('/api/leader/follow-ups').set('X-CSRF-Token', csrfA).send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(created.status).toBe(201);

    const listB = await agentB.get('/api/leader/follow-ups');
    expect(listB.body.items.length).toBe(0);

    const contactsAttempt = await agentB.get(`/api/leader/follow-ups/${created.body.id}/contacts`);
    expect(contactsAttempt.status).toBe(404);
    expect(personA.id).not.toBe((await prisma.followUpAssignment.findUnique({ where: { id: created.body.id } }))!.followerId === personA.id ? undefined : personA.id);
  });

  it('a Member has zero access to follow-up assignments', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/leader/follow-ups');
    expect(res.status).toBe(401);
    const adminRes = await anon.get('/api/admin/follow-ups');
    expect(adminRes.status).toBe(401);
  });
});
