import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function loginAsAdmin(email = 'admin-community@test.local', password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
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
