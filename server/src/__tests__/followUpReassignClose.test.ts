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
  const ip = `10.75.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makePerson(whatsappNumber: string, name = 'Reassign Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

/** Same pattern as followUpAssignment.test.ts's setupScopedLeader, reused
 * here with a distinct IP prefix/rate-limit bucket for this file. */
async function setupScopedLeader(n: number, communityId: string) {
  const email = `leader-rc${n}@test.local`;
  const { user } = await createLeader(`Reassign Leader ${n}`, email, `RC${n}CODE`);
  const person = await makePerson(`+237675${String(n).padStart(6, '0')}`, `Reassign Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

async function makeFollowUp(followerAgent: any, followerCsrf: string, followedId: string, communityId: string) {
  const res = await followerAgent
    .post('/api/leader/follow-ups')
    .set('X-CSRF-Token', followerCsrf)
    .send({ followedPersonId: followedId, contextType: 'COMMUNITY', contextId: communityId });
  expect(res.status).toBe(201);
  return res.body;
}

describe('Phase 3D — FollowUpAssignment reassignment', () => {
  it('the current follower can reassign to a new Leader holding the matching active RoleAssignment', async () => {
    const community = await makeCommunity('RC Community A');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(1, community.id);
    const { person: personB } = await setupScopedLeader(2, community.id);
    const followed = await makePerson('+237676000001', 'Followed RC 1');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const created = await makeFollowUp(agentA, csrfA, followed.id, community.id);

    const res = await agentA
      .post(`/api/leader/follow-ups/${created.id}/reassign`)
      .set('X-CSRF-Token', csrfA)
      .send({ newFollowerId: personB.id });

    expect(res.status).toBe(200);
    expect(res.body.followerId).toBe(personB.id);
    expect(res.body.status).toBe('ACTIVE');

    const old = await prisma.followUpAssignment.findUnique({ where: { id: created.id } });
    expect(old!.status).toBe('CLOSED');
  });

  it('an Admin can reassign any active follow-up assignment', async () => {
    const community = await makeCommunity('RC Community B');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(3, community.id);
    const { person: personB } = await setupScopedLeader(4, community.id);
    const followed = await makePerson('+237676000002', 'Followed RC 2');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agentA, csrfA, followed.id, community.id);

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-rc5@test.local');
    const res = await adminAgent
      .post(`/api/admin/follow-ups/${created.id}/reassign`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ newFollowerId: personB.id });

    expect(res.status).toBe(200);
    expect(res.body.followerId).toBe(personB.id);
  });

  it('rejects reassignment to a new follower lacking the matching active RoleAssignment', async () => {
    const community = await makeCommunity('RC Community C');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(6, community.id);
    const unscopedPerson = await makePerson('+237676000003', 'Unscoped Person');
    const followed = await makePerson('+237676000004', 'Followed RC 3');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agentA, csrfA, followed.id, community.id);

    const res = await agentA
      .post(`/api/leader/follow-ups/${created.id}/reassign`)
      .set('X-CSRF-Token', csrfA)
      .send({ newFollowerId: unscopedPerson.id });

    expect(res.status).toBe(400);
    const stillOld = await prisma.followUpAssignment.findUnique({ where: { id: created.id } });
    expect(stillOld!.status).toBe('ACTIVE');
  });

  it('an unrelated Leader (not the current follower) cannot reassign, even sharing the same scope', async () => {
    const community = await makeCommunity('RC Community D');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(7, community.id);
    const { agent: agentB, csrf: csrfB, person: personB } = await setupScopedLeader(8, community.id);
    const { person: personC } = await setupScopedLeader(9, community.id);
    const followed = await makePerson('+237676000005', 'Followed RC 4');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agentA, csrfA, followed.id, community.id);

    const res = await agentB
      .post(`/api/leader/follow-ups/${created.id}/reassign`)
      .set('X-CSRF-Token', csrfB)
      .send({ newFollowerId: personC.id });

    expect(res.status).toBe(404);
    const unchanged = await prisma.followUpAssignment.findUnique({ where: { id: created.id } });
    expect(unchanged!.status).toBe('ACTIVE');
    expect(unchanged!.followerId).not.toBe(personB.id);
  });

  it('reassignment is atomic — a failed attempt leaves the old assignment fully active', async () => {
    const community = await makeCommunity('RC Community E');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(10, community.id);
    const { user: userB, person: personB } = await setupScopedLeader(11, community.id);
    const followed = await makePerson('+237676000006', 'Followed RC 5');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agentA, csrfA, followed.id, community.id);

    // personB already has an active follow-up with the same `followed`
    // Person (created directly, bypassing the self-follow-only Leader
    // route) — reassigning A's assignment to personB must fail on the
    // create half of the transaction (P2002), and the CLOSE half of the
    // same transaction must roll back with it, leaving A's row untouched.
    await prisma.followUpAssignment.create({
      data: {
        followerId: personB.id,
        followedPersonId: followed.id,
        contextType: 'COMMUNITY',
        contextId: community.id,
        assignedByUserId: userB.id,
      },
    });

    const res = await agentA
      .post(`/api/leader/follow-ups/${created.id}/reassign`)
      .set('X-CSRF-Token', csrfA)
      .send({ newFollowerId: personB.id });

    expect(res.status).toBe(409);
    const stillActive = await prisma.followUpAssignment.findUnique({ where: { id: created.id } });
    expect(stillActive!.status).toBe('ACTIVE');
  });

  it('rejects reassignment on an already-closed assignment', async () => {
    const community = await makeCommunity('RC Community F');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(13, community.id);
    const { person: personB } = await setupScopedLeader(14, community.id);
    const followed = await makePerson('+237676000008', 'Followed RC 7');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agentA, csrfA, followed.id, community.id);
    await agentA.post(`/api/leader/follow-ups/${created.id}/close`).set('X-CSRF-Token', csrfA).send({});

    const res = await agentA
      .post(`/api/leader/follow-ups/${created.id}/reassign`)
      .set('X-CSRF-Token', csrfA)
      .send({ newFollowerId: personB.id });

    expect(res.status).toBe(409);
  });
});

