import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Final Geography Retirement — removes the Geography model itself, the last
// remaining Geography dependency after Steps 2, 4, 5A, and 5B already
// retired GeographyConversation, AnnouncementTarget.geographyId,
// FollowUpAssignment's GEOGRAPHY context, GeographicAssignment, and
// RoleAssignment.geographyId (see the 20260930123741_retire_geography_model
// migration). The final organizational model is Central Authority ->
// Communities -> Members, with no geographic hierarchy, leaders,
// permissions, memberships, follow-ups, messaging, resources, or
// announcement targeting of any kind. Person.locationCountry/City/Area
// remain — purely descriptive, never authorizing anything.
const app = createApp();

let ipCounter = 60000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.98.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makePerson(whatsappNumber: string, name = 'Final Geo Retirement Person', overrides: Record<string, unknown> = {}) {
  return prisma.person.create({ data: { name, whatsappNumber, ...overrides } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

/** Creates a Leader User linked to a fresh Person with an ACTIVE
 * SCOPED_LEADER RoleAssignment for the given exact Community, then logs in. */
async function setupScopedLeader(n: number, communityId: string) {
  const email = `leader-fgr${n}@test.local`;
  const { user } = await createLeader(`Final Geo Retirement Leader ${n}`, email, `FGR${n}CODE`);
  const person = await makePerson(`+237678${String(n).padStart(6, '0')}`, `Final Geo Retirement Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

describe('Final Geography Retirement — database/model', () => {
  it('1. Prisma no longer exposes a Geography model at all', () => {
    expect((prisma as any).geography).toBeUndefined();
  });

  it('2. The Geography table is removed after migration — a raw query against it fails', async () => {
    await expect(prisma.$queryRawUnsafe('SELECT 1 FROM "Geography" LIMIT 1')).rejects.toThrow();
  });

  it('3. No active application route depends on Geography — /api/admin/geography is gone entirely (404)', async () => {
    const { agent } = await loginAsAdmin('admin-fgr-noroute@test.local');
    const res = await agent.get('/api/admin/geography');
    expect(res.status).toBe(404);
  });

  it('4. No current foreign key references Geography — every self-referencing tree left in the schema is Community\'s own', async () => {
    const rows = await prisma.$queryRawUnsafe<{ confrelid: string }[]>(`
      SELECT confrelid::regclass::text AS confrelid
      FROM pg_constraint
      WHERE contype = 'f' AND confrelid::regclass::text = '"Geography"'
    `);
    expect(rows.length).toBe(0);
  });
});

describe('Final Geography Retirement — authorization', () => {
  it('5. Geography cannot grant authority because it no longer exists — no route accepts a geography-shaped scope', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-fgr-noauth@test.local');
    const person = await makePerson('+237678900001', 'No Auth Person');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', geographyId: crypto.randomUUID() });
    expect(res.status).toBe(400);

    const roles = await prisma.roleAssignment.count({ where: { personId: person.id } });
    expect(roles).toBe(0);
  });

  it('6. Member location does not grant authority — a Leader with a fully-located Person but no RoleAssignment gets no roster access', async () => {
    const community = await makeCommunity('FGR Community A');
    const email = 'leader-fgr-located@test.local';
    const { user } = await createLeader('Located Leader', email, 'FGRLOCATED');
    const person = await makePerson('+237678900002', 'Located Person', {
      locationCountry: 'Cameroon',
      locationCity: 'Douala',
      locationArea: 'Bonapriso',
    });
    await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(403);
  });

  it('7. Community membership remains authoritative for roster population, regardless of location', async () => {
    const community = await makeCommunity('FGR Community B');
    const { agent } = await setupScopedLeader(1, community.id);
    const memberWithLocation = await makePerson('+237678900003', 'Member With Location', { locationCountry: 'Nigeria' });
    const memberWithout = await makePerson('+237678900004', 'Member Without Location');
    await prisma.communityMembership.create({ data: { personId: memberWithLocation.id, communityId: community.id } });
    await prisma.communityMembership.create({ data: { personId: memberWithout.id, communityId: community.id } });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(200);
    const ids = res.body.items.map((i: any) => i.personId);
    expect(ids).toContain(memberWithLocation.id);
    expect(ids).toContain(memberWithout.id);
  });

  it('8. Community Leader authorization remains correct — cross-Community roster access stays blocked', async () => {
    const communityA = await makeCommunity('FGR Community C-A');
    const communityB = await makeCommunity('FGR Community C-B');
    const { agent } = await setupScopedLeader(2, communityA.id);
    const memberB = await makePerson('+237678900005', 'Member B');
    await prisma.communityMembership.create({ data: { personId: memberB.id, communityId: communityB.id } });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${communityB.id}`);
    expect(res.status).toBe(403);
  });
});

