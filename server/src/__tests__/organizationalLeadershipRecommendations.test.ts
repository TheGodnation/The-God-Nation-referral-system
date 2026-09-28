import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';
import { isCommunityAdministrator, findActiveScopedRole } from '../lib/leadership';
import { hasConversationAccess } from '../lib/communityConversation';

// Phase 2C — Organizational Leadership Recommendation. Mirrors the exact
// conventions established in leadershipProposals.test.ts (Phase 3L) and
// leaderLeadershipCollaboration.test.ts (Phase 2B): agentWithUniqueIp,
// createLeader/createAdmin, bootstrap, setupCommunityLeader.

const app = createApp();

let ipCounter = 8000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.95.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makeCommunity(name: string, parentId?: string) {
  return prisma.community.create({ data: { name, parentId: parentId ?? null } });
}

async function setHeadquarters(communityId: string) {
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', headquartersCommunityId: communityId },
    update: { headquartersCommunityId: communityId },
  });
}

async function makePerson(whatsappNumber: string, name = 'Recommendation Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeGeography(name: string) {
  return prisma.geography.create({ data: { name, type: 'REGION', countryCode: 'CM' } });
}

async function addActiveMember(personId: string, communityId: string) {
  return prisma.communityMembership.create({ data: { personId, communityId, status: 'ACTIVE' } });
}

/** Creates a Leader User linked to a Person, with an ACTIVE SCOPED_LEADER
 * RoleAssignment for the given Community, then logs in. */
async function setupCommunityLeader(n: number, communityId: string, name?: string) {
  const email = `leader-orgrec${n}@test.local`;
  const { user } = await createLeader(name ?? `OrgRec Leader ${n}`, email, `OR${n}CODE`);
  const person = await makePerson(`+237986${String(n).padStart(6, '0')}`, name ?? `OrgRec Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  const role = await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person, role };
}

async function setupGeographyOnlyLeader(n: number, geographyId: string) {
  const email = `leader-orgrec-geo${n}@test.local`;
  const { user } = await createLeader(`OrgRec Geo Leader ${n}`, email, `ORG${n}CODE`);
  const person = await makePerson(`+237986${String(900000 + n).padStart(6, '0')}`, `OrgRec Geo Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, geographyId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

describe('Phase 2C — authentication', () => {
  it('rejects an unauthenticated Leader create', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.post('/api/leader/organizational-leadership-recommendations').send({});
    expect(res.status).toBe(401);
  });

  it('rejects an unauthenticated Leader list', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/leader/organizational-leadership-recommendations');
    expect(res.status).toBe(401);
  });

  it('a non-Leader (Admin) session cannot create/list/withdraw via the Leader routes', async () => {
    const { agent } = await loginAsAdmin('admin-orgrec-nonleader@test.local');
    expect((await agent.post('/api/leader/organizational-leadership-recommendations').send({})).status).toBe(403);
    expect((await agent.get('/api/leader/organizational-leadership-recommendations')).status).toBe(403);
    expect((await agent.post('/api/leader/organizational-leadership-recommendations/x/withdraw').send({})).status).toBe(403);
  });

  it('rejects an unauthenticated Admin review request', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/admin/organizational-leadership-recommendations');
    expect(res.status).toBe(401);
  });

  it('a non-Admin (Leader) cannot review recommendations', async () => {
    const hq = await makeCommunity('OrgRec Auth HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Auth HQ A - A', hq.id);
    const { agent } = await setupCommunityLeader(1, a.id);
    const res = await agent.get('/api/admin/organizational-leadership-recommendations');
    expect(res.status).toBe(403);
  });
});

