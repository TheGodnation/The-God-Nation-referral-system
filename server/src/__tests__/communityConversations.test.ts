import crypto from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Phase 3M.8C — lib/storage.ts is the ONLY file that talks to Cloudflare
// R2; every attachment test below mocks it rather than touching real object
// storage (no R2 credentials exist in this test environment, by design —
// see the Phase 3M.8C architecture report). This lets every test below
// exercise the real authorization/validation/finalize logic in
// communityConversations.ts while treating "does R2 actually store the
// bytes" as already covered by the AWS SDK itself.
vi.mock('../lib/storage', () => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({
    url: `https://mock-r2.example/upload/${storageKey}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })),
  createDownloadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({
    url: `https://mock-r2.example/download/${storageKey}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  })),
  headObject: vi.fn(async () => null),
}));
import * as storage from '../lib/storage';

function communityStorageKey(communityId: string): string {
  return `communities/${communityId}/attachments/${crypto.randomUUID()}`;
}

// Phase 3M.1 — Community Text Conversation. Mirrors the exact conventions
// established in leadershipProposals.test.ts (Phase 3L): agentWithUniqueIp,
// createLeader/createAdmin, bootstrap, loginAsMember.

const app = createApp();

let ipCounter = 0;
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

async function makePerson(whatsappNumber: string, name = 'Conversation Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function makeMembership(personId: string, communityId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  return prisma.communityMembership.create({ data: { personId, communityId, status } });
}

