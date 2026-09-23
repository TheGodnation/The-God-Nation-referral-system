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

async function makePerson(whatsappNumber: string, name = 'Roster Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function makeGeography(name: string, type = 'REGION', countryCode = 'CM') {
  return prisma.geography.create({ data: { name, type, countryCode } });
}

/** Creates a Leader User linked to a Person, with an ACTIVE SCOPED_LEADER
 * RoleAssignment for the given scope, then logs in. Mirrors the pattern
 * already established in followUpAssignment.test.ts / trainingProgressLeader.test.ts. */
async function setupScopedLeader(n: number, scope: { communityId: string } | { geographyId: string }) {
  const email = `leader-roster${n}@test.local`;
  const { user } = await createLeader(`Roster Leader ${n}`, email, `RO${n}CODE`);
  const person = await makePerson(`+237691${String(n).padStart(6, '0')}`, `Roster Leader Person ${n}`);
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

describe('Phase 3H — GET /api/leader/roster — authentication', () => {
  it('rejects an unauthenticated request', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/leader/roster?scopeType=COMMUNITY&scopeId=x');
    expect(res.status).toBe(401);
  });

  it('rejects a non-Leader (Admin) session', async () => {
    const community = await makeCommunity('Roster Community Admin Cross');
    const { agent } = await loginAsAdmin('admin-roster1@test.local');
    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(403);
  });

  it('an unlinked Leader receives the existing unlinked-Leader response', async () => {
    await createLeader('Roster Unlinked Leader', 'leader-roster-unlinked@test.local', 'ROUNLINKED');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'leader-roster-unlinked@test.local', password: 'password123' });

    const community = await makeCommunity('Roster Community Unlinked');
    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not yet linked to a Person/);
  });
});

