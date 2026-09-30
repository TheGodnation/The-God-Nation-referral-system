import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Geography Retirement Step 5A — retires the Follow-Up system's organizational
// dependency on Geography. FollowUpContextType no longer has a GEOGRAPHY
// value at all (see the 20260930094423_retire_followup_geography_context
// migration): Follow-Up is now Community-scoped only. This file tests the
// rejection behavior and security properties that change as a direct result;
// existing Community-context Follow-Up behavior (creation, contacts,
// reassignment, closure, ownership isolation) is already exhaustively
// covered by followUpAssignment.test.ts, followUpContacts.test.ts,
// followUpReassignClose.test.ts, and followUpAttention.test.ts — all four
// already exclusively use Community context and are unaffected by this step.
//
// Geography Retirement Step 5B (a later step) went on to remove
// GeographicAssignment and RoleAssignment.geographyId entirely — a
// Geography-scoped RoleAssignment can no longer be created at all. The
// handful of tests below that originally set one up (to prove it still
// couldn't authorize a Follow-Up) were updated then to use only Community
// roles and plain Geography rows instead; the security property they prove
// is unchanged and, if anything, now holds even more strongly.
const app = createApp();

let ipCounter = 40000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.96.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makePerson(whatsappNumber: string, name = 'Geo Retirement Test Person', overrides: Record<string, unknown> = {}) {
  return prisma.person.create({ data: { name, whatsappNumber, ...overrides } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function makeGeography(name: string, type = 'REGION', countryCode = 'CM') {
  return prisma.geography.create({ data: { name, type, countryCode } });
}

/** Creates a Leader User linked to a fresh Person with an ACTIVE
 * SCOPED_LEADER RoleAssignment for the given exact Community, then logs in. */
async function setupScopedLeader(n: number, scope: { communityId: string }) {
  const email = `leader-georetire${n}@test.local`;
  const { user } = await createLeader(`Geo Retirement Leader ${n}`, email, `GR${n}CODE`);
  const person = await makePerson(`+237675${String(n).padStart(6, '0')}`, `Geo Retirement Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: {
      personId: person.id,
      roleType: 'SCOPED_LEADER',
      assignedByUserId: user.id,
      communityId: scope.communityId,
    },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

describe('Geography Retirement Step 5A — context validation', () => {
  it('1. COMMUNITY Follow-Up creation still succeeds when authorized', async () => {
    const community = await makeCommunity('GR Community A');
    const { agent, csrf, person: leaderPerson } = await setupScopedLeader(1, { communityId: community.id });
    const followed = await makePerson('+237676000001', 'Followed 1');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });

    expect(res.status).toBe(201);
    expect(res.body.followerId).toBe(leaderPerson.id);
  });

  it('2. GEOGRAPHY Follow-Up creation is rejected outright — the enum no longer has that value, regardless of the acting Leader\'s own role', async () => {
    const community = await makeCommunity('GR Community A');
    const geography = await makeGeography('GR Geography A');
    const { agent, csrf } = await setupScopedLeader(2, { communityId: community.id });
    const followed = await makePerson('+237676000002', 'Followed 2');

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'GEOGRAPHY', contextId: geography.id });

    expect(res.status).toBe(400);
  });

  it('3. GEOGRAPHY scoped-people request is rejected', async () => {
    const community = await makeCommunity('GR Community A2');
    const geography = await makeGeography('GR Geography B');
    const { agent } = await setupScopedLeader(3, { communityId: community.id });

    const res = await agent.get(`/api/leader/scoped-people?contextType=GEOGRAPHY&contextId=${geography.id}`);
    expect(res.status).toBe(400);
  });

  it('4. Follow-Up reassignment is rejected for a Person with no matching Community role (the same path a Geography-scoped Leader would once have failed on)', async () => {
    const community = await makeCommunity('GR Community B');
    const { agent: communityAgent, csrf: communityCsrf } = await setupScopedLeader(4, { communityId: community.id });
    const unrelatedPerson = await makePerson('+237676000005', 'Unrelated Person 5');
    const followed = await makePerson('+237676000004', 'Followed 4');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const created = await communityAgent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', communityCsrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(created.status).toBe(201);

    // unrelatedPerson holds no RoleAssignment at all —
    // findActiveScopedRole(unrelatedPerson.id, 'COMMUNITY', community.id)
    // fails, exactly as it would for any Person with no matching role.
    const reassign = await communityAgent
      .post(`/api/leader/follow-ups/${created.body.id}/reassign`)
      .set('X-CSRF-Token', communityCsrf)
      .send({ newFollowerId: unrelatedPerson.id });
    expect(reassign.status).toBe(400);
  });

  it('5. No Geography Follow-Up can be created through the Admin API either', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-georetire1@test.local');
    const geography = await makeGeography('GR Geography D');
    const follower = await makePerson('+237676000005', 'Admin Follower 5');
    const followed = await makePerson('+237676000006', 'Admin Followed 5');

    const res = await agent
      .post('/api/admin/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followerId: follower.id, followedPersonId: followed.id, contextType: 'GEOGRAPHY', contextId: geography.id });

    expect(res.status).toBe(400);
  });
});

describe('Geography Retirement Step 5A — authorization', () => {
  it('6. Community Leader authorization remains unchanged', async () => {
    const community = await makeCommunity('GR Community C');
    const { agent, csrf } = await setupScopedLeader(6, { communityId: community.id });
    const followed = await makePerson('+237676000007', 'Followed 7');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(res.status).toBe(201);
  });

  it('7. A Leader cannot use a Geography id in place of a Community id to obtain Follow-Up access', async () => {
    const geography = await makeGeography('GR Geography E');
    const ownCommunity = await makeCommunity('GR Community H');
    const { agent, csrf } = await setupScopedLeader(7, { communityId: ownCommunity.id });
    const followed = await makePerson('+237676000008', 'Followed 8');

    // Submitting the Geography id as a COMMUNITY-context id: no matching
    // Community-scoped RoleAssignment exists for it, so this fails exactly
    // like any other unrecognized Community id would.
    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: geography.id });
    expect(res.status).toBe(403);
  });

  it('8. A Leader cannot submit city/country/area values to obtain Follow-Up access', async () => {
    const community = await makeCommunity('GR Community D');
    const { agent, csrf } = await setupScopedLeader(8, { communityId: community.id });
    const followed = await makePerson('+237676000009', 'Followed 9', { locationCountry: 'Cameroon', locationCity: 'Douala', locationArea: 'Bonapriso' });

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: 'Bonapriso' });
    expect(res.status).toBe(403);
  });

  it('9. Cross-Community Follow-Up access remains blocked', async () => {
    const communityA = await makeCommunity('GR Community E-A');
    const communityB = await makeCommunity('GR Community E-B');
    const { agent } = await setupScopedLeader(9, { communityId: communityA.id });
    const followed = await makePerson('+237676000010', 'Followed 10');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: communityB.id } });

    const res = await agent.get(`/api/leader/scoped-people?contextType=COMMUNITY&contextId=${communityB.id}`);
    expect(res.status).toBe(403);
  });
});

describe('Geography Retirement Step 5A — data integrity', () => {
  it('10-11. Existing Community FollowUpAssignments and their FollowUpContacts remain fully intact after the migration', async () => {
    const community = await makeCommunity('GR Community F');
    const { agent, csrf } = await setupScopedLeader(10, { communityId: community.id });
    const followed = await makePerson('+237676000011', 'Followed 11');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const created = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(created.status).toBe(201);
    expect(created.body.contextType).toBe('COMMUNITY');

    const contact = await agent
      .post(`/api/leader/follow-ups/${created.body.id}/contacts`)
      .set('X-CSRF-Token', csrf)
      .send({ wellbeingStatus: 'GOOD' });
    expect(contact.status).toBe(201);

    const stored = await prisma.followUpAssignment.findUnique({ where: { id: created.body.id }, include: { contacts: true } });
    expect(stored?.contextType).toBe('COMMUNITY');
    expect(stored?.contacts.length).toBe(1);
  });

  it('12. No Geography-context FollowUpAssignment can exist at the database level — the enum no longer has a GEOGRAPHY value', async () => {
    const follower = await makePerson('+237676000013', 'Direct Follower 13');
    const followedPerson = await makePerson('+237676000014', 'Direct Followed 13');
    const admin = await createAdmin('admin-georetire-dbcheck@test.local');

    // Bypasses the Zod/route layer entirely (contextType: 'GEOGRAPHY' as any)
    // to prove the rejection is enforced by the database column type itself,
    // not only by application validation.
    await expect(
      prisma.followUpAssignment.create({
        data: {
          followerId: follower.id,
          followedPersonId: followedPerson.id,
          contextType: 'GEOGRAPHY' as any,
          contextId: 'anything',
          assignedByUserId: admin.id,
        },
      }),
    ).rejects.toThrow();
  });
});

describe('Geography Retirement Step 5A — attention', () => {
  it('13-14. Community Follow-Up Attention continues to work and classification is unchanged', async () => {
    const community = await makeCommunity('GR Community G');
    const { agent, csrf } = await setupScopedLeader(11, { communityId: community.id });
    const followed = await makePerson('+237676000012', 'Followed 12');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const created = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(created.status).toBe(201);

    const attention = await agent.get('/api/leader/follow-ups/attention');
    expect(attention.status).toBe(200);
    // Never contacted yet — classified NOT_YET_CONTACTED, same fixed rule as
    // before this step (followUpAttention.ts has no Geography branch at all).
    const row = attention.body.items.find((i: any) => i.followUpAssignmentId === created.body.id);
    expect(row?.reason).toBe('NOT_YET_CONTACTED');
  });
});

describe('Geography Retirement Step 5A — diagnostic', () => {
  it('30. The Geography diagnostic endpoint continues to work and reflects the retired Follow-Up Geography capability', async () => {
    const { agent } = await loginAsAdmin('admin-georetire-diag@test.local');
    const res = await agent.get('/api/admin/diagnostics/geography-dependencies');
    expect(res.status).toBe(200);
    expect(res.body.followUpAssignments).toEqual({
      geographyContextRetired: true,
      note: expect.stringContaining('Step 5A'),
    });
    // The Geography section is retained (the model itself is untouched by
    // this step). geographicAssignments/roleAssignments remained real counts
    // as of Step 5A — Step 5B later replaced them with retirement notices,
    // but both keys are still present either way.
    expect(res.body.geography).toBeDefined();
    expect(res.body.geographicAssignments).toBeDefined();
    expect(res.body.roleAssignments).toBeDefined();
    expect(res.body.locationData).toBeDefined();
    expect(res.body.knownGeographyForeignKeys).not.toEqual(
      expect.arrayContaining([expect.stringContaining('FollowUpAssignment')]),
    );
  });
});