async function setupCommunityLeader(n: number, communityId: string) {
  const email = `conv-leader${n}@test.local`;
  const { user } = await createLeader(`Conversation Leader ${n}`, email, `CV${n}CODE`);
  const person = await makePerson(`+237697${String(n).padStart(6, '0')}`, `Conversation Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  const role = await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person, role };
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

async function loginAsMember(whatsapp: string, email: string, name = 'Conversation Member Person') {
  const person = await prisma.person.create({ data: { name, whatsappNumber: whatsapp } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const requestAgent = agentWithUniqueIp();
  const { csrf: requestCsrf } = await bootstrap(requestAgent as any);
  await requestAgent.post('/api/member/auth/request-link').set('X-CSRF-Token', requestCsrf).send({ whatsapp, email });
  const link = spy.mock.calls[0][0].link as string;
  spy.mockRestore();
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/consume').set('X-CSRF-Token', csrf).send({ token: extractToken(link) });
  return { agent, csrf, person };
}

describe('Phase 3M.1 — Community Conversation — access authorization', () => {
  it('1. an active CommunityMember can read the conversation', async () => {
    const community = await makeCommunity('Access Community 1');
    const { agent, person } = await loginAsMember('+237698000001', 'conv1@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent.get(`/api/communities/${community.id}/conversation`);
    expect(res.status).toBe(200);
    expect(res.body.communityId).toBe(community.id);
  });

  it('2. an active CommunityMember can post', async () => {
    const community = await makeCommunity('Access Community 2');
    const { agent, csrf, person } = await loginAsMember('+237698000002', 'conv2@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Hello, community!' });
    expect(res.status).toBe(201);
    expect(res.body.body).toBe('Hello, community!');
  });

  it('3. an active Community Leader can read even without a CommunityMembership row', async () => {
    const community = await makeCommunity('Access Community 3');
    const { agent } = await setupCommunityLeader(3, community.id);

    const res = await agent.get(`/api/communities/${community.id}/conversation`);
    expect(res.status).toBe(200);
  });

  it('4. an active Community Leader can post even without a CommunityMembership row', async () => {
    const community = await makeCommunity('Access Community 4');
    const { agent, csrf } = await setupCommunityLeader(4, community.id);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Leader message.' });
    expect(res.status).toBe(201);
  });

  it('5. a person with INACTIVE CommunityMembership (and no leader role) cannot read', async () => {
    const community = await makeCommunity('Access Community 5');
    const { agent, person } = await loginAsMember('+237698000005', 'conv5@example.com');
    await makeMembership(person.id, community.id, 'INACTIVE');

    const res = await agent.get(`/api/communities/${community.id}/conversation`);
    expect(res.status).toBe(403);
  });

  it('6. a person with INACTIVE CommunityMembership (and no leader role) cannot post', async () => {
    const community = await makeCommunity('Access Community 6');
    const { agent, csrf, person } = await loginAsMember('+237698000006', 'conv6@example.com');
    await makeMembership(person.id, community.id, 'INACTIVE');

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Should be rejected.' });
    expect(res.status).toBe(403);
  });

  it('7. a former Community Leader (ended role, no membership) cannot read', async () => {
    const community = await makeCommunity('Access Community 7');
    const { agent, role } = await setupCommunityLeader(7, community.id);
    await prisma.roleAssignment.update({ where: { id: role.id }, data: { status: 'ENDED', endedAt: new Date() } });

    const res = await agent.get(`/api/communities/${community.id}/conversation`);
    expect(res.status).toBe(403);
  });

  it('8. a former Community Leader (ended role, no membership) cannot post', async () => {
    const community = await makeCommunity('Access Community 8');
    const { agent, csrf, role } = await setupCommunityLeader(8, community.id);
    await prisma.roleAssignment.update({ where: { id: role.id }, data: { status: 'ENDED', endedAt: new Date() } });

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Should be rejected.' });
    expect(res.status).toBe(403);
  });

  it('9. a former Community Leader who remains an active member keeps access', async () => {
    const community = await makeCommunity('Access Community 9');
    const { agent, csrf, person, role } = await setupCommunityLeader(9, community.id);
    await makeMembership(person.id, community.id, 'ACTIVE');
    await prisma.roleAssignment.update({ where: { id: role.id }, data: { status: 'ENDED', endedAt: new Date() } });

    const readRes = await agent.get(`/api/communities/${community.id}/conversation`);
    expect(readRes.status).toBe(200);

    const postRes = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Still a member.' });
    expect(postRes.status).toBe(201);
  });

  it('10. a member of a different Community cannot access this Community\'s conversation', async () => {
    const communityA = await makeCommunity('Access Community 10A');
    const communityB = await makeCommunity('Access Community 10B');
    const { agent, person } = await loginAsMember('+237698000010', 'conv10@example.com');
    await makeMembership(person.id, communityB.id);

    const res = await agent.get(`/api/communities/${communityA.id}/conversation`);
    expect(res.status).toBe(403);
  });

  it('11. an unauthenticated user cannot access', async () => {
    const community = await makeCommunity('Access Community 11');
    const anon = agentWithUniqueIp();

    const readRes = await anon.get(`/api/communities/${community.id}/conversation`);
    expect(readRes.status).toBe(401);

    const listRes = await anon.get(`/api/communities/${community.id}/conversation/messages`);
    expect(listRes.status).toBe(401);
  });

  it('an Admin (no membership, no leader role) cannot access via this route', async () => {
    const community = await makeCommunity('Access Community Admin');
    const { agent } = await loginAsAdmin('admin-conv1@test.local');

    const res = await agent.get(`/api/communities/${community.id}/conversation`);
    expect(res.status).toBe(401);
  });

  it('a nonexistent Community returns 404, not 403', async () => {
    const { agent } = await loginAsMember('+237698000099', 'conv99@example.com');
    const res = await agent.get('/api/communities/00000000-0000-0000-0000-000000000000/conversation');
    expect(res.status).toBe(404);
  });
});

describe('Phase 3M.1 — Community Conversation — sender security', () => {
  it('12. the sender is derived from the authenticated session', async () => {
    const community = await makeCommunity('Sender Community 12');
    const { agent, csrf, person } = await loginAsMember('+237698000012', 'conv12@example.com');
    await makeMembership(person.id, community.id);

    const postRes = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'From me.' });
    expect(postRes.status).toBe(201);

    const stored = await prisma.message.findUnique({ where: { id: postRes.body.id } });
    expect(stored!.senderPersonId).toBe(person.id);
  });

  it('13. a client cannot impersonate another Person by supplying a sender id', async () => {
    const community = await makeCommunity('Sender Community 13');
    const { agent, csrf, person } = await loginAsMember('+237698000013', 'conv13@example.com');
    await makeMembership(person.id, community.id);
    const otherPerson = await makePerson('+237698100013', 'Someone Else');

    const postRes = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Impersonation attempt.', senderPersonId: otherPerson.id, personId: otherPerson.id });
    expect(postRes.status).toBe(201);

    const stored = await prisma.message.findUnique({ where: { id: postRes.body.id } });
    expect(stored!.senderPersonId).toBe(person.id);
    expect(stored!.senderPersonId).not.toBe(otherPerson.id);
  });

  it('17. unexpected sender identity fields never override the authenticated sender (also covers extra unknown fields)', async () => {
    const community = await makeCommunity('Sender Community 17');
    const { agent, csrf, person } = await loginAsMember('+237698000017', 'conv17@example.com');
    await makeMembership(person.id, community.id);

    const postRes = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Extra fields.', senderPersonId: 'not-a-real-id', role: 'ADMIN', conversationId: 'forged' });
    expect(postRes.status).toBe(201);

    const stored = await prisma.message.findUnique({ where: { id: postRes.body.id } });
    expect(stored!.senderPersonId).toBe(person.id);
  });
});

describe('Phase 3M.1 — Community Conversation — message validation', () => {
  it('14. an empty body is rejected', async () => {
    const community = await makeCommunity('Validation Community 14');
    const { agent, csrf, person } = await loginAsMember('+237698000014', 'conv14@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: '' });
    expect(res.status).toBe(400);
  });

  it('a whitespace-only body is rejected', async () => {
    const community = await makeCommunity('Validation Community 14b');
    const { agent, csrf, person } = await loginAsMember('+237698000114', 'conv14b@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: '   ' });
    expect(res.status).toBe(400);
  });

  it('15. a body over 2000 characters is rejected', async () => {
    const community = await makeCommunity('Validation Community 15');
    const { agent, csrf, person } = await loginAsMember('+237698000015', 'conv15@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'x'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  it('16. a valid body is accepted', async () => {
    const community = await makeCommunity('Validation Community 16');
    const { agent, csrf, person } = await loginAsMember('+237698000016', 'conv16@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'x'.repeat(2000) });
    expect(res.status).toBe(201);
  });

  it('requires CSRF protection on message send', async () => {
    const community = await makeCommunity('Validation Community CSRF');
    const { agent, person } = await loginAsMember('+237698000018', 'conv18@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent.post(`/api/communities/${community.id}/conversation/messages`).send({ body: 'No CSRF.' });
    expect(res.status).toBe(403);
  });
});

describe('Phase 3M.1 — Community Conversation — pagination', () => {
  async function seedMessages(communityId: string, senderId: string, count: number) {
    const created = [];
    for (let i = 0; i < count; i++) {
      const conversation = await prisma.conversation.upsert({
        where: { communityId },
        create: { communityId },
        update: {},
      });
      const msg = await prisma.message.create({
        data: { conversationId: conversation.id, senderPersonId: senderId, body: `Message ${i}` },
      });
      created.push(msg);
      // Ensure strictly increasing createdAt ordering even under fast test execution.
      await new Promise((r) => setTimeout(r, 2));
    }
    return created;
  }

  it('18. the default page size is 30', async () => {
    const community = await makeCommunity('Pagination Community 18');
    const { agent, person } = await loginAsMember('+237698000020', 'conv20@example.com');
    await makeMembership(person.id, community.id);
    await seedMessages(community.id, person.id, 35);

    const res = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(30);
    expect(res.body.hasMore).toBe(true);
  });

  it('19. the maximum page size (50) is enforced even if a larger limit is requested', async () => {
    const community = await makeCommunity('Pagination Community 19');
    const { agent, person } = await loginAsMember('+237698000021', 'conv21@example.com');
    await makeMembership(person.id, community.id);
    await seedMessages(community.id, person.id, 55);

    const res = await agent.get(`/api/communities/${community.id}/conversation/messages?limit=1000`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(50);
  });

  it('20-21. cursor pagination retrieves older messages correctly, oldest-first within each page', async () => {
    const community = await makeCommunity('Pagination Community 20');
    const { agent, person } = await loginAsMember('+237698000022', 'conv22@example.com');
    await makeMembership(person.id, community.id);
    const created = await seedMessages(community.id, person.id, 5);

    const firstPage = await agent.get(`/api/communities/${community.id}/conversation/messages?limit=3`);
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.items.length).toBe(3);
    expect(firstPage.body.hasMore).toBe(true);
    // Newest 3 of 5, returned oldest-first: messages 2,3,4.
    expect(firstPage.body.items.map((m: any) => m.body)).toEqual(['Message 2', 'Message 3', 'Message 4']);

    const oldestOnPage = firstPage.body.items[0].id;
    const secondPage = await agent.get(
      `/api/communities/${community.id}/conversation/messages?limit=3&before=${oldestOnPage}`,
    );
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items.map((m: any) => m.body)).toEqual(['Message 0', 'Message 1']);
    expect(secondPage.body.hasMore).toBe(false);
    expect(created.length).toBe(5);
  });

  it('a cursor from a different conversation is rejected', async () => {
    const communityA = await makeCommunity('Pagination Community A');
    const communityB = await makeCommunity('Pagination Community B');
    const { agent, person } = await loginAsMember('+237698000023', 'conv23@example.com');
    await makeMembership(person.id, communityA.id);
    await makeMembership(person.id, communityB.id);
    const [messageInB] = await seedMessages(communityB.id, person.id, 1);

    const res = await agent.get(`/api/communities/${communityA.id}/conversation/messages?before=${messageInB.id}`);
    expect(res.status).toBe(400);
  });
});

describe('Phase 3M.1 — Community Conversation — uniqueness', () => {
  it('22. a Community cannot receive more than one Conversation', async () => {
    const community = await makeCommunity('Uniqueness Community 22');
    await prisma.conversation.create({ data: { communityId: community.id } });

    await expect(prisma.conversation.create({ data: { communityId: community.id } })).rejects.toThrow();
  });

  it('repeated GETs never create more than one Conversation for the same Community', async () => {
    const community = await makeCommunity('Uniqueness Community 22b');
    const { agent, person } = await loginAsMember('+237698000024', 'conv24@example.com');
    await makeMembership(person.id, community.id);

    const first = await agent.get(`/api/communities/${community.id}/conversation`);
    const second = await agent.get(`/api/communities/${community.id}/conversation`);
    expect(first.body.id).toBe(second.body.id);

    const count = await prisma.conversation.count({ where: { communityId: community.id } });
    expect(count).toBe(1);
  });

  it('creating a Community via the Admin route creates its Conversation eagerly', async () => {
    const { agent, csrf } = await loginAsAdmin('admin-conv2@test.local');
    const res = await agent
      .post('/api/admin/communities')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Eagerly Created Community' });
    expect(res.status).toBe(201);

    const conversation = await prisma.conversation.findUnique({ where: { communityId: res.body.id } });
    expect(conversation).toBeTruthy();
  });
});

describe('Phase 3M.1 — Community Conversation — rate limiting', () => {
  it('23. the dedicated message-send rate limiter applies', async () => {
    const community = await makeCommunity('Rate Limit Community 23');
    const { agent, csrf, person } = await loginAsMember('+237698000025', 'conv25@example.com');
    await makeMembership(person.id, community.id);

    let lastStatus = 200;
    for (let i = 0; i < 61; i++) {
      const res = await agent
        .post(`/api/communities/${community.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ body: `Message ${i}` });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('Phase 3M.7 — Community Conversation — read state', () => {
  it('a member can mark the conversation read up to a given message', async () => {
    const community = await makeCommunity('Read Community 1');
    const { agent, csrf, person } = await loginAsMember('+237698100001', 'read1@example.com');
    await makeMembership(person.id, community.id);

    const sender = await makePerson('+237698100101', 'Other Sender 1');
    await makeMembership(sender.id, community.id);
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'Hello' },
    });

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg.id });
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(0);

    const stored = await prisma.communityConversationRead.findUnique({
      where: { personId_conversationId: { personId: person.id, conversationId: conversation.id } },
    });
    expect(stored).toBeTruthy();
    expect(stored!.lastReadAt.getTime()).toBe(msg.createdAt.getTime());
  });

  it('a leader can mark the conversation read even without a CommunityMembership row', async () => {
    const community = await makeCommunity('Read Community 2');
    const { agent, csrf, person } = await setupCommunityLeader(102, community.id);
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: person.id, body: 'Leader own message' },
    });

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg.id });
    expect(res.status).toBe(200);
  });

  it('a person with no access to the community cannot mark it read', async () => {
    const community = await makeCommunity('Read Community 3');
    const { agent, csrf } = await loginAsMember('+237698100003', 'read3@example.com');
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const other = await makePerson('+237698100103', 'Someone Else 3');
    const msg = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: other.id, body: 'Not yours to read' },
    });

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg.id });
    expect(res.status).toBe(403);
  });

  it('an unauthenticated user cannot mark a conversation read', async () => {
    const community = await makeCommunity('Read Community 4');
    const anon = agentWithUniqueIp();
    const res = await anon.post(`/api/communities/${community.id}/conversation/read`).send({ messageId: 'anything' });
    expect(res.status).toBe(401);
  });

  it('requires CSRF protection', async () => {
    const community = await makeCommunity('Read Community 5');
    const { agent, person } = await loginAsMember('+237698100005', 'read5@example.com');
    await makeMembership(person.id, community.id);
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: person.id, body: 'x' },
    });

    const res = await agent.post(`/api/communities/${community.id}/conversation/read`).send({ messageId: msg.id });
    expect(res.status).toBe(403);
  });

  it('a client-supplied personId is ignored — the cursor is always the authenticated caller\'s own', async () => {
    const community = await makeCommunity('Read Community 6');
    const { agent, csrf, person } = await loginAsMember('+237698100006', 'read6@example.com');
    await makeMembership(person.id, community.id);
    const other = await makePerson('+237698100106', 'Someone Else 6');
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: person.id, body: 'x' },
    });

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg.id, personId: other.id });
    expect(res.status).toBe(200);

    const otherRead = await prisma.communityConversationRead.findUnique({
      where: { personId_conversationId: { personId: other.id, conversationId: conversation.id } },
    });
    expect(otherRead).toBeNull();
  });

  it('a message id from a different conversation is rejected (IDOR)', async () => {
    const communityA = await makeCommunity('Read Community 7A');
    const communityB = await makeCommunity('Read Community 7B');
    const { agent, csrf, person } = await loginAsMember('+237698100007', 'read7@example.com');
    await makeMembership(person.id, communityA.id);
    await makeMembership(person.id, communityB.id);
    const conversationB = await prisma.conversation.upsert({
      where: { communityId: communityB.id },
      create: { communityId: communityB.id },
      update: {},
    });
    const msgInB = await prisma.message.create({
      data: { conversationId: conversationB.id, senderPersonId: person.id, body: 'In B' },
    });

    const res = await agent
      .post(`/api/communities/${communityA.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msgInB.id });
    expect(res.status).toBe(400);
  });

  it('GET requests never write read state — only the dedicated POST route does', async () => {
    const community = await makeCommunity('Read Community 8');
    const { agent, person } = await loginAsMember('+237698100008', 'read8@example.com');
    await makeMembership(person.id, community.id);
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: person.id, body: 'x' } });

    await agent.get(`/api/communities/${community.id}/conversation`);
    await agent.get(`/api/communities/${community.id}/conversation/messages`);

    const read = await prisma.communityConversationRead.findUnique({
      where: { personId_conversationId: { personId: person.id, conversationId: conversation.id } },
    });
    expect(read).toBeNull();
  });

  it('marking read is idempotent — repeating the same messageId does not error or duplicate rows', async () => {
    const community = await makeCommunity('Read Community 9');
    const { agent, csrf, person } = await loginAsMember('+237698100009', 'read9@example.com');
    await makeMembership(person.id, community.id);
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: person.id, body: 'x' },
    });

    const first = await agent
      .post(`/api/communities/${community.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg.id });
    expect(first.status).toBe(200);
    const second = await agent
      .post(`/api/communities/${community.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg.id });
    expect(second.status).toBe(200);

    const count = await prisma.communityConversationRead.count({
      where: { personId: person.id, conversationId: conversation.id },
    });
    expect(count).toBe(1);
  });

  it('a stale (older) read-mark request never moves the cursor backwards', async () => {
    const community = await makeCommunity('Read Community 10');
    const { agent, csrf, person } = await loginAsMember('+237698100010', 'read10@example.com');
    await makeMembership(person.id, community.id);
    const sender = await makePerson('+237698100110', 'Other Sender 10');
    await makeMembership(sender.id, community.id);
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const older = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'older' },
    });
    await new Promise((r) => setTimeout(r, 5));
    const newer = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'newer' },
    });

    await agent
      .post(`/api/communities/${community.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: newer.id });

    const staleRes = await agent
      .post(`/api/communities/${community.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: older.id });
    expect(staleRes.status).toBe(200);

    const stored = await prisma.communityConversationRead.findUnique({
      where: { personId_conversationId: { personId: person.id, conversationId: conversation.id } },
    });
    expect(stored!.lastReadAt.getTime()).toBe(newer.createdAt.getTime());
  });

  it('unread count excludes the reader\'s own sent messages', async () => {
    const community = await makeCommunity('Read Community 11');
    const { agent, person } = await loginAsMember('+237698100011', 'read11@example.com');
    await makeMembership(person.id, community.id);
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: person.id, body: 'my own message' },
    });

    const res = await agent.get(`/api/communities/${community.id}/conversation`);
    expect(res.status).toBe(200);
    expect(res.body.unreadCount).toBe(0);
  });

  it('unread count reflects messages from others and drops to zero after marking read', async () => {
    const community = await makeCommunity('Read Community 12');
    const { agent, csrf, person } = await loginAsMember('+237698100012', 'read12@example.com');
    await makeMembership(person.id, community.id);
    const sender = await makePerson('+237698100112', 'Other Sender 12');
    await makeMembership(sender.id, community.id);
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg1 = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'one' },
    });
    await new Promise((r) => setTimeout(r, 2));
    await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'two' },
    });

    const before = await agent.get(`/api/communities/${community.id}/conversation`);
    expect(before.body.unreadCount).toBe(2);

    await agent
      .post(`/api/communities/${community.id}/conversation/read`)
      .set('X-CSRF-Token', csrf)
      .send({ messageId: msg1.id });

    const afterPartial = await agent.get(`/api/communities/${community.id}/conversation`);
    expect(afterPartial.body.unreadCount).toBe(1);
  });

  it('read state is Person-specific — one member\'s read state never affects another\'s unread count', async () => {
    const community = await makeCommunity('Read Community 13');
    const { agent: agentA, csrf: csrfA, person: personA } = await loginAsMember('+237698100013', 'read13a@example.com');
    const { agent: agentB } = await loginAsMember('+237698100014', 'read13b@example.com');
    await makeMembership(personA.id, community.id);
    const personBRecord = await prisma.person.findFirst({ where: { whatsappNumber: '+237698100014' } });
    await makeMembership(personBRecord!.id, community.id);
    const sender = await makePerson('+237698100115', 'Other Sender 13');
    await makeMembership(sender.id, community.id);
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'shared' },
    });

    await agentA
      .post(`/api/communities/${community.id}/conversation/read`)
      .set('X-CSRF-Token', csrfA)
      .send({ messageId: msg.id });

    const aRes = await agentA.get(`/api/communities/${community.id}/conversation`);
    expect(aRes.body.unreadCount).toBe(0);

    const bRes = await agentB.get(`/api/communities/${community.id}/conversation`);
    expect(bRes.body.unreadCount).toBe(1);
  });

  it('a nonexistent Community returns 404 for the read route', async () => {
    const { agent, csrf } = await loginAsMember('+237698100099', 'read99@example.com');
    const res = await agent
      .post('/api/communities/00000000-0000-0000-0000-000000000000/conversation/read')
      .set('X-CSRF-Token', csrf)
      .send({ messageId: 'x' });
    expect(res.status).toBe(404);
  });

  it('the same Person shares one read cursor whether they authenticate as Member or as Leader', async () => {
    const community = await makeCommunity('Read Community 15');
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237698100016', 'read15@example.com');
    await makeMembership(person.id, community.id);

    const { user } = await createLeader('Shared Identity Leader 15', 'read15-leader@test.local', 'RD15CODE');
    await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
    await prisma.roleAssignment.create({
      data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId: community.id },
    });
    const leaderAgent = agentWithUniqueIp();
    const { csrf: leaderCsrf } = await bootstrap(leaderAgent as any);
    await leaderAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', leaderCsrf)
      .send({ email: 'read15-leader@test.local', password: 'password123' });

    const sender = await makePerson('+237698100116', 'Other Sender 15');
    await makeMembership(sender.id, community.id);
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'shared identity' },
    });

    // Mark read via the Member session...
    await memberAgent
      .post(`/api/communities/${community.id}/conversation/read`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ messageId: msg.id });

    // ...and the Leader session for the SAME Person sees it as already read.
    const leaderRes = await leaderAgent.get(`/api/communities/${community.id}/conversation`);
    expect(leaderRes.body.unreadCount).toBe(0);

    const rows = await prisma.communityConversationRead.count({
      where: { personId: person.id, conversationId: conversation.id },
    });
    expect(rows).toBe(1);
  });

  it('the dedicated read rate limiter applies independently of the message-send limiter', async () => {
    const community = await makeCommunity('Read Community 14');
    const { agent, csrf, person } = await loginAsMember('+237698100015', 'read14@example.com');
    await makeMembership(person.id, community.id);
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: person.id, body: 'x' },
    });

    let lastStatus = 200;
    for (let i = 0; i < 121; i++) {
      const res = await agent
        .post(`/api/communities/${community.id}/conversation/read`)
        .set('X-CSRF-Token', csrf)
        .send({ messageId: msg.id });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('Phase 3M.8A — Community Administration — message moderation', () => {
  async function seedMessage(communityId: string, senderId: string, body = 'inappropriate content') {
    const conversation = await prisma.conversation.upsert({
      where: { communityId },
      create: { communityId },
      update: {},
    });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: senderId, body } });
    return { conversation, message };
  }

  it('an active Community Administrator can delete a message in their exact Community', async () => {
    const community = await makeCommunity('Moderation Community 1');
    const { agent, csrf } = await setupCommunityLeader(201, community.id);
    const sender = await makePerson('+237698200001', 'Sender 1');
    await makeMembership(sender.id, community.id);
    const { message } = await seedMessage(community.id, sender.id);

    const res = await agent
      .delete(`/api/communities/${community.id}/conversation/messages/${message.id}`)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    const stored = await prisma.message.findUnique({ where: { id: message.id } });
    expect(stored!.deletedAt).not.toBeNull();
  });

  it('the original message body is preserved in the database (soft delete only)', async () => {
    const community = await makeCommunity('Moderation Community 2');
    const { agent, csrf } = await setupCommunityLeader(202, community.id);
    const sender = await makePerson('+237698200002', 'Sender 2');
    await makeMembership(sender.id, community.id);
    const { message } = await seedMessage(community.id, sender.id, 'the real original text');

    await agent
      .delete(`/api/communities/${community.id}/conversation/messages/${message.id}`)
      .set('X-CSRF-Token', csrf);

    const stored = await prisma.message.findUnique({ where: { id: message.id } });
    expect(stored!.body).toBe('the real original text');
    expect(stored!.deletedByPersonId).toBeTruthy();
  });

  it('an ordinary Member (no scoped role) cannot delete a message', async () => {
    const community = await makeCommunity('Moderation Community 3');
    const { agent, csrf, person } = await loginAsMember('+237698200003', 'mod3@example.com');
    await makeMembership(person.id, community.id);
    const { message } = await seedMessage(community.id, person.id);

    const res = await agent
      .delete(`/api/communities/${community.id}/conversation/messages/${message.id}`)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(403);

    const stored = await prisma.message.findUnique({ where: { id: message.id } });
    expect(stored!.deletedAt).toBeNull();
  });

  it('a Leader scoped to a DIFFERENT Community cannot delete a message here', async () => {
    const communityA = await makeCommunity('Moderation Community 4A');
    const communityB = await makeCommunity('Moderation Community 4B');
    const { agent, csrf } = await setupCommunityLeader(204, communityB.id);
    const sender = await makePerson('+237698200004', 'Sender 4');
    await makeMembership(sender.id, communityA.id);
    const { message } = await seedMessage(communityA.id, sender.id);

    const res = await agent
      .delete(`/api/communities/${communityA.id}/conversation/messages/${message.id}`)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(403);
  });

  it('a former Community Administrator (ended role) cannot delete a message', async () => {
    const community = await makeCommunity('Moderation Community 5');
    const { agent, csrf, role } = await setupCommunityLeader(205, community.id);
    await prisma.roleAssignment.update({ where: { id: role.id }, data: { status: 'ENDED', endedAt: new Date() } });
    const sender = await makePerson('+237698200005', 'Sender 5');
    await makeMembership(sender.id, community.id);
    const { message } = await seedMessage(community.id, sender.id);

    const res = await agent
      .delete(`/api/communities/${community.id}/conversation/messages/${message.id}`)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(403);
  });

  it('an unauthenticated caller cannot delete a message', async () => {
    const community = await makeCommunity('Moderation Community 6');
    const sender = await makePerson('+237698200006', 'Sender 6');
    await makeMembership(sender.id, community.id);
    const { message } = await seedMessage(community.id, sender.id);

    const anon = agentWithUniqueIp();
    const res = await anon.delete(`/api/communities/${community.id}/conversation/messages/${message.id}`);
    expect(res.status).toBe(401);
  });

  it('requires CSRF protection', async () => {
    const community = await makeCommunity('Moderation Community 7');
    const { agent } = await setupCommunityLeader(207, community.id);
    const sender = await makePerson('+237698200007', 'Sender 7');
    await makeMembership(sender.id, community.id);
    const { message } = await seedMessage(community.id, sender.id);

    const res = await agent.delete(`/api/communities/${community.id}/conversation/messages/${message.id}`);
    expect(res.status).toBe(403);
  });

  it('a message id from a different Community\'s conversation is rejected (IDOR)', async () => {
    const communityA = await makeCommunity('Moderation Community 8A');
    const communityB = await makeCommunity('Moderation Community 8B');
    const { agent, csrf } = await setupCommunityLeader(208, communityA.id);
    const sender = await makePerson('+237698200008', 'Sender 8');
    await makeMembership(sender.id, communityB.id);
    const { message: msgInB } = await seedMessage(communityB.id, sender.id);

    const res = await agent
      .delete(`/api/communities/${communityA.id}/conversation/messages/${msgInB.id}`)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(404);
  });

  it('a nonexistent Community returns 404', async () => {
    const { agent, csrf } = await setupCommunityLeader(209, (await makeCommunity('Moderation Community 9')).id);
    const res = await agent
      .delete('/api/communities/00000000-0000-0000-0000-000000000000/conversation/messages/00000000-0000-0000-0000-000000000000')
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(404);
  });

  it('a nonexistent message id returns 404', async () => {
    const community = await makeCommunity('Moderation Community 10');
    const { agent, csrf } = await setupCommunityLeader(210, community.id);

    const res = await agent
      .delete(`/api/communities/${community.id}/conversation/messages/00000000-0000-0000-0000-000000000000`)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(404);
  });

  it('deleting an already-deleted message is idempotent and preserves the original deleter', async () => {
    const community = await makeCommunity('Moderation Community 11');
    const { agent: agentA, csrf: csrfA, person: personA } = await setupCommunityLeader(211, community.id);
    const { agent: agentB, csrf: csrfB } = await setupCommunityLeader(212, community.id);
    const sender = await makePerson('+237698200011', 'Sender 11');
    await makeMembership(sender.id, community.id);
    const { message } = await seedMessage(community.id, sender.id);

    const first = await agentA
      .delete(`/api/communities/${community.id}/conversation/messages/${message.id}`)
      .set('X-CSRF-Token', csrfA);
    expect(first.status).toBe(200);

    const second = await agentB
      .delete(`/api/communities/${community.id}/conversation/messages/${message.id}`)
      .set('X-CSRF-Token', csrfB);
    expect(second.status).toBe(200);

    const stored = await prisma.message.findUnique({ where: { id: message.id } });
    expect(stored!.deletedByPersonId).toBe(personA.id);
  });

  it('a deleted message is redacted (body null, deleted true) for an ordinary participant reading the conversation', async () => {
    const community = await makeCommunity('Moderation Community 13');
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupCommunityLeader(213, community.id);
    const { agent: memberAgent, person: memberPerson } = await loginAsMember('+237698200013', 'mod13@example.com');
    await makeMembership(memberPerson.id, community.id);
    const { message } = await seedMessage(community.id, memberPerson.id, 'to be removed');

    await leaderAgent
      .delete(`/api/communities/${community.id}/conversation/messages/${message.id}`)
      .set('X-CSRF-Token', leaderCsrf);

    const res = await memberAgent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(res.status).toBe(200);
    const row = res.body.items.find((i: any) => i.id === message.id);
    expect(row.deleted).toBe(true);
    expect(row.body).toBeNull();
  });

  it('GET conversation metadata and messages report isAdministrator correctly for an administrator and an ordinary member', async () => {
    const community = await makeCommunity('Moderation Community 14');
    const { agent: leaderAgent } = await setupCommunityLeader(214, community.id);
    const { agent: memberAgent, person: memberPerson } = await loginAsMember('+237698200014', 'mod14@example.com');
    await makeMembership(memberPerson.id, community.id);

    const leaderMeta = await leaderAgent.get(`/api/communities/${community.id}/conversation`);
    expect(leaderMeta.body.isAdministrator).toBe(true);
    const memberMeta = await memberAgent.get(`/api/communities/${community.id}/conversation`);
    expect(memberMeta.body.isAdministrator).toBe(false);

    const leaderMsgs = await leaderAgent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(leaderMsgs.body.isAdministrator).toBe(true);
    const memberMsgs = await memberAgent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(memberMsgs.body.isAdministrator).toBe(false);
  });

  it('multiple active Community Administrators for the same Community may each independently moderate messages', async () => {
    const community = await makeCommunity('Moderation Community 15');
    const { agent: agentA, csrf: csrfA } = await setupCommunityLeader(215, community.id);
    const { agent: agentB, csrf: csrfB } = await setupCommunityLeader(216, community.id);
    const sender = await makePerson('+237698200015', 'Sender 15');
    await makeMembership(sender.id, community.id);
    const { message: msg1 } = await seedMessage(community.id, sender.id, 'first');
    const { message: msg2 } = await seedMessage(community.id, sender.id, 'second');

    const resA = await agentA
      .delete(`/api/communities/${community.id}/conversation/messages/${msg1.id}`)
      .set('X-CSRF-Token', csrfA);
    expect(resA.status).toBe(200);
    const resB = await agentB
      .delete(`/api/communities/${community.id}/conversation/messages/${msg2.id}`)
      .set('X-CSRF-Token', csrfB);
    expect(resB.status).toBe(200);

    const stored1 = await prisma.message.findUnique({ where: { id: msg1.id } });
    const stored2 = await prisma.message.findUnique({ where: { id: msg2.id } });
    expect(stored1!.deletedAt).not.toBeNull();
    expect(stored2!.deletedAt).not.toBeNull();
  });

  it('the dedicated moderation rate limiter applies independently of the message-send limiter', async () => {
    const community = await makeCommunity('Moderation Community 17');
    const { agent, csrf } = await setupCommunityLeader(217, community.id);
    const sender = await makePerson('+237698200017', 'Sender 17');
    await makeMembership(sender.id, community.id);

    let lastStatus = 200;
    for (let i = 0; i < 61; i++) {
      const { message } = await seedMessage(community.id, sender.id, `msg ${i}`);
      const res = await agent
        .delete(`/api/communities/${community.id}/conversation/messages/${message.id}`)
        .set('X-CSRF-Token', csrf);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('Phase 3M.8C — Community Administration — delete for me', () => {
  it('1. a Member can hide their own message for themselves', async () => {
    const community = await makeCommunity('Hide Community 1');
    const { agent, csrf, person } = await loginAsMember('+237698300001', 'hide1@example.com');
    await makeMembership(person.id, community.id);
    await agent.post(`/api/communities/${community.id}/conversation/messages`).set('X-CSRF-Token', csrf).send({ body: 'oops' });
    const msgs = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    const messageId = msgs.body.items[0].id;

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages/${messageId}/hide`)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(200);
    expect(res.body.hidden).toBe(true);
  });

  it('2. a Member cannot hide another person\'s message', async () => {
    const community = await makeCommunity('Hide Community 2');
    const { person: sender } = await loginAsMember('+237698300002', 'hide2a@example.com');
    await makeMembership(sender.id, community.id);
    const { agent: otherAgent, csrf: otherCsrf, person: other } = await loginAsMember('+237698300003', 'hide2b@example.com');
    await makeMembership(other.id, community.id);
    const conversation = await prisma.conversation.upsert({ where: { communityId: community.id }, create: { communityId: community.id }, update: {} });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'sender text' } });

    const res = await otherAgent
      .post(`/api/communities/${community.id}/conversation/messages/${message.id}/hide`)
      .set('X-CSRF-Token', otherCsrf);
    expect(res.status).toBe(403);

    const hiddenRow = await prisma.messageHiddenForPerson.findUnique({
      where: { messageId_personId: { messageId: message.id, personId: other.id } },
    });
    expect(hiddenRow).toBeNull();
  });

  it('3 & 4. hiding disappears only from that Member\'s own view — other participants still see it', async () => {
    const community = await makeCommunity('Hide Community 3');
    const { agent, csrf, person } = await loginAsMember('+237698300004', 'hide3a@example.com');
    await makeMembership(person.id, community.id);
    const { agent: otherAgent, person: other } = await loginAsMember('+237698300005', 'hide3b@example.com');
    await makeMembership(other.id, community.id);

    await agent.post(`/api/communities/${community.id}/conversation/messages`).set('X-CSRF-Token', csrf).send({ body: 'visible to others' });
    const listed = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    const messageId = listed.body.items[0].id;

    await agent.post(`/api/communities/${community.id}/conversation/messages/${messageId}/hide`).set('X-CSRF-Token', csrf);

    const ownView = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(ownView.body.items.find((m: any) => m.id === messageId)).toBeUndefined();

    const otherView = await otherAgent.get(`/api/communities/${community.id}/conversation/messages`);
    const row = otherView.body.items.find((m: any) => m.id === messageId);
    expect(row).toBeTruthy();
    expect(row.body).toBe('visible to others');
  });

  it('5. a Community Leader still sees a message the sender hid for themselves', async () => {
    const community = await makeCommunity('Hide Community 4');
    const { agent, csrf, person } = await loginAsMember('+237698300006', 'hide4@example.com');
    await makeMembership(person.id, community.id);
    const { agent: leaderAgent } = await setupCommunityLeader(301, community.id);

    await agent.post(`/api/communities/${community.id}/conversation/messages`).set('X-CSRF-Token', csrf).send({ body: 'leader should see this' });
    const listed = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    const messageId = listed.body.items[0].id;
    await agent.post(`/api/communities/${community.id}/conversation/messages/${messageId}/hide`).set('X-CSRF-Token', csrf);

    const leaderView = await leaderAgent.get(`/api/communities/${community.id}/conversation/messages`);
    const row = leaderView.body.items.find((m: any) => m.id === messageId);
    expect(row).toBeTruthy();
    expect(row.body).toBe('leader should see this');
  });

  it('7 & 8. personal hiding never sets deletedAt or deletedByPersonId', async () => {
    const community = await makeCommunity('Hide Community 5');
    const { agent, csrf, person } = await loginAsMember('+237698300007', 'hide5@example.com');
    await makeMembership(person.id, community.id);
    await agent.post(`/api/communities/${community.id}/conversation/messages`).set('X-CSRF-Token', csrf).send({ body: 'text' });
    const listed = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    const messageId = listed.body.items[0].id;

    await agent.post(`/api/communities/${community.id}/conversation/messages/${messageId}/hide`).set('X-CSRF-Token', csrf);

    const stored = await prisma.message.findUnique({ where: { id: messageId } });
    expect(stored!.deletedAt).toBeNull();
    expect(stored!.deletedByPersonId).toBeNull();
  });

  it('9. personal hiding never creates a COMMUNITY_MESSAGE_DELETED audit event', async () => {
    const community = await makeCommunity('Hide Community 6');
    const { agent, csrf, person } = await loginAsMember('+237698300008', 'hide6@example.com');
    await makeMembership(person.id, community.id);
    await agent.post(`/api/communities/${community.id}/conversation/messages`).set('X-CSRF-Token', csrf).send({ body: 'text' });
    const listed = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    const messageId = listed.body.items[0].id;

    await agent.post(`/api/communities/${community.id}/conversation/messages/${messageId}/hide`).set('X-CSRF-Token', csrf);

    const auditRows = await prisma.auditLog.findMany({ where: { targetId: messageId, action: 'COMMUNITY_MESSAGE_DELETED' } });
    expect(auditRows).toHaveLength(0);
  });

  it('10. repeating the hide action is idempotent', async () => {
    const community = await makeCommunity('Hide Community 7');
    const { agent, csrf, person } = await loginAsMember('+237698300009', 'hide7@example.com');
    await makeMembership(person.id, community.id);
    await agent.post(`/api/communities/${community.id}/conversation/messages`).set('X-CSRF-Token', csrf).send({ body: 'text' });
    const listed = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    const messageId = listed.body.items[0].id;

    const first = await agent.post(`/api/communities/${community.id}/conversation/messages/${messageId}/hide`).set('X-CSRF-Token', csrf);
    const second = await agent.post(`/api/communities/${community.id}/conversation/messages/${messageId}/hide`).set('X-CSRF-Token', csrf);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const count = await prisma.messageHiddenForPerson.count({ where: { messageId, personId: person.id } });
    expect(count).toBe(1);
  });

  it('11. a hidden message stays hidden on a subsequent fetch (simulated refresh) with the same session', async () => {
    const community = await makeCommunity('Hide Community 8');
    const { agent, csrf, person } = await loginAsMember('+237698300010', 'hide8@example.com');
    await makeMembership(person.id, community.id);
    await agent.post(`/api/communities/${community.id}/conversation/messages`).set('X-CSRF-Token', csrf).send({ body: 'text' });
    const listed = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    const messageId = listed.body.items[0].id;
    await agent.post(`/api/communities/${community.id}/conversation/messages/${messageId}/hide`).set('X-CSRF-Token', csrf);

    const refreshed = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(refreshed.body.items.find((m: any) => m.id === messageId)).toBeUndefined();
  });

  it('12 & 13. moderator delete-for-everyone behavior is unchanged by the existence of personal hiding', async () => {
    const community = await makeCommunity('Hide Community 9');
    const { agent, csrf, person } = await loginAsMember('+237698300011', 'hide9@example.com');
    await makeMembership(person.id, community.id);
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupCommunityLeader(302, community.id);

    await agent.post(`/api/communities/${community.id}/conversation/messages`).set('X-CSRF-Token', csrf).send({ body: 'will be moderated' });
    const listed = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    const messageId = listed.body.items[0].id;

    await agent.post(`/api/communities/${community.id}/conversation/messages/${messageId}/hide`).set('X-CSRF-Token', csrf);

    const delRes = await leaderAgent
      .delete(`/api/communities/${community.id}/conversation/messages/${messageId}`)
      .set('X-CSRF-Token', leaderCsrf);
    expect(delRes.status).toBe(200);

    const stored = await prisma.message.findUnique({ where: { id: messageId } });
    expect(stored!.deletedAt).not.toBeNull();
    expect(stored!.deletedByPersonId).toBeTruthy();

    const leaderView = await leaderAgent.get(`/api/communities/${community.id}/conversation/messages`);
    const leaderRow = leaderView.body.items.find((m: any) => m.id === messageId);
    expect(leaderRow.deleted).toBe(true);
    expect(leaderRow.body).toBeNull();
  });

  it('requires CSRF protection', async () => {
    const community = await makeCommunity('Hide Community 10');
    const { agent, csrf, person } = await loginAsMember('+237698300012', 'hide10@example.com');
    await makeMembership(person.id, community.id);
    await agent.post(`/api/communities/${community.id}/conversation/messages`).set('X-CSRF-Token', csrf).send({ body: 'text' });
    const listed = await agent.get(`/api/communities/${community.id}/conversation/messages`);
    const messageId = listed.body.items[0].id;

    const res = await agent.post(`/api/communities/${community.id}/conversation/messages/${messageId}/hide`);
    expect(res.status).toBe(403);
  });

  it('an unauthenticated caller cannot hide a message', async () => {
    const community = await makeCommunity('Hide Community 11');
    const sender = await makePerson('+237698300013', 'Hide Sender 11');
    await makeMembership(sender.id, community.id);
    const conversation = await prisma.conversation.upsert({ where: { communityId: community.id }, create: { communityId: community.id }, update: {} });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'x' } });

    const anon = agentWithUniqueIp();
    const res = await anon.post(`/api/communities/${community.id}/conversation/messages/${message.id}/hide`);
    expect(res.status).toBe(401);
  });

  it('a message id from a different Community\'s conversation is rejected (IDOR)', async () => {
    const communityA = await makeCommunity('Hide Community 12A');
    const communityB = await makeCommunity('Hide Community 12B');
    const { agent, csrf, person } = await loginAsMember('+237698300014', 'hide12@example.com');
    await makeMembership(person.id, communityA.id);
    await makeMembership(person.id, communityB.id);
    await agent.post(`/api/communities/${communityB.id}/conversation/messages`).set('X-CSRF-Token', csrf).send({ body: 'in B' });
    const listedB = await agent.get(`/api/communities/${communityB.id}/conversation/messages`);
    const messageId = listedB.body.items[0].id;

    const res = await agent
      .post(`/api/communities/${communityA.id}/conversation/messages/${messageId}/hide`)
      .set('X-CSRF-Token', csrf);
    expect(res.status).toBe(404);
  });
});

