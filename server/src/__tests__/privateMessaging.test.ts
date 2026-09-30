import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Private Communication / Messaging — mirrors the exact conventions
// established in headquartersPosts.test.ts / communityPostingPolicy.test.ts:
// agentWithUniqueIp, createLeader/createAdmin, bootstrap, loginAsMember,
// setupCommunityLeader.

const app = createApp();

let ipCounter = 9000;
function agentWithUniqueIp() {
  ipCounter += 1;
  const ip = `10.94.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
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

async function loginAsAdmin(n: number) {
  const email = `pm-admin${n}@test.local`;
  await createAdmin(email);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, email };
}

async function makePerson(whatsappNumber: string, name = 'PM Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function makeMembership(personId: string, communityId: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') {
  return prisma.communityMembership.create({ data: { personId, communityId, status } });
}

async function setupCommunityLeader(n: number, communityId: string, status: 'ACTIVE' | 'ENDED' = 'ACTIVE') {
  const email = `pm-leader${n}@test.local`;
  const { user } = await createLeader(`PM Leader ${n}`, email, `PM${n}CODE`);
  const person = await makePerson(`+237695${String(n).padStart(6, '0')}`, `PM Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  const role = await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId, status },
  });

  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person, role };
}

async function loginAsMember(whatsapp: string, email: string, name = 'PM Member') {
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

describe('Private Messaging — authentication', () => {
  it('an unauthenticated caller cannot list conversations', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/private-messages/conversations');
    expect(res.status).toBe(401);
  });

  it('an unauthenticated caller cannot access a conversation', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.get('/api/private-messages/conversations/00000000-0000-0000-0000-000000000000/messages');
    expect(res.status).toBe(401);
  });

  it('an unauthenticated caller cannot create a message', async () => {
    const anon = agentWithUniqueIp();
    const res = await anon.post('/api/private-messages/conversations/00000000-0000-0000-0000-000000000000/messages').send({ body: 'Hi' });
    expect(res.status).toBe(401);
  });
});