describe('Phase 3H — GET /api/leader/roster — authorization', () => {
  it('an exact Community-scoped Leader can access that exact Community roster', async () => {
    const community = await makeCommunity('Roster Community A');
    const { agent } = await setupScopedLeader(1, { communityId: community.id });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(200);
    expect(res.body.scopeType).toBe('COMMUNITY');
    expect(res.body.scopeId).toBe(community.id);
  });

  it('an exact Geography-scoped Leader can access that exact Geography roster', async () => {
    const geography = await makeGeography('Roster Geography A');
    const { agent } = await setupScopedLeader(2, { geographyId: geography.id });

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${geography.id}`);
    expect(res.status).toBe(200);
    expect(res.body.scopeType).toBe('GEOGRAPHY');
    expect(res.body.scopeId).toBe(geography.id);
  });

  it('rejects a scopeType that is neither COMMUNITY nor GEOGRAPHY with 400, no silent fallback', async () => {
    const community = await makeCommunity('Roster Community Invalid Type');
    const { agent } = await setupScopedLeader(3, { communityId: community.id });

    const res = await agent.get(`/api/leader/roster?scopeType=BOGUS&scopeId=${community.id}`);
    expect(res.status).toBe(400);
  });

  it('rejects a missing scopeId with 400', async () => {
    const community = await makeCommunity('Roster Community Missing Id');
    const { agent } = await setupScopedLeader(4, { communityId: community.id });
    const res = await agent.get('/api/leader/roster?scopeType=COMMUNITY');
    expect(res.status).toBe(400);
  });

  it('an ENDED RoleAssignment cannot authorize access — 403', async () => {
    const community = await makeCommunity('Roster Community Ended');
    const { agent, person, user } = await setupScopedLeader(5, { communityId: community.id });
    await prisma.roleAssignment.updateMany({
      where: { personId: person.id, communityId: community.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    void user;

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(403);
  });

  it('a Leader requesting a scope with no RoleAssignment at all receives 403', async () => {
    const communityA = await makeCommunity('Roster Community F-A');
    const communityB = await makeCommunity('Roster Community F-B');
    const { agent } = await setupScopedLeader(6, { communityId: communityA.id });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${communityB.id}`);
    expect(res.status).toBe(403);
  });

  it('a Leader cannot access another Leader\'s exact scope', async () => {
    const communityA = await makeCommunity('Roster Community G-A');
    const communityB = await makeCommunity('Roster Community G-B');
    await setupScopedLeader(7, { communityId: communityA.id });
    const { agent: agentB } = await setupScopedLeader(8, { communityId: communityB.id });

    const res = await agentB.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${communityA.id}`);
    expect(res.status).toBe(403);
  });

  it('a parent Community RoleAssignment does not expose the child Community roster', async () => {
    const parent = await makeCommunity('Roster Parent Community');
    const child = await prisma.community.create({ data: { name: 'Roster Child Community', parentId: parent.id } });
    const { agent } = await setupScopedLeader(9, { communityId: parent.id });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${child.id}`);
    expect(res.status).toBe(403);
  });

  it('a child Community RoleAssignment does not expose the parent Community roster', async () => {
    const parent = await makeCommunity('Roster Parent Community 2');
    const child = await prisma.community.create({ data: { name: 'Roster Child Community 2', parentId: parent.id } });
    const { agent } = await setupScopedLeader(10, { communityId: child.id });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${parent.id}`);
    expect(res.status).toBe(403);
  });

  // Phase 3K deliberately supersedes this Phase 3H invariant for Geography
  // specifically — Community, directly above, is untouched and remains
  // exact-scope only. Geographical leadership visibility is intentionally
  // descendant-aware: a Leader assigned to a parent Geography node is now
  // authorized to view a descendant node's roster directly. See
  // leaderRosterGeographyDescendant.test.ts for the full descendant-visibility
  // matrix across every level (Sub-Division/Division/Region/Country).
  it('a parent Geography RoleAssignment DOES expose the child Geography roster (Phase 3K descendant visibility)', async () => {
    const parent = await makeGeography('Roster Parent Geography');
    const child = await prisma.geography.create({ data: { name: 'Roster Child Geography', type: 'DIVISION', countryCode: 'CM', parentId: parent.id } });
    const { agent } = await setupScopedLeader(11, { geographyId: parent.id });

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${child.id}`);
    expect(res.status).toBe(200);
    expect(res.body.scopeId).toBe(child.id);
  });

  it('a child Geography RoleAssignment does not expose the parent Geography roster', async () => {
    const parent = await makeGeography('Roster Parent Geography 2');
    const child = await prisma.geography.create({ data: { name: 'Roster Child Geography 2', type: 'DIVISION', countryCode: 'CM', parentId: parent.id } });
    const { agent } = await setupScopedLeader(12, { geographyId: child.id });

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${parent.id}`);
    expect(res.status).toBe(403);
  });
});

describe('Phase 3H — GET /api/leader/roster — population', () => {
  it('returns active CommunityMembership records and excludes inactive ones', async () => {
    const community = await makeCommunity('Roster Community Population');
    const { agent } = await setupScopedLeader(13, { communityId: community.id });
    const activePerson = await makePerson('+237692000013', 'Active Roster Member');
    const inactivePerson = await makePerson('+237692000113', 'Inactive Roster Member');
    await prisma.communityMembership.create({ data: { personId: activePerson.id, communityId: community.id, status: 'ACTIVE' } });
    await prisma.communityMembership.create({ data: { personId: inactivePerson.id, communityId: community.id, status: 'INACTIVE' } });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(activePerson.id);
    expect(ids).not.toContain(inactivePerson.id);
  });

  it('returns active GeographicAssignment records and excludes inactive ones', async () => {
    const geography = await makeGeography('Roster Geography Population');
    const { agent } = await setupScopedLeader(14, { geographyId: geography.id });
    const activePerson = await makePerson('+237692000014', 'Active Geo Member');
    const inactivePerson = await makePerson('+237692000114', 'Inactive Geo Member');
    await prisma.geographicAssignment.create({ data: { personId: activePerson.id, geographyId: geography.id, status: 'ACTIVE' } });
    await prisma.geographicAssignment.create({ data: { personId: inactivePerson.id, geographyId: geography.id, status: 'INACTIVE' } });

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${geography.id}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(activePerson.id);
    expect(ids).not.toContain(inactivePerson.id);
  });
});

describe('Phase 3H — GET /api/leader/roster — response correctness', () => {
  it('a Community response returns membershipJoinedAt and never geographicAssignedAt', async () => {
    const community = await makeCommunity('Roster Community Fields');
    const { agent } = await setupScopedLeader(15, { communityId: community.id });
    const person = await makePerson('+237692000015', 'Field Check Person');
    await prisma.communityMembership.create({ data: { personId: person.id, communityId: community.id } });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items[0].membershipJoinedAt).toBeTruthy();
    expect(res.body.items[0].geographicAssignedAt).toBeUndefined();
  });

  it('a Geography response returns geographicAssignedAt and never membershipJoinedAt', async () => {
    const geography = await makeGeography('Roster Geography Fields');
    const { agent } = await setupScopedLeader(16, { geographyId: geography.id });
    const person = await makePerson('+237692000016', 'Field Check Geo Person');
    await prisma.geographicAssignment.create({ data: { personId: person.id, geographyId: geography.id } });

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${geography.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items[0].geographicAssignedAt).toBeTruthy();
    expect(res.body.items[0].membershipJoinedAt).toBeUndefined();
  });

  it('returns only the permitted minimum fields — no WhatsApp/email/other Person data', async () => {
    const community = await makeCommunity('Roster Community Minimal');
    const { agent } = await setupScopedLeader(17, { communityId: community.id });
    const person = await makePerson('+237692000017', 'Minimal Field Person');
    await prisma.communityMembership.create({ data: { personId: person.id, communityId: community.id } });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(200);
    const keys = Object.keys(res.body.items[0]).sort();
    expect(keys).toEqual(['membershipJoinedAt', 'name', 'personId'].sort());
    expect(JSON.stringify(res.body)).not.toMatch(/whatsapp/i);
    expect(JSON.stringify(res.body)).not.toMatch(/email/i);
  });

  it('an authorized empty scope returns 200 with empty items and correct pagination metadata', async () => {
    const community = await makeCommunity('Roster Community Empty');
    const { agent } = await setupScopedLeader(18, { communityId: community.id });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.totalPages).toBe(1);
  });
});

describe('Phase 3H — GET /api/leader/roster — pagination', () => {
  it('respects page boundaries and total count, using the existing default page size', async () => {
    const community = await makeCommunity('Roster Community Pagination');
    const { agent } = await setupScopedLeader(19, { communityId: community.id });
    for (let i = 0; i < 25; i++) {
      const p = await makePerson(`+237692001${String(i).padStart(3, '0')}`, `Paged Person ${i}`);
      await prisma.communityMembership.create({ data: { personId: p.id, communityId: community.id } });
    }

    const page1 = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(page1.status).toBe(200);
    expect(page1.body.items.length).toBe(20); // existing default page size
    expect(page1.body.pagination.total).toBe(25);
    expect(page1.body.pagination.totalPages).toBe(2);
    expect(page1.body.pagination.page).toBe(1);
    expect(page1.body.pagination.pageSize).toBe(20);

    const page2 = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}&page=2`);
    expect(page2.body.items.length).toBe(5);
  });

  it('respects a custom pageSize within the existing maximum', async () => {
    const community = await makeCommunity('Roster Community Pagination Custom');
    const { agent } = await setupScopedLeader(20, { communityId: community.id });
    for (let i = 0; i < 5; i++) {
      const p = await makePerson(`+237692002${String(i).padStart(3, '0')}`, `Custom Paged Person ${i}`);
      await prisma.communityMembership.create({ data: { personId: p.id, communityId: community.id } });
    }

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}&pageSize=2`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    expect(res.body.pagination.pageSize).toBe(2);
    expect(res.body.pagination.totalPages).toBe(3);
  });

  it('caps pageSize at the existing maximum (100)', async () => {
    const community = await makeCommunity('Roster Community Pagination Max');
    const { agent } = await setupScopedLeader(21, { communityId: community.id });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}&pageSize=500`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.pageSize).toBe(100);
  });
});

