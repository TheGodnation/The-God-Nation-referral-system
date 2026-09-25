import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Phase 3M.6 — Geography Two-Way Conversation. Mirrors the exact
// conventions established in communityConversations.test.ts (Phase 3M.1)
// and followUpConversations.test.ts (Phase 3M.2): agentWithUniqueIp,
// createLeader/createAdmin, bootstrap, loginAsMember.

const app = createApp();

let ipCounter = 2000;
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

function extractToken(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

async function makeGeography(name: string, parentId?: string) {
  return prisma.geography.create({
    data: { name, parentId: parentId ?? null, type: 'REGION', countryCode: 'CM' },
  });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function assignGeography(personId: string, geographyId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  return prisma.geographicAssignment.create({ data: { personId, geographyId, status } });
}

async function loginAsMember(whatsapp: string, email: string, name = 'Geography Conversation Member') {
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const requestAgent = agentWithUniqueIp();
  const { csrf: requestCsrf } = await bootstrap(requestAgent as any);
  await requestAgent.post('/api/member/auth/request-link').set('X-CSRF-Token', requestCsrf).send({ whatsapp, email });
  const link = spy.mock.calls[spy.mock.calls.length - 1][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: extractToken(link) });
  return { agent, csrf, person };
}

async function setupGeographyLeader(n: number, geographyId: string) {
  const email = `geoconv-leader${n}@test.local`;
  const { user } = await createLeader(`Geography Conversation Leader ${n}`, email, `GC${n}CODE`);
  const person = await prisma.person.create({
    data: { name: `Geography Conversation Leader Person ${n}`, whatsappNumber: `+237697${String(n).padStart(6, '0')}` },
  });
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  const role = await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, geographyId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person, role };
}

async function loginAsAdmin(n: number) {
  const email = `geoconv-admin${n}@test.local`;
  await createAdmin(email);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, email };
}

describe('Phase 3M.6 — GeographyConversation model integrity', () => {
  it('rejects a second GeographyConversation for the same Geography (unique constraint)', async () => {
    const geography = await makeGeography('Model Integrity Region');
    await prisma.geographyConversation.create({ data: { geographyId: geography.id } });
    await expect(prisma.geographyConversation.create({ data: { geographyId: geography.id } })).rejects.toThrow();
  });
});

