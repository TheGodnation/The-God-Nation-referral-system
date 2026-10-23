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
  const ip = `10.83.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makePerson(whatsappNumber: string, name = 'Attention Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

/** Creates a Leader User linked to a fresh Person with an ACTIVE
 * SCOPED_LEADER RoleAssignment for the given Community, then logs in. */
async function setupScopedLeader(n: number, communityId: string) {
  const email = `leader-att${n}@test.local`;
  const { user } = await createLeader(`Attention Leader ${n}`, email, `ATT${n}CODE`);
  const person = await makePerson(`+237679${String(n).padStart(6, '0')}`, `Attention Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

/** A Leader User with no linked Person — hits requireLinkedPerson's 403. */
async function setupUnlinkedLeader(n: number) {
  const email = `leader-att-unlinked${n}@test.local`;
  await createLeader(`Unlinked Attention Leader ${n}`, email, `ATTU${n}CODE`);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent };
}

async function makeFollowUp(followerId: string, followedPersonId: string, assignedByUserId: string, contextId: string) {
  return prisma.followUpAssignment.create({
    data: { followerId, followedPersonId, contextType: 'COMMUNITY', contextId, assignedByUserId },
  });
}

function daysFromNow(n: number) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

async function makeContact(
  followUpAssignmentId: string,
  loggedByUserId: string,
  opts: { wellbeingStatus: 'GOOD' | 'NEEDS_ATTENTION' | 'EMERGENCY' | 'UNABLE_TO_REACH'; contactedAt: Date; nextFollowUpDate?: Date | null },
) {
  return prisma.followUpContact.create({
    data: {
      followUpAssignmentId,
      loggedByUserId,
      wellbeingStatus: opts.wellbeingStatus,
      contactedAt: opts.contactedAt,
      nextFollowUpDate: opts.nextFollowUpDate ?? null,
    },
  });
}

describe('Phase 3I — GET /api/leader/follow-ups/attention — authentication', () => {
  it('rejects an unauthenticated caller', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/leader/follow-ups/attention');
    expect(res.status).toBe(401);
  });

  it('rejects a non-Leader (Admin) caller', async () => {
    const { agent } = await loginAsAdmin('admin-att1@test.local');
    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.status).toBe(403);
  });

  it('a Leader whose User has no linked Person receives the existing unlinked-Leader response', async () => {
    const { agent } = await setupUnlinkedLeader(1);
    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not yet linked to a Person/);
  });
});

describe('Phase 3I — GET /api/leader/follow-ups/attention — ownership isolation', () => {
  it('a Leader sees only ACTIVE assignments where they are the follower', async () => {
    const community = await makeCommunity('ATT Community A');
    const { agent, person, user } = await setupScopedLeader(2, community.id);
    const followed = await makePerson('+237680000002', 'Followed A');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    // No contacts at all — NOT_YET_CONTACTED, eligible for the response.

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.followUpAssignmentId)).toEqual([assignment.id]);
  });

  it('another Leader\'s assignments are never returned', async () => {
    const community = await makeCommunity('ATT Community B');
    const { person: personA, user: userA } = await setupScopedLeader(3, community.id);
    const { agent: agentB } = await setupScopedLeader(4, community.id);
    const followed = await makePerson('+237680000003', 'Followed B');
    await makeFollowUp(personA.id, followed.id, userA.id, community.id);

    const res = await agentB.get('/api/leader/follow-ups/attention');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(0);
  });

  it('CLOSED assignments are never returned, even with an emergency contact history', async () => {
    const community = await makeCommunity('ATT Community C');
    const { agent, person, user } = await setupScopedLeader(5, community.id);
    const followed = await makePerson('+237680000004', 'Followed C');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'EMERGENCY', contactedAt: new Date() });
    await prisma.followUpAssignment.update({ where: { id: assignment.id }, data: { status: 'CLOSED' } });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(0);
  });
});