describe('Private Messaging — Admin authorization', () => {
  it('an Admin can initiate an authorized organizational conversation (SELECTED_MEMBERS)', async () => {
    const { agent, csrf } = await loginAsAdmin(1);
    const { person } = await loginAsMember('+237694900001', 'pm-member1@example.com');

    const res = await agent
      .post('/api/admin/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Welcome!' });
    expect(res.status).toBe(201);
    expect(res.body.conversationsCreated).toBe(1);
  });

  it('an Admin can target all eligible members', async () => {
    const { agent, csrf } = await loginAsAdmin(2);
    const community = await makeCommunity('All Eligible Community');
    const { person: p1 } = await loginAsMember('+237694900002', 'pm-member2@example.com');
    const { person: p2 } = await loginAsMember('+237694900003', 'pm-member3@example.com');
    await makeMembership(p1.id, community.id);
    await makeMembership(p2.id, community.id);

    const res = await agent
      .post('/api/admin/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ scope: 'ALL_ELIGIBLE', body: 'Hello everyone' });
    expect(res.status).toBe(201);
    expect(res.body.targetCount).toBeGreaterThanOrEqual(2);
  });

  it('an Admin can target a selected Community', async () => {
    const { agent, csrf } = await loginAsAdmin(3);
    const community = await makeCommunity('Selected Community Target');
    const { person } = await loginAsMember('+237694900004', 'pm-member4@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent
      .post('/api/admin/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ scope: 'SELECTED_COMMUNITY', communityId: community.id, body: 'Community message' });
    expect(res.status).toBe(201);
    expect(res.body.targetCount).toBe(1);
  });

  it('a non-Admin (Leader) cannot use Admin-only targeting', async () => {
    const community = await makeCommunity('Leader Blocked Community');
    const { agent, csrf } = await setupCommunityLeader(1, community.id);
    const { person } = await loginAsMember('+237694900005', 'pm-member5@example.com');

    const res = await agent
      .post('/api/admin/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Should not work' });
    expect(res.status).toBe(403);
  });

  it('a non-Admin (Member) cannot use Admin-only targeting', async () => {
    const { agent, csrf } = await loginAsMember('+237694900006', 'pm-member6@example.com');
    const res = await agent
      .post('/api/admin/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ scope: 'ALL_ELIGIBLE', body: 'Should not work' });
    expect(res.status).toBe(401);
  });
});

describe('Private Messaging — Leader authorization', () => {
  it('an authorized Leader can message a member of an exact Community they lead', async () => {
    const community = await makeCommunity('Leader Own Community');
    const { agent, csrf } = await setupCommunityLeader(2, community.id);
    const { person } = await loginAsMember('+237694900007', 'pm-member7@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent
      .post('/api/leader/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ personIds: [person.id], body: 'Hi from your Leader' });
    expect(res.status).toBe(201);
    expect(res.body.conversationsCreated).toBe(1);
  });

  it('a Leader cannot message a member of another Community', async () => {
    const ownCommunity = await makeCommunity('Leader A Community');
    const otherCommunity = await makeCommunity('Leader B Community');
    const { agent, csrf } = await setupCommunityLeader(3, ownCommunity.id);
    const { person } = await loginAsMember('+237694900008', 'pm-member8@example.com');
    await makeMembership(person.id, otherCommunity.id);

    const res = await agent
      .post('/api/leader/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ personIds: [person.id], body: 'Should be rejected' });
    expect(res.status).toBe(403);

    const count = await prisma.privateConversation.count();
    expect(count).toBe(0);
  });

  it('a former/ended Leader cannot initiate a private conversation', async () => {
    const community = await makeCommunity('Ended Leader Community');
    const { agent, csrf } = await setupCommunityLeader(4, community.id, 'ENDED');
    const { person } = await loginAsMember('+237694900009', 'pm-member9@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent
      .post('/api/leader/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ personIds: [person.id], body: 'Should be rejected' });
    expect(res.status).toBe(403);
  });

  it('an OrganizationalLeadershipRecommendation alone does not grant permission', async () => {
    const community = await makeCommunity('Recommendation Only Community');
    const unrelatedHome = await makeCommunity('Unrelated Leader Home');
    const { agent, csrf, person: leaderPerson } = await setupCommunityLeader(5, unrelatedHome.id);
    const { person: candidate } = await loginAsMember('+237694900010', 'pm-member10@example.com');
    await makeMembership(candidate.id, community.id);

    await prisma.organizationalLeadershipRecommendation.create({
      data: {
        proposedByPersonId: leaderPerson.id,
        proposedPersonId: candidate.id,
        communityId: community.id,
        note: 'Recommended',
      },
    });

    const res = await agent
      .post('/api/leader/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ personIds: [candidate.id], body: 'Should be rejected' });
    expect(res.status).toBe(403);
  });

});

describe('Private Messaging — participant isolation', () => {
  it('a participant can retrieve their own conversation', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(4);
    const { agent: memberAgent, person } = await loginAsMember('+237694900012', 'pm-member12@example.com');
    const created = await adminAgent
      .post('/api/admin/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });

    const list = await memberAgent.get('/api/private-messages/conversations');
    expect(list.status).toBe(200);
    expect(list.body.items.length).toBeGreaterThan(0);
    const conversationId = list.body.items[0].id;

    const messages = await memberAgent.get(`/api/private-messages/conversations/${conversationId}/messages`);
    expect(messages.status).toBe(200);
    expect(messages.body.items.some((m: any) => m.body === 'Hello')).toBe(true);
    void created;
  });

  it('a non-participant cannot retrieve the conversation (404)', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(5);
    const { person } = await loginAsMember('+237694900013', 'pm-member13@example.com');
    await adminAgent
      .post('/api/admin/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });

    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });
    const { agent: strangerAgent } = await loginAsMember('+237694900014', 'pm-member14@example.com');
    const res = await strangerAgent.get(`/api/private-messages/conversations/${conversation!.id}/messages`);
    expect(res.status).toBe(404);
  });

  it('a client-supplied Person ID in the message body cannot change authorization or attribution', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(6);
    const { person } = await loginAsMember('+237694900015', 'pm-member15@example.com');
    await adminAgent
      .post('/api/admin/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });
    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });

    const { agent: strangerAgent, csrf: strangerCsrf } = await loginAsMember('+237694900016', 'pm-member16@example.com');
    const res = await strangerAgent
      .post(`/api/private-messages/conversations/${conversation!.id}/messages`)
      .set('X-CSRF-Token', strangerCsrf)
      .send({ body: 'Trying to inject', personId: person.id });
    expect(res.status).toBe(404);
  });

  it('a client-supplied role cannot change authorization', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(7);
    const { person } = await loginAsMember('+237694900017', 'pm-member17@example.com');
    await adminAgent
      .post('/api/admin/private-messages/conversations')
      .set('X-CSRF-Token', csrf)
      .send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });
    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });

    const { agent: strangerAgent, csrf: strangerCsrf } = await loginAsMember('+237694900018', 'pm-member18@example.com');
    const res = await strangerAgent
      .post(`/api/private-messages/conversations/${conversation!.id}/messages`)
      .set('X-CSRF-Token', strangerCsrf)
      .send({ body: 'Trying to inject', role: 'ADMIN', isAdmin: true });
    expect(res.status).toBe(404);
  });

  it('a client-supplied participant/conversation ID cannot grant access to another Person\'s conversation', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(8);
    const { person: p1 } = await loginAsMember('+237694900019', 'pm-member19@example.com');
    const { agent: p2Agent, person: p2 } = await loginAsMember('+237694900020', 'pm-member20@example.com');
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [p1.id], body: 'For p1 only' });
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [p2.id], body: 'For p2 only' });

    const p1Conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: p1.id } });
    const res = await p2Agent.get(`/api/private-messages/conversations/${p1Conversation!.id}/messages`);
    expect(res.status).toBe(404);
  });
});