describe('Phase 3M.6 — ordinary person: exact and descendant access', () => {
  it('a Person assigned exactly to G can read and send in G\'s conversation', async () => {
    const geography = await makeGeography('Exact Match Village');
    const { agent, csrf, person } = await loginAsMember('+237696900001', 'geoconv-member1@example.com');
    await assignGeography(person.id, geography.id);

    const readRes = await agent.get(`/api/geographies/${geography.id}/conversation`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.geographyId).toBe(geography.id);

    const sendRes = await agent
      .post(`/api/geographies/${geography.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Hello from the village.' });
    expect(sendRes.status).toBe(201);
  });

  it('a Person assigned to a direct child of G can access G\'s conversation', async () => {
    const region = await makeGeography('Parent Region A');
    const division = await makeGeography('Child Division A', region.id);
    const { agent, person } = await loginAsMember('+237696900002', 'geoconv-member2@example.com');
    await assignGeography(person.id, division.id);

    const res = await agent.get(`/api/geographies/${region.id}/conversation`);
    expect(res.status).toBe(200);
  });

  it('a Person assigned to a multi-level descendant (grandchild) can access the ancestor\'s conversation', async () => {
    const country = await makeGeography('GC Country A');
    const region = await makeGeography('GC Region A', country.id);
    const village = await makeGeography('GC Village A', region.id);
    const { agent, person } = await loginAsMember('+237696900003', 'geoconv-member3@example.com');
    await assignGeography(person.id, village.id);

    const res = await agent.get(`/api/geographies/${country.id}/conversation`);
    expect(res.status).toBe(200);
  });

  it('per the founder worked example, a Person assigned to a leaf can access every ancestor\'s conversation up the chain', async () => {
    const world = await makeGeography('World A');
    const continent = await makeGeography('Africa A', world.id);
    const country = await makeGeography('Cameroon A', continent.id);
    const region = await makeGeography('Littoral A', country.id);
    const division = await makeGeography('Wouri A', region.id);
    const city = await makeGeography('Douala A', division.id);
    const quarter = await makeGeography('Quarter A', city.id);
    const { agent, person } = await loginAsMember('+237696900004', 'geoconv-member4@example.com');
    await assignGeography(person.id, quarter.id);

    for (const node of [quarter, city, division, region, country, continent, world]) {
      const res = await agent.get(`/api/geographies/${node.id}/conversation`);
      expect(res.status).toBe(200);
    }
  });

  it('a Person assigned to an ANCESTOR of G is denied access to G\'s conversation (outside their local scope)', async () => {
    const region = await makeGeography('Ancestor Denied Region');
    const village = await makeGeography('Ancestor Denied Village', region.id);
    const { agent, person } = await loginAsMember('+237696900005', 'geoconv-member5@example.com');
    await assignGeography(person.id, region.id);

    const res = await agent.get(`/api/geographies/${village.id}/conversation`);
    expect(res.status).toBe(404);
  });

  it('a Person assigned to an unrelated Geography is denied', async () => {
    const region = await makeGeography('Unrelated Region A');
    const other = await makeGeography('Unrelated Region B');
    const { agent, person } = await loginAsMember('+237696900006', 'geoconv-member6@example.com');
    await assignGeography(person.id, other.id);

    const res = await agent.get(`/api/geographies/${region.id}/conversation`);
    expect(res.status).toBe(404);
  });

  it('a Person with an INACTIVE GeographicAssignment is denied', async () => {
    const geography = await makeGeography('Inactive Assignment Region');
    const { agent, person } = await loginAsMember('+237696900007', 'geoconv-member7@example.com');
    await assignGeography(person.id, geography.id, 'INACTIVE');

    const res = await agent.get(`/api/geographies/${geography.id}/conversation`);
    expect(res.status).toBe(404);
  });

  it('a Person with no GeographicAssignment at all is denied', async () => {
    const geography = await makeGeography('No Assignment Region');
    const { agent } = await loginAsMember('+237696900008', 'geoconv-member8@example.com');

    const res = await agent.get(`/api/geographies/${geography.id}/conversation`);
    expect(res.status).toBe(404);
  });
});

describe('Phase 3M.6 — geographical leader: exact-match-only access', () => {
  it('a Leader with an ACTIVE RoleAssignment for exactly G can read and send', async () => {
    const geography = await makeGeography('Leader Exact Region');
    const { agent, csrf } = await setupGeographyLeader(101, geography.id);

    const readRes = await agent.get(`/api/geographies/${geography.id}/conversation`);
    expect(readRes.status).toBe(200);

    const sendRes = await agent
      .post(`/api/geographies/${geography.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Greetings from your leader.' });
    expect(sendRes.status).toBe(201);
  });

  it('a Leader scoped to a DESCENDANT of G does not automatically gain access to G\'s conversation', async () => {
    const region = await makeGeography('Leader Parent Region');
    const division = await makeGeography('Leader Child Division', region.id);
    const { agent } = await setupGeographyLeader(102, division.id);

    const res = await agent.get(`/api/geographies/${region.id}/conversation`);
    expect(res.status).toBe(404);
  });

  it('a Leader scoped to an ANCESTOR of G does not automatically gain access to G\'s conversation', async () => {
    const region = await makeGeography('Leader Ancestor Region');
    const division = await makeGeography('Leader Descendant Division', region.id);
    const { agent } = await setupGeographyLeader(103, region.id);

    const res = await agent.get(`/api/geographies/${division.id}/conversation`);
    expect(res.status).toBe(404);
  });

  it('a Community-scoped RoleAssignment does not grant Geography conversation access', async () => {
    const geography = await makeGeography('Community Role Region');
    const community = await makeCommunity('Community Role Only Community');
    const { user } = await createLeader('Community Only Leader', 'geoconv-commleader@test.local', 'CVONLYCODE');
    const person = await prisma.person.create({
      data: { name: 'Community Only Leader Person', whatsappNumber: '+237697900001' },
    });
    await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
    await prisma.roleAssignment.create({
      data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId: community.id },
    });

    const agent = agentWithUniqueIp();
    const { csrf } = await bootstrap(agent as any);
    await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrf)
      .send({ email: 'geoconv-commleader@test.local', password: 'password123' });

    const res = await agent.get(`/api/geographies/${geography.id}/conversation`);
    expect(res.status).toBe(404);
  });
});

