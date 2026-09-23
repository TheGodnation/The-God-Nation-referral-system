import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Phase 3L — Geographical Leadership Recommendation/Proposal workflow.
// Mirrors the exact conventions established in leaderRosterGeographyDescendant.test.ts
// (Phase 3K): agentWithUniqueIp, setupScopedLeader, buildChain.

const app = createApp();

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

async function makePerson(whatsappNumber: string, name = 'Proposal Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeGeography(name: string, type = 'REGION', countryCode = 'CM', parentId?: string) {
  return prisma.geography.create({ data: { name, type, countryCode, parentId: parentId ?? null } });
}

async function assignGeo(personId: string, geographyId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  return prisma.geographicAssignment.create({ data: { personId, geographyId, status } });
}

async function setupScopedLeader(n: number, geographyId: string) {
  const email = `leader-prop${n}@test.local`;
  const { user } = await createLeader(`Proposal Leader ${n}`, email, `PR${n}CODE`);
  const person = await makePerson(`+237695${String(n).padStart(6, '0')}`, `Proposal Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, geographyId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

async function loginAsAdmin(email: string, password = 'AdminPass123!') {
  await createAdmin(email, password);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

function extractToken(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

async function loginAsMember(whatsapp: string, email: string, name = 'Proposal Member Person') {
  await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const requestAgent = agentWithUniqueIp();
  const { csrf: requestCsrf } = await bootstrap(requestAgent as any);
  await requestAgent.post('/api/member/auth/request-link').set('X-CSRF-Token', requestCsrf).send({ whatsapp, email });
  const link = spy.mock.calls[0][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: extractToken(link) });
  return { agent, csrf };
}

/** Builds one full World -> Continent -> Country -> Region -> Division ->
 * Sub-Division -> Village chain, with a distinct suffix so parallel tests
 * never collide. */
async function buildChain(suffix: string) {
  const world = await makeGeography(`World ${suffix}`, 'WORLD', 'CM');
  const continent = await makeGeography(`Continent ${suffix}`, 'CONTINENT', 'CM', world.id);
  const country = await makeGeography(`Country ${suffix}`, 'COUNTRY', 'CM', continent.id);
  const region = await makeGeography(`Region ${suffix}`, 'REGION', 'CM', country.id);
  const division = await makeGeography(`Division ${suffix}`, 'DIVISION', 'CM', region.id);
  const subdivision = await makeGeography(`SubDivision ${suffix}`, 'SUBDIVISION', 'CM', division.id);
  const village = await makeGeography(`Village ${suffix}`, 'VILLAGE', 'CM', subdivision.id);
  return { world, continent, country, region, division, subdivision, village };
}

describe('Phase 3L — POST /api/leader/leadership-proposals — creation', () => {
  it('1-2. authorized Leader creates a valid proposal for their own Geography', async () => {
    const chain = await buildChain('A1');
    const { agent, csrf } = await setupScopedLeader(1, chain.village.id);
    const candidate = await makePerson('+237696000001');
    await assignGeo(candidate.id, chain.village.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: chain.village.id, note: 'Faithful and reliable.' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PROPOSED');
    expect(res.body.proposedPersonId).toBe(candidate.id);
    expect(res.body.geographyId).toBe(chain.village.id);
  });

  it('3-5. a descendant Geography proposal succeeds when the candidate is in that descendant', async () => {
    const chain = await buildChain('A2');
    const { agent, csrf } = await setupScopedLeader(2, chain.region.id);
    const candidate = await makePerson('+237696000002');
    await assignGeo(candidate.id, chain.village.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: chain.region.id });

    expect(res.status).toBe(201);
  });

  it('6. a candidate outside the target Geography is rejected', async () => {
    const chain = await buildChain('A3');
    const otherChain = await buildChain('A3b');
    const { agent, csrf } = await setupScopedLeader(3, chain.region.id);
    const candidate = await makePerson('+237696000003');
    await assignGeo(candidate.id, otherChain.village.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: chain.region.id });

    expect(res.status).toBe(400);
  });

  it('7. a target geography outside the Leader territory is rejected', async () => {
    const chain = await buildChain('A4');
    const otherChain = await buildChain('A4b');
    const { agent, csrf } = await setupScopedLeader(4, chain.region.id);
    const candidate = await makePerson('+237696000004');
    await assignGeo(candidate.id, otherChain.village.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: otherChain.region.id });

    expect(res.status).toBe(403);
  });

  it('8. an ancestor-direction proposal is rejected (Village leader cannot propose for their parent Sub-Division)', async () => {
    const chain = await buildChain('A5');
    const { agent, csrf } = await setupScopedLeader(5, chain.village.id);
    const candidate = await makePerson('+237696000005');
    await assignGeo(candidate.id, chain.subdivision.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: chain.subdivision.id });

    expect(res.status).toBe(403);
  });

  it('9. a sibling geography proposal is rejected', async () => {
    const chain = await buildChain('A6');
    const siblingDivision = await makeGeography('Sibling Division A6', 'DIVISION', 'CM', chain.region.id);
    const { agent, csrf } = await setupScopedLeader(6, chain.division.id);
    const candidate = await makePerson('+237696000006');
    await assignGeo(candidate.id, siblingDivision.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: siblingDivision.id });

    expect(res.status).toBe(403);
  });

  it('10. a cross-country geography proposal is rejected', async () => {
    const chain = await buildChain('A7');
    const otherChain = await buildChain('A7b');
    const { agent, csrf } = await setupScopedLeader(7, chain.country.id);
    const candidate = await makePerson('+237696000007');
    await assignGeo(candidate.id, otherChain.country.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: otherChain.country.id });

    expect(res.status).toBe(403);
  });

  it('11. a nonexistent candidate is rejected', async () => {
    const chain = await buildChain('A8');
    const { agent, csrf } = await setupScopedLeader(8, chain.village.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: 'nonexistent-person-id', geographyId: chain.village.id });

    expect(res.status).toBe(400);
  });

  it('12. a nonexistent geography is rejected', async () => {
    const chain = await buildChain('A9');
    const { agent, csrf } = await setupScopedLeader(9, chain.village.id);
    const candidate = await makePerson('+237696000009');
    await assignGeo(candidate.id, chain.village.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: 'nonexistent-geography-id' });

    expect(res.status).toBe(403);
  });

  it('13. self-proposal is rejected', async () => {
    const chain = await buildChain('A10');
    const { agent, csrf, person } = await setupScopedLeader(10, chain.village.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: person.id, geographyId: chain.village.id });

    expect(res.status).toBe(400);
  });

  it('14. a candidate already an ACTIVE leader for the exact same Geography is rejected as redundant', async () => {
    const chain = await buildChain('A11');
    const { agent, csrf } = await setupScopedLeader(11, chain.region.id);
    const candidate = await makePerson('+237696000011');
    await assignGeo(candidate.id, chain.village.id);
    const { user: candidateUser } = await createLeader('Existing Village Leader A11', 'leader-existing-a11@test.local', 'EXA11');
    await prisma.roleAssignment.create({
      data: { personId: candidate.id, roleType: 'SCOPED_LEADER', assignedByUserId: candidateUser.id, geographyId: chain.village.id },
    });

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: chain.village.id });

    expect(res.status).toBe(400);
  });

  it('15. a candidate who already leads a different Geography may still be proposed', async () => {
    const chain = await buildChain('A12');
    const otherChain = await buildChain('A12b');
    const { agent, csrf } = await setupScopedLeader(12, chain.region.id);
    const candidate = await makePerson('+237696000012');
    await assignGeo(candidate.id, chain.village.id);
    const { user: candidateUser } = await createLeader('Elsewhere Leader A12', 'leader-elsewhere-a12@test.local', 'ELA12');
    await prisma.roleAssignment.create({
      data: { personId: candidate.id, roleType: 'SCOPED_LEADER', assignedByUserId: candidateUser.id, geographyId: otherChain.village.id },
    });

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: chain.region.id });

    expect(res.status).toBe(201);
  });

  it('16. no CommunityMembership does not block a valid proposal', async () => {
    const chain = await buildChain('A13');
    const { agent, csrf } = await setupScopedLeader(13, chain.village.id);
    const candidate = await makePerson('+237696000013');
    await assignGeo(candidate.id, chain.village.id);
    const memberships = await prisma.communityMembership.count({ where: { personId: candidate.id } });
    expect(memberships).toBe(0);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: chain.village.id });

    expect(res.status).toBe(201);
  });
});

describe('Phase 3L — POST /api/leader/leadership-proposals — identity/security', () => {
  it('17. a client-supplied proposer identity cannot impersonate another Leader', async () => {
    const chain = await buildChain('B1');
    const { agent, csrf } = await setupScopedLeader(14, chain.village.id);
    const { person: otherPerson } = await setupScopedLeader(15, chain.village.id);
    const candidate = await makePerson('+237696000014');
    await assignGeo(candidate.id, chain.village.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: chain.village.id, proposedByPersonId: otherPerson.id });

    expect(res.status).toBe(201);
    expect(res.body.proposedByPersonId).not.toBe(otherPerson.id);
  });

  it('18. the candidate\'s real GeographicAssignment controls authorization, not any client-supplied value', async () => {
    const chain = await buildChain('B2');
    const { agent, csrf } = await setupScopedLeader(16, chain.village.id);
    const candidate = await makePerson('+237696000015');
    await assignGeo(candidate.id, chain.village.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: chain.village.id, candidateGeographyId: 'irrelevant-forged-id' });

    expect(res.status).toBe(201);
  });

  it('19. an ENDED Leader RoleAssignment cannot authorize a proposal', async () => {
    const chain = await buildChain('B3');
    const { agent, csrf, person } = await setupScopedLeader(17, chain.village.id);
    await prisma.roleAssignment.updateMany({
      where: { personId: person.id, geographyId: chain.village.id },
      data: { status: 'ENDED', endedAt: new Date() },
    });
    const candidate = await makePerson('+237696000016');
    await assignGeo(candidate.id, chain.village.id);

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: chain.village.id });

    expect(res.status).toBe(403);
  });

  it('20. an unlinked Leader receives the existing unlinked-Leader response', async () => {
    const chain = await buildChain('B4');
    const { user } = await createLeader('Unlinked Proposal Leader', 'leader-prop-unlinked@test.local', 'PRUNLINKED');
    void user;
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'leader-prop-unlinked@test.local', password: 'password123' });

    const res = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: 'whoever', geographyId: chain.village.id });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not yet linked to a Person/);
  });
});

describe('Phase 3L — duplicate/historical proposals', () => {
  it('21. a duplicate pending proposal for the same candidate+geography returns 409', async () => {
    const chain = await buildChain('C1');
    const { agent, csrf } = await setupScopedLeader(18, chain.village.id);
    const candidate = await makePerson('+237696000017');
    await assignGeo(candidate.id, chain.village.id);

    const first = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: chain.village.id });
    expect(first.status).toBe(201);

    const second = await agent
      .post('/api/leader/leadership-proposals')
      .set('X-CSRF-Token', csrf)
      .send({ proposedPersonId: candidate.id, geographyId: chain.village.id });
    expect(second.status).toBe(409);
  });

  it('22-24. a historical APPROVED/REJECTED/WITHDRAWN proposal does not prevent a new one', async () => {
    const chain = await buildChain('C2');
    const { agent, csrf } = await setupScopedLeader(19, chain.village.id);
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-prop-c2@test.local');
    const candidate = await makePerson('+237696000018');
    await assignGeo(candidate.id, chain.village.id);

    const approved = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });
    await adminAgent.patch(`/api/admin/leadership-proposals/${approved.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({});

    const second = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });
    expect(second.status).toBe(201);

    await adminAgent.patch(`/api/admin/leadership-proposals/${second.body.id}/reject`).set('X-CSRF-Token', adminCsrf).send({});
    const third = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });
    expect(third.status).toBe(201);

    await agent.post(`/api/leader/leadership-proposals/${third.body.id}/withdraw`).set('X-CSRF-Token', csrf).send({});
    const fourth = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });
    expect(fourth.status).toBe(201);
  });
});