describe('Phase 3M.8C — Community Administration — attachments', () => {
  function validDescriptor(communityId: string, overrides: Partial<{ storageKey: string; originalFilename: string; mimeType: string; byteSize: number }> = {}) {
    return {
      storageKey: communityStorageKey(communityId),
      originalFilename: 'photo.png',
      mimeType: 'image/png',
      byteSize: 1024,
      ...overrides,
    };
  }

  function mockHeadMatches(descriptor: { byteSize: number; mimeType: string }) {
    vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: descriptor.byteSize, contentType: descriptor.mimeType });
  }

  describe('upload authorization', () => {
    it('an authenticated participant can request an upload authorization', async () => {
      const community = await makeCommunity('Attachment Community 1');
      const { agent, csrf, person } = await loginAsMember('+237698400001', 'att1@example.com');
      await makeMembership(person.id, community.id);

      const res = await agent
        .post(`/api/communities/${community.id}/attachments/authorize`)
        .set('X-CSRF-Token', csrf)
        .send({ originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 1024 });
      expect(res.status).toBe(200);
      expect(res.body.storageKey).toMatch(new RegExp(`^communities/${community.id}/attachments/[0-9a-f-]{36}$`));
      expect(res.body.uploadUrl).toContain(res.body.storageKey);
      expect(res.body.maxBytes).toBe(8 * 1024 * 1024);
    });

    it('an unauthenticated caller cannot request an upload authorization', async () => {
      const community = await makeCommunity('Attachment Community 2');
      const anon = agentWithUniqueIp();
      const res = await anon
        .post(`/api/communities/${community.id}/attachments/authorize`)
        .send({ originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 1024 });
      expect(res.status).toBe(401);
    });

    it('a non-member of the Community is rejected', async () => {
      const community = await makeCommunity('Attachment Community 3');
      const { agent, csrf } = await loginAsMember('+237698400002', 'att2@example.com');
      const res = await agent
        .post(`/api/communities/${community.id}/attachments/authorize`)
        .set('X-CSRF-Token', csrf)
        .send({ originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 1024 });
      expect(res.status).toBe(403);
    });

    it('a Community Leader can also request an upload authorization', async () => {
      const community = await makeCommunity('Attachment Community 4');
      const { agent, csrf } = await setupCommunityLeader(401, community.id);
      const res = await agent
        .post(`/api/communities/${community.id}/attachments/authorize`)
        .set('X-CSRF-Token', csrf)
        .send({ originalFilename: 'doc.pdf', mimeType: 'application/pdf', byteSize: 2048 });
      expect(res.status).toBe(200);
    });

    it('an unsupported MIME type is rejected', async () => {
      const community = await makeCommunity('Attachment Community 5');
      const { agent, csrf, person } = await loginAsMember('+237698400003', 'att3@example.com');
      await makeMembership(person.id, community.id);
      const res = await agent
        .post(`/api/communities/${community.id}/attachments/authorize`)
        .set('X-CSRF-Token', csrf)
        .send({ originalFilename: 'app.exe', mimeType: 'application/x-msdownload', byteSize: 1024 });
      expect(res.status).toBe(400);
    });

    it('an oversized declared file is rejected', async () => {
      const community = await makeCommunity('Attachment Community 6');
      const { agent, csrf, person } = await loginAsMember('+237698400004', 'att4@example.com');
      await makeMembership(person.id, community.id);
      const res = await agent
        .post(`/api/communities/${community.id}/attachments/authorize`)
        .set('X-CSRF-Token', csrf)
        .send({ originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 9 * 1024 * 1024 });
      expect(res.status).toBe(400);
    });

    it('an invalid filename (path-shaped) is rejected', async () => {
      const community = await makeCommunity('Attachment Community 7');
      const { agent, csrf, person } = await loginAsMember('+237698400005', 'att5@example.com');
      await makeMembership(person.id, community.id);
      const res = await agent
        .post(`/api/communities/${community.id}/attachments/authorize`)
        .set('X-CSRF-Token', csrf)
        .send({ originalFilename: '../../etc/passwd', mimeType: 'image/png', byteSize: 1024 });
      expect(res.status).toBe(400);
    });

    it('returns 503 when object storage is not configured', async () => {
      const community = await makeCommunity('Attachment Community 8');
      const { agent, csrf, person } = await loginAsMember('+237698400006', 'att6@example.com');
      await makeMembership(person.id, community.id);
      vi.mocked(storage.isStorageConfigured).mockReturnValueOnce(false);
      const res = await agent
        .post(`/api/communities/${community.id}/attachments/authorize`)
        .set('X-CSRF-Token', csrf)
        .send({ originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 1024 });
      expect(res.status).toBe(503);
    });

    it('requires CSRF protection', async () => {
      const community = await makeCommunity('Attachment Community 9');
      const { agent, person } = await loginAsMember('+237698400007', 'att7@example.com');
      await makeMembership(person.id, community.id);
      const res = await agent
        .post(`/api/communities/${community.id}/attachments/authorize`)
        .send({ originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 1024 });
      expect(res.status).toBe(403);
    });

    it('the server controls the storage path — two authorizations for the same file never collide', async () => {
      const community = await makeCommunity('Attachment Community 10');
      const { agent, csrf, person } = await loginAsMember('+237698400008', 'att8@example.com');
      await makeMembership(person.id, community.id);
      const first = await agent
        .post(`/api/communities/${community.id}/attachments/authorize`)
        .set('X-CSRF-Token', csrf)
        .send({ originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 1024 });
      const second = await agent
        .post(`/api/communities/${community.id}/attachments/authorize`)
        .set('X-CSRF-Token', csrf)
        .send({ originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 1024 });
      expect(first.body.storageKey).not.toBe(second.body.storageKey);
    });

    it('the dedicated attachment-authorize rate limiter applies', async () => {
      const community = await makeCommunity('Attachment Community 11');
      const { agent, csrf, person } = await loginAsMember('+237698400009', 'att9@example.com');
      await makeMembership(person.id, community.id);
      let lastStatus = 200;
      for (let i = 0; i < 41; i++) {
        const res = await agent
          .post(`/api/communities/${community.id}/attachments/authorize`)
          .set('X-CSRF-Token', csrf)
          .send({ originalFilename: 'photo.png', mimeType: 'image/png', byteSize: 1024 });
        lastStatus = res.status;
      }
      expect(lastStatus).toBe(429);
    });
  });

  describe('message creation with attachments', () => {
    it('a text-only message still works and reports an empty attachments array', async () => {
      const community = await makeCommunity('Attachment Community 20');
      const { agent, csrf, person } = await loginAsMember('+237698400020', 'att20@example.com');
      await makeMembership(person.id, community.id);
      const res = await agent
        .post(`/api/communities/${community.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ body: 'just text' });
      expect(res.status).toBe(201);
      expect(res.body.attachments).toEqual([]);
    });

    it('an attachment-only message (no body) is valid', async () => {
      const community = await makeCommunity('Attachment Community 21');
      const { agent, csrf, person } = await loginAsMember('+237698400021', 'att21@example.com');
      await makeMembership(person.id, community.id);
      const descriptor = validDescriptor(community.id);
      mockHeadMatches(descriptor);

      const res = await agent
        .post(`/api/communities/${community.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ attachments: [descriptor] });
      expect(res.status).toBe(201);
      expect(res.body.body).toBeNull();
      expect(res.body.attachments).toHaveLength(1);
      expect(res.body.attachments[0].originalFilename).toBe('photo.png');
    });

    it('a text + attachment message works', async () => {
      const community = await makeCommunity('Attachment Community 22');
      const { agent, csrf, person } = await loginAsMember('+237698400022', 'att22@example.com');
      await makeMembership(person.id, community.id);
      const descriptor = validDescriptor(community.id);
      mockHeadMatches(descriptor);

      const res = await agent
        .post(`/api/communities/${community.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ body: 'see attached', attachments: [descriptor] });
      expect(res.status).toBe(201);
      expect(res.body.body).toBe('see attached');
      expect(res.body.attachments).toHaveLength(1);
    });

    it('multiple attachments on one message are all created', async () => {
      const community = await makeCommunity('Attachment Community 23');
      const { agent, csrf, person } = await loginAsMember('+237698400023', 'att23@example.com');
      await makeMembership(person.id, community.id);
      const d1 = validDescriptor(community.id, { originalFilename: 'a.png' });
      const d2 = validDescriptor(community.id, { originalFilename: 'b.pdf', mimeType: 'application/pdf', byteSize: 4096 });
      mockHeadMatches(d1);
      mockHeadMatches(d2);

      const res = await agent
        .post(`/api/communities/${community.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ attachments: [d1, d2] });
      expect(res.status).toBe(201);
      expect(res.body.attachments).toHaveLength(2);
    });

    it('an empty message (no text, no attachments) is rejected', async () => {
      const community = await makeCommunity('Attachment Community 24');
      const { agent, csrf, person } = await loginAsMember('+237698400024', 'att24@example.com');
      await makeMembership(person.id, community.id);
      const res = await agent.post(`/api/communities/${community.id}/conversation/messages`).set('X-CSRF-Token', csrf).send({});
      expect(res.status).toBe(400);
    });

    it('too many attachments on one message is rejected', async () => {
      const community = await makeCommunity('Attachment Community 25');
      const { agent, csrf, person } = await loginAsMember('+237698400025', 'att25@example.com');
      await makeMembership(person.id, community.id);
      const attachments = Array.from({ length: 6 }, (_, i) => validDescriptor(community.id, { originalFilename: `f${i}.png` }));
      const res = await agent
        .post(`/api/communities/${community.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ attachments });
      expect(res.status).toBe(400);
    });

    it('a storage key shaped as an arbitrary/public URL is rejected', async () => {
      const community = await makeCommunity('Attachment Community 26');
      const { agent, csrf, person } = await loginAsMember('+237698400026', 'att26@example.com');
      await makeMembership(person.id, community.id);
      const res = await agent
        .post(`/api/communities/${community.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ attachments: [validDescriptor(community.id, { storageKey: 'https://evil.example/steal.png' })] });
      expect(res.status).toBe(400);
      const count = await prisma.message.count({ where: { conversationId: (await prisma.conversation.findUnique({ where: { communityId: community.id } }))?.id ?? '' } });
      expect(count).toBe(0);
    });

    it('a storage key generated for a DIFFERENT Community is rejected (cannot attach across Communities)', async () => {
      const communityA = await makeCommunity('Attachment Community 27A');
      const communityB = await makeCommunity('Attachment Community 27B');
      const { agent, csrf, person } = await loginAsMember('+237698400027', 'att27@example.com');
      await makeMembership(person.id, communityA.id);
      const foreignDescriptor = validDescriptor(communityB.id);

      const res = await agent
        .post(`/api/communities/${communityA.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ attachments: [foreignDescriptor] });
      expect(res.status).toBe(400);
    });

    it('an unsupported MIME type is rejected at finalize too', async () => {
      const community = await makeCommunity('Attachment Community 28');
      const { agent, csrf, person } = await loginAsMember('+237698400028', 'att28@example.com');
      await makeMembership(person.id, community.id);
      const res = await agent
        .post(`/api/communities/${community.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ attachments: [validDescriptor(community.id, { mimeType: 'text/html' })] });
      expect(res.status).toBe(400);
    });

    it('an oversized file is rejected at finalize too', async () => {
      const community = await makeCommunity('Attachment Community 29');
      const { agent, csrf, person } = await loginAsMember('+237698400029', 'att29@example.com');
      await makeMembership(person.id, community.id);
      const res = await agent
        .post(`/api/communities/${community.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ attachments: [validDescriptor(community.id, { byteSize: 9 * 1024 * 1024 })] });
      expect(res.status).toBe(400);
    });

    it('an unfinalized (never actually uploaded) attachment never becomes visible', async () => {
      const community = await makeCommunity('Attachment Community 30');
      const { agent, csrf, person } = await loginAsMember('+237698400030', 'att30@example.com');
      await makeMembership(person.id, community.id);
      const descriptor = validDescriptor(community.id);
      // headObject default mock resolves to null (object not found in R2).

      const res = await agent
        .post(`/api/communities/${community.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ attachments: [descriptor] });
      expect(res.status).toBe(400);

      const rows = await prisma.messageAttachment.findMany({ where: { storageKey: descriptor.storageKey } });
      expect(rows).toHaveLength(0);
    });

    it('a declared byteSize that does not match the actual uploaded object is rejected', async () => {
      const community = await makeCommunity('Attachment Community 31');
      const { agent, csrf, person } = await loginAsMember('+237698400031', 'att31@example.com');
      await makeMembership(person.id, community.id);
      const descriptor = validDescriptor(community.id, { byteSize: 1024 });
      vi.mocked(storage.headObject).mockResolvedValueOnce({ contentLength: 999, contentType: 'image/png' });

      const res = await agent
        .post(`/api/communities/${community.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ attachments: [descriptor] });
      expect(res.status).toBe(400);
    });

    it('returns 503 when storage is not configured and attachments were supplied', async () => {
      const community = await makeCommunity('Attachment Community 32');
      const { agent, csrf, person } = await loginAsMember('+237698400032', 'att32@example.com');
      await makeMembership(person.id, community.id);
      const descriptor = validDescriptor(community.id);
      vi.mocked(storage.isStorageConfigured).mockReturnValueOnce(false);

      const res = await agent
        .post(`/api/communities/${community.id}/conversation/messages`)
        .set('X-CSRF-Token', csrf)
        .send({ attachments: [descriptor] });
      expect(res.status).toBe(503);
    });
  });

  describe('download authorization', () => {
    async function seedMessageWithAttachment(communityId: string, senderId: string) {
      const conversation = await prisma.conversation.upsert({ where: { communityId }, create: { communityId }, update: {} });
      const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: senderId, body: 'has attachment' } });
      const attachment = await prisma.messageAttachment.create({
        data: {
          messageId: message.id,
          storageKey: communityStorageKey(communityId),
          originalFilename: 'photo.png',
          mimeType: 'image/png',
          byteSize: 1024,
          uploadedByPersonId: senderId,
        },
      });
      return { message, attachment };
    }

    it('a participant can get a fresh download URL for an attachment they are authorized to see', async () => {
      const community = await makeCommunity('Attachment Community 40');
      const { agent, csrf, person } = await loginAsMember('+237698400040', 'att40@example.com');
      await makeMembership(person.id, community.id);
      const { message, attachment } = await seedMessageWithAttachment(community.id, person.id);
      void csrf;

      const res = await agent.get(
        `/api/communities/${community.id}/conversation/messages/${message.id}/attachments/${attachment.id}/download-url`,
      );
      expect(res.status).toBe(200);
      expect(res.body.url).toContain(attachment.storageKey);
    });

    it('a non-participant is rejected', async () => {
      const community = await makeCommunity('Attachment Community 41');
      const sender = await makePerson('+237698400041', 'Sender 41');
      await makeMembership(sender.id, community.id);
      const { message, attachment } = await seedMessageWithAttachment(community.id, sender.id);
      const { agent: outsiderAgent } = await loginAsMember('+237698400042', 'att41@example.com');

      const res = await outsiderAgent.get(
        `/api/communities/${community.id}/conversation/messages/${message.id}/attachments/${attachment.id}/download-url`,
      );
      expect(res.status).toBe(403);
    });

    it('an attachment id belonging to a different message/Community is rejected (IDOR)', async () => {
      const communityA = await makeCommunity('Attachment Community 42A');
      const communityB = await makeCommunity('Attachment Community 42B');
      const senderB = await makePerson('+237698400043', 'Sender 42B');
      await makeMembership(senderB.id, communityB.id);
      const { attachment: attachmentInB } = await seedMessageWithAttachment(communityB.id, senderB.id);

      const { agent, csrf, person } = await loginAsMember('+237698400044', 'att42@example.com');
      await makeMembership(person.id, communityA.id);
      await agent.post(`/api/communities/${communityA.id}/conversation/messages`).set('X-CSRF-Token', csrf).send({ body: 'unrelated' });
      const listed = await agent.get(`/api/communities/${communityA.id}/conversation/messages`);
      const messageInA = listed.body.items[0].id;

      const res = await agent.get(
        `/api/communities/${communityA.id}/conversation/messages/${messageInA}/attachments/${attachmentInB.id}/download-url`,
      );
      expect(res.status).toBe(404);
    });

    it('a moderator-deleted message\'s attachment is not downloadable by an ordinary participant', async () => {
      const community = await makeCommunity('Attachment Community 43');
      const { agent, person } = await loginAsMember('+237698400045', 'att43@example.com');
      await makeMembership(person.id, community.id);
      const { agent: leaderAgent, csrf: leaderCsrf } = await setupCommunityLeader(402, community.id);
      const { message, attachment } = await seedMessageWithAttachment(community.id, person.id);

      await leaderAgent.delete(`/api/communities/${community.id}/conversation/messages/${message.id}`).set('X-CSRF-Token', leaderCsrf);

      const res = await agent.get(
        `/api/communities/${community.id}/conversation/messages/${message.id}/attachments/${attachment.id}/download-url`,
      );
      expect(res.status).toBe(404);
    });

    it('a personally-hidden message\'s attachment is unavailable only to the Person who hid it', async () => {
      const community = await makeCommunity('Attachment Community 44');
      const { agent, csrf, person } = await loginAsMember('+237698400046', 'att44@example.com');
      await makeMembership(person.id, community.id);
      const { agent: otherAgent, person: other } = await loginAsMember('+237698400047', 'att44b@example.com');
      await makeMembership(other.id, community.id);
      const { message, attachment } = await seedMessageWithAttachment(community.id, person.id);

      await agent.post(`/api/communities/${community.id}/conversation/messages/${message.id}/hide`).set('X-CSRF-Token', csrf);

      const ownRes = await agent.get(
        `/api/communities/${community.id}/conversation/messages/${message.id}/attachments/${attachment.id}/download-url`,
      );
      expect(ownRes.status).toBe(404);

      const otherRes = await otherAgent.get(
        `/api/communities/${community.id}/conversation/messages/${message.id}/attachments/${attachment.id}/download-url`,
      );
      expect(otherRes.status).toBe(200);
    });

    it('returns 503 when storage is not configured', async () => {
      const community = await makeCommunity('Attachment Community 45');
      const { agent, person } = await loginAsMember('+237698400048', 'att45@example.com');
      await makeMembership(person.id, community.id);
      const { message, attachment } = await seedMessageWithAttachment(community.id, person.id);
      vi.mocked(storage.isStorageConfigured).mockReturnValueOnce(false);

      const res = await agent.get(
        `/api/communities/${community.id}/conversation/messages/${message.id}/attachments/${attachment.id}/download-url`,
      );
      expect(res.status).toBe(503);
    });

    it('the dedicated attachment-download rate limiter applies', async () => {
      const community = await makeCommunity('Attachment Community 46');
      const { agent, person } = await loginAsMember('+237698400049', 'att46@example.com');
      await makeMembership(person.id, community.id);
      const { message, attachment } = await seedMessageWithAttachment(community.id, person.id);

      let lastStatus = 200;
      for (let i = 0; i < 151; i++) {
        const res = await agent.get(
          `/api/communities/${community.id}/conversation/messages/${message.id}/attachments/${attachment.id}/download-url`,
        );
        lastStatus = res.status;
      }
      expect(lastStatus).toBe(429);
    });
  });
});
