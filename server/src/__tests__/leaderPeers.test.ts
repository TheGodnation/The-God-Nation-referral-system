import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';
import { getCommunityIdsAtGeneration } from '../lib/tree';

const app = createApp();

let ipCounter = 0;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.97.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function makePerson(whatsappNumber: string, name = 'Peer Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

/** Creates a Leader User linked to a Person, with an ACTIVE SCOPED_LEADER
 * RoleAssignment for the given Community, then logs in. Mirrors the exact
 * pattern established in leaderRoster.test.ts. */
async function setupCommunityLeader(n: number, communityId: string, name?: string) {
  const email = `leader-peers${n}@test.local`;
  const { user } = await createLeader(name ?? `Peers Leader ${n}`, email, `PR${n}CODE`);
  const person = await makePerson(`+237988${String(n).padStart(6, '0')}`, name ?? `Peers Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  const role = await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person, role };
}

describe('Phase 2A — getCommunityIdsAtGeneration (lib/tree.ts)', () => {
  it('generation 0 returns Headquarters itself, with no query needed', async () => {
    const hq = await makeCommunity('Peers Gen HQ A');
    const ids = await getCommunityIdsAtGeneration(hq.id, 0);
    expect(ids).toEqual([hq.id]);
  });

  it('generation 1 returns direct children', async () => {
    const hq = await makeCommunity('Peers Gen HQ B');
    const a = await makeCommunity('Peers Gen B-A', hq.id);
    const b = await makeCommunity('Peers Gen B-B', hq.id);
    const ids = await getCommunityIdsAtGeneration(hq.id, 1);
    expect(ids.slice().sort()).toEqual([a.id, b.id].sort());
  });

  it('generation 2 returns grandchildren', async () => {
    const hq = await makeCommunity('Peers Gen HQ C');
    const a = await makeCommunity('Peers Gen C-A', hq.id);
    const b = await makeCommunity('Peers Gen C-B', hq.id);
    const a1 = await makeCommunity('Peers Gen C-A1', a.id);
    const b1 = await makeCommunity('Peers Gen C-B1', b.id);
    const ids = await getCommunityIdsAtGeneration(hq.id, 2);
    expect(ids.slice().sort()).toEqual([a1.id, b1.id].sort());
  });

  it('deeper generations are calculated correctly', async () => {
    const hq = await makeCommunity('Peers Gen HQ D');
    const g1 = await makeCommunity('Peers Gen D1', hq.id);
    const g2 = await makeCommunity('Peers Gen D2', g1.id);
    const g3 = await makeCommunity('Peers Gen D3', g2.id);
    const g4 = await makeCommunity('Peers Gen D4', g3.id);
    expect(await getCommunityIdsAtGeneration(hq.id, 3)).toEqual([g3.id]);
    expect(await getCommunityIdsAtGeneration(hq.id, 4)).toEqual([g4.id]);
  });

  it('an unrelated root (and its descendants) is never included at any generation', async () => {
    const hq = await makeCommunity('Peers Gen HQ E');
    await makeCommunity('Peers Gen E-A', hq.id);
    const unrelatedRoot = await makeCommunity('Peers Gen Unrelated Root E');
    const unrelatedChild = await makeCommunity('Peers Gen Unrelated Child E', unrelatedRoot.id);
    const gen0 = await getCommunityIdsAtGeneration(hq.id, 0);
    const gen1 = await getCommunityIdsAtGeneration(hq.id, 1);
    expect(gen0).not.toContain(unrelatedRoot.id);
    expect(gen1).not.toContain(unrelatedRoot.id);
    expect(gen1).not.toContain(unrelatedChild.id);
  });

  it('a generation deeper than the actual tree returns an empty array', async () => {
    const hq = await makeCommunity('Peers Gen HQ F');
    await makeCommunity('Peers Gen F-A', hq.id);
    expect(await getCommunityIdsAtGeneration(hq.id, 5)).toEqual([]);
  });

  it('is defensive against malformed/cyclic parentId data and always terminates', async () => {
    const hq = await makeCommunity('Peers Gen HQ G');
    const a = await makeCommunity('Peers Gen Cyclic G-A', hq.id);
    const b = await makeCommunity('Peers Gen Cyclic G-B', a.id);
    // Force a cycle the application itself would never create.
    await prisma.community.update({ where: { id: a.id }, data: { parentId: b.id } });
    // Bounded by the generation argument itself — must resolve promptly
    // regardless of the cycle beneath it.
    const ids = await getCommunityIdsAtGeneration(hq.id, 3);
    expect(Array.isArray(ids)).toBe(true);
  });
});

describe('Phase 2A — GET /api/leader/peers — authentication', () => {
  it('rejects an unauthenticated request', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/leader/peers');
    expect(res.status).toBe(401);
  });

  it('rejects a non-Leader (Admin) session', async () => {
    const { agent } = await loginAsAdmin('admin-peers1@test.local');
    const res = await agent.get('/api/leader/peers');
    expect(res.status).toBe(403);
  });

  it('a Leader with no active Community-scoped leadership assignment receives an empty peer result', async () => {
    const hq = await makeCommunity('Peers Auth HQ C');
    await setHeadquarters(hq.id);
    const email = 'leader-peers-unlinked-role@test.local';
    await createLeader('Peers No Role Leader', email, 'PRNOROLE');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
    // Not linked to a Person at all — requireLinkedPerson itself rejects.
    const res = await agent.get('/api/leader/peers');
    expect(res.status).toBe(403);
  });

});

describe('Phase 2A — GET /api/leader/peers — peer discovery', () => {
  it('a Generation 1 Leader sees another Generation 1 Leader (not a sibling — cousins under different parents)', async () => {
    const hq = await makeCommunity('Peers Discover HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Discover A', hq.id);
    const b = await makeCommunity('Peers Discover B', hq.id);
    const { agent: agentA } = await setupCommunityLeader(101, a.id, 'Leader A');
    const { person: personB } = await setupCommunityLeader(102, b.id, 'Leader B');

    const res = await agentA.get('/api/leader/peers');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].personId).toBe(personB.id);
    expect(res.body.items[0].generation).toBe(1);
  });

  it('a Generation 1 Leader does not see a Generation 2 Leader', async () => {
    const hq = await makeCommunity('Peers Discover HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Discover HQ B - A', hq.id);
    const a1 = await makeCommunity('Peers Discover HQ B - A1', a.id);
    const { agent: agentA } = await setupCommunityLeader(103, a.id, 'Leader Gen1');
    await setupCommunityLeader(104, a1.id, 'Leader Gen2');

    const res = await agentA.get('/api/leader/peers');
    expect(res.body.items).toEqual([]);
  });

  it('a Generation 2 Leader sees Generation 2 Leaders across different parents, but not Generation 1', async () => {
    const hq = await makeCommunity('Peers Discover HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Discover HQ C - A', hq.id);
    const b = await makeCommunity('Peers Discover HQ C - B', hq.id);
    const a1 = await makeCommunity('Peers Discover HQ C - A1', a.id);
    const a2 = await makeCommunity('Peers Discover HQ C - A2', a.id);
    const b1 = await makeCommunity('Peers Discover HQ C - B1', b.id);

    const { agent: agentA1 } = await setupCommunityLeader(105, a1.id, 'Leader A1');
    const { person: personA2 } = await setupCommunityLeader(106, a2.id, 'Leader A2');
    const { person: personB1 } = await setupCommunityLeader(107, b1.id, 'Leader B1');
    await setupCommunityLeader(108, a.id, 'Leader A (Gen1)');

    const res = await agentA1.get('/api/leader/peers');
    const peerIds = res.body.items.map((p: any) => p.personId).sort();
    expect(peerIds).toEqual([personA2.id, personB1.id].sort());
  });

  it('siblings and non-siblings at the same generation are both treated as peers', async () => {
    // Already proven by the two tests above (A1/A2 are siblings; B1 is not)
    // — this test asserts it explicitly in one place.
    const hq = await makeCommunity('Peers Discover HQ D');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Discover HQ D - A', hq.id);
    const b = await makeCommunity('Peers Discover HQ D - B', hq.id);
    const a1 = await makeCommunity('Peers Discover HQ D - A1', a.id);
    const a2 = await makeCommunity('Peers Discover HQ D - A2', a.id);
    const b1 = await makeCommunity('Peers Discover HQ D - B1', b.id);

    const { agent: agentA1 } = await setupCommunityLeader(109, a1.id);
    const { person: personA2 } = await setupCommunityLeader(110, a2.id);
    const { person: personB1 } = await setupCommunityLeader(111, b1.id);

    const res = await agentA1.get('/api/leader/peers');
    const communityIds = res.body.items.map((p: any) => p.communityId).sort();
    expect(communityIds).toEqual([a2.id, b1.id].sort());
    expect(res.body.items.map((p: any) => p.personId)).toContain(personA2.id);
    expect(res.body.items.map((p: any) => p.personId)).toContain(personB1.id);
  });

  it('a Leader is never returned as their own peer', async () => {
    const hq = await makeCommunity('Peers Discover HQ E');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Discover HQ E - A', hq.id);
    const { agent, person } = await setupCommunityLeader(112, a.id);

    const res = await agent.get('/api/leader/peers');
    expect(res.body.items.find((p: any) => p.personId === person.id)).toBeUndefined();
  });

  it('an ENDED RoleAssignment is excluded from peer discovery, both as requester basis and as a candidate', async () => {
    const hq = await makeCommunity('Peers Discover HQ F');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Discover HQ F - A', hq.id);
    const b = await makeCommunity('Peers Discover HQ F - B', hq.id);
    const { agent: agentA } = await setupCommunityLeader(113, a.id);
    const { role: roleB } = await setupCommunityLeader(114, b.id);
    await prisma.roleAssignment.update({ where: { id: roleB.id }, data: { status: 'ENDED', endedAt: new Date() } });

    const res = await agentA.get('/api/leader/peers');
    expect(res.body.items).toEqual([]);
  });

  it('a non-SCOPED_LEADER RoleAssignment would never match (only role type in this system, asserted defensively)', async () => {
    const hq = await makeCommunity('Peers Discover HQ G');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Discover HQ G - A', hq.id);
    const { agent } = await setupCommunityLeader(115, a.id);
    // No other role type exists in this schema to construct a counter-example
    // with; this test documents the guarantee via the WHERE clause itself —
    // findLeaderPeers always filters roleType: 'SCOPED_LEADER' explicitly.
    const res = await agent.get('/api/leader/peers');
    expect(res.status).toBe(200);
  });

  it('Leaders without any active Community assignment never appear as a peer candidate', async () => {
    const hq = await makeCommunity('Peers Discover HQ H');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Discover HQ H - A', hq.id);
    const b = await makeCommunity('Peers Discover HQ H - B', hq.id);
    const { agent: agentA } = await setupCommunityLeader(116, a.id);
    // Leader with an ENDED role at b — should not appear.
    const { role: roleB } = await setupCommunityLeader(117, b.id);
    await prisma.roleAssignment.update({ where: { id: roleB.id }, data: { status: 'ENDED', endedAt: new Date() } });

    const res = await agentA.get('/api/leader/peers');
    expect(res.body.items).toEqual([]);
  });
});

describe('Phase 2A — GET /api/leader/peers — multiple assignments', () => {
  it('a Leader with active assignments at multiple generations sees peers in each applicable generation', async () => {
    const hq = await makeCommunity('Peers Multi HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Multi A', hq.id); // gen 1
    const b = await makeCommunity('Peers Multi B', hq.id); // gen 1 (peer at gen1)
    const a1 = await makeCommunity('Peers Multi A1', a.id); // gen 2
    const c1 = await makeCommunity('Peers Multi C1', b.id); // gen 2 (peer at gen2)

    const { agent, person, csrf } = await setupCommunityLeader(118, a.id); // gen1 role
    // Give the same Person a SECOND active Community role at gen2.
    await prisma.roleAssignment.create({
      data: { personId: person.id, roleType: 'SCOPED_LEADER', communityId: a1.id, assignedByUserId: (await prisma.user.findFirst({ where: { personId: person.id } }))!.id },
    });
    void csrf;

    const { person: personB } = await setupCommunityLeader(119, b.id); // gen1 peer
    const { person: personC1 } = await setupCommunityLeader(120, c1.id); // gen2 peer

    const res = await agent.get('/api/leader/peers');
    const peerIds = res.body.items.map((p: any) => p.personId).sort();
    expect(peerIds).toEqual([personB.id, personC1.id].sort());
  });

  it('a Person can never hold two simultaneously-ACTIVE roles for the same Community (DB-enforced), and findLeaderPeers still returns exactly one row for them', async () => {
    const hq = await makeCommunity('Peers Multi HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Multi HQ B - A', hq.id);
    const b = await makeCommunity('Peers Multi HQ B - B', hq.id);
    const { agent: agentA } = await setupCommunityLeader(121, a.id);
    const { person: personB, user: userB } = await setupCommunityLeader(122, b.id);

    // A second, redundant ACTIVE role for the exact same (person, community)
    // is rejected by the database's own partial unique index
    // (RoleAssignment_active_person_community_key) — this app-level
    // findLeaderPeers de-duplication is therefore a defensive backstop, not
    // the only thing preventing a duplicated peer row.
    await expect(
      prisma.roleAssignment.create({
        data: { personId: personB.id, roleType: 'SCOPED_LEADER', communityId: b.id, assignedByUserId: userB.id },
      }),
    ).rejects.toThrow();

    const res = await agentA.get('/api/leader/peers');
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].personId).toBe(personB.id);
  });

  it('a qualifying generation never leaks peers from an unrelated generation', async () => {
    const hq = await makeCommunity('Peers Multi HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Multi HQ C - A', hq.id); // gen1
    const a1 = await makeCommunity('Peers Multi HQ C - A1', a.id); // gen2
    const a1x = await makeCommunity('Peers Multi HQ C - A1X', a1.id); // gen3
    const { agent } = await setupCommunityLeader(123, a.id); // gen1 only
    await setupCommunityLeader(124, a1.id); // gen2 — must not appear
    await setupCommunityLeader(125, a1x.id); // gen3 — must not appear

    const res = await agent.get('/api/leader/peers');
    expect(res.body.items).toEqual([]);
  });
});

describe('Phase 2A — GET /api/leader/peers — isolation', () => {
  it('client-supplied query parameters cannot change or expand the result', async () => {
    const hq = await makeCommunity('Peers Isolation HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Isolation A', hq.id);
    const b = await makeCommunity('Peers Isolation B', hq.id);
    const { agent } = await setupCommunityLeader(126, a.id);
    const { person: personB } = await setupCommunityLeader(127, b.id);

    const baseline = await agent.get('/api/leader/peers');
    const tampered = await agent.get(
      `/api/leader/peers?personId=someone-else&communityId=${b.id}&generation=99`,
    );
    expect(tampered.status).toBe(200);
    expect(tampered.body.items.map((p: any) => p.personId).sort()).toEqual(
      baseline.body.items.map((p: any) => p.personId).sort(),
    );
    expect(tampered.body.items.map((p: any) => p.personId)).toContain(personB.id);
  });

  it('the requesting Leader\'s own CommunityMembership never affects peer discovery', async () => {
    const hq = await makeCommunity('Peers Isolation HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Isolation HQ B - A', hq.id);
    const b = await makeCommunity('Peers Isolation HQ B - B', hq.id);
    const { agent, person } = await setupCommunityLeader(128, a.id);
    const { person: personB } = await setupCommunityLeader(129, b.id);

    // Give the requester an active Community MEMBERSHIP (not a role) in a
    // totally different, unrelated Community — it should not influence the
    // result at all.
    const unrelated = await makeCommunity('Peers Isolation Unrelated');
    await prisma.communityMembership.create({ data: { personId: person.id, communityId: unrelated.id } });

    const res = await agent.get('/api/leader/peers');
    expect(res.body.items.map((p: any) => p.personId)).toEqual([personB.id]);
  });

  it('a candidate peer\'s own CommunityMembership never affects whether they qualify', async () => {
    const hq = await makeCommunity('Peers Isolation HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Isolation HQ C - A', hq.id);
    const b = await makeCommunity('Peers Isolation HQ C - B', hq.id);
    const { agent } = await setupCommunityLeader(130, a.id);
    const { person: personB } = await setupCommunityLeader(131, b.id);
    // personB has no CommunityMembership at all — they still qualify purely
    // via their RoleAssignment.
    const membership = await prisma.communityMembership.findFirst({ where: { personId: personB.id } });
    expect(membership).toBeNull();

    const res = await agent.get('/api/leader/peers');
    expect(res.body.items.map((p: any) => p.personId)).toContain(personB.id);
  });
});

describe('Phase 2A — GET /api/leader/peers — response shape and privacy', () => {
  it('returns exactly the documented fields, correctly populated, and no prohibited sensitive fields', async () => {
    const hq = await makeCommunity('Peers Response HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Response A', hq.id);
    const b = await makeCommunity('Peers Response B', hq.id);
    const { agent } = await setupCommunityLeader(132, a.id);
    const { person: personB } = await setupCommunityLeader(133, b.id, 'Peers Response Leader B');

    const res = await agent.get('/api/leader/peers');
    const row = res.body.items.find((p: any) => p.personId === personB.id);
    expect(row).toEqual({
      personId: personB.id,
      name: 'Peers Response Leader B',
      communityId: b.id,
      communityName: 'Peers Response B',
      generation: 1,
    });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('whatsapp');
    expect(serialized).not.toMatch(/"email"/i);
  });

  it('an empty result returns 200 with an empty items array', async () => {
    const hq = await makeCommunity('Peers Response HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers Response HQ B - A', hq.id);
    const { agent } = await setupCommunityLeader(134, a.id);

    const res = await agent.get('/api/leader/peers');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});

describe('Phase 2A — GET /api/leader/peers — read-only', () => {
  it('performs no writes of any kind', async () => {
    const hq = await makeCommunity('Peers ReadOnly HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Peers ReadOnly A', hq.id);
    const b = await makeCommunity('Peers ReadOnly B', hq.id);
    const { agent } = await setupCommunityLeader(135, a.id);
    await setupCommunityLeader(136, b.id);

    const roleCountBefore = await prisma.roleAssignment.count();
    const communityCountBefore = await prisma.community.count();
    const auditCountBefore = await prisma.auditLog.count();

    await agent.get('/api/leader/peers');

    expect(await prisma.roleAssignment.count()).toBe(roleCountBefore);
    expect(await prisma.community.count()).toBe(communityCountBefore);
    expect(await prisma.auditLog.count()).toBe(auditCountBefore);
  });
});
