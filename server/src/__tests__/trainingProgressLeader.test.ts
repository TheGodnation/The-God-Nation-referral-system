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
  const ip = `10.81.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makePerson(whatsappNumber: string, name = 'TP Leader Test Person') {
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
 * established in followUpAssignment.test.ts's setupScopedLeader. */
async function setupScopedLeader(n: number, scope: { communityId: string } | { geographyId: string }) {
  const email = `leader-tp${n}@test.local`;
  const { user } = await createLeader(`TP Leader ${n}`, email, `TP${n}CODE`);
  const person = await makePerson(`+237681${String(n).padStart(6, '0')}`, `TP Leader Person ${n}`);
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

describe('Phase 3E — GET /api/leader/community-progress', () => {
  it('an exact Community-scoped Leader can access their community\'s progress', async () => {
    const community = await makeCommunity('TP Community A');
    const { agent } = await setupScopedLeader(1, { communityId: community.id });
    const member = await makePerson('+237682000001', 'Community Member 1');
    await prisma.communityMembership.create({ data: { personId: member.id, communityId: community.id } });

    const res = await agent.get(`/api/leader/community-progress?communityId=${community.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items.some((i: any) => i.personId === member.id)).toBe(true);
  });

  it('rejects a Geography-only Leader — no Geography role authorizes this endpoint', async () => {
    const geography = await makeGeography('TP Geography A');
    const community = await makeCommunity('TP Community B');
    const { agent } = await setupScopedLeader(2, { geographyId: geography.id });

    const res = await agent.get(`/api/leader/community-progress?communityId=${community.id}`);
    expect(res.status).toBe(403);
  });

  it('rejects a request for a Community the Leader is not scoped to', async () => {
    const communityA = await makeCommunity('TP Community C-A');
    const communityB = await makeCommunity('TP Community C-B');
    const { agent } = await setupScopedLeader(3, { communityId: communityA.id });

    const res = await agent.get(`/api/leader/community-progress?communityId=${communityB.id}`);
    expect(res.status).toBe(403);
  });

  it('a parent Community RoleAssignment does not authorize a child Community', async () => {
    const parent = await makeCommunity('TP Parent Community');
    const child = await prisma.community.create({ data: { name: 'TP Child Community', parentId: parent.id } });
    const { agent } = await setupScopedLeader(4, { communityId: parent.id });

    const res = await agent.get(`/api/leader/community-progress?communityId=${child.id}`);
    expect(res.status).toBe(403);
  });

  it('a child Community RoleAssignment does not authorize the parent Community', async () => {
    const parent = await makeCommunity('TP Parent Community 2');
    const child = await prisma.community.create({ data: { name: 'TP Child Community 2', parentId: parent.id } });
    const { agent } = await setupScopedLeader(5, { communityId: child.id });

    const res = await agent.get(`/api/leader/community-progress?communityId=${parent.id}`);
    expect(res.status).toBe(403);
  });

  it('only ACTIVE members of the exact Community appear; inactive members are excluded', async () => {
    const community = await makeCommunity('TP Community D');
    const { agent } = await setupScopedLeader(6, { communityId: community.id });
    const activeMember = await makePerson('+237682000006', 'Active Member');
    const inactiveMember = await makePerson('+237682000106', 'Inactive Member');
    await prisma.communityMembership.create({ data: { personId: activeMember.id, communityId: community.id, status: 'ACTIVE' } });
    await prisma.communityMembership.create({ data: { personId: inactiveMember.id, communityId: community.id, status: 'INACTIVE' } });

    const res = await agent.get(`/api/leader/community-progress?communityId=${community.id}`);
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(activeMember.id);
    expect(ids).not.toContain(inactiveMember.id);
  });

  it('an arbitrary communityId query value cannot bypass authorization', async () => {
    const community = await makeCommunity('TP Community E');
    const { agent } = await setupScopedLeader(7, { communityId: community.id });

    const res = await agent.get('/api/leader/community-progress?communityId=nonexistent-community-id');
    expect(res.status).toBe(403);
  });

  it('an unlinked Leader (no Person link) is rejected the same way as every other Phase 3D leader route', async () => {
    const { user } = await createLeader('TP Unlinked Leader', 'leader-tp-unlinked@test.local', 'TPUNLINKED');
    void user;
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'leader-tp-unlinked@test.local', password: 'password123' });

    const community = await makeCommunity('TP Community F');
    const res = await agent.get(`/api/leader/community-progress?communityId=${community.id}`);
    expect(res.status).toBe(403);
  });

  it('rejects an unauthenticated request', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/leader/community-progress?communityId=x');
    expect(res.status).toBe(401);
  });

  it('rejects a non-Leader (Admin) session on this Leader-only endpoint', async () => {
    const community = await makeCommunity('TP Community G');
    const { agent } = await loginAsAdmin('admin-tp-leader-cross@test.local');
    const res = await agent.get(`/api/leader/community-progress?communityId=${community.id}`);
    expect(res.status).toBe(403);
  });

  it('uses the existing repository pagination convention', async () => {
    const community = await makeCommunity('TP Community H');
    const { agent } = await setupScopedLeader(8, { communityId: community.id });
    for (let i = 0; i < 3; i++) {
      const p = await makePerson(`+237682000${800 + i}`, `Paginated Member ${i}`);
      await prisma.communityMembership.create({ data: { personId: p.id, communityId: community.id } });
    }

    const res = await agent.get(`/api/leader/community-progress?communityId=${community.id}&page=1&pageSize=2`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(2);
    expect(res.body.pagination.total).toBe(3);
    expect(res.body.pagination.totalPages).toBe(2);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.pageSize).toBe(2);
  });
});