describe('Phase 2C — Leader authorization (anchor Community exactness)', () => {
  it('a Leader can recommend for their own exact active Community', async () => {
    const hq = await makeCommunity('OrgRec Auth HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Auth HQ B - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(2, a.id);
    const candidate = await makePerson('+237987000001');
    await addActiveMember(candidate.id, a.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: a.id, note: 'Faithful and reliable.' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PROPOSED');
    expect(res.body.proposedPersonId).toBe(candidate.id);
    expect(res.body.communityId).toBe(a.id);
  });

  it('a Leader cannot recommend for another Leader\'s Community', async () => {
    const hq = await makeCommunity('OrgRec Auth HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Auth HQ C - A', hq.id);
    const b = await makeCommunity('OrgRec Auth HQ C - B', hq.id);
    const { agent, csrf } = await setupCommunityLeader(3, a.id);
    const { person: personB } = await setupCommunityLeader(4, b.id);
    await addActiveMember(personB.id, b.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: personB.id, communityId: b.id });
    expect(res.status).toBe(403);
  });

  it('a Leader cannot recommend for a sibling Community', async () => {
    const hq = await makeCommunity('OrgRec Auth HQ D');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Auth HQ D - A', hq.id);
    const b = await makeCommunity('OrgRec Auth HQ D - B', hq.id);
    const { agent, csrf } = await setupCommunityLeader(5, a.id);
    const candidate = await makePerson('+237987000002');
    await addActiveMember(candidate.id, b.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: b.id });
    expect(res.status).toBe(403);
  });

  it('a Leader cannot recommend for a parent Community', async () => {
    const hq = await makeCommunity('OrgRec Auth HQ E');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Auth HQ E - A', hq.id);
    const a1 = await makeCommunity('OrgRec Auth HQ E - A1', a.id);
    const { agent, csrf } = await setupCommunityLeader(6, a1.id);
    const candidate = await makePerson('+237987000003');
    await addActiveMember(candidate.id, a.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: a.id });
    expect(res.status).toBe(403);
  });

  it('a Leader cannot recommend for a descendant Community', async () => {
    const hq = await makeCommunity('OrgRec Auth HQ F');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Auth HQ F - A', hq.id);
    const a1 = await makeCommunity('OrgRec Auth HQ F - A1', a.id);
    const { agent, csrf } = await setupCommunityLeader(7, a.id);
    const candidate = await makePerson('+237987000004');
    await addActiveMember(candidate.id, a1.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: a1.id });
    expect(res.status).toBe(403);
  });

  it('a Leader cannot recommend for an unrelated Community', async () => {
    const hq = await makeCommunity('OrgRec Auth HQ G');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Auth HQ G - A', hq.id);
    const unrelated = await makeCommunity('OrgRec Auth HQ G - Unrelated');
    const { agent, csrf } = await setupCommunityLeader(8, a.id);
    const candidate = await makePerson('+237987000005');
    await addActiveMember(candidate.id, unrelated.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: unrelated.id });
    expect(res.status).toBe(403);
  });

  it('a Geography-only Leader cannot create an organizational recommendation', async () => {
    const geography = await makeGeography('OrgRec Auth Geography A');
    const hq = await makeCommunity('OrgRec Auth HQ H');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Auth HQ H - A', hq.id);
    const { agent, csrf } = await setupGeographyOnlyLeader(9, geography.id);
    const candidate = await makePerson('+237987000006');
    await addActiveMember(candidate.id, a.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: a.id });
    expect(res.status).toBe(403);
  });

  it('a client-supplied proposer Person id cannot impersonate another Leader', async () => {
    const hq = await makeCommunity('OrgRec Auth HQ I');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Auth HQ I - A', hq.id);
    const { agent, csrf, person } = await setupCommunityLeader(10, a.id);
    const other = await makePerson('+237987000007', 'Someone Else');
    const candidate = await makePerson('+237987000008');
    await addActiveMember(candidate.id, a.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: a.id, proposedByPersonId: other.id });
    expect(res.status).toBe(201);
    const stored = await prisma.organizationalLeadershipRecommendation.findUnique({ where: { id: res.body.id } });
    expect(stored!.proposedByPersonId).toBe(person.id);
  });

  it('a client-supplied generation cannot expand access', async () => {
    const hq = await makeCommunity('OrgRec Auth HQ J');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Auth HQ J - A', hq.id);
    const b = await makeCommunity('OrgRec Auth HQ J - B', hq.id);
    const { agent, csrf } = await setupCommunityLeader(11, a.id);
    const candidate = await makePerson('+237987000009');
    await addActiveMember(candidate.id, b.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: b.id, generation: 1 });
    expect(res.status).toBe(403);
  });

  it('a client-supplied Community id (the only relevant target field) still requires the exact-match check, never trusted on its own', async () => {
    const hq = await makeCommunity('OrgRec Auth HQ K');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Auth HQ K - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(12, a.id);
    const candidate = await makePerson('+237987000010');
    await addActiveMember(candidate.id, a.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(403);
  });
});