describe('Phase 3I — GET /api/leader/follow-ups/attention — attention classification', () => {
  it('latest contact EMERGENCY classifies as EMERGENCY', async () => {
    const community = await makeCommunity('ATT Community D');
    const { agent, person, user } = await setupScopedLeader(6, community.id);
    const followed = await makePerson('+237680000005', 'Followed D');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'EMERGENCY', contactedAt: new Date() });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items[0].reason).toBe('EMERGENCY');
  });

  it('latest contact NEEDS_ATTENTION classifies as NEEDS_ATTENTION', async () => {
    const community = await makeCommunity('ATT Community E');
    const { agent, person, user } = await setupScopedLeader(7, community.id);
    const followed = await makePerson('+237680000006', 'Followed E');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'NEEDS_ATTENTION', contactedAt: new Date() });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items[0].reason).toBe('NEEDS_ATTENTION');
  });

  it('latest contact UNABLE_TO_REACH classifies as UNABLE_TO_REACH', async () => {
    const community = await makeCommunity('ATT Community F');
    const { agent, person, user } = await setupScopedLeader(8, community.id);
    const followed = await makePerson('+237680000007', 'Followed F');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'UNABLE_TO_REACH', contactedAt: new Date() });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items[0].reason).toBe('UNABLE_TO_REACH');
  });

  it('latest contact GOOD with a future nextFollowUpDate is not returned', async () => {
    const community = await makeCommunity('ATT Community G');
    const { agent, person, user } = await setupScopedLeader(9, community.id);
    const followed = await makePerson('+237680000008', 'Followed G');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: new Date(), nextFollowUpDate: daysFromNow(7) });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items.length).toBe(0);
  });

  it('latest contact GOOD with a passed nextFollowUpDate and no newer contact classifies as OVERDUE', async () => {
    const community = await makeCommunity('ATT Community H');
    const { agent, person, user } = await setupScopedLeader(10, community.id);
    const followed = await makePerson('+237680000009', 'Followed H');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: daysFromNow(-10), nextFollowUpDate: daysFromNow(-3) });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items[0].reason).toBe('OVERDUE');
  });

  it('a newer contact after the previous scheduled date prevents the old contact from being classified as OVERDUE', async () => {
    const community = await makeCommunity('ATT Community I');
    const { agent, person, user } = await setupScopedLeader(11, community.id);
    const followed = await makePerson('+237680000010', 'Followed I');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: daysFromNow(-10), nextFollowUpDate: daysFromNow(-5) });
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: daysFromNow(-1), nextFollowUpDate: daysFromNow(7) });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items.length).toBe(0);
  });

  it('an ACTIVE assignment with no contact history classifies as NOT_YET_CONTACTED', async () => {
    const community = await makeCommunity('ATT Community J');
    const { agent, person, user } = await setupScopedLeader(12, community.id);
    const followed = await makePerson('+237680000011', 'Followed J');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items.length).toBe(1);
    expect(res.body.items[0].followUpAssignmentId).toBe(assignment.id);
    expect(res.body.items[0].reason).toBe('NOT_YET_CONTACTED');
  });

  it('a CLOSED assignment with emergency/overdue history is not returned', async () => {
    const community = await makeCommunity('ATT Community K');
    const { agent, person, user } = await setupScopedLeader(13, community.id);
    const followed = await makePerson('+237680000012', 'Followed K');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: daysFromNow(-10), nextFollowUpDate: daysFromNow(-3) });
    await prisma.followUpAssignment.update({ where: { id: assignment.id }, data: { status: 'CLOSED' } });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items.length).toBe(0);
  });
});

describe('Phase 3I — GET /api/leader/follow-ups/attention — precedence', () => {
  it('EMERGENCY + an overdue nextFollowUpDate on the same contact returns EMERGENCY', async () => {
    const community = await makeCommunity('ATT Community L');
    const { agent, person, user } = await setupScopedLeader(14, community.id);
    const followed = await makePerson('+237680000013', 'Followed L');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'EMERGENCY', contactedAt: new Date(), nextFollowUpDate: daysFromNow(-3) });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items[0].reason).toBe('EMERGENCY');
  });

  it('NEEDS_ATTENTION + an overdue nextFollowUpDate on the same contact returns NEEDS_ATTENTION', async () => {
    const community = await makeCommunity('ATT Community M');
    const { agent, person, user } = await setupScopedLeader(15, community.id);
    const followed = await makePerson('+237680000014', 'Followed M');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'NEEDS_ATTENTION', contactedAt: new Date(), nextFollowUpDate: daysFromNow(-3) });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items[0].reason).toBe('NEEDS_ATTENTION');
  });

  it('UNABLE_TO_REACH + an overdue nextFollowUpDate on the same contact returns UNABLE_TO_REACH', async () => {
    const community = await makeCommunity('ATT Community N');
    const { agent, person, user } = await setupScopedLeader(16, community.id);
    const followed = await makePerson('+237680000015', 'Followed N');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'UNABLE_TO_REACH', contactedAt: new Date(), nextFollowUpDate: daysFromNow(-3) });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items[0].reason).toBe('UNABLE_TO_REACH');
  });
});

describe('Phase 3I — GET /api/leader/follow-ups/attention — latest-contact behavior', () => {
  it('an older EMERGENCY contact followed by a newer GOOD (no schedule) contact is not returned', async () => {
    const community = await makeCommunity('ATT Community O');
    const { agent, person, user } = await setupScopedLeader(17, community.id);
    const followed = await makePerson('+237680000016', 'Followed O');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'EMERGENCY', contactedAt: daysFromNow(-5) });
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: new Date() });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items.length).toBe(0);
  });

  it('an older overdue contact followed by a newer contact never uses the old nextFollowUpDate', async () => {
    const community = await makeCommunity('ATT Community P');
    const { agent, person, user } = await setupScopedLeader(18, community.id);
    const followed = await makePerson('+237680000017', 'Followed P');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: daysFromNow(-20), nextFollowUpDate: daysFromNow(-15) });
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: daysFromNow(-1), nextFollowUpDate: null });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items.length).toBe(0);
  });
});

