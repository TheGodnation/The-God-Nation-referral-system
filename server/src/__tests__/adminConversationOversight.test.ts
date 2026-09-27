import crypto from 'crypto';
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createLeader, createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Phase 3M.8C — same storage mock strategy as communityConversations.test.ts:
// no real R2 credentials exist in this test environment, so lib/storage.ts
// is mocked rather than touched.
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

// Phase 3M.8B — Central Authority Conversation Oversight. Mirrors the exact
// conventions established in communityConversations.test.ts (Phase 3M.1)
// and leaderCommunities.test.ts (Phase 3M.8A): agentWithUniqueIp,
// createLeader/createAdmin, bootstrap, loginAsMember.

const app = createApp();

let ipCounter = 9000;
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

async function makePerson(whatsappNumber: string, name = 'Oversight Test Person') {
  return prisma.person.create({ data: { name, whatsappNumber } });
}

async function makeCommunity(name: string) {
  return prisma.community.create({ data: { name } });
}

async function makeGeography(name: string) {
  return prisma.geography.create({ data: { name, type: 'REGION', countryCode: 'CM' } });
}

async function loginAsAdmin(n: number) {
  const email = `oversight-admin${n}@test.local`;
  await createAdmin(email);
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, email };
}

async function setupCommunityLeader(n: number, communityId: string) {
  const email = `oversight-leader${n}@test.local`;
  const { user } = await createLeader(`Oversight Leader ${n}`, email, `OV${n}CODE`);
  const person = await makePerson(`+237694${String(n).padStart(6, '0')}`, `Oversight Leader Person ${n}`);
  await prisma.user.update({ where: { id: user.id }, data: { personId: person.id } });
  await prisma.roleAssignment.create({
    data: { personId: person.id, roleType: 'SCOPED_LEADER', assignedByUserId: user.id, communityId },
  });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'password123' });
  return { agent, csrf, user, person };
}

function extractToken(link: string): string {
  return new URL(link).searchParams.get('token')!;
}

