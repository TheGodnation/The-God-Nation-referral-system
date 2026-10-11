import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

// Phase [National Headquarters]: every new test below logs in at least
// once, and several log in twice (Admin + Leader) — enough cumulative
// POST /api/auth/login calls to exceed loginLimiter's 10-per-15-minutes cap
// if they all shared one apparent client IP (the pre-existing tests above
// never came close to that limit on their own). Mirrors the exact
// agentWithUniqueIp() pattern already established in
// communityConversations.test.ts and others, so each login is counted
// against its own separate rate-limit bucket.
let ipCounter = 0;
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

async function loginAsAdmin(email = 'admin-community@test.local', password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

async function makePerson(whatsappNumber: string, name = 'Community Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

describe('Phase 3A — Community hierarchy and membership', () => {
  it('creates a Community, a multi-level parent/child hierarchy, and browses it', async () => {
    const { agent, csrf } = await loginAsAdmin();

    const mother = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Mother Community' });
    expect(mother.status).toBe(201);
    expect(mother.body.parentId).toBeNull();

    const child = await agent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Child Community', parentId: mother.body.id });
    expect(child.status).toBe(201);
    expect(child.body.parentId).toBe(mother.body.id);

    const grandchild = await agent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Grandchild Community', parentId: child.body.id });
    expect(grandchild.status).toBe(201);

    const greatGrandchild = await agent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Great-Grandchild Community', parentId: grandchild.body.id });
    expect(greatGrandchild.status).toBe(201);

    // Browse: root level shows the mother only.
    const rootList = await agent.get('/api/admin/communities');
    expect(rootList.status).toBe(200);
    expect(rootList.body.items.map((c: any) => c.name)).toContain('Mother Community');
    expect(rootList.body.items.map((c: any) => c.name)).not.toContain('Child Community');

    // Browse: children of mother shows only the child.
    const childList = await agent.get(`/api/admin/communities?parentId=${mother.body.id}`);
    expect(childList.body.items.map((c: any) => c.id)).toEqual([child.body.id]);

    // Arbitrary depth reachable by drilling down further.
    const grandchildList = await agent.get(`/api/admin/communities?parentId=${child.body.id}`);
    expect(grandchildList.body.items.map((c: any) => c.id)).toEqual([grandchild.body.id]);
    const greatGrandchildList = await agent.get(`/api/admin/communities?parentId=${grandchild.body.id}`);
    expect(greatGrandchildList.body.items.map((c: any) => c.id)).toEqual([greatGrandchild.body.id]);
  });

  it('activates and deactivates a Community', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-community-active@test.local');
    const created = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Toggle Community' });
    expect(created.body.active).toBe(true);

    const deactivated = await agent
      .patch(`/api/admin/communities/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ active: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.active).toBe(false);

    const reactivated = await agent
      .patch(`/api/admin/communities/${created.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ active: true });
    expect(reactivated.body.active).toBe(true);
  });

  it('creates a CommunityMembership, prevents a duplicate active membership, and changes status', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-membership@test.local');
    const community = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Membership Community' });
    const person = await makePerson('+237670002001');

    const membership = await agent
      .post(`/api/admin/people/${person.id}/community-memberships`)
      .set('X-CSRF-Token', csrf)
      .send({ communityId: community.body.id });
    expect(membership.status).toBe(201);
    expect(membership.body.status).toBe('ACTIVE');

    // Duplicate active membership in the same community is rejected.
    const duplicate = await agent
      .post(`/api/admin/people/${person.id}/community-memberships`)
      .set('X-CSRF-Token', csrf)
      .send({ communityId: community.body.id });
    expect(duplicate.status).toBe(409);

    const stillOne = await prisma.communityMembership.count({
      where: { personId: person.id, communityId: community.body.id },
    });
    expect(stillOne).toBe(1);

    // Change membership status.
    const deactivated = await agent
      .patch(`/api/admin/community-memberships/${membership.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ status: 'INACTIVE' });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.status).toBe('INACTIVE');

    // Rejoining after leaving reactivates the same row instead of creating
    // a second one.
    const rejoin = await agent
      .post(`/api/admin/people/${person.id}/community-memberships`)
      .set('X-CSRF-Token', csrf)
      .send({ communityId: community.body.id });
    expect(rejoin.status).toBe(201);
    expect(rejoin.body.id).toBe(membership.body.id);
    expect(rejoin.body.status).toBe('ACTIVE');

    const totalRows = await prisma.communityMembership.count({
      where: { personId: person.id, communityId: community.body.id },
    });
    expect(totalRows).toBe(1);
  });

  it('requires Admin authorization for every Community/membership mutation', async () => {
    const anon = request.agent(app);
    const { csrf: anonCsrf } = await bootstrap(anon);
    const anonCreate = await anon.post('/api/admin/communities').set('X-CSRF-Token', anonCsrf).send({ name: 'Nope' });
    expect(anonCreate.status).toBe(401);

    await createLeader('Community Leader', 'leader-community@example.com', 'COMMLD1');
    const leaderAgent = request.agent(app);
    const { csrf: leaderCsrf } = await bootstrap(leaderAgent);
    await leaderAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ email: 'leader-community@example.com', password: 'password123' });
    const leaderCreate = await leaderAgent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ name: 'Nope' });
    expect(leaderCreate.status).toBe(403);
  });
});

describe('National Headquarters designation and derived generation', () => {
  it('reports no Headquarters configured, and every Community has a null generation, before one is designated', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-hq-unset@test.local');
    const community = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'HQ Unset Community' });

    const current = await agent.get('/api/admin/communities/headquarters');
    expect(current.status).toBe(200);
    expect(current.body.community).toBeNull();

    const detail = await agent.get(`/api/admin/communities/${community.body.id}`);
    expect(detail.body.generation).toBeNull();
  });

  it('an Admin can designate a root Community as National Headquarters', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-hq-designate@test.local');
    const community = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'HQ Designate Community' });

    const res = await agent
      .put('/api/admin/communities/headquarters')
      .set('X-CSRF-Token', csrf)
      .send({ communityId: community.body.id });
    expect(res.status).toBe(200);
    expect(res.body.community.id).toBe(community.body.id);

    const current = await agent.get('/api/admin/communities/headquarters');
    expect(current.body.community.id).toBe(community.body.id);

    const auditRow = await prisma.auditLog.findFirst({ where: { action: 'HEADQUARTERS_COMMUNITY_DESIGNATED', targetId: community.body.id } });
    expect(auditRow).toBeTruthy();
  });

  it('rejects designating a non-root (child) Community as National Headquarters', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-hq-reject-child@test.local');
    const mother = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'HQ Reject Mother' });
    const child = await agent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'HQ Reject Child', parentId: mother.body.id });

    const res = await agent
      .put('/api/admin/communities/headquarters')
      .set('X-CSRF-Token', csrf)
      .send({ communityId: child.body.id });
    expect(res.status).toBe(400);

    const current = await agent.get('/api/admin/communities/headquarters');
    expect(current.body.community).toBeNull();
  });

  it('rejects a nonexistent Community id', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-hq-reject-missing@test.local');
    const res = await agent
      .put('/api/admin/communities/headquarters')
      .set('X-CSRF-Token', csrf)
      .send({ communityId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing communityId', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-hq-reject-empty@test.local');
    const res = await agent.put('/api/admin/communities/headquarters').set('X-CSRF-Token', csrf).send({});
    expect(res.status).toBe(400);
  });

  it('designating Headquarters never modifies any Community.parentId', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-hq-no-mutation@test.local');
    const mother = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'HQ No-Mutation Mother' });
    const child = await agent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'HQ No-Mutation Child', parentId: mother.body.id });

    await agent.put('/api/admin/communities/headquarters').set('X-CSRF-Token', csrf).send({ communityId: mother.body.id });

    const motherRow = await prisma.community.findUnique({ where: { id: mother.body.id } });
    const childRow = await prisma.community.findUnique({ where: { id: child.body.id } });
    expect(motherRow!.parentId).toBeNull();
    expect(childRow!.parentId).toBe(mother.body.id);
  });

  it('re-designating Headquarters to a different root Community simply updates the singleton, never creating a second record', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-hq-redesignate@test.local');
    const first = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'HQ Redesignate First' });
    const second = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'HQ Redesignate Second' });

    await agent.put('/api/admin/communities/headquarters').set('X-CSRF-Token', csrf).send({ communityId: first.body.id });
    const settingsCountAfterFirst = await prisma.settings.count();
    await agent.put('/api/admin/communities/headquarters').set('X-CSRF-Token', csrf).send({ communityId: second.body.id });
    const settingsCountAfterSecond = await prisma.settings.count();

    expect(settingsCountAfterFirst).toBe(1);
    expect(settingsCountAfterSecond).toBe(1);
    const current = await agent.get('/api/admin/communities/headquarters');
    expect(current.body.community.id).toBe(second.body.id);
  });

  it('the Community list and detail routes report the correct derived generation at every level', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-hq-generation@test.local');
    const hq = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Generation HQ Community' });
    await agent.put('/api/admin/communities/headquarters').set('X-CSRF-Token', csrf).send({ communityId: hq.body.id });

    const child = await agent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Generation Child Community', parentId: hq.body.id });
    const grandchild = await agent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Generation Grandchild Community', parentId: child.body.id });

    const hqDetail = await agent.get(`/api/admin/communities/${hq.body.id}`);
    expect(hqDetail.body.generation).toBe(0);

    const childList = await agent.get(`/api/admin/communities?parentId=${hq.body.id}`);
    expect(childList.body.items.find((c: any) => c.id === child.body.id).generation).toBe(1);

    const grandchildDetail = await agent.get(`/api/admin/communities/${grandchild.body.id}`);
    expect(grandchildDetail.body.generation).toBe(2);
  });

  it('a Community outside the Headquarters tree has a null generation even after Headquarters is configured', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-hq-unrelated@test.local');
    const hq = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Generation HQ Unrelated' });
    await agent.put('/api/admin/communities/headquarters').set('X-CSRF-Token', csrf).send({ communityId: hq.body.id });

    const unrelated = await agent.post('/api/admin/communities').set('X-CSRF-Token', csrf).send({ name: 'Generation Unrelated Root' });
    const detail = await agent.get(`/api/admin/communities/${unrelated.body.id}`);
    expect(detail.body.generation).toBeNull();
  });

  it('requires Admin authorization for both the Headquarters read and designation routes', async () => {
    const anon = request.agent(app);
    const { csrf: anonCsrf } = await bootstrap(anon);
    const anonGet = await anon.get('/api/admin/communities/headquarters');
    expect(anonGet.status).toBe(401);
    const anonPut = await anon.put('/api/admin/communities/headquarters').set('X-CSRF-Token', anonCsrf).send({ communityId: 'x' });
    expect(anonPut.status).toBe(401);

    await createLeader('HQ Test Leader', 'leader-hq@example.com', 'HQLEAD1');
    const leaderAgent = request.agent(app);
    const { csrf: leaderCsrf } = await bootstrap(leaderAgent);
    await leaderAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ email: 'leader-hq@example.com', password: 'password123' });
    const leaderGet = await leaderAgent.get('/api/admin/communities/headquarters');
    expect(leaderGet.status).toBe(403);
    const leaderPut = await leaderAgent
      .put('/api/admin/communities/headquarters')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ communityId: 'x' });
    expect(leaderPut.status).toBe(403);
  });

  it('requires CSRF protection on the designation route', async () => {
    const { agent } = await loginAsAdmin('admin-hq-csrf@test.local');
    const res = await agent.put('/api/admin/communities/headquarters').send({ communityId: 'x' });
    expect(res.status).toBe(403);
  });
});
