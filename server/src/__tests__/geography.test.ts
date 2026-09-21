import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

const app = createApp();

async function loginAsAdmin(email = 'admin-geo@test.local', password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = request.agent(app);
  const { csrf } = await bootstrap(agent);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

async function makePerson(whatsappNumber: string, name = 'Geo Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

describe('Phase 3A — Geography hierarchy and assignment', () => {
  it('creates a root country, a full arbitrary-depth chain, with different type labels and country codes', async () => {
    const { agent, csrf } = await loginAsAdmin();

    const country = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Cameroon', type: 'COUNTRY', countryCode: 'CM' });
    expect(country.status).toBe(201);
    expect(country.body.parentId).toBeNull();
    expect(country.body.countryCode).toBe('CM');

    const region = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Littoral', type: 'REGION', parentId: country.body.id });
    // countryCode inherited from parent when not given.
    expect(region.status).toBe(201);
    expect(region.body.countryCode).toBe('CM');

    const division = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Wouri', type: 'DIVISION', parentId: region.body.id });
    const subdivision = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Subdivision X', type: 'SUBDIVISION', parentId: division.body.id });
    const quarter = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Quarter Y', type: 'QUARTER', parentId: subdivision.body.id });
    expect(quarter.status).toBe(201);
    expect(quarter.body.countryCode).toBe('CM');

    // A second country with entirely different type labels.
    const otherCountry = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Nigeria', type: 'COUNTRY', countryCode: 'NG' });
    const state = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Lagos', type: 'STATE', parentId: otherCountry.body.id });
    expect(state.body.type).toBe('STATE');
    expect(state.body.countryCode).toBe('NG');

    // Browse hierarchy: root shows both countries.
    const roots = await agent.get('/api/admin/geography');
    const rootNames = roots.body.items.map((n: any) => n.name);
    expect(rootNames).toContain('Cameroon');
    expect(rootNames).toContain('Nigeria');
    expect(rootNames).not.toContain('Littoral');

    // Browse hierarchy: filtering by countryCode.
    const cmRoots = await agent.get('/api/admin/geography?countryCode=CM');
    expect(cmRoots.body.items.map((n: any) => n.name)).toEqual(['Cameroon']);

    // Arbitrary depth: drill all the way to the quarter.
    const children = await agent.get(`/api/admin/geography?parentId=${subdivision.body.id}`);
    expect(children.body.items.map((n: any) => n.id)).toEqual([quarter.body.id]);

    // Full ancestor path is derivable via the detail endpoint.
    const detail = await agent.get(`/api/admin/geography/${quarter.body.id}`);
    expect(detail.body.path.map((p: any) => p.name)).toEqual([
      'Cameroon',
      'Littoral',
      'Wouri',
      'Subdivision X',
      'Quarter Y',
    ]);
  });

  it('activates and deactivates a Geography node', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-geo-active@test.local');
    const node = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Togglestan', type: 'COUNTRY', countryCode: 'TG' });
    expect(node.body.active).toBe(true);

    const deactivated = await agent
      .patch(`/api/admin/geography/${node.body.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ active: false });
    expect(deactivated.body.active).toBe(false);
  });

  it('supports exactly one active GeographicAssignment per Person, with reassignment updating it in place', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-geo-assign@test.local');
    const country = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Assignland', type: 'COUNTRY', countryCode: 'AS' });
    const quarterA = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Quarter A', type: 'QUARTER', parentId: country.body.id });
    const quarterB = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Quarter B', type: 'QUARTER', parentId: country.body.id });

    const person = await makePerson('+237670003001');

    const assign = await agent
      .put(`/api/admin/people/${person.id}/geographic-assignment`)
      .set('X-CSRF-Token', csrf)
      .send({ geographyId: quarterA.body.id });
    expect(assign.status).toBe(200);
    expect(assign.body.geography.id).toBe(quarterA.body.id);

    const onlyOne = await prisma.geographicAssignment.count({ where: { personId: person.id } });
    expect(onlyOne).toBe(1);

    // Reassignment updates the same row rather than creating a second one.
    const reassign = await agent
      .put(`/api/admin/people/${person.id}/geographic-assignment`)
      .set('X-CSRF-Token', csrf)
      .send({ geographyId: quarterB.body.id });
    expect(reassign.status).toBe(200);
    expect(reassign.body.geography.id).toBe(quarterB.body.id);
    expect(reassign.body.id).toBe(assign.body.id);

    const stillOnlyOne = await prisma.geographicAssignment.count({ where: { personId: person.id } });
    expect(stillOnlyOne).toBe(1);
  });

  it('never lets Geography affect CommunityMembership', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-geo-vs-community@test.local');
    const country = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Independence Land', type: 'COUNTRY', countryCode: 'IL' });
    const otherCountry = await agent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Faraway Land', type: 'COUNTRY', countryCode: 'FL' });
    const community = await agent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Global Online Community' });

    const personHere = await makePerson('+237670003002', 'Local Person');
    const personThere = await makePerson('+237670003003', 'Distant Person');

    await agent
      .put(`/api/admin/people/${personHere.id}/geographic-assignment`)
      .set('X-CSRF-Token', csrf)
      .send({ geographyId: country.body.id });
    await agent
      .put(`/api/admin/people/${personThere.id}/geographic-assignment`)
      .set('X-CSRF-Token', csrf)
      .send({ geographyId: otherCountry.body.id });

    // Both people, despite being in different countries, join the SAME
    // online community with no restriction from Geography.
    const join1 = await agent
      .post(`/api/admin/people/${personHere.id}/community-memberships`)
      .set('X-CSRF-Token', csrf)
      .send({ communityId: community.body.id });
    const join2 = await agent
      .post(`/api/admin/people/${personThere.id}/community-memberships`)
      .set('X-CSRF-Token', csrf)
      .send({ communityId: community.body.id });
    expect(join1.status).toBe(201);
    expect(join2.status).toBe(201);

    const members = await prisma.communityMembership.count({ where: { communityId: community.body.id } });
    expect(members).toBe(2);
  });

  it('requires Admin authorization for every Geography mutation', async () => {
    const anon = request.agent(app);
    const { csrf: anonCsrf } = await bootstrap(anon);
    const anonCreate = await anon
      .post('/api/admin/geography')
      .set('X-CSRF-Token', anonCsrf)
      .send({ name: 'Nope', type: 'COUNTRY', countryCode: 'XX' });
    expect(anonCreate.status).toBe(401);

    await createLeader('Geography Leader', 'leader-geo@example.com', 'GEOLD1');
    const leaderAgent = request.agent(app);
    const { csrf: leaderCsrf } = await bootstrap(leaderAgent);
    await leaderAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ email: 'leader-geo@example.com', password: 'password123' });
    const leaderCreate = await leaderAgent
      .post('/api/admin/geography')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ name: 'Nope', type: 'COUNTRY', countryCode: 'XX' });
    expect(leaderCreate.status).toBe(403);
  });
});
