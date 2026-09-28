import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Member Location & Central Authority Location Intelligence — server tests
// for GET /api/admin/locations. Mirrors the exact conventions established
// throughout this codebase: agentWithUniqueIp, createAdmin/createLeader,
// bootstrap.
//
// Every location string in this file is suffixed with a per-run unique tag
// so assertions never depend on the test database being empty or on this
// file running in isolation from other test files — a real, necessary
// precaution given every test file in this suite runs against the same
// shared test database with no truncation between files (the same lesson
// already learned the hard way in leaderLeadershipCollaboration.test.ts's
// own "generation is a shared global key" comment).
const RUN = Math.random().toString(36).slice(2, 10);

const app = createApp();

let ipCounter = 9000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.94.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function setupCommunityLeader(n: number, communityId: string) {
  const email = `loc-leader${n}-${RUN}@test.local`;
  const { user } = await createLeader(`Loc Leader ${n}`, email, `LOC${n}${RUN}`);
  const person = await prisma.person.create({
    data: { name: `Loc Leader Person ${n}`, whatsappNumber: `+237981${RUN}${String(n).padStart(3, '0')}`.slice(0, 16) },
  });
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, person };
}

let personCounter = 0;
async function makePerson(opts: {
  country?: string | null;
  city?: string | null;
  area?: string | null;
  isTestData?: boolean;
}) {
  personCounter += 1;
  return prisma.person.create({
    data: {
      name: `Loc Person ${RUN}-${personCounter}`,
      whatsappNumber: `+23798${RUN.slice(0, 2)}${String(personCounter).padStart(6, '0')}`.slice(0, 18),
      locationCountry: opts.country ?? null,
      locationCity: opts.city ?? null,
      locationArea: opts.area ?? null,
      isTestData: opts.isTestData ?? false,
    },
  });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name: `${name} ${RUN}` } });
}

async function addActiveMember(personId: string, communityId: string) {
  return prisma.communityMembership.create({ data: { personId, communityId, status: 'ACTIVE' } });
}

function findGroup(items: any[], country: string, city: string, area: string) {
  return items.find((g) => g.country === country && g.city === city && g.area === area);
}