describe('Phase 3I — GET /api/leader/follow-ups/attention — response correctness', () => {
  it('returns the correct personId, name, lastContactedAt, and nextFollowUpDate', async () => {
    const community = await makeCommunity('ATT Community Q');
    const { agent, person, user } = await setupScopedLeader(19, community.id);
    const followed = await makePerson('+237680000018', 'Followed Q Exact Name');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    const contactedAt = daysFromNow(-1);
    const nextDate = daysFromNow(-3);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'NEEDS_ATTENTION', contactedAt, nextFollowUpDate: nextDate });

    const res = await agent.get('/api/leader/follow-ups/attention');
    const item = res.body.items[0];
    expect(item.personId).toBe(followed.id);
    expect(item.name).toBe('Followed Q Exact Name');
    expect(new Date(item.lastContactedAt).getTime()).toBe(contactedAt.getTime());
    expect(new Date(item.nextFollowUpDate).getTime()).toBe(nextDate.getTime());
  });

  it('NOT_YET_CONTACTED items have null lastContactedAt and null nextFollowUpDate', async () => {
    const community = await makeCommunity('ATT Community R');
    const { agent, person, user } = await setupScopedLeader(20, community.id);
    const followed = await makePerson('+237680000019', 'Followed R');
    await makeFollowUp(person.id, followed.id, user.id, community.id);

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.body.items[0].lastContactedAt).toBeNull();
    expect(res.body.items[0].nextFollowUpDate).toBeNull();
  });

  it('returns no prohibited sensitive fields', async () => {
    const community = await makeCommunity('ATT Community S');
    const { agent, person, user } = await setupScopedLeader(21, community.id);
    const followed = await makePerson('+237680000020', 'Followed S');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'EMERGENCY', contactedAt: new Date(), nextFollowUpDate: null });

    const res = await agent.get('/api/leader/follow-ups/attention');
    const keys = Object.keys(res.body.items[0]).sort();
    expect(keys).toEqual(['followUpAssignmentId', 'lastContactedAt', 'name', 'nextFollowUpDate', 'personId', 'reason'].sort());
    const serialized = JSON.stringify(res.body.items[0]).toLowerCase();
    expect(serialized).not.toContain('whatsapp');
    expect(serialized).not.toContain('email');
    expect(serialized).not.toContain('note');
  });

  it('paginates the attention result set correctly', async () => {
    const community = await makeCommunity('ATT Community T');
    const { agent, person, user } = await setupScopedLeader(22, community.id);
    for (let i = 0; i < 5; i += 1) {
      const followed = await makePerson(`+23768002${String(i).padStart(4, '0')}`, `Followed T${i}`);
      await makeFollowUp(person.id, followed.id, user.id, community.id);
    }

    const page1 = await agent.get('/api/leader/follow-ups/attention?page=1&pageSize=2');
    expect(page1.body.items.length).toBe(2);
    expect(page1.body.pagination).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });

    const page3 = await agent.get('/api/leader/follow-ups/attention?page=3&pageSize=2');
    expect(page3.body.items.length).toBe(1);
    expect(page3.body.pagination.total).toBe(5);
  });

  it('returns 200 with an empty items array when nothing needs attention', async () => {
    const community = await makeCommunity('ATT Community U');
    const { agent, person, user } = await setupScopedLeader(23, community.id);
    const followed = await makePerson('+237680000030', 'Followed U');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: new Date() });

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });
});

describe('Phase 3I — GET /api/leader/follow-ups/attention — security/data integrity', () => {
  it('a client-supplied Person/follower id in the query string has no effect on the result', async () => {
    const community = await makeCommunity('ATT Community V');
    const { agent, person, user } = await setupScopedLeader(24, community.id);
    const other = await setupScopedLeader(25, community.id);
    const followed = await makePerson('+237680000031', 'Followed V');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);

    const res = await agent.get(`/api/leader/follow-ups/attention?followerId=${other.person.id}&personId=${other.person.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.followUpAssignmentId)).toEqual([assignment.id]);
  });

  it('performs no writes — assignment and contact counts are unchanged before and after', async () => {
    const community = await makeCommunity('ATT Community W');
    const { agent, person, user } = await setupScopedLeader(26, community.id);
    const followed = await makePerson('+237680000032', 'Followed W');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'EMERGENCY', contactedAt: new Date() });

    const beforeAssignments = await prisma.followUpAssignment.count();
    const beforeContacts = await prisma.followUpContact.count();

    const res = await agent.get('/api/leader/follow-ups/attention');
    expect(res.status).toBe(200);

    const afterAssignments = await prisma.followUpAssignment.count();
    const afterContacts = await prisma.followUpContact.count();
    expect(afterAssignments).toBe(beforeAssignments);
    expect(afterContacts).toBe(beforeContacts);
  });
});
