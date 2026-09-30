import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Central Authority Follow-Up Attention — GET /api/admin/follow-ups/attention.
// A read-only, network-wide view reusing the exact same classification rule
// and priority ordering as GET /api/leader/follow-ups/attention (see
// lib/followUpAttention.ts's computeAttentionAcrossNetwork, which calls the
// same internal `classify` function and `REASON_PRIORITY` map as
// computeAttentionForLeader — no second rules engine). This file focuses on
// what's new here: network-wide scope (every follower, every Community) and
// the extra follower/Community fields an Admin oversight view needs. Fixed
// classification-rule correctness itself (latest-contact-only, precedence,
// OVERDUE date math) is already exhaustively covered by
// followUpAttention.test.ts for the Leader route and is not re-proven here.
const app = createApp();

let ipCounter = 70000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.99.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makePerson(whatsappNumber: string, name = 'Admin Attention Test Person', overrides: Record<string, unknown> = {}) {
  return prisma.person.create({ data: { name, whatsappNumber, ...overrides } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

/** Creates a Leader User linked to a fresh Person with an ACTIVE
 * SCOPED_LEADER RoleAssignment for the given Community, then logs in. */
async function setupScopedLeader(n: number, communityId: string) {
  const email = `leader-adminatt${n}@test.local`;
  const { user } = await createLeader(`Admin Attention Leader ${n}`, email, `AATT${n}CODE`);
  const person = await makePerson(`+237681${String(n).padStart(6, '0')}`, `Admin Attention Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

async function makeFollowUp(followerId: string, followedPersonId: string, assignedByUserId: string, contextId: string) {
  return prisma.followUpAssignment.create({
    data: { followerId, followedPersonId, contextType: 'COMMUNITY', contextId, assignedByUserId },
  });
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

function daysFromNow(n: number) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

describe('Central Authority Follow-Up Attention — authentication and authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/admin/follow-ups/attention');
    expect(res.status).toBe(401);
  });

  it('rejects a non-Admin (Leader) caller', async () => {
    const community = await makeCommunity('AdminAtt Community Auth');
    const { agent } = await setupScopedLeader(1, community.id);
    const res = await agent.get('/api/admin/follow-ups/attention');
    expect(res.status).toBe(403);
  });
});

describe('Central Authority Follow-Up Attention — scope: only ACTIVE assignments, network-wide', () => {
  it('returns ACTIVE assignments across every Leader, not just one', async () => {
    const communityA = await makeCommunity('AdminAtt Community A');
    const communityB = await makeCommunity('AdminAtt Community B');
    const { person: personA, user: userA } = await setupScopedLeader(2, communityA.id);
    const { person: personB, user: userB } = await setupScopedLeader(3, communityB.id);
    const followedA = await makePerson('+237682000001', 'Followed A');
    const followedB = await makePerson('+237682000002', 'Followed B');
    const assignmentA = await makeFollowUp(personA.id, followedA.id, userA.id, communityA.id);
    const assignmentB = await makeFollowUp(personB.id, followedB.id, userB.id, communityB.id);
    // Neither has a contact yet — both are NOT_YET_CONTACTED, eligible.

    const { agent } = await loginAsAdmin('admin-adminatt-network@test.local');
    const res = await agent.get('/api/admin/follow-ups/attention');
    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: any) => i.followUpAssignmentId);
    expect(ids).toEqual(expect.arrayContaining([assignmentA.id, assignmentB.id]));
  });

  it('CLOSED assignments are never returned, even with an emergency contact history', async () => {
    const community = await makeCommunity('AdminAtt Community Closed');
    const { person, user } = await setupScopedLeader(4, community.id);
    const followed = await makePerson('+237682000003', 'Closed Followed');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'EMERGENCY', contactedAt: new Date() });
    await prisma.followUpAssignment.update({ where: { id: assignment.id }, data: { status: 'CLOSED' } });

    const { agent } = await loginAsAdmin('admin-adminatt-closed@test.local');
    const res = await agent.get('/api/admin/follow-ups/attention');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.followUpAssignmentId)).not.toContain(assignment.id);
  });
});

describe('Central Authority Follow-Up Attention — classification correctness', () => {
  it('latest contact EMERGENCY classifies as EMERGENCY', async () => {
    const community = await makeCommunity('AdminAtt Community Emergency');
    const { person, user } = await setupScopedLeader(5, community.id);
    const followed = await makePerson('+237682000004', 'Emergency Followed');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'EMERGENCY', contactedAt: new Date() });

    const { agent } = await loginAsAdmin('admin-adminatt-emerg@test.local');
    const res = await agent.get('/api/admin/follow-ups/attention');
    const item = res.body.items.find((i: any) => i.followUpAssignmentId === assignment.id);
    expect(item.reason).toBe('EMERGENCY');
  });

  it('a GOOD latest contact with no future nextFollowUpDate needs no attention at all', async () => {
    const community = await makeCommunity('AdminAtt Community Good');
    const { person, user } = await setupScopedLeader(6, community.id);
    const followed = await makePerson('+237682000005', 'Good Followed');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: new Date() });

    const { agent } = await loginAsAdmin('admin-adminatt-good@test.local');
    const res = await agent.get('/api/admin/follow-ups/attention');
    expect(res.body.items.map((i: any) => i.followUpAssignmentId)).not.toContain(assignment.id);
  });

  it('a GOOD latest contact with a past nextFollowUpDate classifies as OVERDUE', async () => {
    const community = await makeCommunity('AdminAtt Community Overdue');
    const { person, user } = await setupScopedLeader(7, community.id);
    const followed = await makePerson('+237682000006', 'Overdue Followed');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, {
      wellbeingStatus: 'GOOD',
      contactedAt: daysFromNow(-10),
      nextFollowUpDate: daysFromNow(-1),
    });

    const { agent } = await loginAsAdmin('admin-adminatt-overdue@test.local');
    const res = await agent.get('/api/admin/follow-ups/attention');
    const item = res.body.items.find((i: any) => i.followUpAssignmentId === assignment.id);
    expect(item.reason).toBe('OVERDUE');
  });

  it('an assignment with no contact at all classifies as NOT_YET_CONTACTED', async () => {
    const community = await makeCommunity('AdminAtt Community NoContact');
    const { person, user } = await setupScopedLeader(8, community.id);
    const followed = await makePerson('+237682000007', 'No Contact Followed');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);

    const { agent } = await loginAsAdmin('admin-adminatt-nocontact@test.local');
    const res = await agent.get('/api/admin/follow-ups/attention');
    const item = res.body.items.find((i: any) => i.followUpAssignmentId === assignment.id);
    expect(item.reason).toBe('NOT_YET_CONTACTED');
    expect(item.lastContactedAt).toBeNull();
  });
});

describe('Central Authority Follow-Up Attention — precedence', () => {
  it('sorts EMERGENCY before NEEDS_ATTENTION before UNABLE_TO_REACH before OVERDUE before NOT_YET_CONTACTED', async () => {
    const community = await makeCommunity('AdminAtt Community Precedence');
    const { person, user } = await setupScopedLeader(9, community.id);

    const followedOverdue = await makePerson('+237682000008', 'P Overdue');
    const followedNotYet = await makePerson('+237682000009', 'P NotYet');
    const followedUnable = await makePerson('+237682000010', 'P Unable');
    const followedNeeds = await makePerson('+237682000011', 'P Needs');
    const followedEmergency = await makePerson('+237682000012', 'P Emergency');

    const aOverdue = await makeFollowUp(person.id, followedOverdue.id, user.id, community.id);
    await makeContact(aOverdue.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: daysFromNow(-10), nextFollowUpDate: daysFromNow(-1) });
    const aNotYet = await makeFollowUp(person.id, followedNotYet.id, user.id, community.id);
    const aUnable = await makeFollowUp(person.id, followedUnable.id, user.id, community.id);
    await makeContact(aUnable.id, user.id, { wellbeingStatus: 'UNABLE_TO_REACH', contactedAt: new Date() });
    const aNeeds = await makeFollowUp(person.id, followedNeeds.id, user.id, community.id);
    await makeContact(aNeeds.id, user.id, { wellbeingStatus: 'NEEDS_ATTENTION', contactedAt: new Date() });
    const aEmergency = await makeFollowUp(person.id, followedEmergency.id, user.id, community.id);
    await makeContact(aEmergency.id, user.id, { wellbeingStatus: 'EMERGENCY', contactedAt: new Date() });

    const { agent } = await loginAsAdmin('admin-adminatt-precedence@test.local');
    const res = await agent.get('/api/admin/follow-ups/attention?pageSize=100');
    const ids = [aEmergency.id, aNeeds.id, aUnable.id, aOverdue.id, aNotYet.id];
    const orderedIds = res.body.items.map((i: any) => i.followUpAssignmentId).filter((id: string) => ids.includes(id));
    expect(orderedIds).toEqual(ids);
  });
});

describe('Central Authority Follow-Up Attention — network scope correctness (no cross-item leakage)', () => {
  it('each item carries only its own follower, Community, and follow-up identity — never mixed with another', async () => {
    const communityA = await makeCommunity('AdminAtt Community LeakA');
    const communityB = await makeCommunity('AdminAtt Community LeakB');
    const { person: personA, user: userA } = await setupScopedLeader(10, communityA.id);
    const { person: personB, user: userB } = await setupScopedLeader(11, communityB.id);
    const followedA = await makePerson('+237682000013', 'Leak Followed A');
    const followedB = await makePerson('+237682000014', 'Leak Followed B');
    const assignmentA = await makeFollowUp(personA.id, followedA.id, userA.id, communityA.id);
    await makeContact(assignmentA.id, userA.id, { wellbeingStatus: 'EMERGENCY', contactedAt: new Date() });
    const assignmentB = await makeFollowUp(personB.id, followedB.id, userB.id, communityB.id);
    await makeContact(assignmentB.id, userB.id, { wellbeingStatus: 'NEEDS_ATTENTION', contactedAt: new Date() });

    const { agent } = await loginAsAdmin('admin-adminatt-leak@test.local');
    const res = await agent.get('/api/admin/follow-ups/attention');

    const itemA = res.body.items.find((i: any) => i.followUpAssignmentId === assignmentA.id);
    const itemB = res.body.items.find((i: any) => i.followUpAssignmentId === assignmentB.id);
    expect(itemA.followerPersonId).toBe(personA.id);
    expect(itemA.followerName).toBe(personA.name);
    expect(itemA.communityId).toBe(communityA.id);
    expect(itemA.communityName).toBe(communityA.name);
    expect(itemA.personId).toBe(followedA.id);
    expect(itemA.name).toBe(followedA.name);

    expect(itemB.followerPersonId).toBe(personB.id);
    expect(itemB.followerName).toBe(personB.name);
    expect(itemB.communityId).toBe(communityB.id);
    expect(itemB.communityName).toBe(communityB.name);
    expect(itemB.personId).toBe(followedB.id);
    expect(itemB.name).toBe(followedB.name);
  });
});

describe('Central Authority Follow-Up Attention — data minimization', () => {
  it('prohibited fields are absent from every item: no WhatsApp number, email, note, or full contact history', async () => {
    const community = await makeCommunity('AdminAtt Community Prohibited');
    const { person, user } = await setupScopedLeader(12, community.id);
    const followed = await makePerson('+237682000015', 'Prohibited Followed');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'EMERGENCY', contactedAt: new Date(), nextFollowUpDate: daysFromNow(3) });
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: daysFromNow(-5) });

    const { agent } = await loginAsAdmin('admin-adminatt-prohibited@test.local');
    const res = await agent.get('/api/admin/follow-ups/attention');
    const item = res.body.items.find((i: any) => i.followUpAssignmentId === assignment.id);

    expect(item).not.toHaveProperty('whatsappNumber');
    expect(item).not.toHaveProperty('email');
    expect(item).not.toHaveProperty('note');
    expect(item).not.toHaveProperty('contacts');
    expect(item).not.toHaveProperty('locationCountry');
    expect(item).not.toHaveProperty('locationCity');
    expect(item).not.toHaveProperty('locationArea');
    expect(Object.keys(item).sort()).toEqual(
      [
        'followUpAssignmentId',
        'followerPersonId',
        'followerName',
        'personId',
        'name',
        'communityId',
        'communityName',
        'reason',
        'lastContactedAt',
        'nextFollowUpDate',
      ].sort(),
    );
  });
});

describe('Central Authority Follow-Up Attention — pagination', () => {
  it('paginates the actual attention result set, not the total ACTIVE assignment count', async () => {
    const community = await makeCommunity('AdminAtt Community Pagination');
    const { person, user } = await setupScopedLeader(13, community.id);

    for (let i = 0; i < 3; i++) {
      const followed = await makePerson(`+23768210${String(i).padStart(4, '0')}`, `Pagination Needs ${i}`);
      const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
      await makeContact(assignment.id, user.id, { wellbeingStatus: 'NEEDS_ATTENTION', contactedAt: new Date() });
    }
    // A GOOD, non-overdue assignment — ACTIVE but needs no attention, so it
    // must never count toward the attention pagination total.
    const goodFollowed = await makePerson('+237682109999', 'Pagination Good');
    const goodAssignment = await makeFollowUp(person.id, goodFollowed.id, user.id, community.id);
    await makeContact(goodAssignment.id, user.id, { wellbeingStatus: 'GOOD', contactedAt: new Date() });

    const { agent } = await loginAsAdmin('admin-adminatt-pagination@test.local');
    const page1 = await agent.get('/api/admin/follow-ups/attention?page=1&pageSize=2');
    expect(page1.status).toBe(200);
    expect(page1.body.items.length).toBe(2);
    expect(page1.body.pagination.total).toBeGreaterThanOrEqual(3);
    expect(page1.body.items.map((i: any) => i.followUpAssignmentId)).not.toContain(goodAssignment.id);

    const page2 = await agent.get('/api/admin/follow-ups/attention?page=2&pageSize=2');
    expect(page2.body.items.length).toBeGreaterThanOrEqual(1);
    const page1Ids = page1.body.items.map((i: any) => i.followUpAssignmentId);
    const page2Ids = page2.body.items.map((i: any) => i.followUpAssignmentId);
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
  });
});

describe('Central Authority Follow-Up Attention — empty result', () => {
  it('returns an empty items array and zero total when nothing needs attention', async () => {
    const { agent } = await loginAsAdmin('admin-adminatt-empty@test.local');
    const res = await agent.get('/api/admin/follow-ups/attention');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });
});

describe('Central Authority Follow-Up Attention — read-only', () => {
  it('never writes to FollowUpAssignment, FollowUpContact, or any other table', async () => {
    const community = await makeCommunity('AdminAtt Community ReadOnly');
    const { person, user } = await setupScopedLeader(14, community.id);
    const followed = await makePerson('+237682000016', 'ReadOnly Followed');
    const assignment = await makeFollowUp(person.id, followed.id, user.id, community.id);
    await makeContact(assignment.id, user.id, { wellbeingStatus: 'EMERGENCY', contactedAt: new Date() });

    const beforeAssignments = await prisma.followUpAssignment.count();
    const beforeContacts = await prisma.followUpContact.count();
    const beforeAudit = await prisma.auditLog.count();

    const { agent } = await loginAsAdmin('admin-adminatt-readonly@test.local');
    await agent.get('/api/admin/follow-ups/attention');
    await agent.get('/api/admin/follow-ups/attention');

    expect(await prisma.followUpAssignment.count()).toBe(beforeAssignments);
    expect(await prisma.followUpContact.count()).toBe(beforeContacts);
    expect(await prisma.auditLog.count()).toBe(beforeAudit);

    // The underlying assignment/contact data is exactly as it was before —
    // not merely unchanged in count, but unchanged in content.
    const unchanged = await prisma.followUpAssignment.findUnique({ where: { id: assignment.id } });
    expect(unchanged?.status).toBe('ACTIVE');
    expect(unchanged?.followerId).toBe(person.id);
  });
});