describe('Private Messaging — messages', () => {
  it('an authorized participant (the Member) can send a reply', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(9);
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237694900021', 'pm-member21@example.com');
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });
    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });

    const res = await memberAgent
      .post(`/api/private-messages/conversations/${conversation!.id}/messages`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ body: 'Thanks for reaching out!' });
    expect(res.status).toBe(201);
    expect(res.body.isOwn).toBe(true);
  });

  it('an unauthorized person cannot send a message', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(10);
    const { person } = await loginAsMember('+237694900022', 'pm-member22@example.com');
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });
    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });

    const { agent: strangerAgent, csrf: strangerCsrf } = await loginAsMember('+237694900023', 'pm-member23@example.com');
    const res = await strangerAgent
      .post(`/api/private-messages/conversations/${conversation!.id}/messages`)
      .set('X-CSRF-Token', strangerCsrf)
      .send({ body: 'Should be rejected' });
    expect(res.status).toBe(404);
  });

  it('an empty message is rejected', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(11);
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237694900024', 'pm-member24@example.com');
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });
    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });

    const res = await memberAgent
      .post(`/api/private-messages/conversations/${conversation!.id}/messages`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ body: '   ' });
    expect(res.status).toBe(400);
  });

  it('a sent message is associated with the authenticated sender', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(12);
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237694900025', 'pm-member25@example.com');
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });
    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });

    await memberAgent
      .post(`/api/private-messages/conversations/${conversation!.id}/messages`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ body: 'My reply' });

    const stored = await prisma.privateMessage.findFirst({ where: { body: 'My reply' } });
    expect(stored!.senderPersonId).toBe(person.id);
    expect(stored!.senderUserId).toBeNull();
  });

  it('a sender cannot impersonate another Person via a client-supplied senderPersonId', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(13);
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237694900026', 'pm-member26@example.com');
    const otherPerson = await makePerson('+237694900027', 'Impersonation Target');
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });
    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });

    await memberAgent
      .post(`/api/private-messages/conversations/${conversation!.id}/messages`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ body: 'Impersonation attempt', senderPersonId: otherPerson.id });

    const stored = await prisma.privateMessage.findFirst({ where: { body: 'Impersonation attempt' } });
    expect(stored!.senderPersonId).toBe(person.id);
    expect(stored!.senderPersonId).not.toBe(otherPerson.id);
  });
});