async function loginAsMember(whatsapp: string, email: string, name = 'Oversight Member') {
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

describe('Phase 3M.8B — Central Authority oversight — Community conversation', () => {
  it('an Admin with a valid reason can view messages, and it is audited', async () => {
    const community = await makeCommunity('Oversight Community 1');
    const { agent, email } = await loginAsAdmin(1);
    const sender = await makePerson('+237693100001', 'Sender 1');
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'Hello' } });

    const res = await agent.get(`/api/admin/communities/${community.id}/conversation/messages?reason=SECURITY`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].body).toBe('Hello');

    const auditRows = await prisma.auditLog.findMany({ where: { action: 'CENTRAL_AUTHORITY_COMMUNITY_CONVERSATION_VIEWED' } });
    const row = auditRows.find((r) => r.targetId === community.id);
    expect(row).toBeTruthy();
    expect(row!.actorEmail).toBe(email);
    expect(row!.targetType).toBe('Community');
    expect((row!.metadata as any).reason).toBe('SECURITY');
    expect((row!.metadata as any).conversationId).toBe(conversation.id);
  });

  it('reason=OTHER without reasonNote is rejected, and nothing is audited', async () => {
    const community = await makeCommunity('Oversight Community 2');
    const { agent } = await loginAsAdmin(2);

    const before = await prisma.auditLog.count({ where: { action: 'CENTRAL_AUTHORITY_COMMUNITY_CONVERSATION_VIEWED' } });
    const res = await agent.get(`/api/admin/communities/${community.id}/conversation/messages?reason=OTHER`);
    expect(res.status).toBe(400);
    const after = await prisma.auditLog.count({ where: { action: 'CENTRAL_AUTHORITY_COMMUNITY_CONVERSATION_VIEWED' } });
    expect(after).toBe(before);
  });

  it('reason=OTHER with a reasonNote succeeds and the note is captured in the audit metadata', async () => {
    const community = await makeCommunity('Oversight Community 3');
    const { agent } = await loginAsAdmin(3);

    const res = await agent.get(
      `/api/admin/communities/${community.id}/conversation/messages?reason=OTHER&reasonNote=${encodeURIComponent('Reported by a member')}`,
    );
    expect(res.status).toBe(200);

    const row = await prisma.auditLog.findFirst({
      where: { action: 'CENTRAL_AUTHORITY_COMMUNITY_CONVERSATION_VIEWED', targetId: community.id },
    });
    expect((row!.metadata as any).reasonNote).toBe('Reported by a member');
  });

  it('an invalid reason value is rejected', async () => {
    const community = await makeCommunity('Oversight Community 4');
    const { agent } = await loginAsAdmin(4);

    const res = await agent.get(`/api/admin/communities/${community.id}/conversation/messages?reason=NOT_A_REAL_REASON`);
    expect(res.status).toBe(400);
  });

  it('a missing reason is rejected', async () => {
    const community = await makeCommunity('Oversight Community 5');
    const { agent } = await loginAsAdmin(5);

    const res = await agent.get(`/api/admin/communities/${community.id}/conversation/messages`);
    expect(res.status).toBe(400);
  });

  it('a Leader (not Admin) cannot access the oversight route', async () => {
    const community = await makeCommunity('Oversight Community 6');
    const { agent } = await setupCommunityLeader(6, community.id);

    // requireRole('ADMIN') returns 403 here (a real session, wrong role) —
    // distinct from the 401 an unauthenticated caller gets below.
    const res = await agent.get(`/api/admin/communities/${community.id}/conversation/messages?reason=SECURITY`);
    expect(res.status).toBe(403);
  });

  it('a Member cannot access the oversight route', async () => {
    const community = await makeCommunity('Oversight Community 7');
    const { agent } = await loginAsMember('+237693100007', 'oversight7@example.com');

    const res = await agent.get(`/api/admin/communities/${community.id}/conversation/messages?reason=SECURITY`);
    expect(res.status).toBe(401);
  });

  it('an unauthenticated caller cannot access the oversight route', async () => {
    const community = await makeCommunity('Oversight Community 8');
    const anon = agentWithUniqueIp();

    const res = await anon.get(`/api/admin/communities/${community.id}/conversation/messages?reason=SECURITY`);
    expect(res.status).toBe(401);
  });

  it('a nonexistent Community returns 404', async () => {
    const { agent } = await loginAsAdmin(9);
    const res = await agent.get(
      '/api/admin/communities/00000000-0000-0000-0000-000000000000/conversation/messages?reason=SECURITY',
    );
    expect(res.status).toBe(404);
  });

  it('a moderated (soft-deleted) message shows its ORIGINAL body plus deletion metadata to Central Authority', async () => {
    const community = await makeCommunity('Oversight Community 10');
    const { agent: leaderAgent, csrf: leaderCsrf, person: leaderPerson } = await setupCommunityLeader(10, community.id);
    const sender = await makePerson('+237693100010', 'Sender 10');
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg = await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'the real original text' },
    });
    await leaderAgent
      .delete(`/api/communities/${community.id}/conversation/messages/${msg.id}`)
      .set('X-CSRF-Token', leaderCsrf);

    const { agent: adminAgent } = await loginAsAdmin(11);
    const res = await adminAgent.get(`/api/admin/communities/${community.id}/conversation/messages?reason=ABUSE_OR_SAFEGUARDING`);
    expect(res.status).toBe(200);
    const row = res.body.items.find((i: any) => i.id === msg.id);
    expect(row.body).toBe('the real original text');
    expect(row.deleted).toBe(true);
    expect(row.deletedByName).toBe(leaderPerson.name);
  });

  it('cursor pagination works, and a cursor from a different Community is rejected', async () => {
    const communityA = await makeCommunity('Oversight Community 12A');
    const communityB = await makeCommunity('Oversight Community 12B');
    const { agent } = await loginAsAdmin(12);
    const sender = await makePerson('+237693100012', 'Sender 12');
    const conversationA = await prisma.conversation.upsert({
      where: { communityId: communityA.id },
      create: { communityId: communityA.id },
      update: {},
    });
    const conversationB = await prisma.conversation.upsert({
      where: { communityId: communityB.id },
      create: { communityId: communityB.id },
      update: {},
    });
    const msgInB = await prisma.message.create({ data: { conversationId: conversationB.id, senderPersonId: sender.id, body: 'in B' } });
    await prisma.message.create({ data: { conversationId: conversationA.id, senderPersonId: sender.id, body: 'in A' } });

    const res = await agent.get(
      `/api/admin/communities/${communityA.id}/conversation/messages?reason=SECURITY&before=${msgInB.id}`,
    );
    expect(res.status).toBe(400);
  });

  it('does not create any CommunityConversationRead row for the Admin (never becomes a participant)', async () => {
    const community = await makeCommunity('Oversight Community 13');
    const { agent } = await loginAsAdmin(13);
    const sender = await makePerson('+237693100013', 'Sender 13');
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'x' } });

    await agent.get(`/api/admin/communities/${community.id}/conversation/messages?reason=SECURITY`);

    const readRows = await prisma.communityConversationRead.count({ where: { conversationId: conversation.id } });
    expect(readRows).toBe(0);
  });

  it('the dedicated oversight rate limiter applies', async () => {
    const community = await makeCommunity('Oversight Community 14');
    const { agent } = await loginAsAdmin(14);

    let lastStatus = 200;
    for (let i = 0; i < 91; i++) {
      const res = await agent.get(`/api/admin/communities/${community.id}/conversation/messages?reason=SECURITY`);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  // Phase 3M.8C — attachment metadata in the existing oversight listing, and
  // the dedicated fresh-signed-URL route. Extends the surface above only —
  // no second oversight mechanism.
  it('the message listing includes attachment metadata, unredacted even for a moderated message', async () => {
    const community = await makeCommunity('Oversight Community 15');
    const { agent: leaderAgent, csrf: leaderCsrf } = await setupCommunityLeader(15, community.id);
    const sender = await makePerson('+237693100015', 'Sender 15');
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'has a file' } });
    const attachment = await prisma.messageAttachment.create({
      data: {
        messageId: msg.id,
        storageKey: `communities/${community.id}/attachments/${crypto.randomUUID()}`,
        originalFilename: 'evidence.png',
        mimeType: 'image/png',
        byteSize: 2048,
        uploadedByPersonId: sender.id,
      },
    });
    await leaderAgent.delete(`/api/communities/${community.id}/conversation/messages/${msg.id}`).set('X-CSRF-Token', leaderCsrf);

    const { agent } = await loginAsAdmin(15);
    const res = await agent.get(`/api/admin/communities/${community.id}/conversation/messages?reason=SECURITY`);
    expect(res.status).toBe(200);
    const row = res.body.items.find((i: any) => i.id === msg.id);
    expect(row.deleted).toBe(true);
    expect(row.attachments).toHaveLength(1);
    expect(row.attachments[0].id).toBe(attachment.id);
    expect(row.attachments[0].originalFilename).toBe('evidence.png');
  });

  it('the listing never includes a storageKey or a signed URL', async () => {
    const community = await makeCommunity('Oversight Community 16');
    const sender = await makePerson('+237693100016', 'Sender 16');
    const conversation = await prisma.conversation.upsert({
      where: { communityId: community.id },
      create: { communityId: community.id },
      update: {},
    });
    const msg = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'x' } });
    await prisma.messageAttachment.create({
      data: {
        messageId: msg.id,
        storageKey: `communities/${community.id}/attachments/${crypto.randomUUID()}`,
        originalFilename: 'a.png',
        mimeType: 'image/png',
        byteSize: 10,
        uploadedByPersonId: sender.id,
      },
    });

    const { agent } = await loginAsAdmin(16);
    const res = await agent.get(`/api/admin/communities/${community.id}/conversation/messages?reason=SECURITY`);
    expect(JSON.stringify(res.body)).not.toContain('storageKey');
    expect(JSON.stringify(res.body)).not.toContain('http');
  });
});