describe('Phase 2C — candidate rules', () => {
  it('an existing, active-member Person can be recommended', async () => {
    const hq = await makeCommunity('OrgRec Candidate HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Candidate HQ A - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(13, a.id);
    const candidate = await makePerson('+237987000011');
    await addActiveMember(candidate.id, a.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: a.id });
    expect(res.status).toBe(201);
  });

  it('a candidate need not already be a Leader', async () => {
    const hq = await makeCommunity('OrgRec Candidate HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Candidate HQ B - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(14, a.id);
    const candidate = await makePerson('+237987000012');
    await addActiveMember(candidate.id, a.id);

    const noRole = await prisma.roleAssignment.findFirst({ where: { personId: candidate.id } });
    expect(noRole).toBeNull();

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: a.id });
    expect(res.status).toBe(201);
  });

  it('a nonexistent Person is rejected', async () => {
    const hq = await makeCommunity('OrgRec Candidate HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Candidate HQ C - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(15, a.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: '00000000-0000-0000-0000-000000000000', communityId: a.id });
    expect(res.status).toBe(400);
  });

  it('a Person who is not an active member of the anchor Community is rejected', async () => {
    const hq = await makeCommunity('OrgRec Candidate HQ D');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Candidate HQ D - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(16, a.id);
    const candidate = await makePerson('+237987000013');
    // No membership at all.

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: a.id });
    expect(res.status).toBe(400);
  });

  it('self-recommendation is rejected', async () => {
    const hq = await makeCommunity('OrgRec Candidate HQ E');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Candidate HQ E - A', hq.id);
    const { agent, csrf, person } = await setupCommunityLeader(17, a.id);
    await addActiveMember(person.id, a.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: person.id, communityId: a.id });
    expect(res.status).toBe(400);
  });

  it('the candidate never automatically receives a RoleAssignment', async () => {
    const hq = await makeCommunity('OrgRec Candidate HQ F');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Candidate HQ F - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(18, a.id);
    const candidate = await makePerson('+237987000014');
    await addActiveMember(candidate.id, a.id);

    await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: a.id });

    const role = await prisma.roleAssignment.findFirst({ where: { personId: candidate.id } });
    expect(role).toBeNull();
  });

  it('the candidate never automatically receives a new CommunityMembership beyond what already existed', async () => {
    const hq = await makeCommunity('OrgRec Candidate HQ G');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Candidate HQ G - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(19, a.id);
    const candidate = await makePerson('+237987000015');
    await addActiveMember(candidate.id, a.id);

    const before = await prisma.communityMembership.count();
    await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: a.id });
    const after = await prisma.communityMembership.count();
    expect(after).toBe(before);
  });
});

