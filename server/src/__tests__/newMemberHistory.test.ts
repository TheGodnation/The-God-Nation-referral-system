import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';

// "Last 10 messages for newcomers": someone who joins an assembly sees the 10
// latest earlier messages and everything since, with the unread badge showing
// that messages are waiting. Current members, leaders and the central admin
// keep the full history.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.151.${Math.floor(n / 256)}.${n % 256}`;
  const methods = ['get', 'post'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}

async function signedIn(name: string, opts: { admin?: boolean; communityId?: string; joinedAt?: Date } = {}) {
  n += 1;
  const email = `hist${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2376580${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (opts.admin) await prisma.user.create({ data: { name: 'Central Admin', email: `hist-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
  if (opts.communityId) await prisma.communityMembership.create({ data: { personId: person.id, communityId: opts.communityId, status: 'ACTIVE', ...(opts.joinedAt ? { joinedAt: opts.joinedAt } : {}) } });
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  if (opts.admin) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  } else {
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  }
  return { person, agent, csrf };
}

const MIN = 60_000;

/** An assembly with 15 old messages (m1 … m15, oldest first) from someone already in it. */
async function assemblyWithHistory() {
  const community = await prisma.community.create({ data: { name: `History ${n++}` } });
  const old = await signedIn('Old Timer', { communityId: community.id, joinedAt: new Date(Date.now() - 3 * 24 * 60 * MIN) });
  const conversation = await prisma.conversation.create({ data: { communityId: community.id } });
  for (let i = 1; i <= 15; i++) {
    await prisma.message.create({
      data: { conversationId: conversation.id, senderPersonId: old.person.id, body: `m${i}`, createdAt: new Date(Date.now() - (60 - i) * MIN) },
    });
  }
  return { community, conversation, old };
}

const bodies = (res: request.Response) => res.body.items.map((i: any) => i.body);

afterEach(() => vi.restoreAllMocks());

describe('Newcomers see the last 10 messages', () => {
  it('a new member sees the 10 latest earlier messages and what comes after, with the unread badge', async () => {
    const { community, conversation, old } = await assemblyWithHistory();
    const fresh = await signedIn('Newcomer', { communityId: community.id });

    const info = await fresh.agent.get(`/api/communities/${community.id}/conversation`);
    expect(info.body.unreadCount).toBe(10);
    expect(info.body.lastMessage.body).toBe('m15');

    const list = await fresh.agent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(bodies(list)).toEqual(['m6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12', 'm13', 'm14', 'm15']);

    // Scrolling up reaches nothing older.
    const older = await fresh.agent.get(`/api/communities/${community.id}/conversation/messages?before=${list.body.items[0].id}`);
    expect(bodies(older)).toEqual([]);

    // New messages after joining are all seen.
    await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: old.person.id, body: 'after joining' } });
    const again = await fresh.agent.get(`/api/communities/${community.id}/conversation/messages`);
    expect(bodies(again)).toHaveLength(11);
    expect(bodies(again).at(-1)).toBe('after joining');
    expect((await fresh.agent.get(`/api/communities/${community.id}/conversation`)).body.unreadCount).toBe(11);
  });

  it('search never reaches before that window', async () => {
    const { community } = await assemblyWithHistory();
    const fresh = await signedIn('Newcomer', { communityId: community.id });
    const hit = await fresh.agent.get(`/api/communities/${community.id}/conversation/search?q=m1`);
    // m1 … m5 are older than the window; m10 … m15 match "m1".
    expect(hit.body.items.map((i: any) => i.body).sort()).toEqual(['m10', 'm11', 'm12', 'm13', 'm14', 'm15']);
    const old = await fresh.agent.get(`/api/communities/${community.id}/conversation/search?q=m3`);
    expect(old.body.items).toEqual([]);
  });

  it('members who joined before keep their full history, as do the central admin and an assembly with few messages', async () => {
    const { community } = await assemblyWithHistory();
    const veteran = await signedIn('Veteran', { communityId: community.id, joinedAt: new Date(Date.now() - 2 * 24 * 60 * MIN) });
    expect(bodies(await veteran.agent.get(`/api/communities/${community.id}/conversation/messages`))).toHaveLength(15);
    const admin = await signedIn('Coordinator', { admin: true });
    expect(bodies(await admin.agent.get(`/api/communities/${community.id}/conversation/messages`))).toHaveLength(15);

    const small = await prisma.community.create({ data: { name: `Small ${n++}` } });
    const sender = await signedIn('Sender', { communityId: small.id, joinedAt: new Date(Date.now() - 2 * 24 * 60 * MIN) });
    const convo = await prisma.conversation.create({ data: { communityId: small.id } });
    for (let i = 1; i <= 4; i++) await prisma.message.create({ data: { conversationId: convo.id, senderPersonId: sender.person.id, body: `s${i}`, createdAt: new Date(Date.now() - (30 - i) * MIN) } });
    const joiner = await signedIn('Joiner', { communityId: small.id });
    expect(bodies(await joiner.agent.get(`/api/communities/${small.id}/conversation/messages`))).toEqual(['s1', 's2', 's3', 's4']);
  });

  it('members who joined before the rule was introduced keep everything', async () => {
    const { community } = await assemblyWithHistory();
    const fresh = await signedIn('Joined Yesterday Enough', { communityId: community.id });
    // The rule "starts" in the future: this member joined before it.
    await prisma.settings.create({ data: { id: 'singleton', newMemberHistoryFrom: new Date(Date.now() + 60 * MIN) } });
    expect(bodies(await fresh.agent.get(`/api/communities/${community.id}/conversation/messages`))).toHaveLength(15);
  });
});