describe('Final Geography Retirement — Follow-Up', () => {
  it('9. Follow-Up remains Community-only', async () => {
    const community = await makeCommunity('FGR Community D');
    const { agent, csrf } = await setupScopedLeader(3, community.id);
    const followed = await makePerson('+237678900006', 'Followed Person');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(res.status).toBe(201);
  });

  it('10. No Geography Follow-Up context can exist — the enum has no GEOGRAPHY value at the database level', async () => {
    const follower = await makePerson('+237678900007', 'Direct Follower');
    const followedPerson = await makePerson('+237678900008', 'Direct Followed');
    const admin = await createAdmin('admin-fgr-dbcheck@test.local');

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

describe('Final Geography Retirement — leadership', () => {
  it('11. Community Leader creation remains functional', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-fgr-create@test.local');
    const person = await makePerson('+237678900009', 'New Leader Candidate');
    const community = await makeCommunity('FGR Community E');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    expect(res.status).toBe(201);
    expect(res.body.communityId).toBe(community.id);
  });

  it('12. Multiple active Community Leaders remain supported for the same Community', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-fgr-multi@test.local');
    const community = await makeCommunity('FGR Community F');
    const personA = await makePerson('+237678900010', 'Leader A');
    const personB = await makePerson('+237678900011', 'Leader B');

    const resA = await agent.post('/api/admin/role-assignments').set('X-CSRF-Token', csrf).send({ personId: personA.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    const resB = await agent.post('/api/admin/role-assignments').set('X-CSRF-Token', csrf).send({ personId: personB.id, roleType: 'SCOPED_LEADER', communityId: community.id });
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);

    const active = await prisma.roleAssignment.count({ where: { communityId: community.id, status: 'ACTIVE' } });
    expect(active).toBe(2);
  });

  it('13. No geographic Leader assignment exists — geographyId is silently stripped, never persisted or echoed back', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-fgr-strip@test.local');
    const person = await makePerson('+237678900012', 'Strip Candidate');
    const community = await makeCommunity('FGR Community G');

    const res = await agent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', csrf)
      .send({ personId: person.id, roleType: 'SCOPED_LEADER', communityId: community.id, geographyId: crypto.randomUUID() });
    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('geographyId');
  });
});

describe('Final Geography Retirement — roster', () => {
  it('14. Community roster remains functional', async () => {
    const community = await makeCommunity('FGR Community H');
    const { agent } = await setupScopedLeader(4, community.id);
    const member = await makePerson('+237678900013', 'Roster Member');
    await prisma.communityMembership.create({ data: { personId: member.id, communityId: community.id } });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${community.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.personId)).toContain(member.id);
  });

  it('15. Geography roster functionality no longer exists — GEOGRAPHY is rejected outright (400)', async () => {
    const community = await makeCommunity('FGR Community I');
    const { agent } = await setupScopedLeader(5, community.id);

    const res = await agent.get(`/api/leader/roster?scopeType=GEOGRAPHY&scopeId=${crypto.randomUUID()}`);
    expect(res.status).toBe(400);
  });
});

describe('Final Geography Retirement — messaging', () => {
  it('16. Community messaging remains functional — a Community Leader can message a member of their own Community', async () => {
    const community = await makeCommunity('FGR Community J');
    const { agent, csrf } = await setupScopedLeader(6, community.id);
    const member = await makePerson('+237678900014', 'Messaging Member');
    await prisma.communityMembership.create({ data: { personId: member.id, communityId: community.id } });

    const res = await agent
      .post('/api/leader/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ personIds: [member.id], body: 'Hello from the Final Geography Retirement test.' });
    expect(res.status).toBe(201);
  });

  it('17. Location cannot grant messaging access — a Person outside the Leader\'s Community is unreachable regardless of location', async () => {
    const community = await makeCommunity('FGR Community K');
    const { agent, csrf } = await setupScopedLeader(7, community.id);
    const outsider = await makePerson('+237678900015', 'Outsider With Location', { locationCountry: 'Cameroon' });

    const res = await agent
      .post('/api/leader/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ personIds: [outsider.id], body: 'Attempted message.' });
    expect(res.status).toBe(403);
  });
});

describe('Final Geography Retirement — resources', () => {
  it('18. Community/resource authorization remains functional', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-fgr-resource@test.local');
    const person = await makePerson('+237678900016', 'Resource Person');
    const resource = await prisma.resource.create({ data: { titleEn: 'FGR Resource' } });

    const res = await agent
      .post(`/api/admin/people/${person.id}/resource-access`)
      .set('X-CSRF-Token', csrf)
      .send({ resourceId: resource.id });
    expect(res.status).toBe(201);
  });

  it('19. Location cannot grant resource access — access is granted only per-Person, never derived from location', async () => {
    const person = await makePerson('+237678900017', 'Located Resource Person', { locationCountry: 'Cameroon' });
    const grants = await prisma.resourceAccessGrant.count({ where: { personId: person.id } });
    expect(grants).toBe(0);
  });
});

describe('Final Geography Retirement — member location', () => {
  it('20. locationCountry, locationCity, and locationArea remain available on Person', async () => {
    const person = await makePerson('+237678900018', 'Location Fields Person', {
      locationCountry: 'Cameroon',
      locationCity: 'Douala',
      locationArea: 'Akwa',
    });
    const found = await prisma.person.findUnique({ where: { id: person.id } });
    expect(found?.locationCountry).toBe('Cameroon');
    expect(found?.locationCity).toBe('Douala');
    expect(found?.locationArea).toBe('Akwa');
  });

  it('21. The existing aggregate location intelligence endpoint keeps working, independent of Geography', async () => {
    const { agent } = await loginAsAdmin('admin-fgr-locagg@test.local');
    await makePerson('+237678900019', 'Aggregate Location Person', { locationCountry: 'Cameroon', locationCity: 'Douala' });

    const res = await agent.get('/api/admin/locations');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('22. Location remains descriptive only — it never creates a CommunityMembership or RoleAssignment as a side effect', async () => {
    const person = await makePerson('+237678900020', 'Descriptive Only Person', {
      locationCountry: 'Cameroon',
      locationCity: 'Douala',
      locationArea: 'Bonapriso',
    });
    const memberships = await prisma.communityMembership.count({ where: { personId: person.id } });
    const roles = await prisma.roleAssignment.count({ where: { personId: person.id } });
    expect(memberships).toBe(0);
    expect(roles).toBe(0);
  });
});

describe('Final Geography Retirement — security/data integrity', () => {
  it('23. No client-supplied location can alter authorization on a mutating request', async () => {
    const community = await makeCommunity('FGR Community L');
    const { agent, csrf } = await setupScopedLeader(8, community.id);
    const outsider = await makePerson('+237678900021', 'Location Bypass Attempt');

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: outsider.id, contextType: 'COMMUNITY', contextId: community.id, locationCountry: 'Cameroon' });
    // outsider has no CommunityMembership in `community` — supplying an
    // unrelated, unschema'd location field in the body is silently stripped
    // and changes nothing: the request still fails because Community
    // membership (not location) is what personBelongsToContext requires.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/does not currently belong/);
  });

  it('24. No cross-Community access is introduced by this retirement', async () => {
    const communityA = await makeCommunity('FGR Community M-A');
    const communityB = await makeCommunity('FGR Community M-B');
    const { agent } = await setupScopedLeader(9, communityA.id);
    const memberB = await makePerson('+237678900022', 'Cross Community Member');
    await prisma.communityMembership.create({ data: { personId: memberB.id, communityId: communityB.id } });

    const res = await agent.get(`/api/leader/roster?scopeType=COMMUNITY&scopeId=${communityA.id}`);
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: any) => i.personId)).not.toContain(memberB.id);
  });

  it('25. No cross-Leader access is introduced by this retirement', async () => {
    const community = await makeCommunity('FGR Community N');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(10, community.id);
    const { agent: agentB } = await setupScopedLeader(11, community.id);
    const followed = await makePerson('+237678900023', 'Cross Leader Followed');
    await prisma.communityMembership.create({ data: { personId: followed.id, communityId: community.id } });

    const created = await agentA
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrfA)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(created.status).toBe(201);

    const listB = await agentB.get('/api/leader/follow-ups');
    expect(listB.body.items.length).toBe(0);
  });
});