describe('Phase 2C — recommendation lifecycle', () => {
  it('a recommendation is created as PROPOSED, with the correct proposer, Community, generation, and note', async () => {
    const hq = await makeCommunity('OrgRec Lifecycle HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Lifecycle HQ A - A', hq.id); // gen 1
    const { agent, csrf, person } = await setupCommunityLeader(20, a.id);
    const candidate = await makePerson('+237987000016');
    await addActiveMember(candidate.id, a.id);

    const res = await agent
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, communityId: a.id, note: 'Ready for the next generation.' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PROPOSED');
    expect(res.body.proposedByPersonId).toBe(person.id);
    expect(res.body.communityId).toBe(a.id);
    expect(res.body.note).toBe('Ready for the next generation.');

    const list = await agent.get('/api/leader/organizational-leadership-recommendations');
    expect(list.body.items[0].generation).toBe(1);
  });

  it('a Leader can list their own recommendations, but not another Leader\'s', async () => {
    const hq = await makeCommunity('OrgRec Lifecycle HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Lifecycle HQ B - A', hq.id);
    const b = await makeCommunity('OrgRec Lifecycle HQ B - B', hq.id);
    const { agent: agentA, csrf: csrfA } = await setupCommunityLeader(21, a.id);
    const { agent: agentB, csrf: csrfB } = await setupCommunityLeader(22, b.id);
    const candidateA = await makePerson('+237987000017');
    await addActiveMember(candidateA.id, a.id);
    const candidateB = await makePerson('+237987000018');
    await addActiveMember(candidateB.id, b.id);

    await agentA.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrfA).send({ proposedPersonId: candidateA.id, communityId: a.id });
    await agentB.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrfB).send({ proposedPersonId: candidateB.id, communityId: b.id });

    const listA = await agentA.get('/api/leader/organizational-leadership-recommendations');
    expect(listA.body.items).toHaveLength(1);
    expect(listA.body.items[0].proposedPerson.id).toBe(candidateA.id);
  });

  it('the owner can withdraw their own pending recommendation', async () => {
    const hq = await makeCommunity('OrgRec Lifecycle HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Lifecycle HQ C - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(23, a.id);
    const candidate = await makePerson('+237987000019');
    await addActiveMember(candidate.id, a.id);

    const created = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });
    const res = await agent.post(`/api/leader/organizational-leadership-recommendations/${created.body.id}/withdraw`).set('X-CSRF-Token', csrf).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('WITHDRAWN');
  });

  it('a non-owner cannot withdraw another Leader\'s recommendation', async () => {
    const hq = await makeCommunity('OrgRec Lifecycle HQ D');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Lifecycle HQ D - A', hq.id);
    const b = await makeCommunity('OrgRec Lifecycle HQ D - B', hq.id);
    const { agent: agentA, csrf: csrfA } = await setupCommunityLeader(24, a.id);
    const { agent: agentB, csrf: csrfB } = await setupCommunityLeader(25, b.id);
    const candidate = await makePerson('+237987000020');
    await addActiveMember(candidate.id, a.id);

    const created = await agentA.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrfA).send({ proposedPersonId: candidate.id, communityId: a.id });
    const res = await agentB.post(`/api/leader/organizational-leadership-recommendations/${created.body.id}/withdraw`).set('X-CSRF-Token', csrfB).send({});
    expect(res.status).toBe(404);
  });

  it('an invalid lifecycle transition (withdrawing an already-decided recommendation) is rejected', async () => {
    const hq = await makeCommunity('OrgRec Lifecycle HQ E');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Lifecycle HQ E - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(26, a.id);
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-orgrec-lifecycle-e@test.local');
    const candidate = await makePerson('+237987000021');
    await addActiveMember(candidate.id, a.id);

    const created = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });
    await adminAgent.patch(`/api/admin/organizational-leadership-recommendations/${created.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({});

    const res = await agent.post(`/api/leader/organizational-leadership-recommendations/${created.body.id}/withdraw`).set('X-CSRF-Token', csrf).send({});
    expect(res.status).toBe(409);
  });
});

describe('Phase 2C — Admin review', () => {
  it('Admin can list all recommendations', async () => {
    const hq = await makeCommunity('OrgRec Admin HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Admin HQ A - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(27, a.id);
    const candidate = await makePerson('+237987000022');
    await addActiveMember(candidate.id, a.id);
    await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });

    const { agent: adminAgent } = await loginAsAdmin('admin-orgrec-list-a@test.local');
    const res = await adminAgent.get('/api/admin/organizational-leadership-recommendations');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items[0]).toHaveProperty('generation');
  });

  it('Admin can approve, recording decision metadata', async () => {
    const hq = await makeCommunity('OrgRec Admin HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Admin HQ B - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(28, a.id);
    const candidate = await makePerson('+237987000023');
    await addActiveMember(candidate.id, a.id);
    const created = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-orgrec-approve-b@test.local');
    const res = await adminAgent
      .patch(`/api/admin/organizational-leadership-recommendations/${created.body.id}/approve`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ decisionNote: 'Agreed — strong candidate.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.decisionNote).toBe('Agreed — strong candidate.');
    expect(res.body.decidedAt).toBeTruthy();
  });

  it('Admin can reject, recording decision metadata', async () => {
    const hq = await makeCommunity('OrgRec Admin HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Admin HQ C - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(29, a.id);
    const candidate = await makePerson('+237987000024');
    await addActiveMember(candidate.id, a.id);
    const created = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-orgrec-reject-c@test.local');
    const res = await adminAgent
      .patch(`/api/admin/organizational-leadership-recommendations/${created.body.id}/reject`)
      .set('X-CSRF-Token', adminCsrf)
      .send({ decisionNote: 'Not at this time.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.decisionNote).toBe('Not at this time.');
  });

  it('approval does not create a Community, a RoleAssignment, or modify the Community hierarchy', async () => {
    const hq = await makeCommunity('OrgRec Admin HQ D');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Admin HQ D - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(30, a.id);
    const candidate = await makePerson('+237987000025');
    await addActiveMember(candidate.id, a.id);
    const created = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });

    const communityCountBefore = await prisma.community.count();
    const roleCountBefore = await prisma.roleAssignment.count();
    const aBefore = await prisma.community.findUnique({ where: { id: a.id } });

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-orgrec-noeffect-d@test.local');
    await adminAgent.patch(`/api/admin/organizational-leadership-recommendations/${created.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({});

    expect(await prisma.community.count()).toBe(communityCountBefore);
    expect(await prisma.roleAssignment.count()).toBe(roleCountBefore);
    const aAfter = await prisma.community.findUnique({ where: { id: a.id } });
    expect(aAfter!.parentId).toBe(aBefore!.parentId);
  });

  it('rejection does not modify the Community hierarchy', async () => {
    const hq = await makeCommunity('OrgRec Admin HQ E');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Admin HQ E - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(31, a.id);
    const candidate = await makePerson('+237987000026');
    await addActiveMember(candidate.id, a.id);
    const created = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });

    const communityCountBefore = await prisma.community.count();
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-orgrec-noeffect-e@test.local');
    await adminAgent.patch(`/api/admin/organizational-leadership-recommendations/${created.body.id}/reject`).set('X-CSRF-Token', adminCsrf).send({});
    expect(await prisma.community.count()).toBe(communityCountBefore);
  });

  it('a non-Admin cannot approve or reject', async () => {
    const hq = await makeCommunity('OrgRec Admin HQ F');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Admin HQ F - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(32, a.id);
    const candidate = await makePerson('+237987000027');
    await addActiveMember(candidate.id, a.id);
    const created = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });

    const approve = await agent.patch(`/api/admin/organizational-leadership-recommendations/${created.body.id}/approve`).set('X-CSRF-Token', csrf).send({});
    expect(approve.status).toBe(403);
    const reject = await agent.patch(`/api/admin/organizational-leadership-recommendations/${created.body.id}/reject`).set('X-CSRF-Token', csrf).send({});
    expect(reject.status).toBe(403);
  });
});