describe('Phase 3L — GET /api/leader/leadership-proposals — ownership', () => {
  it('25-26. a Leader sees only their own proposals, never another Leader\'s', async () => {
    const chain = await buildChain('D1');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(20, chain.village.id);
    const { agent: agentB } = await setupScopedLeader(21, chain.village.id);
    const candidate = await makePerson('+237696000019');
    await assignGeo(candidate.id, chain.village.id);
    await agentA.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrfA).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });

    const listA = await agentA.get('/api/leader/leadership-proposals');
    expect(listA.status).toBe(200);
    expect(listA.body.items.length).toBe(1);

    const listB = await agentB.get('/api/leader/leadership-proposals');
    expect(listB.status).toBe(200);
    expect(listB.body.items.length).toBe(0);
  });
});

describe('Phase 3L — POST /api/leader/leadership-proposals/:id/withdraw', () => {
  it('27. the owner can withdraw their own pending proposal', async () => {
    const chain = await buildChain('E1');
    const { agent, csrf } = await setupScopedLeader(22, chain.village.id);
    const candidate = await makePerson('+237696000020');
    await assignGeo(candidate.id, chain.village.id);
    const created = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });

    const res = await agent.post(`/api/leader/leadership-proposals/${created.body.id}/withdraw`).set('X-CSRF-Token', csrf).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('WITHDRAWN');
  });

  it('28. a non-owner cannot withdraw another Leader\'s proposal', async () => {
    const chain = await buildChain('E2');
    const { agent: agentA, csrf: csrfA } = await setupScopedLeader(23, chain.village.id);
    const { agent: agentB, csrf: csrfB } = await setupScopedLeader(24, chain.village.id);
    const candidate = await makePerson('+237696000021');
    await assignGeo(candidate.id, chain.village.id);
    const created = await agentA.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrfA).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });

    const res = await agentB.post(`/api/leader/leadership-proposals/${created.body.id}/withdraw`).set('X-CSRF-Token', csrfB).send({});
    expect(res.status).toBe(404);
  });

  it('29-30. an APPROVED or REJECTED proposal cannot be withdrawn', async () => {
    const chain = await buildChain('E3');
    const { agent, csrf } = await setupScopedLeader(25, chain.village.id);
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-prop-e3@test.local');
    const candidateA = await makePerson('+237696000022');
    await assignGeo(candidateA.id, chain.village.id);
    const candidateB = await makePerson('+237696000023');
    await assignGeo(candidateB.id, chain.village.id);

    const approved = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidateA.id, geographyId: chain.village.id });
    await adminAgent.patch(`/api/admin/leadership-proposals/${approved.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({});
    const withdrawApproved = await agent.post(`/api/leader/leadership-proposals/${approved.body.id}/withdraw`).set('X-CSRF-Token', csrf).send({});
    expect(withdrawApproved.status).toBe(409);

    const rejected = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidateB.id, geographyId: chain.village.id });
    await adminAgent.patch(`/api/admin/leadership-proposals/${rejected.body.id}/reject`).set('X-CSRF-Token', adminCsrf).send({});
    const withdrawRejected = await agent.post(`/api/leader/leadership-proposals/${rejected.body.id}/withdraw`).set('X-CSRF-Token', csrf).send({});
    expect(withdrawRejected.status).toBe(409);
  });

  it('31. an already-withdrawn proposal cannot be withdrawn again', async () => {
    const chain = await buildChain('E4');
    const { agent, csrf } = await setupScopedLeader(26, chain.village.id);
    const candidate = await makePerson('+237696000024');
    await assignGeo(candidate.id, chain.village.id);
    const created = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });
    await agent.post(`/api/leader/leadership-proposals/${created.body.id}/withdraw`).set('X-CSRF-Token', csrf).send({});

    const res = await agent.post(`/api/leader/leadership-proposals/${created.body.id}/withdraw`).set('X-CSRF-Token', csrf).send({});
    expect(res.status).toBe(409);
  });
});

describe('Phase 3L — Admin review', () => {
  it('32. Admin can list proposals', async () => {
    const chain = await buildChain('F1');
    const { agent, csrf } = await setupScopedLeader(27, chain.village.id);
    const candidate = await makePerson('+237696000025');
    await assignGeo(candidate.id, chain.village.id);
    await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });

    const { agent: adminAgent } = await loginAsAdmin('admin-prop-f1@test.local');
    const res = await adminAgent.get('/api/admin/leadership-proposals');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(1);
  });

  it('33. Admin can approve a pending proposal', async () => {
    const chain = await buildChain('F2');
    const { agent, csrf } = await setupScopedLeader(28, chain.village.id);
    const candidate = await makePerson('+237696000026');
    await assignGeo(candidate.id, chain.village.id);
    const created = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-prop-f2@test.local');
    const res = await adminAgent.patch(`/api/admin/leadership-proposals/${created.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({ decisionNote: 'Confirmed with local pastor.' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('APPROVED');
    expect(res.body.decisionNote).toBe('Confirmed with local pastor.');
    expect(res.body.decidedByUser.id).toBeTruthy();
  });

  it('34. Admin can reject a pending proposal', async () => {
    const chain = await buildChain('F3');
    const { agent, csrf } = await setupScopedLeader(29, chain.village.id);
    const candidate = await makePerson('+237696000027');
    await assignGeo(candidate.id, chain.village.id);
    const created = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-prop-f3@test.local');
    const res = await adminAgent.patch(`/api/admin/leadership-proposals/${created.body.id}/reject`).set('X-CSRF-Token', adminCsrf).send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REJECTED');
  });

  it('35-36. a non-Admin (Leader or Member) cannot approve or reject', async () => {
    const chain = await buildChain('F4');
    const { agent, csrf } = await setupScopedLeader(30, chain.village.id);
    const candidate = await makePerson('+237696000028');
    await assignGeo(candidate.id, chain.village.id);
    const created = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });

    const leaderApprove = await agent.patch(`/api/admin/leadership-proposals/${created.body.id}/approve`).set('X-CSRF-Token', csrf).send({});
    expect(leaderApprove.status).toBe(403);
    const leaderReject = await agent.patch(`/api/admin/leadership-proposals/${created.body.id}/reject`).set('X-CSRF-Token', csrf).send({});
    expect(leaderReject.status).toBe(403);

    const { agent: memberAgent, csrf: memberCsrf } = await loginAsMember('+237696100028', 'member-prop-f4@test.local');
    const memberApprove = await memberAgent.patch(`/api/admin/leadership-proposals/${created.body.id}/approve`).set('X-CSRF-Token', memberCsrf).send({});
    expect(memberApprove.status).toBe(401);
    const memberList = await memberAgent.get('/api/admin/leadership-proposals');
    expect(memberList.status).toBe(401);
  });

  it('37-39. a decided proposal cannot be approved again, rejected again, or switch decision', async () => {
    const chain = await buildChain('F5');
    const { agent, csrf } = await setupScopedLeader(31, chain.village.id);
    const candidateA = await makePerson('+237696000029');
    await assignGeo(candidateA.id, chain.village.id);
    const candidateB = await makePerson('+237696000030');
    await assignGeo(candidateB.id, chain.village.id);
    const createdA = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidateA.id, geographyId: chain.village.id });
    const createdB = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidateB.id, geographyId: chain.village.id });

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-prop-f5@test.local');
    await adminAgent.patch(`/api/admin/leadership-proposals/${createdA.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({});
    const reApprove = await adminAgent.patch(`/api/admin/leadership-proposals/${createdA.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({});
    expect(reApprove.status).toBe(409);
    const switchToReject = await adminAgent.patch(`/api/admin/leadership-proposals/${createdA.body.id}/reject`).set('X-CSRF-Token', adminCsrf).send({});
    expect(switchToReject.status).toBe(409);

    await adminAgent.patch(`/api/admin/leadership-proposals/${createdB.body.id}/reject`).set('X-CSRF-Token', adminCsrf).send({});
    const reReject = await adminAgent.patch(`/api/admin/leadership-proposals/${createdB.body.id}/reject`).set('X-CSRF-Token', adminCsrf).send({});
    expect(reReject.status).toBe(409);
  });
});