describe('Phase 3D — FollowUpAssignment closing', () => {
  it('the assigned follower can close their own assignment', async () => {
    const community = await makeCommunity('RC Close Community A');
    const { agent, csrf } = await setupScopedLeader(15, community.id);
    const followed = await makePerson('+237676000009', 'Followed Close 1');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);

    const res = await agent.post(`/api/leader/follow-ups/${created.id}/close`).set('X-CSRF-Token', csrf).send({ closeReason: 'Done' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CLOSED');
    expect(res.body.closedAt).toBeTruthy();
  });

  it('an Admin can close any active assignment', async () => {
    const community = await makeCommunity('RC Close Community B');
    const { agent, csrf } = await setupScopedLeader(16, community.id);
    const followed = await makePerson('+237676000010', 'Followed Close 2');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-rc17@test.local');
    const res = await adminAgent.post(`/api/admin/follow-ups/${created.id}/close`).set('X-CSRF-Token', adminCsrf).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CLOSED');
  });

  it('an unrelated Leader cannot close another Leader\'s assignment', async () => {
    const community = await makeCommunity('RC Close Community C');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(18, community.id);
    const { agent: agentB, csrf: csrfB } = await setupScopedLeader(19, community.id);
    const followed = await makePerson('+237676000011', 'Followed Close 3');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agentA, csrfA, followed.id, community.id);

    const res = await agentB.post(`/api/leader/follow-ups/${created.id}/close`).set('X-CSRF-Token', csrfB).send({});
    expect(res.status).toBe(404);
    const unchanged = await prisma.followUpAssignment.findUnique({ where: { id: created.id } });
    expect(unchanged!.status).toBe('ACTIVE');
  });

  it('a Member/unauthenticated caller cannot close an assignment', async () => {
    const community = await makeCommunity('RC Close Community D');
    const { agent, csrf } = await setupScopedLeader(20, community.id);
    const followed = await makePerson('+237676000012', 'Followed Close 4');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);

    const anon = agentWithUniqueIp();
    const res = await anon.post(`/api/leader/follow-ups/${created.id}/close`).send({});
    expect(res.status).toBe(401);
  });

  it('rejects closing an already-closed assignment', async () => {
    const community = await makeCommunity('RC Close Community E');
    const { agent, csrf } = await setupScopedLeader(21, community.id);
    const followed = await makePerson('+237676000013', 'Followed Close 5');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);
    await agent.post(`/api/leader/follow-ups/${created.id}/close`).set('X-CSRF-Token', csrf).send({});

    const res = await agent.post(`/api/leader/follow-ups/${created.id}/close`).set('X-CSRF-Token', csrf).send({});
    expect(res.status).toBe(409);
  });

  it('historical FollowUpContact rows remain intact after closing', async () => {
    const community = await makeCommunity('RC Close Community F');
    const { agent, csrf } = await setupScopedLeader(22, community.id);
    const followed = await makePerson('+237676000014', 'Followed Close 6');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);

    await agent
      .post(`/api/leader/follow-ups/${created.id}/contacts`)
      .set('X-CSRF-Token', csrf)
      .send({ wellbeingStatus: 'GOOD' });

    await agent.post(`/api/leader/follow-ups/${created.id}/close`).set('X-CSRF-Token', csrf).send({});

    const contacts = await prisma.followUpContact.findMany({ where: { followUpAssignmentId: created.id } });
    expect(contacts.length).toBe(1);
  });
});