describe('Phase 3H — GET /api/leader/roster — security/data isolation', () => {
  it('no cross-scope leakage: a Leader scoped to Community A never sees Community B members even when querying A', async () => {
    const communityA = await makeCommunity('Roster Isolation A');
    const communityB = await makeCommunity('Roster Isolation B');
    const { agent } = await setupScopedLeader(22, { communityId: communityA.id });
    const personA = await makePerson('+237692000022', 'Isolation Person A');
    const personB = await makePerson('+237692000122', 'Isolation Person B');
    await prisma.communityMembership.create({ data: { personId: personA.id, communityId: communityA.id } });
    await prisma.communityMembership.create({ data: { personId: personB.id, communityId: communityB.id } });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${communityA.id}`);
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(personA.id);
    expect(ids).not.toContain(personB.id);
  });

  it('performs no writes — CommunityMembership/GeographicAssignment rows are unchanged after a roster read', async () => {
    const community = await makeCommunity('Roster No Writes');
    const { agent } = await setupScopedLeader(23, { communityId: community.id });
    const person = await makePerson('+237692000023', 'No Writes Person');
    const membership = await prisma.communityMembership.create({ data: { personId: person.id, communityId: community.id } });

    await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);

    const stillThere = await prisma.communityMembership.findUnique({ where: { id: membership.id } });
    expect(stillThere).toEqual(membership);
  });

  it('existing Leader endpoints remain unaffected', async () => {
    const { agent } = await setupScopedLeader(24, { communityId: (await makeCommunity('Roster Regression Community')).id });
    const dashboard = await agent.get('/api/leader/dashboard');
    expect(dashboard.status).toBe(200);
    const links = await agent.get('/api/leader/links');
    expect(links.status).toBe(200);
    const referrals = await agent.get('/api/leader/referrals');
    expect(referrals.status).toBe(200);
  });
});