describe('Phase 2C — separation from LeadershipProposal', () => {
  it('creating an organizational recommendation requires no geographyId and does not touch LeadershipProposal', async () => {
    const hq = await makeCommunity('OrgRec Separation HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Separation HQ A - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(33, a.id);
    const candidate = await makePerson('+237987000028');
    await addActiveMember(candidate.id, a.id);

    const before = await prisma.leadershipProposal.count();
    const res = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });
    expect(res.status).toBe(201);
    expect(await prisma.leadershipProposal.count()).toBe(before);
  });

  it('existing Geography LeadershipProposal creation still works unchanged', async () => {
    const geography = await makeGeography('OrgRec Separation Geography A');
    const { agent, csrf } = await setupGeographyOnlyLeader(50, geography.id);
    const candidate = await makePerson('+237987000029');
    await prisma.geographicAssignment.create({ data: { personId: candidate.id, geographyId: geography.id, status: 'ACTIVE' } });

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: geography.id });
    expect(res.status).toBe(201);
  });

  it('an organizational recommendation never modifies Geography leadership', async () => {
    const hq = await makeCommunity('OrgRec Separation HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Separation HQ B - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(34, a.id);
    const candidate = await makePerson('+237987000030');
    await addActiveMember(candidate.id, a.id);

    const geoRolesBefore = await prisma.roleAssignment.count({ where: { geographyId: { not: null } } });
    await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });
    expect(await prisma.roleAssignment.count({ where: { geographyId: { not: null } } })).toBe(geoRolesBefore);
  });
});

