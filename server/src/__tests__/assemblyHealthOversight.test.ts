import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Assembly health (green / yellow / red, rolled up the tree), the leaders
// behind it, and the central admin's secret read-only view of leader-person
// follow-up chats (nobody is told; he can switch it off).
const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

let ip = 0;
function agentWithUniqueIp() {
  ip += 1;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', `10.154.0.${ip}`);
  return wrapped;
}
let n = 0;
const person = (name: string) => {
  n += 1;
  return prisma.person.create({ data: { name, whatsappNumber: `+2376640${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
};
async function login(email: string, password: string) {
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

async function world() {
  const admin = await createAdmin('health-admin@test.local', 'AdminPass123!');
  const parent = await prisma.community.create({ data: { name: 'Parent' } });
  const child = await prisma.community.create({ data: { name: 'Child', parentId: parent.id } });
  const empty = await prisma.community.create({ data: { name: 'Empty' } });
  async function leader(name: string, community: { id: string }) {
    const email = `${name.toLowerCase().replace(/\W/g, '')}${n}@test.local`;
    const { user } = await createLeader(name, email, `H${n}${name.slice(0, 3).toUpperCase()}`);
    const p = await person(name);
    await prisma.user.update({ where: { id: user.id }, data: { personId: p.id } });
    await prisma.roleAssignment.create({ data: { personId: p.id, roleType: 'SCOPED_LEADER', communityId: community.id, assignedByUserId: admin.id } });
    return { user, p, email };
  }
  async function follow(leaderPersonId: string, community: { id: string }, name: string, assignedDaysAgo = 10) {
    const p = await person(name);
    await prisma.communityMembership.create({ data: { personId: p.id, communityId: community.id, status: 'ACTIVE' } });
    const a = await prisma.followUpAssignment.create({
      data: { followerId: leaderPersonId, followedPersonId: p.id, contextType: 'COMMUNITY', contextId: community.id, assignedByUserId: admin.id, assignedAt: new Date(Date.now() - assignedDaysAgo * DAY) },
    });
    return { p, a };
  }
  const contact = (assignmentId: string, daysAgo: number, wellbeingStatus: 'GOOD' | 'EMERGENCY' = 'GOOD') =>
    prisma.followUpContact.create({ data: { followUpAssignmentId: assignmentId, contactedAt: new Date(Date.now() - daysAgo * DAY), wellbeingStatus, loggedByUserId: admin.id } });
  return { admin, parent, child, empty, leader, follow, contact };
}

describe('assembly health', () => {
  it('green when leaders keep in touch twice a week, red on an emergency, grey when empty, and the worst rolls up to the assembly above', async () => {
    const w = await world();
    const pl = await w.leader('Parent Pat', w.parent);
    const cl = await w.leader('Child Chris', w.child);
    const good = await w.follow(pl.p.id, w.parent, 'Fine one');
    await w.contact(good.a.id, 1);
    await w.contact(good.a.id, 3);
    const sick = await w.follow(cl.p.id, w.child, 'Emergency one');
    await w.contact(sick.a.id, 1, 'EMERGENCY');
    await w.contact(sick.a.id, 2);

    const { agent } = await login('health-admin@test.local', 'AdminPass123!');
    const res = await agent.get('/api/admin/cells/health');
    expect(res.status).toBe(200);
    const row = (id: string) => res.body.items.find((r: any) => r.id === id);
    expect(row(w.parent.id).own).toMatchObject({ color: 'GREEN', weeklyRate: 1, followed: 1, leaders: 1 });
    expect(row(w.child.id).own).toMatchObject({ color: 'RED', emergencies: 1 });
    expect(row(w.parent.id).tree.color).toBe('RED');
    expect(row(w.parent.id).tree).toMatchObject({ members: 2, leaders: 2, followed: 2 });
    expect(row(w.empty.id).own.color).toBe('GREY');
  });

  it('a leader who writes in the chat counts as in touch; no contact at all is red; no leader is red', async () => {
    const w = await world();
    const pl = await w.leader('Parent Pat', w.parent);
    const quiet = await w.follow(pl.p.id, w.parent, 'Quiet one');
    const chatty = await w.follow(pl.p.id, w.parent, 'Chatty one');
    const conv = await prisma.privateConversation.create({ data: { memberPersonId: chatty.p.id, initiatorPersonId: pl.p.id } });
    await prisma.privateMessage.create({ data: { conversationId: conv.id, senderPersonId: pl.p.id, body: 'a', createdAt: new Date(Date.now() - 1 * DAY) } });
    await prisma.privateMessage.create({ data: { conversationId: conv.id, senderPersonId: pl.p.id, body: 'b', createdAt: new Date(Date.now() - 3 * DAY) } });
    void quiet;
    // An assembly with members and no leader.
    const orphan = await prisma.community.create({ data: { name: 'Orphan' } });
    const m = await person('Alone');
    await prisma.communityMembership.create({ data: { personId: m.id, communityId: orphan.id, status: 'ACTIVE' } });

    const { agent } = await login('health-admin@test.local', 'AdminPass123!');
    const items = (await agent.get('/api/admin/cells/health')).body.items;
    const parent = items.find((r: any) => r.id === w.parent.id).own;
    expect(parent).toMatchObject({ eligible: 2, contactedTwice: 1, weeklyRate: 0.5, color: 'YELLOW' });
    expect(items.find((r: any) => r.id === orphan.id).own.color).toBe('RED');
  });

  it('drills down to the leaders, and a parent assembly leader sees the assemblies below theirs', async () => {
    const w = await world();
    const pl = await w.leader('Parent Pat', w.parent);
    const cl = await w.leader('Child Chris', w.child);
    const sick = await w.follow(cl.p.id, w.child, 'Emergency one');
    await w.contact(sick.a.id, 1, 'EMERGENCY');
    const { agent } = await login('health-admin@test.local', 'AdminPass123!');
    const drill = await agent.get(`/api/admin/cells/health/${w.child.id}/leaders`);
    expect(drill.body.items).toEqual([expect.objectContaining({ name: 'Child Chris', people: 1, emergencies: 1, needingAttention: 1 })]);

    const lead = await login(pl.email, 'password123');
    const mine = await lead.agent.get('/api/leader/assembly-health');
    expect(mine.body.items.map((r: any) => r.name).sort()).toEqual(['Child', 'Parent']);
    const childLead = await login(cl.email, 'password123');
    expect((await childLead.agent.get('/api/leader/assembly-health')).body.items.map((r: any) => r.name)).toEqual(['Child']);
  });
});

describe('the central admin reading follow-up chats (secretly)', () => {
  async function chat(w: Awaited<ReturnType<typeof world>>) {
    const leader = await w.leader('Chat Charlie', w.parent);
    const f = await w.follow(leader.p.id, w.parent, 'Member Mia');
    const conv = await prisma.privateConversation.create({ data: { memberPersonId: f.p.id, initiatorPersonId: leader.p.id } });
    await prisma.privateMessage.create({ data: { conversationId: conv.id, senderPersonId: leader.p.id, body: 'How are you?', createdAt: new Date(Date.now() - 3600_000) } });
    const voice = await prisma.privateMessage.create({ data: { conversationId: conv.id, senderPersonId: f.p.id, body: '' } });
    await prisma.privateMessageAttachment.create({ data: { messageId: voice.id, storageKey: `k-${n}-${Math.random()}`, originalFilename: 'voice.m4a', mimeType: 'audio/mp4', byteSize: 10 } });
    return { leader, f, conv };
  }

  it('lists a leader\'s chats and shows the whole conversation, without telling anyone or marking anything read', async () => {
    const w = await world();
    const c = await chat(w);
    const { agent } = await login('health-admin@test.local', 'AdminPass123!');
    const list = await agent.get(`/api/admin/cells/oversight/leaders/${c.leader.p.id}/chats`);
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([expect.objectContaining({ conversationId: c.conv.id, memberName: 'Member Mia', messageCount: 2, lastFrom: 'MEMBER' })]);

    const thread = await agent.get(`/api/admin/cells/oversight/chats/${c.conv.id}`);
    expect(thread.status).toBe(200);
    expect(thread.body.leaderName).toBe('Chat Charlie');
    expect(thread.body.messages.map((m: any) => [m.from, m.body, m.attachments.map((a: any) => a.kind)])).toEqual([
      ['LEADER', 'How are you?', []],
      ['MEMBER', '', ['VOICE']],
    ]);
    // Nobody is told, nothing is marked as read; only an access record for the admin.
    expect(await prisma.privateConversationRead.count()).toBe(0);
    expect(await prisma.notification.count({ where: { recipientPersonId: { in: [c.leader.p.id, c.f.p.id] } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'FOLLOW_UP_CHAT_OVERSIGHT_READ' } })).toBe(1);
  });

  it('can be switched off, and a chat that was not started by a leader is never shown', async () => {
    const w = await world();
    const c = await chat(w);
    const { agent, csrf } = await login('health-admin@test.local', 'AdminPass123!');
    expect((await agent.get('/api/admin/cells/oversight/settings')).body.enabled).toBe(true);

    const adminUser = await prisma.user.findUniqueOrThrow({ where: { email: 'health-admin@test.local' } });
    const byAdmin = await prisma.privateConversation.create({ data: { memberPersonId: c.f.p.id, initiatorUserId: adminUser.id } });
    expect((await agent.get(`/api/admin/cells/oversight/chats/${byAdmin.id}`)).status).toBe(404);

    const off = await agent.put('/api/admin/cells/oversight/settings').set('X-CSRF-Token', csrf).send({ enabled: false });
    expect(off.body.enabled).toBe(false);
    expect((await agent.get(`/api/admin/cells/oversight/chats/${c.conv.id}`)).status).toBe(403);
    expect((await agent.get(`/api/admin/cells/oversight/leaders/${c.leader.p.id}/chats`)).status).toBe(403);
  });

  it('is closed to leaders and visitors', async () => {
    const w = await world();
    const c = await chat(w);
    const lead = await login(c.leader.email, 'password123');
    expect((await lead.agent.get(`/api/admin/cells/oversight/chats/${c.conv.id}`)).status).toBe(403);
    expect((await agentWithUniqueIp().get(`/api/admin/cells/oversight/chats/${c.conv.id}`)).status).toBe(401);
  });
});
