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
  const ip = `10.76.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makePerson(whatsappNumber: string, name = 'Contact Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function setupScopedLeader(n: number, communityId: string) {
  const email = `leader-ct${n}@test.local`;
  const { user } = await createLeader(`Contact Leader ${n}`, email, `CT${n}CODE`);
  const person = await makePerson(`+237677${String(n).padStart(6, '0')}`, `Contact Leader Person ${n}`);
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

describe('Phase 3D — FollowUpContact', () => {
  it('the assigned follower can log a contact', async () => {
    const community = await makeCommunity('CT Community A');
    const { agent, csrf, user } = await setupScopedLeader(1, community.id);
    const followed = await makePerson('+237678000001', 'Followed CT 1');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);

    const res = await agent
      .post(`/api/leader/follow-ups/${created.id}/contacts`)
      .set('X-CSRF-Token', csrf)
      .send({ wellbeingStatus: 'GOOD', note: 'Doing well.' });

    expect(res.status).toBe(201);
    expect(res.body.wellbeingStatus).toBe('GOOD');
    expect(res.body.loggedByUserId).toBe(user.id);
  });

  it('an Admin can log a contact on any active assignment', async () => {
    const community = await makeCommunity('CT Community B');
    const { agent, csrf } = await setupScopedLeader(2, community.id);
    const followed = await makePerson('+237678000002', 'Followed CT 2');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-ct3@test.local');
    const res = await adminAgent
      .post(`/api/admin/follow-ups/${created.id}/contacts`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ wellbeingStatus: 'NEEDS_ATTENTION' });

    expect(res.status).toBe(201);
    expect(res.body.wellbeingStatus).toBe('NEEDS_ATTENTION');
  });

  it('a different Leader cannot log a contact merely by sharing the same scope', async () => {
    const community = await makeCommunity('CT Community C');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(4, community.id);
    const { agent: agentB, csrf: csrfB } = await setupScopedLeader(5, community.id);
    const followed = await makePerson('+237678000003', 'Followed CT 3');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agentA, csrfA, followed.id, community.id);

    const res = await agentB
      .post(`/api/leader/follow-ups/${created.id}/contacts`)
      .set('X-CSRF-Token', csrfB)
      .send({ wellbeingStatus: 'GOOD' });

    expect(res.status).toBe(404);
    const contacts = await prisma.followUpContact.findMany({ where: { followUpAssignmentId: created.id } });
    expect(contacts.length).toBe(0);
  });

  it('a Member/unauthenticated caller cannot log a contact', async () => {
    const community = await makeCommunity('CT Community D');
    const { agent, csrf } = await setupScopedLeader(6, community.id);
    const followed = await makePerson('+237678000004', 'Followed CT 4');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);

    const anon = agentWithUniqueIp();
    const res = await anon.post(`/api/leader/follow-ups/${created.id}/contacts`).send({ wellbeingStatus: 'GOOD' });
    expect(res.status).toBe(401);
  });

  it('loggedByUserId is always server-derived — a client-supplied value has no effect', async () => {
    const community = await makeCommunity('CT Community E');
    const { agent, csrf, user } = await setupScopedLeader(7, community.id);
    const otherUser = await createAdmin('admin-ct8-spoof-target@test.local');
    const followed = await makePerson('+237678000005', 'Followed CT 5');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);

    const res = await agent
      .post(`/api/leader/follow-ups/${created.id}/contacts`)
      .set('X-CSRF-Token', csrf)
      .send({ wellbeingStatus: 'GOOD', loggedByUserId: otherUser.id });

    expect(res.status).toBe(201);
    expect(res.body.loggedByUserId).toBe(user.id);
    expect(res.body.loggedByUserId).not.toBe(otherUser.id);
  });

  it('rejects an invalid wellbeingStatus value', async () => {
    const community = await makeCommunity('CT Community F');
    const { agent, csrf } = await setupScopedLeader(9, community.id);
    const followed = await makePerson('+237678000006', 'Followed CT 6');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);

    const res = await agent
      .post(`/api/leader/follow-ups/${created.id}/contacts`)
      .set('X-CSRF-Token', csrf)
      .send({ wellbeingStatus: 'FANTASTIC' });

    expect(res.status).toBe(400);
  });

  it('rejects logging a contact on a closed assignment', async () => {
    const community = await makeCommunity('CT Community G');
    const { agent, csrf } = await setupScopedLeader(10, community.id);
    const followed = await makePerson('+237678000007', 'Followed CT 7');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);
    await agent.post(`/api/leader/follow-ups/${created.id}/close`).set('X-CSRF-Token', csrf).send({});

    // Ownership already confirms this is the caller's own assignment, so
    // the closed-status rejection here is a 409 (conflict with current
    // state), not a 404 — unlike the Admin path, which has no ownership
    // concept and folds "not found" and "not active" into one 404.
    const res = await agent
      .post(`/api/leader/follow-ups/${created.id}/contacts`)
      .set('X-CSRF-Token', csrf)
      .send({ wellbeingStatus: 'GOOD' });

    expect(res.status).toBe(409);
  });

  it('rejects an Admin logging a contact on a closed assignment', async () => {
    const community = await makeCommunity('CT Community H');
    const { agent, csrf } = await setupScopedLeader(11, community.id);
    const followed = await makePerson('+237678000008', 'Followed CT 8');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);
    await agent.post(`/api/leader/follow-ups/${created.id}/close`).set('X-CSRF-Token', csrf).send({});

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-ct12@test.local');
    const res = await adminAgent
      .post(`/api/admin/follow-ups/${created.id}/contacts`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ wellbeingStatus: 'GOOD' });

    expect(res.status).toBe(404);
  });

  it('the latest logged contact is what determines current wellbeing state (contacts are append-only, most recent first)', async () => {
    const community = await makeCommunity('CT Community I');
    const { agent, csrf } = await setupScopedLeader(13, community.id);
    const followed = await makePerson('+237678000009', 'Followed CT 9');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);

    await agent.post(`/api/leader/follow-ups/${created.id}/contacts`).set('X-CSRF-Token', csrf).send({ wellbeingStatus: 'GOOD' });
    await agent.post(`/api/leader/follow-ups/${created.id}/contacts`).set('X-CSRF-Token', csrf).send({ wellbeingStatus: 'EMERGENCY' });

    const list = await agent.get(`/api/leader/follow-ups/${created.id}/contacts`);
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBe(2);
    // Most recent first — the latest contact (EMERGENCY) is item 0, proving
    // "current state" is always derived from history rather than stored
    // separately on the FollowUpAssignment itself.
    expect(list.body.items[0].wellbeingStatus).toBe('EMERGENCY');
    expect(list.body.items[1].wellbeingStatus).toBe('GOOD');

    const assignment = await prisma.followUpAssignment.findUnique({ where: { id: created.id } });
    expect((assignment as any).wellbeingStatus).toBeUndefined();
    expect((assignment as any).currentWellbeing).toBeUndefined();
  });

  it('accepts an optional nextFollowUpDate and note', async () => {
    const community = await makeCommunity('CT Community J');
    const { agent, csrf } = await setupScopedLeader(14, community.id);
    const followed = await makePerson('+237678000010', 'Followed CT 10');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });
    const created = await makeFollowUp(agent, csrf, followed.id, community.id);

    const nextDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await agent
      .post(`/api/leader/follow-ups/${created.id}/contacts`)
      .set('X-CSRF-Token', csrf)
      .send({ wellbeingStatus: 'UNABLE_TO_REACH', note: 'No answer.', nextFollowUpDate: nextDate });

    expect(res.status).toBe(201);
    expect(res.body.note).toBe('No answer.');
    expect(new Date(res.body.nextFollowUpDate).toISOString()).toBe(nextDate);
  });
});