describe('Phase 2C — administrative isolation', () => {
  it('recommendation authorization does not grant Community administration', async () => {
    const hq = await makeCommunity('OrgRec Isolation HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Isolation HQ A - A', hq.id);
    const b = await makeCommunity('OrgRec Isolation HQ A - B', hq.id);
    const { person: personA } = await setupCommunityLeader(35, a.id);
    await setupCommunityLeader(36, b.id);

    expect(await isCommunityAdministrator(personA.id, b.id)).toBe(false);
    expect(await findActiveScopedRole(personA.id, 'COMMUNITY', b.id)).toBeNull();
  });

  it('existing isCommunityAdministrator behavior remains unchanged', async () => {
    const hq = await makeCommunity('OrgRec Isolation HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Isolation HQ B - A', hq.id);
    const { person } = await setupCommunityLeader(37, a.id);
    expect(await isCommunityAdministrator(person.id, a.id)).toBe(true);
  });

  it('existing hasConversationAccess (Community Conversation) behavior remains unchanged', async () => {
    const hq = await makeCommunity('OrgRec Isolation HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Isolation HQ C - A', hq.id);
    const b = await makeCommunity('OrgRec Isolation HQ C - B', hq.id);
    const { person: personA } = await setupCommunityLeader(38, a.id);
    await setupCommunityLeader(39, b.id);
    expect(await hasConversationAccess(personA.id, b.id)).toBe(false);
  });

  it('same-generation Leadership Collaboration eligibility remains communication-only and irrelevant to recommendation authorization', async () => {
    const hq = await makeCommunity('OrgRec Isolation HQ D');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Isolation HQ D - A', hq.id);
    const b = await makeCommunity('OrgRec Isolation HQ D - B', hq.id);
    const { agent: agentA, csrf: csrfA } = await setupCommunityLeader(40, a.id);
    const { person: personB } = await setupCommunityLeader(41, b.id);
    await addActiveMember(personB.id, b.id);

    // A and B are same-generation Leadership Collaboration peers (both
    // gen 1 under the same Headquarters), yet A still cannot recommend
    // anchored to B's Community.
    const res = await agentA
      .post('/api/leader/organizational-leadership-recommendations')
      .set('X-CSRF-Token', csrfA)
      .send({ proposedPersonId: personB.id, communityId: b.id });
    expect(res.status).toBe(403);
  });
});