describe('Phase 3M.6 — genuinely two-way: either side may initiate', () => {
  it('an ordinary Person can send the FIRST message without waiting for a Leader', async () => {
    const geography = await makeGeography('First Message Region');
    const { agent, csrf, person } = await loginAsMember('+237696900009', 'geoconv-member9@example.com');
    await assignGeography(person.id, geography.id);

    const res = await agent
      .post(`/api/geographies/${geography.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'A member initiates.' });
    expect(res.status).toBe(201);
  });

  it('a Leader can also send the first message, and both sides read the same history', async () => {
    const geography = await makeGeography('Two Way Region');
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupGeographyLeader(104, geography.id);
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember(
      '+237696900010',
      'geoconv-member10@example.com',
    );
    await assignGeography(person.id, geography.id);

    await leaderAgent
      .post(`/api/geographies/${geography.id}/conversation/messages`)
      .set('X-CSRF-Token', leaderCsrf)
      .send({ body: 'Leader speaks first.' });
    await memberAgent
      .post(`/api/geographies/${geography.id}/conversation/messages`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ body: 'Member replies.' });

    const leaderView = await leaderAgent.get(`/api/geographies/${geography.id}/conversation/messages`);
    const memberView = await memberAgent.get(`/api/geographies/${geography.id}/conversation/messages`);
    const leaderBodies = leaderView.body.items.map((m: any) => m.body);
    const memberBodies = memberView.body.items.map((m: any) => m.body);
    expect(leaderBodies).toEqual(['Leader speaks first.', 'Member replies.']);
    expect(memberBodies).toEqual(leaderBodies);
  });
});

describe('Phase 3M.6 — sender identity, CSRF, and rate limiting', () => {
  it('the sender is always derived from the authenticated session', async () => {
    const geography = await makeGeography('Sender Identity Region');
    const { agent, csrf, person } = await loginAsMember('+237696900011', 'geoconv-member11@example.com');
    await assignGeography(person.id, geography.id);

    const res = await agent
      .post(`/api/geographies/${geography.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'From the member.' });
    const stored = await prisma.geographyMessage.findUnique({ where: { id: res.body.id } });
    expect(stored!.senderPersonId).toBe(person.id);
  });

  it('a client cannot impersonate another Person by supplying a sender id', async () => {
    const geography = await makeGeography('Impersonation Region');
    const { agent, csrf, person } = await loginAsMember('+237696900012', 'geoconv-member12@example.com');
    await assignGeography(person.id, geography.id);
    const other = await prisma.person.create({ data: { name: 'Someone Else', whatsappNumber: '+237696900013' } });

    const res = await agent
      .post(`/api/geographies/${geography.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Impersonation attempt.', senderPersonId: other.id });
    const stored = await prisma.geographyMessage.findUnique({ where: { id: res.body.id } });
    expect(stored!.senderPersonId).toBe(person.id);
  });

  it('an empty message is rejected', async () => {
    const geography = await makeGeography('Empty Message Region');
    const { agent, csrf, person } = await loginAsMember('+237696900014', 'geoconv-member14@example.com');
    await assignGeography(person.id, geography.id);

    const res = await agent
      .post(`/api/geographies/${geography.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: '' });
    expect(res.status).toBe(400);
  });

  it('a message over 2000 characters is rejected, never silently truncated', async () => {
    const geography = await makeGeography('Over Limit Region');
    const { agent, csrf, person } = await loginAsMember('+237696900015', 'geoconv-member15@example.com');
    await assignGeography(person.id, geography.id);

    const res = await agent
      .post(`/api/geographies/${geography.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
    const conversation = await prisma.geographyConversation.findUnique({ where: { geographyId: geography.id } });
    expect(conversation).toBeNull();
  });

  it('CSRF protection is enforced on message send', async () => {
    const geography = await makeGeography('CSRF Region');
    const { agent, person } = await loginAsMember('+237696900016', 'geoconv-member16@example.com');
    await assignGeography(person.id, geography.id);

    const res = await agent.post(`/api/geographies/${geography.id}/conversation/messages`).send({ body: 'No CSRF.' });
    expect(res.status).toBe(403);
  });

  it('the dedicated Geography message-send rate limiter applies', async () => {
    const geography = await makeGeography('Rate Limit Region');
    const { agent, csrf, person } = await loginAsMember('+237696900017', 'geoconv-member17@example.com');
    await assignGeography(person.id, geography.id);

    let lastStatus = 200;
    for (let i = 0; i < 61; i++) {
      const res = await agent
        .post(`/api/geographies/${geography.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ body: `Message ${i}` });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('Phase 3M.6 — non-disclosure, authentication exclusion', () => {
  it('a nonexistent Geography id returns 404, indistinguishable from a real but inaccessible one', async () => {
    const geography = await makeGeography('Real But Inaccessible Region');
    const { agent } = await loginAsMember('+237696900018', 'geoconv-member18@example.com');
    // No assignGeography call — this Person has no relationship to `geography`.

    const realButInaccessible = await agent.get(`/api/geographies/${geography.id}/conversation`);
    const madeUp = await agent.get('/api/geographies/00000000-0000-0000-0000-000000000000/conversation');
    expect(realButInaccessible.status).toBe(404);
    expect(madeUp.status).toBe(404);
    expect(realButInaccessible.body).toEqual(madeUp.body);
  });

  it('an unauthenticated caller cannot access a Geography conversation', async () => {
    const geography = await makeGeography('Unauthenticated Region');
    const anon = agentWithUniqueIp();
    const res = await anon.get(`/api/geographies/${geography.id}/conversation`);
    expect(res.status).toBe(401);
  });

  it('an Admin session cannot use the Geography conversation routes as a bypass', async () => {
    const geography = await makeGeography('Admin Bypass Region');
    const { agent } = await loginAsAdmin(1);
    const res = await agent.get(`/api/geographies/${geography.id}/conversation`);
    expect(res.status).toBe(401);
  });

  it('sending to an inaccessible Geography also returns 404, and creates no message', async () => {
    const geography = await makeGeography('Inaccessible Send Region');
    const { agent, csrf } = await loginAsMember('+237696900019', 'geoconv-member19@example.com');

    const res = await agent
      .post(`/api/geographies/${geography.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Should not be created.' });
    expect(res.status).toBe(404);
    const conversation = await prisma.geographyConversation.findUnique({ where: { geographyId: geography.id } });
    expect(conversation).toBeNull();
  });
});

describe('Phase 3M.6 — pagination', () => {
  it('cursor pagination returns oldest-first with hasMore, and rejects an invalid cursor', async () => {
    const geography = await makeGeography('Pagination Region');
    const { agent, csrf, person } = await loginAsMember('+237696900020', 'geoconv-member20@example.com');
    await assignGeography(person.id, geography.id);

    for (let i = 0; i < 3; i++) {
      await agent
        .post(`/api/geographies/${geography.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ body: `Message ${i}` });
    }

    const page = await agent.get(`/api/geographies/${geography.id}/conversation/messages?limit=2`);
    expect(page.status).toBe(200);
    expect(page.body.items).toHaveLength(2);
    expect(page.body.hasMore).toBe(true);
    expect(page.body.items.map((m: any) => m.body)).toEqual(['Message 1', 'Message 2']);

    const invalidCursor = await agent.get(`/api/geographies/${geography.id}/conversation/messages?before=not-a-real-id`);
    expect(invalidCursor.status).toBe(400);
  });
});

describe('Phase 3M.6 — lazy get-or-create and dynamic reassignment', () => {
  it('the conversation is created lazily on first access, and repeated access never creates a duplicate', async () => {
    const geography = await makeGeography('Lazy Creation Region');
    const { agent, person } = await loginAsMember('+237696900021', 'geoconv-member21@example.com');
    await assignGeography(person.id, geography.id);

    expect(await prisma.geographyConversation.findUnique({ where: { geographyId: geography.id } })).toBeNull();

    await agent.get(`/api/geographies/${geography.id}/conversation`);
    await agent.get(`/api/geographies/${geography.id}/conversation`);

    const rows = await prisma.geographyConversation.findMany({ where: { geographyId: geography.id } });
    expect(rows).toHaveLength(1);
  });

  it('moving to a new Geography changes access on the very next request — no caching', async () => {
    const villageA = await makeGeography('Reassignment Village A');
    const villageB = await makeGeography('Reassignment Village B');
    const { agent, person } = await loginAsMember('+237696900022', 'geoconv-member22@example.com');
    const assignment = await assignGeography(person.id, villageA.id);

    const before = await agent.get(`/api/geographies/${villageA.id}/conversation`);
    expect(before.status).toBe(200);
    const beforeOther = await agent.get(`/api/geographies/${villageB.id}/conversation`);
    expect(beforeOther.status).toBe(404);

    await prisma.geographicAssignment.update({ where: { id: assignment.id }, data: { geographyId: villageB.id } });

    const afterOld = await agent.get(`/api/geographies/${villageA.id}/conversation`);
    expect(afterOld.status).toBe(404);
    const afterNew = await agent.get(`/api/geographies/${villageB.id}/conversation`);
    expect(afterNew.status).toBe(200);
  });
});

describe('Phase 3M.7 — Geography Conversation — read state', () => {
  it('an authorized ordinary Person can mark the conversation read', async () => {
    const geography = await makeGeography('Read Region 1');
    const { agent, csrf, person } = await loginAsMember('+237696900101', 'geoconv-read1@example.com');
    await assignGeography(person.id, geography.id);
    const leader = await prisma.person.create({ data: { name: 'Sender Leader 1', whatsappNumber: '+237696900201' } });
    const conversation = await prisma.geographyConversation.upsert({
      where: { geographyId: geography.id },
      create: { geographyId: geography.id },
      update: {},
    });
    const msg = await prisma.geographyMessage.create({
      data: { conversationId: conversation.id, senderPersonId: leader.id, body: 'From someone else' },
    });

    const res = await agent
      .post(`/api/geographies/${geography.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg.id });
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(0);
  });

  it('an authorized exact-match Leader can mark the conversation read', async () => {
    const geography = await makeGeography('Read Region 2');
    const { agent, csrf, person } = await setupGeographyLeader(105, geography.id);
    const conversation = await prisma.geographyConversation.upsert({
      where: { geographyId: geography.id },
      create: { geographyId: geography.id },
      update: {},
    });
    const msg = await prisma.geographyMessage.create({
      data: { conversationId: conversation.id, senderPersonId: person.id, body: 'Leader own message' },
    });

    const res = await agent
      .post(`/api/geographies/${geography.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg.id });
    expect(res.status).toBe(200);
  });

  it('an unauthorized Person (no relationship to G) cannot mark it read — hierarchy rules preserved', async () => {
    const region = await makeGeography('Read Region 3 Parent');
    const village = await makeGeography('Read Region 3 Child', region.id);
    const { agent, csrf, person } = await loginAsMember('+237696900102', 'geoconv-read3@example.com');
    // Assigned to the region — an ANCESTOR of village — so still denied
    // access to the village's own conversation.
    await assignGeography(person.id, region.id);
    const conversation = await prisma.geographyConversation.upsert({
      where: { geographyId: village.id },
      create: { geographyId: village.id },
      update: {},
    });
    const msg = await prisma.geographyMessage.create({
      data: { conversationId: conversation.id, senderPersonId: person.id, body: 'x' },
    });

    const res = await agent
      .post(`/api/geographies/${village.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg.id });
    expect(res.status).toBe(404);
  });

  it('a messageId from a different Geography\'s conversation is rejected (IDOR)', async () => {
    const geographyA = await makeGeography('Read Region 4A');
    const geographyB = await makeGeography('Read Region 4B');
    const { agent, csrf, person } = await loginAsMember('+237696900103', 'geoconv-read4@example.com');
    await assignGeography(person.id, geographyA.id);
    const conversationB = await prisma.geographyConversation.upsert({
      where: { geographyId: geographyB.id },
      create: { geographyId: geographyB.id },
      update: {},
    });
    const msgInB = await prisma.geographyMessage.create({
      data: { conversationId: conversationB.id, senderPersonId: person.id, body: 'In B' },
    });

    const res = await agent
      .post(`/api/geographies/${geographyA.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msgInB.id });
    expect(res.status).toBe(400);
  });

  it('GET requests never write read state', async () => {
    const geography = await makeGeography('Read Region 5');
    const { agent, person } = await loginAsMember('+237696900104', 'geoconv-read5@example.com');
    await assignGeography(person.id, geography.id);
    const conversation = await prisma.geographyConversation.upsert({
      where: { geographyId: geography.id },
      create: { geographyId: geography.id },
      update: {},
    });
    await prisma.geographyMessage.create({
      data: { conversationId: conversation.id, senderPersonId: person.id, body: 'x' },
    });

    await agent.get(`/api/geographies/${geography.id}/conversation`);
    await agent.get(`/api/geographies/${geography.id}/conversation/messages`);

    const read = await prisma.geographyConversationRead.findUnique({
      where: { personId_conversationId: { personId: person.id, conversationId: conversation.id } },
    });
    expect(read).toBeNull();
  });

  it('requires CSRF protection', async () => {
    const geography = await makeGeography('Read Region 6');
    const { agent, person } = await loginAsMember('+237696900105', 'geoconv-read6@example.com');
    await assignGeography(person.id, geography.id);
    const conversation = await prisma.geographyConversation.upsert({
      where: { geographyId: geography.id },
      create: { geographyId: geography.id },
      update: {},
    });
    const msg = await prisma.geographyMessage.create({
      data: { conversationId: conversation.id, senderPersonId: person.id, body: 'x' },
    });

    const res = await agent.post(`/api/geographies/${geography.id}/conversation/read`).send({ messageId: msg.id });
    expect(res.status).toBe(403);
  });

  it('an unauthenticated caller cannot mark read', async () => {
    const geography = await makeGeography('Read Region 7');
    const anon = agentWithUniqueIp();
    const res = await anon.post(`/api/geographies/${geography.id}/conversation/read`).send({ messageId: 'x' });
    expect(res.status).toBe(401);
  });

  it('a nonexistent Geography returns 404 for the read route, indistinguishable from a real inaccessible one', async () => {
    const { agent, csrf } = await loginAsMember('+237696900106', 'geoconv-read8@example.com');
    const res = await agent
      .post('/api/geographies/00000000-0000-0000-0000-000000000000/conversation/read')
      .set('X-CSRF-Token', csrf)
      .send({ messageId: 'x' });
    expect(res.status).toBe(404);
  });

  it('a stale read-mark request never moves the cursor backwards', async () => {
    const geography = await makeGeography('Read Region 8');
    const { agent, csrf, person } = await loginAsMember('+237696900107', 'geoconv-read9@example.com');
    await assignGeography(person.id, geography.id);
    const other = await prisma.person.create({ data: { name: 'Other Sender', whatsappNumber: '+237696900207' } });
    const conversation = await prisma.geographyConversation.upsert({
      where: { geographyId: geography.id },
      create: { geographyId: geography.id },
      update: {},
    });
    const older = await prisma.geographyMessage.create({
      data: { conversationId: conversation.id, senderPersonId: other.id, body: 'older' },
    });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await prisma.geographyMessage.create({
      data: { conversationId: conversation.id, senderPersonId: other.id, body: 'newer' },
    });

    await agent
      .post(`/api/geographies/${geography.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: newer.id });
    await agent
      .post(`/api/geographies/${geography.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: older.id });

    const stored = await prisma.geographyConversationRead.findUnique({
      where: { personId_conversationId: { personId: person.id, conversationId: conversation.id } },
    });
    expect(stored!.lastReadAt.getTime()).toBe(newer.createdAt.getTime());
  });

  it('unread count excludes the reader\'s own sent messages', async () => {
    const geography = await makeGeography('Read Region 9');
    const { agent, csrf, person } = await loginAsMember('+237696900108', 'geoconv-read10@example.com');
    await assignGeography(person.id, geography.id);

    await agent
      .post(`/api/geographies/${geography.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'my own message' });

    const res = await agent.get(`/api/geographies/${geography.id}/conversation`);
    expect(res.body.unreadCount).toBe(0);
  });

  it('read state is Person-specific and tied to the correct conversation across the Geography hierarchy', async () => {
    const region = await makeGeography('Read Region 10 Parent');
    const village = await makeGeography('Read Region 10 Child', region.id);
    const { agent, csrf, person } = await loginAsMember('+237696900109', 'geoconv-read11@example.com');
    await assignGeography(person.id, village.id);
    const other = await prisma.person.create({ data: { name: 'Other Sender 10', whatsappNumber: '+237696900209' } });

    const regionConversation = await prisma.geographyConversation.upsert({
      where: { geographyId: region.id },
      create: { geographyId: region.id },
      update: {},
    });
    const villageConversation = await prisma.geographyConversation.upsert({
      where: { geographyId: village.id },
      create: { geographyId: village.id },
      update: {},
    });
    const regionMsg = await prisma.geographyMessage.create({
      data: { conversationId: regionConversation.id, senderPersonId: other.id, body: 'in region' },
    });
    await prisma.geographyMessage.create({
      data: { conversationId: villageConversation.id, senderPersonId: other.id, body: 'in village' },
    });

    // Marking the region's conversation read must not affect the village's
    // own, separate unread count.
    await agent
      .post(`/api/geographies/${region.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: regionMsg.id });

    const regionRes = await agent.get(`/api/geographies/${region.id}/conversation`);
    expect(regionRes.body.unreadCount).toBe(0);
    const villageRes = await agent.get(`/api/geographies/${village.id}/conversation`);
    expect(villageRes.body.unreadCount).toBe(1);
  });
});
