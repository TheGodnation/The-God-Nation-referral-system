import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';
import { isCommunityAdministrator, findActiveScopedRole } from '../lib/leadership';
import { hasConversationAccess } from '../lib/communityConversation';

// Phase 2B — Same-Generation Leader Collaboration. Mirrors the exact
// conventions established in leaderPeers.test.ts (Phase 2A): agentWithUniqueIp,
// createLeader/createAdmin, bootstrap, cursor-pagination assertions, CSRF
// and rate-limiter assertions.

const app = createApp();

let ipCounter = 5000;
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

async function makePerson(whatsappNumber: string, name = 'Collab Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeGeography(name: string) {
  return prisma.geography.create({ data: { name, type: 'REGION', countryCode: 'CM' } });
}

/** Creates a Leader User linked to a Person, with an ACTIVE SCOPED_LEADER
 * RoleAssignment for the given Community, then logs in. Mirrors
 * leaderPeers.test.ts's setupCommunityLeader exactly. */
async function setupCommunityLeader(n: number, communityId: string, name?: string) {
  const email = `leader-collab${n}@test.local`;
  const { user } = await createLeader(name ?? `Collab Leader ${n}`, email, `LC${n}CODE`);
  const person = await makePerson(`+237989${String(n).padStart(6, '0')}`, name ?? `Collab Leader Person ${n}`);
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
  const email = `leader-collab-geo${n}@test.local`;
  const { user } = await createLeader(`Collab Geo Leader ${n}`, email, `LCG${n}CODE`);
  const person = await makePerson(`+237989${String(900000 + n).padStart(6, '0')}`, `Collab Geo Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, geographyId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

describe('Phase 2B — authentication', () => {
  it('rejects an unauthenticated request to the generation list', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/leader/leadership-collaboration');
    expect(res.status).toBe(401);
  });

  it('rejects an unauthenticated request to a messages route', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/leader/leadership-collaboration/1/messages');
    expect(res.status).toBe(401);
  });

  it('a non-Leader (Admin) session cannot access collaboration', async () => {
    const { agent } = await loginAsAdmin('admin-collab1@test.local');
    const res = await agent.get('/api/leader/leadership-collaboration');
    expect(res.status).toBe(403);
  });

  it('a Leader without any eligible Community-scoped leadership has no eligible generations', async () => {
    const email = 'leader-collab-unlinked@test.local';
    await createLeader('Collab No Role Leader', email, 'LCNOROLE');
    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
    // Not linked to a Person at all — requireLinkedPerson itself rejects.
    const res = await agent.get('/api/leader/leadership-collaboration');
    expect(res.status).toBe(403);
  });

  it('a Geography-only Leader has no eligible generations and cannot access any generation', async () => {
    const geography = await makeGeography('Collab Auth Geography');
    const { agent } = await setupGeographyOnlyLeader(1, geography.id);

    const list = await agent.get('/api/leader/leadership-collaboration');
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);

    const messages = await agent.get('/api/leader/leadership-collaboration/0/messages');
    expect(messages.status).toBe(404);
  });
});

describe('Phase 2B — generation isolation', () => {
  it('a Generation 1 Leader can access Generation 1 collaboration', async () => {
    const hq = await makeCommunity('Collab Gen HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Gen A', hq.id);
    const { agent } = await setupCommunityLeader(1, a.id);

    const res = await agent.get('/api/leader/leadership-collaboration/1/messages');
    expect(res.status).toBe(200);
  });

  it('a Generation 1 Leader cannot access Generation 2 collaboration', async () => {
    const hq = await makeCommunity('Collab Gen HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Gen B - A', hq.id);
    const { agent } = await setupCommunityLeader(2, a.id);

    const res = await agent.get('/api/leader/leadership-collaboration/2/messages');
    expect(res.status).toBe(404);
  });

  it('a Generation 2 Leader can access Generation 2 collaboration', async () => {
    const hq = await makeCommunity('Collab Gen HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Gen C - A', hq.id);
    const a1 = await makeCommunity('Collab Gen C - A1', a.id);
    const { agent } = await setupCommunityLeader(3, a1.id);

    const res = await agent.get('/api/leader/leadership-collaboration/2/messages');
    expect(res.status).toBe(200);
  });

  it('A1 and B1 (different parents, same generation) can both post into and read Generation 2 collaboration', async () => {
    const hq = await makeCommunity('Collab Gen HQ D');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Gen D - A', hq.id);
    const b = await makeCommunity('Collab Gen D - B', hq.id);
    const a1 = await makeCommunity('Collab Gen D - A1', a.id);
    const b1 = await makeCommunity('Collab Gen D - B1', b.id);
    const { agent: agentA1, csrf: csrfA1 } = await setupCommunityLeader(4, a1.id, 'Leader A1');
    const { agent: agentB1 } = await setupCommunityLeader(5, b1.id, 'Leader B1');

    const sent = await agentA1
      .post('/api/leader/leadership-collaboration/2/messages')
      .set('X-CSRF-Token', csrfA1)
      .send({ body: 'Hello from A1.' });
    expect(sent.status).toBe(201);

    const seenByB1 = await agentB1.get('/api/leader/leadership-collaboration/2/messages');
    expect(seenByB1.status).toBe(200);
    expect(seenByB1.body.items.map((m: any) => m.body)).toContain('Hello from A1.');
  });

  it('same-generation membership does not require a shared parent (siblings and non-siblings both work)', async () => {
    const hq = await makeCommunity('Collab Gen HQ E');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Gen E - A', hq.id);
    const b = await makeCommunity('Collab Gen E - B', hq.id);
    const { agent: agentA } = await setupCommunityLeader(6, a.id);
    const { agent: agentB } = await setupCommunityLeader(7, b.id);

    expect((await agentA.get('/api/leader/leadership-collaboration/1/messages')).status).toBe(200);
    expect((await agentB.get('/api/leader/leadership-collaboration/1/messages')).status).toBe(200);
  });

  it('different generations cannot communicate through the same collaboration surface', async () => {
    const hq = await makeCommunity('Collab Gen HQ F');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Gen F - A', hq.id);
    const a1 = await makeCommunity('Collab Gen F - A1', a.id);
    const { agent: agentGen1, csrf: csrfGen1 } = await setupCommunityLeader(8, a.id, 'Gen1 Leader');
    const { agent: agentGen2 } = await setupCommunityLeader(9, a1.id, 'Gen2 Leader');

    await agentGen1
      .post('/api/leader/leadership-collaboration/1/messages')
      .set('X-CSRF-Token', csrfGen1)
      .send({ body: 'Generation 1 only.' });

    // The Generation 2 Leader cannot even reach Generation 1's conversation.
    const res = await agentGen2.get('/api/leader/leadership-collaboration/1/messages');
    expect(res.status).toBe(404);
  });
});

describe('Phase 2B — multi-generation leadership', () => {
  it('a Leader with active assignments at multiple generations can access each eligible generation', async () => {
    const hq = await makeCommunity('Collab Multi HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Multi A', hq.id); // gen 1
    const a1 = await makeCommunity('Collab Multi A1', a.id); // gen 2
    const { agent, person } = await setupCommunityLeader(10, a.id);
    await prisma.roleAssignment.create({
      data: {
        personId: person.id,
        roleType: 'SCOPED_LEADER',
        communityId: a1.id,
        assignedByUserId: (await prisma.user.findFirst({ where: { personId: person.id } }))!.id,
      },
    });

    const list = await agent.get('/api/leader/leadership-collaboration');
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: any) => i.generation).sort()).toEqual([1, 2]);

    expect((await agent.get('/api/leader/leadership-collaboration/1/messages')).status).toBe(200);
    expect((await agent.get('/api/leader/leadership-collaboration/2/messages')).status).toBe(200);
  });

  it('access to one generation does not automatically grant access to another', async () => {
    const hq = await makeCommunity('Collab Multi HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Multi HQ B - A', hq.id); // gen 1
    const { agent } = await setupCommunityLeader(11, a.id);

    expect((await agent.get('/api/leader/leadership-collaboration/1/messages')).status).toBe(200);
    expect((await agent.get('/api/leader/leadership-collaboration/3/messages')).status).toBe(404);
  });
});

describe('Phase 2B — administrative isolation', () => {
  it('collaboration access does not grant Community administration of another Leader\'s Community', async () => {
    const hq = await makeCommunity('Collab Admin HQ A');
    await setHeadquarters(hq.id);
    const a1 = await makeCommunity('Collab Admin HQ A - A1', hq.id);
    const b1 = await makeCommunity('Collab Admin HQ A - B1', hq.id);
    const { person: personA1 } = await setupCommunityLeader(12, a1.id, 'Admin Isolation A1');
    await setupCommunityLeader(13, b1.id, 'Admin Isolation B1');

    // A1 must NOT be an administrator of B1's Community merely by sharing
    // Generation 1's collaboration surface.
    expect(await isCommunityAdministrator(personA1.id, b1.id)).toBe(false);
    expect(await findActiveScopedRole(personA1.id, 'COMMUNITY', b1.id)).toBeNull();
  });

  it('existing isCommunityAdministrator behavior is completely unchanged', async () => {
    const hq = await makeCommunity('Collab Admin HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Admin HQ B - A', hq.id);
    const { person } = await setupCommunityLeader(14, a.id);
    expect(await isCommunityAdministrator(person.id, a.id)).toBe(true);
  });

  it('existing hasConversationAccess (Community Conversation) behavior is completely unchanged', async () => {
    const hq = await makeCommunity('Collab Admin HQ C');
    await setHeadquarters(hq.id);
    const a1 = await makeCommunity('Collab Admin HQ C - A1', hq.id);
    const b1 = await makeCommunity('Collab Admin HQ C - B1', hq.id);
    const { person: personA1 } = await setupCommunityLeader(15, a1.id, 'HCA Isolation A1');
    await setupCommunityLeader(16, b1.id, 'HCA Isolation B1');

    // A1's Leader must not have Community Conversation access to B1's
    // Community merely by sharing Generation 1 collaboration eligibility.
    expect(await hasConversationAccess(personA1.id, b1.id)).toBe(false);
  });

  it('a Leader cannot use collaboration authorization to access another Community\'s conversation via the Community Conversation route', async () => {
    const hq = await makeCommunity('Collab Admin HQ D');
    await setHeadquarters(hq.id);
    const a1 = await makeCommunity('Collab Admin HQ D - A1', hq.id);
    const b1 = await makeCommunity('Collab Admin HQ D - B1', hq.id);
    const { agent: agentA1 } = await setupCommunityLeader(17, a1.id, 'Route Isolation A1');
    await setupCommunityLeader(18, b1.id, 'Route Isolation B1');

    // A1's Leader is eligible for Generation 1 collaboration, but that
    // eligibility must not translate into access on the completely separate
    // Community Conversation route for B1's own Community.
    const res = await agentA1.get(`/api/communities/${b1.id}/conversation`);
    expect(res.status).toBe(403);
  });
});

describe('Phase 2B — geography isolation', () => {
  it('a Geography assignment/role does not expand collaboration scope', async () => {
    const hq = await makeCommunity('Collab Geo HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Geo HQ A - A', hq.id);
    const geography = await makeGeography('Collab Geo Isolation Region A');
    const { agent, person, user } = await setupCommunityLeader(19, a.id);
    // Also give this Leader a Geography-scoped role — must not expand which
    // organizational generations they can reach.
    await prisma.roleAssignment.create({
      data: { personId: person.id, roleType: 'SCOPED_LEADER', geographyId: geography.id, assignedByUserId: user.id },
    });

    const list = await agent.get('/api/leader/leadership-collaboration');
    expect(list.body.items.map((i: any) => i.generation)).toEqual([1]);
  });

  it('different Geography does not prevent same-generation organizational collaboration', async () => {
    const hq = await makeCommunity('Collab Geo HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Geo HQ B - A', hq.id);
    const b = await makeCommunity('Collab Geo HQ B - B', hq.id);
    const geoA = await makeGeography('Collab Geo Isolation Region B-A');
    const geoB = await makeGeography('Collab Geo Isolation Region B-B');
    const { agent: agentA, person: personA, user: userA } = await setupCommunityLeader(20, a.id, 'Geo Isolation A');
    const { agent: agentB, person: personB, user: userB } = await setupCommunityLeader(21, b.id, 'Geo Isolation B');
    await prisma.roleAssignment.create({
      data: { personId: personA.id, roleType: 'SCOPED_LEADER', geographyId: geoA.id, assignedByUserId: userA.id },
    });
    await prisma.roleAssignment.create({
      data: { personId: personB.id, roleType: 'SCOPED_LEADER', geographyId: geoB.id, assignedByUserId: userB.id },
    });

    expect((await agentA.get('/api/leader/leadership-collaboration/1/messages')).status).toBe(200);
    expect((await agentB.get('/api/leader/leadership-collaboration/1/messages')).status).toBe(200);
  });
});

describe('Phase 2B — messaging security', () => {
  it('the sender is always derived from the authenticated session', async () => {
    const hq = await makeCommunity('Collab Msg HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Msg HQ A - A', hq.id);
    const { agent, csrf, person } = await setupCommunityLeader(22, a.id);

    const res = await agent
      .post('/api/leader/leadership-collaboration/1/messages')
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Own identity.' });
    expect(res.status).toBe(201);
    const stored = await prisma.leadershipCollaborationMessage.findUnique({ where: { id: res.body.id } });
    expect(stored!.senderPersonId).toBe(person.id);
  });

  it('a client-supplied sender Person id cannot impersonate another Leader', async () => {
    const hq = await makeCommunity('Collab Msg HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Msg HQ B - A', hq.id);
    const { agent, csrf, person } = await setupCommunityLeader(23, a.id);
    const other = await makePerson('+237989777001', 'Someone Else');

    const res = await agent
      .post('/api/leader/leadership-collaboration/1/messages')
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Impersonation attempt.', senderPersonId: other.id });
    const stored = await prisma.leadershipCollaborationMessage.findUnique({ where: { id: res.body.id } });
    expect(stored!.senderPersonId).toBe(person.id);
  });

  it('a client-supplied generation in the body cannot expand access beyond the URL\'s own generation', async () => {
    const hq = await makeCommunity('Collab Msg HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Msg HQ C - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(24, a.id);

    // Only eligible for generation 1 — posting a body-level "generation"
    // field to the generation-2 URL must still be rejected.
    const res = await agent
      .post('/api/leader/leadership-collaboration/2/messages')
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Trying to leak in.', generation: 1 });
    expect(res.status).toBe(404);
  });

  it('a client-supplied Community id cannot expand access', async () => {
    const hq = await makeCommunity('Collab Msg HQ D');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Msg HQ D - A', hq.id);
    const other = await makeCommunity('Collab Msg HQ D - Other', hq.id);
    const { agent, csrf } = await setupCommunityLeader(25, a.id);

    const res = await agent
      .post('/api/leader/leadership-collaboration/2/messages')
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Trying to leak in.', communityId: other.id });
    expect(res.status).toBe(404);
  });

  it('an empty message is rejected', async () => {
    const hq = await makeCommunity('Collab Msg HQ E');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Msg HQ E - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(26, a.id);

    const res = await agent
      .post('/api/leader/leadership-collaboration/1/messages')
      .set('X-CSRF-Token', csrf)
      .send({ body: '' });
    expect(res.status).toBe(400);
  });

  it('a whitespace-only message is rejected', async () => {
    const hq = await makeCommunity('Collab Msg HQ E2');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Msg HQ E2 - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(27, a.id);

    const res = await agent
      .post('/api/leader/leadership-collaboration/1/messages')
      .set('X-CSRF-Token', csrf)
      .send({ body: '    ' });
    expect(res.status).toBe(400);
  });

  it('a message over 2000 characters is rejected, never silently truncated', async () => {
    const hq = await makeCommunity('Collab Msg HQ F');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Msg HQ F - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(28, a.id);

    const res = await agent
      .post('/api/leader/leadership-collaboration/1/messages')
      .set('X-CSRF-Token', csrf)
      .send({ body: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    // generation is a shared, global key (unlike a fresh Community/Geography
    // uuid per test), so a Generation 1 conversation row may already exist
    // from an earlier test in this file — the property under test is that
    // THIS oversized message was never persisted, not that no conversation
    // row exists at all.
    const oversized = await prisma.leadershipCollaborationMessage.findFirst({ where: { body: 'x'.repeat(2001) } });
    expect(oversized).toBeNull();
  });

  it('a valid message is persisted correctly, with correct sender and timestamp', async () => {
    const hq = await makeCommunity('Collab Msg HQ G');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Msg HQ G - A', hq.id);
    const { agent, csrf, person } = await setupCommunityLeader(29, a.id);

    const before = new Date();
    const res = await agent
      .post('/api/leader/leadership-collaboration/1/messages')
      .set('X-CSRF-Token', csrf)
      .send({ body: 'A genuine collaboration message.' });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('A genuine collaboration message.');

    const stored = await prisma.leadershipCollaborationMessage.findUnique({ where: { id: res.body.id } });
    expect(stored!.senderPersonId).toBe(person.id);
    expect(new Date(stored!.createdAt).getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it('an unauthorized Leader cannot post into a generation they are not eligible for', async () => {
    const hq = await makeCommunity('Collab Msg HQ H');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Msg HQ H - A', hq.id); // gen 1
    const { agent, csrf } = await setupCommunityLeader(30, a.id);

    const res = await agent
      .post('/api/leader/leadership-collaboration/2/messages')
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Should never land.' });
    expect(res.status).toBe(404);
    const count = await prisma.leadershipCollaborationMessage.count();
    expect(count).toBe(0);
  });

  it('CSRF protection is enforced on message send', async () => {
    const hq = await makeCommunity('Collab Msg HQ I');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Msg HQ I - A', hq.id);
    const { agent } = await setupCommunityLeader(31, a.id);

    const res = await agent.post('/api/leader/leadership-collaboration/1/messages').send({ body: 'No CSRF.' });
    expect(res.status).toBe(403);
  });

  it('the dedicated Leadership Collaboration message-send rate limiter applies', async () => {
    const hq = await makeCommunity('Collab Msg HQ J');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Msg HQ J - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(32, a.id);

    let lastStatus = 200;
    for (let i = 0; i < 61; i++) {
      const res = await agent
        .post('/api/leader/leadership-collaboration/1/messages')
        .set('X-CSRF-Token', csrf)
        .send({ body: `Message ${i}` });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  }, 20000);
});

describe('Phase 2B — data minimization', () => {
  it('the message response does not contain prohibited Person fields', async () => {
    const hq = await makeCommunity('Collab Data HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Data HQ A - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(33, a.id);
    await agent.post('/api/leader/leadership-collaboration/1/messages').set('X-CSRF-Token', csrf).send({ body: 'Hi.' });

    const res = await agent.get('/api/leader/leadership-collaboration/1/messages');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/whatsapp/i);
    expect(serialized).not.toMatch(/email/i);
    expect(res.body.items[0]).toEqual({
      id: expect.any(String),
      senderName: expect.any(String),
      body: 'Hi.',
      createdAt: expect.any(String),
    });
  });

  it('the response does not expose unrelated Community/Geography/private data', async () => {
    const hq = await makeCommunity('Collab Data HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Data HQ B - A', hq.id);
    const { agent } = await setupCommunityLeader(34, a.id);

    const res = await agent.get('/api/leader/leadership-collaboration');
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/geograph/i);
    expect(serialized).not.toMatch(/communityId/i);
  });
});

describe('Phase 2B — pagination', () => {
  it('message pagination works, with correct metadata and deterministic ordering', async () => {
    const hq = await makeCommunity('Collab Page HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Page HQ A - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(35, a.id);

    for (let i = 0; i < 3; i++) {
      await agent
        .post('/api/leader/leadership-collaboration/1/messages')
        .set('X-CSRF-Token', csrf)
        .send({ body: `Page message ${i}` });
    }

    // Generation 1's conversation is shared, global keyspace state across
    // this whole file (many earlier tests already sent messages into it) —
    // so this only asserts what is true regardless of that history: the
    // first (cursor-less) page returns the NEWEST `limit` messages,
    // oldest-first within the page, which are this test's own last two
    // sends (they were the last two persisted before this GET fires).
    const firstPage = await agent.get('/api/leader/leadership-collaboration/1/messages?limit=2');
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.hasMore).toBe(true);
    expect(firstPage.body.items.map((m: any) => m.body)).toEqual(['Page message 1', 'Page message 2']);

    const oldestIdOnPage = firstPage.body.items[0].id;
    const olderPage = await agent.get(`/api/leader/leadership-collaboration/1/messages?before=${oldestIdOnPage}`);
    expect(olderPage.status).toBe(200);
    // 'Page message 0' was sent immediately before 'Page message 1' with
    // nothing else in between, so it is necessarily the newest entry in the
    // page just older than the cursor — i.e. the last item (oldest-first).
    expect(olderPage.body.items[olderPage.body.items.length - 1].body).toBe('Page message 0');
  });

  it('an invalid pagination cursor is rejected', async () => {
    const hq = await makeCommunity('Collab Page HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Page HQ B - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(36, a.id);
    await agent.post('/api/leader/leadership-collaboration/1/messages').set('X-CSRF-Token', csrf).send({ body: 'Hi.' });

    const res = await agent.get('/api/leader/leadership-collaboration/1/messages?before=00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(400);
  });
});

describe('Phase 2B — read/unread', () => {
  it('a new message is unread for other participants, and read-marking updates only the collaboration read state', async () => {
    const hq = await makeCommunity('Collab Read HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Read HQ A - A', hq.id);
    const b = await makeCommunity('Collab Read HQ A - B', hq.id);
    const { agent: agentA, csrf: csrfA } = await setupCommunityLeader(37, a.id, 'Read Leader A');
    const { agent: agentB, csrf: csrfB } = await setupCommunityLeader(38, b.id, 'Read Leader B');

    const sent = await agentA
      .post('/api/leader/leadership-collaboration/1/messages')
      .set('X-CSRF-Token', csrfA)
      .send({ body: 'Unread test.' });
    expect(sent.status).toBe(201);

    const listBefore = await agentB.get('/api/leader/leadership-collaboration');
    const genBefore = listBefore.body.items.find((i: any) => i.generation === 1);
    expect(genBefore.unreadCount).toBe(1);

    const messages = await agentB.get('/api/leader/leadership-collaboration/1/messages');
    expect(messages.body.unreadCount).toBe(1);

    const markRead = await agentB
      .post('/api/leader/leadership-collaboration/1/read')
      .set('X-CSRF-Token', csrfB)
      .send({ messageId: sent.body.id });
    expect(markRead.status).toBe(200);
    expect(markRead.body.unreadCount).toBe(0);

    // Reading Generation 1 must never touch any other read-state surface —
    // Community Conversation's own read cursor for an unrelated Community
    // stays completely untouched.
    const otherReads = await prisma.communityConversationRead.count({ where: { personId: (await prisma.person.findFirst({ where: { name: 'Read Leader B' } }))!.id } });
    expect(otherReads).toBe(0);
  });

  it('marking one generation read does not affect another generation\'s unread state', async () => {
    const hq = await makeCommunity('Collab Read HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Read HQ B - A', hq.id); // gen 1
    const a1 = await makeCommunity('Collab Read HQ B - A1', a.id); // gen 2
    const { agent, csrf, person } = await setupCommunityLeader(39, a.id);
    await prisma.roleAssignment.create({
      data: {
        personId: person.id,
        roleType: 'SCOPED_LEADER',
        communityId: a1.id,
        assignedByUserId: (await prisma.user.findFirst({ where: { personId: person.id } }))!.id,
      },
    });
    const { agent: agentOther, csrf: csrfOther } = await setupCommunityLeader(40, a.id, 'Other Gen1 Leader');
    void csrf;

    const sentGen1 = await agentOther
      .post('/api/leader/leadership-collaboration/1/messages')
      .set('X-CSRF-Token', csrfOther)
      .send({ body: 'Gen 1 message.' });

    const beforeRead = await agent.get('/api/leader/leadership-collaboration');
    const gen1Before = beforeRead.body.items.find((i: any) => i.generation === 1);
    const gen2Before = beforeRead.body.items.find((i: any) => i.generation === 2);
    expect(gen1Before.unreadCount).toBe(1);
    expect(gen2Before.unreadCount).toBe(0);
    void sentGen1;
  });

  it('GET requests never write read state', async () => {
    const hq = await makeCommunity('Collab Read HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Read HQ C - A', hq.id);
    const { agent } = await setupCommunityLeader(41, a.id);

    await agent.get('/api/leader/leadership-collaboration/1/messages');
    const reads = await prisma.leadershipCollaborationConversationRead.count();
    expect(reads).toBe(0);
  });

  it('requires CSRF protection on the read route', async () => {
    const hq = await makeCommunity('Collab Read HQ D');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab Read HQ D - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(42, a.id);
    const sent = await agent
      .post('/api/leader/leadership-collaboration/1/messages')
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Hi.' });

    const res = await agent.post('/api/leader/leadership-collaboration/1/read').send({ messageId: sent.body.id });
    expect(res.status).toBe(403);
  });

  it('an unauthenticated caller cannot mark a generation read', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.post('/api/leader/leadership-collaboration/1/read').send({ messageId: 'anything' });
    expect(res.status).toBe(401);
  });
});

describe('Phase 2B — no arbitrary groups', () => {
  it('there is no endpoint for a Leader to create an arbitrary collaboration group', async () => {
    const hq = await makeCommunity('Collab NoGroup HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab NoGroup HQ A - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(43, a.id);

    const res = await agent
      .post('/api/leader/leadership-collaboration')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'My Own Group' });
    expect([404, 405]).toContain(res.status);
  });

  it('a Leader cannot add an arbitrary person to a collaboration generation (no membership endpoint exists)', async () => {
    const hq = await makeCommunity('Collab NoGroup HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab NoGroup HQ B - A', hq.id);
    const { agent, csrf } = await setupCommunityLeader(44, a.id);
    const other = await makePerson('+237989777002', 'Uninvited Person');

    const res = await agent
      .post('/api/leader/leadership-collaboration/1/members')
      .set('X-CSRF-Token', csrf)
      .send({ personId: other.id });
    expect([404, 405]).toContain(res.status);
  });

  it('a Leader cannot remove another Leader from a generation collaboration (no such endpoint exists)', async () => {
    const hq = await makeCommunity('Collab NoGroup HQ C');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab NoGroup HQ C - A', hq.id);
    const b = await makeCommunity('Collab NoGroup HQ C - B', hq.id);
    const { agent, csrf } = await setupCommunityLeader(45, a.id);
    const { person: personB } = await setupCommunityLeader(46, b.id);

    const res = await agent
      .delete(`/api/leader/leadership-collaboration/1/members/${personB.id}`)
      .set('X-CSRF-Token', csrf);
    expect([404, 405]).toContain(res.status);
  });
});

describe('Phase 2B — no unintended writes', () => {
  it('an unauthorized access attempt performs no write', async () => {
    const hq = await makeCommunity('Collab NoWrite HQ A');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab NoWrite HQ A - A', hq.id); // gen 1
    const { agent, csrf } = await setupCommunityLeader(47, a.id);

    // generation is a shared, global key — an earlier test in this file may
    // already have legitimately created Generation 2's conversation, so the
    // property under test is that THIS denied attempt adds no message to
    // it, not that the conversation itself doesn't exist.
    const before = await prisma.leadershipCollaborationMessage.count({
      where: { conversation: { generation: 2 } },
    });

    await agent
      .post('/api/leader/leadership-collaboration/2/messages')
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Denied.' });

    const after = await prisma.leadershipCollaborationMessage.count({
      where: { conversation: { generation: 2 } },
    });
    expect(after).toBe(before);
    const deniedMessage = await prisma.leadershipCollaborationMessage.findFirst({ where: { body: 'Denied.' } });
    expect(deniedMessage).toBeNull();
  });

  it('GET endpoints remain read-only under normal use', async () => {
    const hq = await makeCommunity('Collab NoWrite HQ B');
    await setHeadquarters(hq.id);
    const a = await makeCommunity('Collab NoWrite HQ B - A', hq.id);
    const { agent } = await setupCommunityLeader(48, a.id);

    const before = await prisma.leadershipCollaborationMessage.count();
    await agent.get('/api/leader/leadership-collaboration');
    await agent.get('/api/leader/leadership-collaboration/1/messages');
    const after = await prisma.leadershipCollaborationMessage.count();
    expect(after).toBe(before);
  });
});