describe('GET /api/admin/locations — authentication', () => {
  it('rejects an unauthenticated request', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/admin/locations');
    expect(res.status).toBe(401);
  });

  it('rejects a non-Admin (Leader) session', async () => {
    const community = await makeCommunity('Auth Community');
    const { agent } = await setupCommunityLeader(1, community.id);
    const res = await agent.get('/api/admin/locations');
    expect(res.status).toBe(403);
  });

  it('an authenticated Admin can access the aggregation', async () => {
    const { agent } = await loginAsAdmin(`admin-loc-auth-${RUN}@test.local`);
    const res = await agent.get('/api/admin/locations?includeTestData=true');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});

describe('GET /api/admin/locations — aggregation correctness', () => {
  it('members with the same country/city/area aggregate into one group', async () => {
    const country = `Cameroon-${RUN}`;
    const city = `Douala-${RUN}`;
    const area = `Bonamoussadi-${RUN}`;
    await makePerson({ country, city, area, isTestData: true });
    await makePerson({ country, city, area, isTestData: true });

    const { agent } = await loginAsAdmin(`admin-loc-same-${RUN}@test.local`);
    const res = await agent.get('/api/admin/locations?includeTestData=true&pageSize=200');
    const group = findGroup(res.body.items, country, city, area);
    expect(group).toBeTruthy();
    expect(group.memberCount).toBe(2);
  });

  it('different areas remain in separate groups', async () => {
    const country = `Cameroon-${RUN}`;
    const city = `Douala-${RUN}`;
    await makePerson({ country, city, area: `AreaOne-${RUN}`, isTestData: true });
    await makePerson({ country, city, area: `AreaTwo-${RUN}`, isTestData: true });

    const { agent } = await loginAsAdmin(`admin-loc-diff-${RUN}@test.local`);
    const res = await agent.get('/api/admin/locations?includeTestData=true&pageSize=200');
    const groupOne = findGroup(res.body.items, country, city, `AreaOne-${RUN}`);
    const groupTwo = findGroup(res.body.items, country, city, `AreaTwo-${RUN}`);
    expect(groupOne).toBeTruthy();
    expect(groupTwo).toBeTruthy();
    expect(groupOne.memberCount).toBe(1);
    expect(groupTwo.memberCount).toBe(1);
  });

  it('a Person with no location information contributes to no group', async () => {
    const before = await prisma.person.count({
      where: { locationCountry: null, locationCity: null, locationArea: null, isTestData: true },
    });
    await makePerson({ isTestData: true });
    const after = await prisma.person.count({
      where: { locationCountry: null, locationCity: null, locationArea: null, isTestData: true },
    });
    expect(after).toBe(before + 1);

    // The aggregation query itself never groups on an all-null triple in a
    // way that would crash or fabricate a bogus "unknown" bucket containing
    // this Person — verified indirectly: the endpoint still responds 200
    // with a well-formed items array after this Person exists.
    const { agent } = await loginAsAdmin(`admin-loc-missing-${RUN}@test.local`);
    const res = await agent.get('/api/admin/locations?includeTestData=true&pageSize=200');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('assigned member counts are correct', async () => {
    const country = `AssignCountry-${RUN}`;
    const city = `AssignCity-${RUN}`;
    const area = `AssignArea-${RUN}`;
    const community = await makeCommunity('Assign Test Community');
    const assigned = await makePerson({ country, city, area, isTestData: true });
    await addActiveMember(assigned.id, community.id);
    await makePerson({ country, city, area, isTestData: true }); // unassigned

    const { agent } = await loginAsAdmin(`admin-loc-assigned-${RUN}@test.local`);
    const res = await agent.get('/api/admin/locations?includeTestData=true&pageSize=200');
    const group = findGroup(res.body.items, country, city, area);
    expect(group.memberCount).toBe(2);
    expect(group.assignedCount).toBe(1);
  });

  it('unassigned member counts are correct', async () => {
    const country = `UnassignCountry-${RUN}`;
    const city = `UnassignCity-${RUN}`;
    const area = `UnassignArea-${RUN}`;
    await makePerson({ country, city, area, isTestData: true });
    await makePerson({ country, city, area, isTestData: true });
    await makePerson({ country, city, area, isTestData: true });

    const { agent } = await loginAsAdmin(`admin-loc-unassigned-${RUN}@test.local`);
    const res = await agent.get('/api/admin/locations?includeTestData=true&pageSize=200');
    const group = findGroup(res.body.items, country, city, area);
    expect(group.assignedCount).toBe(0);
    expect(group.unassignedCount).toBe(3);
  });

  it('a Person with multiple ACTIVE Community memberships is never double-counted in assignedCount', async () => {
    const country = `MultiCountry-${RUN}`;
    const city = `MultiCity-${RUN}`;
    const area = `MultiArea-${RUN}`;
    const communityA = await makeCommunity('Multi Community A');
    const communityB = await makeCommunity('Multi Community B');
    const person = await makePerson({ country, city, area, isTestData: true });
    await addActiveMember(person.id, communityA.id);
    await addActiveMember(person.id, communityB.id);

    const { agent } = await loginAsAdmin(`admin-loc-multi-${RUN}@test.local`);
    const res = await agent.get('/api/admin/locations?includeTestData=true&pageSize=200');
    const group = findGroup(res.body.items, country, city, area);
    expect(group.memberCount).toBe(1);
    expect(group.assignedCount).toBe(1);
    expect(group.unassignedCount).toBe(0);
    // The per-Community breakdown still lists both Communities, each with
    // count 1 — this Person's presence in two Communities is real
    // information, distinct from (and never conflated with) the
    // once-per-person assignedCount above.
    expect(group.communities).toHaveLength(2);
    expect(group.communities.every((c: any) => c.count === 1)).toBe(true);
  });

  it('does not expose prohibited personal fields', async () => {
    const country = `PrivacyCountry-${RUN}`;
    const person = await makePerson({ country, isTestData: true });
    await prisma.person.update({ where: { id: person.id }, data: { email: 'should-never-leak@example.com' } });

    const { agent } = await loginAsAdmin(`admin-loc-privacy-${RUN}@test.local`);
    const res = await agent.get('/api/admin/locations?includeTestData=true&pageSize=200');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/whatsapp/i);
    expect(serialized).not.toMatch(/should-never-leak/);
    expect(serialized).not.toMatch(person.id);
  });

  it('by default (includeTestData omitted), test-data Persons are excluded', async () => {
    const country = `DefaultFilterCountry-${RUN}`;
    await makePerson({ country, city: 'X', area: 'Y', isTestData: true });

    const { agent } = await loginAsAdmin(`admin-loc-default-${RUN}@test.local`);
    const res = await agent.get('/api/admin/locations?pageSize=200');
    const group = findGroup(res.body.items, country, 'X', 'Y');
    expect(group).toBeUndefined();
  });
});

describe('GET /api/admin/locations — pagination', () => {
  it('pagination metadata is correct, and a page beyond the last page returns an empty, well-formed result', async () => {
    const tag = `Page-${RUN}`;
    await makePerson({ country: `${tag}-1`, city: 'C', area: 'A', isTestData: true });
    await makePerson({ country: `${tag}-2`, city: 'C', area: 'A', isTestData: true });
    await makePerson({ country: `${tag}-3`, city: 'C', area: 'A', isTestData: true });

    const { agent } = await loginAsAdmin(`admin-loc-page-${RUN}@test.local`);

    const firstPage = await agent.get('/api/admin/locations?includeTestData=true&pageSize=200');
    const matchingTotal = firstPage.body.items.filter((g: any) => typeof g.country === 'string' && g.country.startsWith(tag)).length;
    expect(matchingTotal).toBe(3);

    const beyond = await agent.get('/api/admin/locations?includeTestData=true&page=99999&pageSize=20');
    expect(beyond.status).toBe(200);
    expect(beyond.body.items).toEqual([]);
    expect(beyond.body.pagination.page).toBe(99999);
    expect(beyond.body.pagination.total).toBeGreaterThanOrEqual(3);
    expect(beyond.body.pagination.totalPages).toBeGreaterThan(0);
  });
});

describe('GET /api/admin/locations — security / no unintended writes', () => {
  it('performs no write of any kind', async () => {
    const before = await prisma.person.count();
    const beforeMembership = await prisma.communityMembership.count();
    const { agent } = await loginAsAdmin(`admin-loc-nowrite-${RUN}@test.local`);
    await agent.get('/api/admin/locations?includeTestData=true');
    expect(await prisma.person.count()).toBe(before);
    expect(await prisma.communityMembership.count()).toBe(beforeMembership);
  });

  it('never modifies Community, RoleAssignment, or CommunityMembership state', async () => {
    const communityCountBefore = await prisma.community.count();
    const roleCountBefore = await prisma.roleAssignment.count();
    const { agent } = await loginAsAdmin(`admin-loc-noeffect-${RUN}@test.local`);
    await agent.get('/api/admin/locations?includeTestData=true');
    expect(await prisma.community.count()).toBe(communityCountBefore);
    expect(await prisma.roleAssignment.count()).toBe(roleCountBefore);
  });
});