describe('Private Messaging — read state', () => {
  it('a participant can mark their own conversation read', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(14);
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237694900028', 'pm-member28@example.com');
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });
    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });

    const messages = await memberAgent.get(`/api/private-messages/conversations/${conversation!.id}/messages`);
    expect(messages.body.unreadCount).toBe(1);

    const markRes = await memberAgent
      .post(`/api/private-messages/conversations/${conversation!.id}/read`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ messageId: messages.body.items[0].id });
    expect(markRes.status).toBe(200);
    expect(markRes.body.unreadCount).toBe(0);
  });

  it('a participant cannot modify another participant\'s read state', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(15);
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237694900029', 'pm-member29@example.com');
    const created = await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });
    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });

    const memberMessages = await memberAgent.get(`/api/private-messages/conversations/${conversation!.id}/messages`);
    await memberAgent
      .post(`/api/private-messages/conversations/${conversation!.id}/read`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ messageId: memberMessages.body.items[0].id });

    await memberAgent
      .post(`/api/private-messages/conversations/${conversation!.id}/messages`)
      .set('X-CSRF-Token', memberCsrf)
      .send({ body: 'A new reply' });

    // The Admin's own unread count (for the Member's new reply) must be
    // unaffected by the Member having marked their OWN cursor read.
    const adminMessages = await adminAgent.get(`/api/private-messages/conversations/${conversation!.id}/messages`);
    expect(adminMessages.body.unreadCount).toBe(1);
    void created;
  });
});

describe('Private Messaging — pagination', () => {
  it('conversation list pagination works with accurate metadata', async () => {
    const { agent, csrf } = await loginAsAdmin(16);
    for (let i = 0; i < 5; i++) {
      const { person } = await loginAsMember(`+2376949001${String(i).padStart(2, '0')}`, `pm-page-member${i}@example.com`);
      await agent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: `Msg ${i}` });
    }

    const page1 = await agent.get('/api/private-messages/conversations?page=1&pageSize=2');
    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.pagination.total).toBeGreaterThanOrEqual(5);
    expect(page1.body.pagination.totalPages).toBeGreaterThanOrEqual(3);

    const page2 = await agent.get('/api/private-messages/conversations?page=2&pageSize=2');
    const ids1 = page1.body.items.map((i: any) => i.id);
    const ids2 = page2.body.items.map((i: any) => i.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
  });

  it('message pagination works with a before cursor, oldest-first', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(17);
    const { agent: memberAgent, csrf: memberCsrf, person } = await loginAsMember('+237694900130', 'pm-member30@example.com');
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'First' });
    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });

    for (let i = 0; i < 3; i++) {
      await memberAgent.post(`/api/private-messages/conversations/${conversation!.id}/messages`).set('X-CSRF-Token', memberCsrf).send({ body: `Reply ${i}` });
    }

    const firstPage = await memberAgent.get(`/api/private-messages/conversations/${conversation!.id}/messages?limit=2`);
    expect(firstPage.body.items).toHaveLength(2);
    expect(firstPage.body.hasMore).toBe(true);

    const olderPage = await memberAgent.get(`/api/private-messages/conversations/${conversation!.id}/messages?before=${firstPage.body.items[0].id}&limit=10`);
    expect(olderPage.body.items.length).toBeGreaterThan(0);
    const overlap = firstPage.body.items.map((m: any) => m.id).filter((id: string) => olderPage.body.items.map((m: any) => m.id).includes(id));
    expect(overlap).toHaveLength(0);
  });
});