describe('Phase 3L — appointment separation', () => {
  it('40-42. proposal creation, approval, and rejection never change RoleAssignment row count', async () => {
    const chain = await buildChain('G1');
    const { agent, csrf } = await setupScopedLeader(32, chain.village.id);
    const candidateA = await makePerson('+237696000031');
    await assignGeo(candidateA.id, chain.village.id);
    const candidateB = await makePerson('+237696000032');
    await assignGeo(candidateB.id, chain.village.id);

    const beforeCreate = await prisma.roleAssignment.count();
    const createdA = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidateA.id, geographyId: chain.village.id });
    const createdB = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidateB.id, geographyId: chain.village.id });
    const afterCreate = await prisma.roleAssignment.count();
    expect(afterCreate).toBe(beforeCreate);

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-prop-g1@test.local');
    await adminAgent.patch(`/api/admin/leadership-proposals/${createdA.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({});
    const afterApprove = await prisma.roleAssignment.count();
    expect(afterApprove).toBe(beforeCreate);

    await adminAgent.patch(`/api/admin/leadership-proposals/${createdB.body.id}/reject`).set('X-CSRF-Token', adminCsrf).send({});
    const afterReject = await prisma.roleAssignment.count();
    expect(afterReject).toBe(beforeCreate);
  });

  it('43. the existing Admin appointment endpoint (POST /api/admin/role-assignments) still works unchanged', async () => {
    const chain = await buildChain('G2');
    const candidate = await makePerson('+237696000033');
    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-prop-g2@test.local');

    const res = await adminAgent
      .post('/api/admin/role-assignments')
      .set('X-CSRF-Token', adminCsrf)
      .send({ personId: candidate.id, roleType: 'SCOPED_LEADER', geographyId: chain.village.id });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ACTIVE');
  });

  it('44. approving a proposal for a candidate does not itself create any RoleAssignment for that candidate', async () => {
    const chain = await buildChain('G3');
    const { agent, csrf } = await setupScopedLeader(33, chain.village.id);
    const candidate = await makePerson('+237696000034');
    await assignGeo(candidate.id, chain.village.id);
    const created = await agent.post('/api/leader/leadership-proposals').set('X-CSRF-Token', csrf).send({ proposedPersonId: candidate.id, geographyId: chain.village.id });

    const { agent: adminAgent, csrf: adminCsrf } = await loginAsAdmin('admin-prop-g3@test.local');
    await adminAgent.patch(`/api/admin/leadership-proposals/${created.body.id}/approve`).set('X-CSRF-Token', adminCsrf).send({});

    const candidateRoles = await prisma.roleAssignment.findMany({ where: { personId: candidate.id } });
    expect(candidateRoles.length).toBe(0);
  });
});
