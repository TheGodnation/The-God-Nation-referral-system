import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';

// The central admin's own member profile carries the admin's powers in the
// member app (every assembly's chat, moderation, the "National
// Coordinator" badge), and signing in to it on a new phone needs the
// emailed code.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.134.${Math.floor(n / 256)}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
type Agent = ReturnType<typeof agentWithIp>;

async function person(name: string, admin = false) {
  n += 1;
  const email = `coord${n}@example.com`;
  const p = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2376560${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: p.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (admin) await prisma.user.create({ data: { name: 'Central Admin', email: `coord-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: p.id } });
  return { person: p, email };
}

async function login(agent: Agent, email: string, knownCsrf?: string) {
  const csrf = knownCsrf ?? (await bootstrap(agent as any)).csrf;
  const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  return { res, csrf };
}

async function signedIn(name: string, admin = false) {
  const who = await person(name, admin);
  const agent = agentWithIp();
  if (admin) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    const { csrf } = await login(agent, who.email);
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email: who.email, code });
    spy.mockRestore();
    return { ...who, agent, csrf };
  }
  const { csrf } = await login(agent, who.email);
  return { ...who, agent, csrf };
}

afterEach(() => vi.restoreAllMocks());

describe('Signing in to the central admin’s member profile', () => {
  it('needs the emailed code on a new phone, then the password alone works on that phone', async () => {
    const admin = await person('Coordinator', true);
    const phone = agentWithIp();
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    const first = await login(phone, admin.email);
    expect(first.res.body).toEqual({ codeRequired: true });
    expect((await phone.get('/api/member/auth/me')).body.member).toBeNull();
    const code = spy.mock.calls[0][0].code as string;

    const verified = await phone.post('/api/member/auth/verify-code').set('X-CSRF-Token', first.csrf).send({ email: admin.email, code });
    expect(verified.status).toBe(200);
    expect(String(verified.headers['set-cookie'])).toMatch(/mtd=/);
    expect((await phone.get('/api/member/auth/me')).body.member.name).toBe(admin.person.name);

    // Same phone later: password alone.
    await phone.post('/api/member/auth/logout').set('X-CSRF-Token', first.csrf);
    expect((await login(phone, admin.email, first.csrf)).res.body.member).toBeTruthy();

    // Another phone: the code again. A wrong password never reaches that step.
    const other = agentWithIp();
    const second = await login(other, admin.email);
    expect(second.res.body).toEqual({ codeRequired: true });
    const csrf = second.csrf;
    expect((await other.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email: admin.email, password: 'wrong' })).status).toBe(401);
  });

  it('an ordinary member is never asked for a code', async () => {
    const m = await person('Member');
    expect((await login(agentWithIp(), m.email)).res.body.member).toBeTruthy();
  });
});

describe('Powers of the central admin’s member profile', () => {
  it('opens, writes in and moderates every assembly, even one it is not in, and shows the badge', async () => {
    const admin = await signedIn('Coordinator', true);
    const member = await signedIn('Member');
    const assembly = await prisma.community.create({ data: { name: `Assembly ${n}`, postingPolicy: 'LEADERS_ONLY' } });
    await prisma.communityMembership.create({ data: { personId: member.person.id, communityId: assembly.id } });
    const conversation = await prisma.conversation.create({ data: { communityId: assembly.id } });
    const theirs = await prisma.message.create({ data: { conversationId: conversation.id, senderPersonId: member.person.id, body: 'Hello' } });
    const base = `/api/communities/${assembly.id}/conversation`;

    // In its chats list, marked as not a member there.
    const chats = await admin.agent.get('/api/member/me/community-memberships');
    expect(chats.body.items).toContainEqual(expect.objectContaining({ communityId: assembly.id, asCoordinator: true }));

    const list = await admin.agent.get(`${base}/messages`);
    expect(list.status).toBe(200);
    expect(list.body.isAdministrator).toBe(true);
    expect(list.body.canPost).toBe(true);

    const sent = await admin.agent.post(`${base}/messages`).set('X-CSRF-Token', admin.csrf).send({ body: 'Teaching for today' });
    expect(sent.status).toBe(201);
    // Ordinary members can't write in a leaders-only assembly.
    expect((await member.agent.post(`${base}/messages`).set('X-CSRF-Token', member.csrf).send({ body: 'Me too' })).status).toBe(403);

    expect((await admin.agent.delete(`${base}/messages/${theirs.id}`).set('X-CSRF-Token', admin.csrf)).status).toBe(200);

    const seen = await member.agent.get(`${base}/messages`);
    const mine = seen.body.items.find((m: any) => m.body === 'Teaching for today');
    expect(mine.senderBadge).toBe('NATIONAL_COORDINATOR');
    expect(seen.body.items.find((m: any) => m.id === theirs.id).deleted).toBe(true);

    // Profile and posts carry the badge too.
    expect((await member.agent.get(`/api/member/people/${admin.person.id}`)).body.badge).toBe('NATIONAL_COORDINATOR');
    expect((await admin.agent.get(`/api/member/people/${member.person.id}`)).body.badge).toBeNull();
  });

  it('moderates the home page; an inactive admin account loses all of it', async () => {
    const admin = await signedIn('Coordinator', true);
    const member = await signedIn('Member');
    const post = await prisma.updatePost.create({ data: { authorPersonId: member.person.id, body: 'Not suitable' } });
    const feed = await admin.agent.get('/api/updates');
    expect(feed.body.viewer.canModerate).toBe(true);
    expect((await admin.agent.delete(`/api/updates/${post.id}`).set('X-CSRF-Token', admin.csrf)).status).toBe(200);

    await prisma.user.updateMany({ where: { personId: admin.person.id }, data: { active: false } });
    expect((await admin.agent.get('/api/updates')).body.viewer.canModerate).toBe(false);
    const assembly = await prisma.community.create({ data: { name: `Closed ${n}` } });
    expect((await admin.agent.get(`/api/communities/${assembly.id}/conversation/messages`)).status).toBe(403);
  });
});