describe('Private Messaging — privacy / data minimization', () => {
  it('conversation list and message responses never expose WhatsApp/email/other Person fields', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(18);
    const { agent: memberAgent, person } = await loginAsMember('+237694900131', 'pm-member31@example.com');
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });

    const list = await memberAgent.get('/api/private-messages/conversations');
    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain('whatsapp');
    expect(raw).not.toContain(person.whatsappNumber);
    expect(raw).not.toMatch(/@example\.com/);

    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });
    const messages = await memberAgent.get(`/api/private-messages/conversations/${conversation!.id}/messages`);
    const rawMessages = JSON.stringify(messages.body);
    expect(rawMessages).not.toContain('whatsapp');
    expect(rawMessages).not.toContain(person.whatsappNumber);
  });

  it('another Person\'s private message cannot leak through the conversation list', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(19);
    const { agent: p1Agent, person: p1 } = await loginAsMember('+237694900132', 'pm-member32@example.com');
    const { person: p2 } = await loginAsMember('+237694900133', 'pm-member33@example.com');
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [p1.id], body: 'Secret for p1' });
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [p2.id], body: 'Secret for p2' });

    const p1List = await p1Agent.get('/api/private-messages/conversations');
    expect(JSON.stringify(p1List.body)).not.toContain('Secret for p2');
  });

  it('another user\'s unread state cannot leak into a different participant\'s view', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(20);
    const { agent: p1Agent, csrf: p1Csrf, person: p1 } = await loginAsMember('+237694900134', 'pm-member34@example.com');
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [p1.id], body: 'Hello p1' });
    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: p1.id } });

    const p1Messages = await p1Agent.get(`/api/private-messages/conversations/${conversation!.id}/messages`);
    await p1Agent.post(`/api/private-messages/conversations/${conversation!.id}/read`).set('X-CSRF-Token', p1Csrf).send({ messageId: p1Messages.body.items[0].id });

    // The Admin's own cursor/unread count must be independent of p1's.
    const adminMessages = await adminAgent.get(`/api/private-messages/conversations/${conversation!.id}/messages`);
    expect(adminMessages.body.unreadCount).toBe(0); // Admin sent it, nothing unread for Admin yet.
  });
});

describe('Private Messaging — regression isolation', () => {
  it('Community conversations remain unchanged', async () => {
    const community = await makeCommunity('PM Regression Community');
    const { agent, csrf, person } = await loginAsMember('+237694900135', 'pm-member35@example.com');
    await makeMembership(person.id, community.id);

    const res = await agent
      .post(`/api/communities/${community.id}/conversation/messages`)
      .set('X-CSRF-Token', csrf)
      .send({ body: 'Still works' });
    expect(res.status).toBe(201);
  });

  it('Headquarters Posts remain unchanged', async () => {
    const { agent, csrf } = await loginAsAdmin(21);
    const created = await agent.post('/api/admin/headquarters-posts').set('X-CSRF-Token', csrf).send({ titleEn: 'PM Regression Post', bodyEn: 'Body.' });
    await agent.patch(`/api/admin/headquarters-posts/${created.body.id}`).set('X-CSRF-Token', csrf).send({ networkWide: true });
    const published = await agent.post(`/api/admin/headquarters-posts/${created.body.id}/publish`).set('X-CSRF-Token', csrf);
    expect(published.status).toBe(200);
  });

  it('Follow-Up conversations remain unchanged (FollowUpConversation is not repurposed)', async () => {
    const community = await makeCommunity('PM FollowUp Community');
    const { agent, csrf, person: leaderPerson, user: leaderUser } = await setupCommunityLeader(6, community.id);
    const { person: followed } = await loginAsMember('+237694900136', 'pm-member36@example.com');
    await makeMembership(followed.id, community.id);

    const res = await agent
      .post('/api/leader/follow-ups')
      .set('X-CSRF-Token', csrf)
      .send({ followedPersonId: followed.id, contextType: 'COMMUNITY', contextId: community.id });
    expect(res.status).toBe(201);

    const followUpConversationCount = await prisma.followUpConversation.count({ where: { followUpAssignmentId: res.body.id } });
    expect(followUpConversationCount).toBe(1);
    void leaderPerson;
    void leaderUser;
  });

  it('Announcements remain unchanged', async () => {
    const { agent, csrf } = await loginAsAdmin(22);
    const res = await agent.post('/api/admin/announcements').set('X-CSRF-Token', csrf).send({ titleEn: 'PM Regression Announcement', bodyEn: 'Body.' });
    expect(res.status).toBe(201);
  });

  it('Community Posting Policy remains unchanged', async () => {
    const { agent, csrf } = await loginAsAdmin(23);
    const community = await makeCommunity('PM Posting Policy Community');
    const res = await agent
      .patch(`/api/admin/communities/${community.id}`)
      .set('X-CSRF-Token', csrf)
      .send({ postingPolicy: 'LEADERS_ONLY' });
    expect(res.status).toBe(200);
    expect(res.body.postingPolicy).toBe('LEADERS_ONLY');
  });
});