describe('Phase 3M.8C — Central Authority oversight — attachment download', () => {
  async function seedAttachment(communityId: string, n: number) {
    const sender = await makePerson(`+237693200${String(n).padStart(3, '0')}`, `Attachment Sender ${n}`);
    const conversation = await prisma.conversation.upsert({ where: { communityId }, create: { communityId }, update: {} });
    const message = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'x' } });
    const attachment = await prisma.messageAttachment.create({
      data: {
        messageId: message.id,
        storageKey: `communities/${communityId}/attachments/${crypto.randomUUID()}`,
        originalFilename: 'file.png',
        mimeType: 'image/png',
        byteSize: 100,
        uploadedByPersonId: sender.id,
      },
    });
    return { message, attachment };
  }

  it('an Admin with a valid reason gets a fresh signed download URL, and it is audited without the URL itself', async () => {
    const community = await makeCommunity('Oversight Attachment Community 1');
    const { attachment } = await seedAttachment(community.id, 1);
    const { agent, email } = await loginAsAdmin(101);

    const res = await agent.get(`/api/admin/communities/${community.id}/attachments/${attachment.id}/download-url?reason=SECURITY`);
    expect(res.status).toBe(200);
    expect(res.body.url).toContain(attachment.storageKey);

    const row = await prisma.auditLog.findFirst({
      where: { action: 'CENTRAL_AUTHORITY_ATTACHMENT_ACCESSED', targetId: attachment.id },
    });
    expect(row).toBeTruthy();
    expect(row!.actorEmail).toBe(email);
    expect((row!.metadata as any).reason).toBe('SECURITY');
    expect(JSON.stringify(row!.metadata)).not.toContain('http');
  });

  it('a missing reason is rejected', async () => {
    const community = await makeCommunity('Oversight Attachment Community 2');
    const { attachment } = await seedAttachment(community.id, 2);
    const { agent } = await loginAsAdmin(102);

    const res = await agent.get(`/api/admin/communities/${community.id}/attachments/${attachment.id}/download-url`);
    expect(res.status).toBe(400);
  });

  it('an attachment belonging to a DIFFERENT Community is rejected', async () => {
    const communityA = await makeCommunity('Oversight Attachment Community 3A');
    const communityB = await makeCommunity('Oversight Attachment Community 3B');
    const { attachment } = await seedAttachment(communityB.id, 3);
    const { agent } = await loginAsAdmin(103);

    const res = await agent.get(`/api/admin/communities/${communityA.id}/attachments/${attachment.id}/download-url?reason=SECURITY`);
    expect(res.status).toBe(404);
  });

  it('a nonexistent attachment id returns 404', async () => {
    const community = await makeCommunity('Oversight Attachment Community 4');
    const { agent } = await loginAsAdmin(104);

    const res = await agent.get(
      `/api/admin/communities/${community.id}/attachments/00000000-0000-0000-0000-000000000000/download-url?reason=SECURITY`,
    );
    expect(res.status).toBe(404);
  });

  it('a Leader cannot access this route', async () => {
    const community = await makeCommunity('Oversight Attachment Community 5');
    const { attachment } = await seedAttachment(community.id, 5);
    const { agent } = await setupCommunityLeader(105, community.id);

    const res = await agent.get(`/api/admin/communities/${community.id}/attachments/${attachment.id}/download-url?reason=SECURITY`);
    expect(res.status).toBe(403);
  });

  it('returns 503 when object storage is not configured', async () => {
    const community = await makeCommunity('Oversight Attachment Community 6');
    const { attachment } = await seedAttachment(community.id, 6);
    const { agent } = await loginAsAdmin(106);
    vi.mocked(storage.isStorageConfigured).mockReturnValueOnce(false);

    const res = await agent.get(`/api/admin/communities/${community.id}/attachments/${attachment.id}/download-url?reason=SECURITY`);
    expect(res.status).toBe(503);
  });

  it('mints a fresh URL on every call rather than reusing a stored one', async () => {
    const community = await makeCommunity('Oversight Attachment Community 7');
    const { attachment } = await seedAttachment(community.id, 7);
    const { agent } = await loginAsAdmin(107);
    const callsBefore = vi.mocked(storage.createDownloadUrl).mock.calls.length;

    const first = await agent.get(`/api/admin/communities/${community.id}/attachments/${attachment.id}/download-url?reason=SECURITY`);
    const second = await agent.get(`/api/admin/communities/${community.id}/attachments/${attachment.id}/download-url?reason=SECURITY`);
    expect(vi.mocked(storage.createDownloadUrl).mock.calls.length - callsBefore).toBe(2);
    expect(first.body.url).toBe(second.body.url); // same mocked deterministic output, but both are real calls
  });

  it('the dedicated oversight rate limiter applies to attachment downloads too', async () => {
    const community = await makeCommunity('Oversight Attachment Community 8');
    const { attachment } = await seedAttachment(community.id, 8);
    const { agent } = await loginAsAdmin(108);

    let lastStatus = 200;
    for (let i = 0; i < 91; i++) {
      const res = await agent.get(`/api/admin/communities/${community.id}/attachments/${attachment.id}/download-url?reason=SECURITY`);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe('Phase 3M.8B — Central Authority oversight — Geography conversation', () => {
  it('an Admin with a valid reason can view messages, and it is audited', async () => {
    const geography = await makeGeography('Oversight Region 1');
    const { agent, email } = await loginAsAdmin(20);
    const sender = await makePerson('+237693200001', 'Geo Sender 1');
    const conversation = await prisma.geographyConversation.upsert({
      where: { geographyId: geography.id },
      create: { geographyId: geography.id },
      update: {},
    });
    await prisma.geographyMessage.create({ data: { conversationId: conversation.id, senderPersonId: sender.id, body: 'Hi region' } });

    const res = await agent.get(`/api/admin/geographies/${geography.id}/conversation/messages?reason=ORGANIZATIONAL_REVIEW`);
    expect(res.status).toBe(200);
    expect(res.body.items[0].body).toBe('Hi region');

    const row = await prisma.auditLog.findFirst({
      where: { action: 'CENTRAL_AUTHORITY_GEOGRAPHY_CONVERSATION_VIEWED', targetId: geography.id },
    });
    expect(row).toBeTruthy();
    expect(row!.actorEmail).toBe(email);
    expect(row!.targetType).toBe('Geography');
  });

  it('a nonexistent Geography returns 404', async () => {
    const { agent } = await loginAsAdmin(21);
    const res = await agent.get(
      '/api/admin/geographies/00000000-0000-0000-0000-000000000000/conversation/messages?reason=SECURITY',
    );
    expect(res.status).toBe(404);
  });

  it('a missing reason is rejected', async () => {
    const geography = await makeGeography('Oversight Region 2');
    const { agent } = await loginAsAdmin(22);
    const res = await agent.get(`/api/admin/geographies/${geography.id}/conversation/messages`);
    expect(res.status).toBe(400);
  });

  it('an ordinary Person assigned to this Geography cannot use the Admin oversight route', async () => {
    const geography = await makeGeography('Oversight Region 3');
    const { agent, person } = await loginAsMember('+237693200003', 'oversight-geo3@example.com');
    await prisma.geographicAssignment.create({ data: { personId: person.id, geographyId: geography.id } });

    const res = await agent.get(`/api/admin/geographies/${geography.id}/conversation/messages?reason=SECURITY`);
    expect(res.status).toBe(401);
  });
});

describe('Phase 3M.8B — Central Authority oversight — Follow-Up conversation', () => {
  async function makeAssignment(followerId: string, followedPersonId: string, assignedByUserId: string, status: 'ACTIVE' | 'CLOSED' = 'ACTIVE') {
    return prisma.followUpAssignment.create({
      data: {
        followerId,
        followedPersonId,
        contextType: 'COMMUNITY',
        contextId: (await prisma.community.create({ data: { name: `Oversight FU Ctx ${Math.random()}` } })).id,
        assignedByUserId,
        status,
        ...(status === 'CLOSED' ? { closedAt: new Date(), closedByUserId: assignedByUserId } : {}),
      },
    });
  }

  it('an Admin with a valid reason can view a private Follow-Up conversation, and it is audited with both participants', async () => {
    const { user, person: followerPerson } = await setupCommunityLeader(30, (await makeCommunity('Oversight FU Community 1')).id);
    const followed = await makePerson('+237693300001', 'Followed Person 1');
    const assignment = await makeAssignment(followerPerson.id, followed.id, user.id);
    const conversation = await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId: assignment.id },
      create: { followUpAssignmentId: assignment.id },
      update: {},
    });
    await prisma.followUpMessage.create({ data: { conversationId: conversation.id, senderPersonId: followed.id, body: 'private text' } });

    const { agent, email } = await loginAsAdmin(31);
    const res = await agent.get(`/api/admin/follow-ups/${assignment.id}/conversation/messages?reason=ABUSE_OR_SAFEGUARDING`);
    expect(res.status).toBe(200);
    expect(res.body.items[0].body).toBe('private text');

    const row = await prisma.auditLog.findFirst({
      where: { action: 'CENTRAL_AUTHORITY_FOLLOWUP_CONVERSATION_VIEWED', targetId: assignment.id },
    });
    expect(row).toBeTruthy();
    expect(row!.actorEmail).toBe(email);
    expect(row!.targetType).toBe('FollowUpAssignment');
    expect((row!.metadata as any).followerId).toBe(followerPerson.id);
    expect((row!.metadata as any).followedPersonId).toBe(followed.id);
    expect((row!.metadata as any).reason).toBe('ABUSE_OR_SAFEGUARDING');
  });

  it('a CLOSED assignment remains inspectable', async () => {
    const { user, person: followerPerson } = await setupCommunityLeader(32, (await makeCommunity('Oversight FU Community 2')).id);
    const followed = await makePerson('+237693300002', 'Followed Person 2');
    const assignment = await makeAssignment(followerPerson.id, followed.id, user.id, 'CLOSED');

    const { agent } = await loginAsAdmin(33);
    const res = await agent.get(`/api/admin/follow-ups/${assignment.id}/conversation/messages?reason=SECURITY`);
    expect(res.status).toBe(200);
  });

  it('a nonexistent FollowUpAssignment returns 404', async () => {
    const { agent } = await loginAsAdmin(34);
    const res = await agent.get(
      '/api/admin/follow-ups/00000000-0000-0000-0000-000000000000/conversation/messages?reason=SECURITY',
    );
    expect(res.status).toBe(404);
  });

  it('the follower themselves cannot use the Admin oversight route to view their own conversation', async () => {
    const { agent, user, person: followerPerson } = await setupCommunityLeader(35, (await makeCommunity('Oversight FU Community 3')).id);
    const followed = await makePerson('+237693300005', 'Followed Person 5');
    const assignment = await makeAssignment(followerPerson.id, followed.id, user.id);

    // requireRole('ADMIN') returns 403 here (a real Leader session, wrong role).
    const res = await agent.get(`/api/admin/follow-ups/${assignment.id}/conversation/messages?reason=SECURITY`);
    expect(res.status).toBe(403);
  });

  it('an unrelated Member cannot use the Admin oversight route', async () => {
    const { user, person: followerPerson } = await setupCommunityLeader(36, (await makeCommunity('Oversight FU Community 4')).id);
    const followed = await makePerson('+237693300006', 'Followed Person 6');
    const assignment = await makeAssignment(followerPerson.id, followed.id, user.id);
    const { agent: unrelatedAgent } = await loginAsMember('+237693300106', 'oversight-fu6@example.com');

    const res = await unrelatedAgent.get(`/api/admin/follow-ups/${assignment.id}/conversation/messages?reason=SECURITY`);
    expect(res.status).toBe(401);
  });

  it('a messageId cursor from a different Follow-Up conversation is rejected (IDOR)', async () => {
    const { user, person: followerPerson } = await setupCommunityLeader(37, (await makeCommunity('Oversight FU Community 5')).id);
    const followedA = await makePerson('+237693300007', 'Followed Person 7');
    const followedB = await makePerson('+237693300008', 'Followed Person 8');
    const assignmentA = await makeAssignment(followerPerson.id, followedA.id, user.id);
    const assignmentB = await makeAssignment(followerPerson.id, followedB.id, user.id);
    const conversationB = await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId: assignmentB.id },
      create: { followUpAssignmentId: assignmentB.id },
      update: {},
    });
    const msgInB = await prisma.followUpMessage.create({ data: { conversationId: conversationB.id, senderPersonId: followedB.id, body: 'in B' } });

    const { agent } = await loginAsAdmin(38);
    const res = await agent.get(
      `/api/admin/follow-ups/${assignmentA.id}/conversation/messages?reason=SECURITY&before=${msgInB.id}`,
    );
    expect(res.status).toBe(400);
  });

  it('does not create any FollowUpConversationRead row for the Admin (never becomes a participant)', async () => {
    const { user, person: followerPerson } = await setupCommunityLeader(39, (await makeCommunity('Oversight FU Community 6')).id);
    const followed = await makePerson('+237693300009', 'Followed Person 9');
    const assignment = await makeAssignment(followerPerson.id, followed.id, user.id);
    const conversation = await prisma.followUpConversation.upsert({
      where: { followUpAssignmentId: assignment.id },
      create: { followUpAssignmentId: assignment.id },
      update: {},
    });
    await prisma.followUpMessage.create({ data: { conversationId: conversation.id, senderPersonId: followed.id, body: 'x' } });

    const { agent } = await loginAsAdmin(40);
    await agent.get(`/api/admin/follow-ups/${assignment.id}/conversation/messages?reason=SECURITY`);

    const readRows = await prisma.followUpConversationRead.count({ where: { conversationId: conversation.id } });
    expect(readRows).toBe(0);
  });
});