describe('Phase 2C — duplicate/lifecycle rules', () => {
  it('a duplicate pending recommendation for the same proposer+candidate+Community returns 409', async () => {
    const hq = await makeCommunity('OrgRec Duplicate HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Duplicate HQ A - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(42, a.id);
    const candidate = await makePerson('+237987000031');
    await addActiveMember(candidate.id, a.id);

    const first = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });
    expect(first.status).toBe(201);
    const second = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });
    expect(second.status).toBe(409);
  });

  it('a historical WITHDRAWN recommendation does not prevent a new one for the same triple', async () => {
    const hq = await makeCommunity('OrgRec Duplicate HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Duplicate HQ B - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(43, a.id);
    const candidate = await makePerson('+237987000032');
    await addActiveMember(candidate.id, a.id);

    const first = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });
    await agent.post(`/api/leader/organizational-leadership-recommendations/${first.body.id}/withdraw`).set('X-CSRF-Token', csrf).send({});

    const second = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });
    expect(second.status).toBe(201);
  });

  it('a historical APPROVED recommendation does not prevent a new one for the same triple', async () => {
    const hq = await makeCommunity('OrgRec Duplicate HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Duplicate HQ C - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(44, a.id);
    const candidate = await makePerson('+237987000033');
    await addActiveMember(candidate.id, a.id);

    const first = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-orgrec-dup-approved@test.local');
    await adminAgent.patch(`/api/admin/organizational-leadership-recommendations/${first.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({});

    const second = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });
    expect(second.status).toBe(201);
  });
});

describe('Phase 2C — data minimization', () => {
  it('Leader list responses contain no prohibited sensitive Person fields', async () => {
    const hq = await makeCommunity('OrgRec Data HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Data HQ A - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(45, a.id);
    const candidate = await makePerson('+237987000034');
    await addActiveMember(candidate.id, a.id);
    await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });

    const res = await agent.get('/api/leader/organizational-leadership-recommendations');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/whatsapp/i);
    expect(serialized).not.toMatch(/\bemail\b/i);
  });

  it('Admin responses contain only necessary recommendation/reviewer data', async () => {
    const hq = await makeCommunity('OrgRec Data HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec Data HQ B - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(46, a.id);
    const candidate = await makePerson('+237987000035');
    await addActiveMember(candidate.id, a.id);
    await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });

    const { agent: adminAgent } = await loginAsAdmin('admin-orgrec-data-b@test.local');
    const res = await adminAgent.get('/api/admin/organizational-leadership-recommendations');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/whatsapp/i);
  });
});

describe('Phase 2C — security / no unintended writes', () => {
  it('an unauthorized create performs no write', async () => {
    const hq = await makeCommunity('OrgRec NoWrite HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec NoWrite HQ A - A', hq.id);
    const b = await makeCommunity('OrgRec NoWrite HQ A - B', hq.id);
    const { agent, csrf } = await setupCommunityLeader(47, a.id);
    const candidate = await makePerson('+237987000036');
    await addActiveMember(candidate.id, b.id);

    const before = await prisma.organizationalLeadershipRecommendation.count();
    await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: b.id });
    expect(await prisma.organizationalLeadershipRecommendation.count()).toBe(before);
  });

  it('an unauthorized withdraw performs no write', async () => {
    const hq = await makeCommunity('OrgRec NoWrite HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec NoWrite HQ B - A', hq.id);
    const b = await makeCommunity('OrgRec NoWrite HQ B - B', hq.id);
    const { agent: agentA, csrf: csrfA } = await setupCommunityLeader(48, a.id);
    const { agent: agentB, csrf: csrfB } = await setupCommunityLeader(49, b.id);
    const candidate = await makePerson('+237987000037');
    await addActiveMember(candidate.id, a.id);

    const created = await agentA.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrfA).send({ proposedPersonId: candidate.id, communityId: a.id });
    await agentB.post(`/api/leader/organizational-leadership-recommendations/${created.body.id}/withdraw`).set('X-CSRF-Token', csrfB).send({});

    const stillProposed = await prisma.organizationalLeadershipRecommendation.findUnique({ where: { id: created.body.id } });
    expect(stillProposed!.status).toBe('PROPOSED');
  });

  it('an unauthorized approve/reject performs no write', async () => {
    const hq = await makeCommunity('OrgRec NoWrite HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec NoWrite HQ C - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(51, a.id);
    const candidate = await makePerson('+237987000038');
    await addActiveMember(candidate.id, a.id);
    const created = await agent.post('/api/leader/organizational-leadership-recommendations').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, communityId: a.id });

    await agent.patch(`/api/admin/organizational-leadership-recommendations/${created.body.id}/approve`).set('X-CSRF-Token', csrf).send({});
    const stillProposed = await prisma.organizationalLeadershipRecommendation.findUnique({ where: { id: created.body.id } });
    expect(stillProposed!.status).toBe('PROPOSED');
  });

  it('CSRF protection is enforced on create', async () => {
    const hq = await makeCommunity('OrgRec NoWrite HQ D');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec NoWrite HQ D - A', hq.id);
    const { agent } = await setupCommunityLeader(52, a.id);
    const candidate = await makePerson('+237987000039');
    await addActiveMember(candidate.id, a.id);

    const res = await agent.post('/api/leader/organizational-leadership-recommendations').send({ proposedPersonId: candidate.id, communityId: a.id });
    expect(res.status).toBe(403);
  });

  it('the dedicated leadershipMutationLimiter is reused (no dedicated new limiter), and GET remains read-only', async () => {
    const hq = await makeCommunity('OrgRec NoWrite HQ E');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('OrgRec NoWrite HQ E - A', hq.id);
    const { agent } = await setupCommunityLeader(53, a.id);

    const before = await prisma.organizationalLeadershipRecommendation.count();
    await agent.get('/api/leader/organizational-leadership-recommendations');
    expect(await prisma.organizationalLeadershipRecommendation.count()).toBe(before);
  });
});