describe('Private Messaging — security / model integrity', () => {
  it('rejects a PrivateConversation with both initiatorUserId and initiatorPersonId set', async () => {
    const user = await createAdmin('pm-integrity-admin@test.local');
    const community = await makeCommunity('Integrity Community');
    const { person: leaderPerson } = await setupCommunityLeader(7, community.id);
    const member = await makePerson('+237694900137', 'Integrity Member');

    await expect(
      prisma.privateConversation.create({
        data: { memberPersonId: member.id, initiatorUserId: user.id, initiatorPersonId: leaderPerson.id },
      }),
    ).rejects.toThrow();
  });

  it('rejects a PrivateConversation with neither initiatorUserId nor initiatorPersonId set', async () => {
    const member = await makePerson('+237694900138', 'Integrity Member 2');
    await expect(
      prisma.privateConversation.create({ data: { memberPersonId: member.id } }),
    ).rejects.toThrow();
  });

  it('CSRF protection is enforced on Admin conversation creation', async () => {
    const { agent } = await loginAsAdmin(24);
    const { person } = await loginAsMember('+237694900139', 'pm-member39@example.com');
    const res = await agent.post('/api/admin/private-messages/conversations').send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'No csrf' });
    expect(res.status).toBe(403);
  });

  it('CSRF protection is enforced on sending a message', async () => {
    const { agent: adminAgent, csrf } = await loginAsAdmin(25);
    const { agent: memberAgent, person } = await loginAsMember('+237694900140', 'pm-member40@example.com');
    await adminAgent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Hello' });
    const conversation = await prisma.privateConversation.findFirst({ where: { memberPersonId: person.id } });

    const res = await memberAgent.post(`/api/private-messages/conversations/${conversation!.id}/messages`).send({ body: 'No csrf' });
    expect(res.status).toBe(403);
  });

  it('re-initiating a conversation with the same member reuses the existing thread rather than creating a duplicate', async () => {
    const { agent, csrf } = await loginAsAdmin(26);
    const { person } = await loginAsMember('+237694900141', 'pm-member41@example.com');

    const first = await agent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'First' });
    expect(first.body.conversationsCreated).toBe(1);
    const second = await agent.post('/api/admin/private-messages/conversations').set('X-CSRF-Token', csrf).send({ scope: 'SELECTED_MEMBERS', personIds: [person.id], body: 'Second' });
    expect(second.body.conversationsReused).toBe(1);
    expect(second.body.conversationsCreated).toBe(0);

    const count = await prisma.privateConversation.count({ where: { memberPersonId: person.id } });
    expect(count).toBe(1);
  });
});
