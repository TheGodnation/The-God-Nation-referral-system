import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Share-into-app: forwarding from WhatsApp / TikTok / Facebook / Instagram
// into the Updates feed as an official post. Only the Central Admin (admin
// account, or their own member profile on the phone) — and Leaders the
// admin switches on — may do it.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.177.${Math.floor(n / 256)}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
type Agent = ReturnType<typeof agentWithIp>;

async function memberPerson(name: string) {
  n += 1;
  const email = `share${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376570${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  return { person, email };
}

async function memberLogin(agent: Agent, email: string, needsCode = false) {
  const { csrf } = await bootstrap(agent as any);
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  if (needsCode) {
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  }
  spy.mockRestore();
  return csrf;
}

async function signedInMember(name: string) {
  const who = await memberPerson(name);
  const agent = agentWithIp();
  const csrf = await memberLogin(agent, who.email);
  return { ...who, agent, csrf };
}

async function signedInAdminAccount() {
  n += 1;
  const email = `share-admin${n}@test.local`;
  await createAdmin(email);
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf };
}

/** The central admin signed in to their own member profile on the phone. */
async function signedInAdminProfile() {
  const who = await memberPerson('Coordinator');
  await prisma.user.create({ data: { name: 'Central Admin', email: `share-coord-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: who.person.id } });
  const agent = agentWithIp();
  const csrf = await memberLogin(agent, who.email, true);
  return { ...who, agent, csrf };
}

async function leaderProfile() {
  n += 1;
  const { user } = await createLeader(`Share Leader ${n}`, `share-leader${n}@test.local`, `SHL${n}CODE`);
  const who = await memberPerson('Leader');
  await prisma.user.update({ where: { id: user.id }, data: { personId: who.person.id } });
  const agent = agentWithIp();
  const csrf = await memberLogin(agent, who.email);
  return { ...who, user, agent, csrf };
}

async function headquartersWithMember() {
  const hq = await prisma.community.create({ data: { name: `HQ ${n}` } });
  await prisma.settings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', headquartersCommunityId: hq.id },
    update: { headquartersCommunityId: hq.id },
  });
  const reader = await signedInMember('Reader');
  await prisma.communityMembership.create({ data: { personId: reader.person.id, communityId: hq.id } });
  return { hq, reader };
}

afterEach(() => vi.restoreAllMocks());

describe('Who can share into the app', () => {
  it('an ordinary member is told it is only for leaders, and cannot post', async () => {
    const m = await signedInMember('Member');
    expect((await m.agent.get('/api/share-into-app/status')).body).toEqual({ canShare: false });
    const res = await m.agent.post('/api/share-into-app/posts').set('X-CSRF-Token', m.csrf).send({ body: 'Hi', networkWide: true });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_A_SHARER');
  });

  it('someone not signed in cannot post either', async () => {
    const agent = agentWithIp();
    const { csrf } = await bootstrap(agent as any);
    expect((await agent.get('/api/share-into-app/status')).body).toEqual({ canShare: false });
    expect((await agent.post('/api/share-into-app/posts').set('X-CSRF-Token', csrf).send({ body: 'x', networkWide: true })).status).toBe(403);
  });

  it('the Central Admin account can share, to everyone or to groups', async () => {
    const a = await signedInAdminAccount();
    const status = (await a.agent.get('/api/share-into-app/status')).body;
    expect(status).toMatchObject({ canShare: true, isAdmin: true, canPostNetworkWide: true });
    expect(status.voices).toContain('COMMUNICATION_DEPARTMENT');
  });

  it('the Central Admin’s own member profile on the phone can share too', async () => {
    const a = await signedInAdminProfile();
    const status = (await a.agent.get('/api/share-into-app/status')).body;
    expect(status).toMatchObject({ canShare: true, isAdmin: true, canPostAsSelf: true });
  });

  it('a Leader can only share once switched on, and only into their own groups', async () => {
    const leader = await leaderProfile();
    expect((await leader.agent.get('/api/share-into-app/status')).body.canShare).toBe(false);

    // The admin switches it on.
    const admin = await signedInAdminAccount();
    const sw = await admin.agent.patch(`/api/share-into-app/sharers/${leader.person.id}`).set('X-CSRF-Token', admin.csrf).send({ allowed: true });
    expect(sw.status).toBe(200);

    const mine = await prisma.community.create({ data: { name: 'Leader group' } });
    const other = await prisma.community.create({ data: { name: 'Other group' } });
    await prisma.roleAssignment.create({
      data: { personId: leader.person.id, roleType: 'SCOPED_LEADER', communityId: mine.id, assignedByUserId: leader.user.id },
    });

    const status = (await leader.agent.get('/api/share-into-app/status')).body;
    expect(status).toMatchObject({ canShare: true, isAdmin: false, canPostNetworkWide: false });
    expect(status.communities.map((c: { id: string }) => c.id)).toEqual([mine.id]);
    expect(status.voices).not.toContain('CENTRAL_AUTHORITY');

    const post = (body: object) => leader.agent.post('/api/share-into-app/posts').set('X-CSRF-Token', leader.csrf).send(body);
    expect((await post({ body: 'x', networkWide: true })).status).toBe(403);
    expect((await post({ body: 'x', communityIds: [other.id] })).status).toBe(403);
    expect((await post({ body: 'x', communityIds: [mine.id], voice: 'CENTRAL_AUTHORITY' })).status).toBe(403);
    expect((await post({ body: 'x', communityIds: [mine.id] })).status).toBe(201);

    // Switched off again: no more sharing.
    await admin.agent.patch(`/api/share-into-app/sharers/${leader.person.id}`).set('X-CSRF-Token', admin.csrf).send({ allowed: false });
    expect((await post({ body: 'x', communityIds: [mine.id] })).status).toBe(403);
  });

  it('only the Central Admin can switch a Leader on', async () => {
    const leader = await leaderProfile();
    await prisma.person.update({ where: { id: leader.person.id }, data: { canShareIntoApp: true } });
    const res = await leader.agent.patch(`/api/share-into-app/sharers/${leader.person.id}`).set('X-CSRF-Token', leader.csrf).send({ allowed: true });
    expect(res.status).toBe(403);
  });
});

describe('A shared post in the feed', () => {
  it('shows as the Communication Department, with the TikTok playing inside the app', async () => {
    const { reader } = await headquartersWithMember();
    const a = await signedInAdminProfile();

    const created = await a.agent.post('/api/share-into-app/posts').set('X-CSRF-Token', a.csrf).send({
      body: 'Powerful word this morning 🙏 https://www.tiktok.com/@godsnation/video/7412345678901234567?is_from_webapp=1',
      voice: 'COMMUNICATION_DEPARTMENT',
      networkWide: true,
    });
    expect(created.status).toBe(201);
    expect(created.body.link).toMatchObject({ provider: 'TIKTOK', src: 'https://www.tiktok.com/embed/v2/7412345678901234567' });

    // Not visible before Post is tapped.
    expect((await reader.agent.get('/api/me/headquarters-posts')).body.items).toHaveLength(0);

    const published = await a.agent.post(`/api/share-into-app/posts/${created.body.id}/publish`).set('X-CSRF-Token', a.csrf);
    expect(published.status).toBe(200);

    const feed = (await reader.agent.get('/api/me/headquarters-posts')).body.items;
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      voice: 'COMMUNICATION_DEPARTMENT',
      author: null,
      titleEn: '',
      embed: { provider: 'TIKTOK', src: 'https://www.tiktok.com/embed/v2/7412345678901234567' },
    });
    expect(feed[0].bodyEn).toContain('Powerful word');

    // The real sharer is still recorded, privately.
    const row = await prisma.headquartersPost.findUnique({ where: { id: created.body.id }, include: { createdBy: true } });
    expect(row!.createdBy.personId).toBe(a.person.id);
    // Members are told about it like any official post.
    expect(await prisma.notification.count({ where: { recipientPersonId: reader.person.id, targetId: created.body.id } })).toBe(1);
  });

  it('a plain website link stays a link card, never a player', async () => {
    await headquartersWithMember();
    const a = await signedInAdminAccount();
    const created = await a.agent.post('/api/share-into-app/posts').set('X-CSRF-Token', a.csrf).send({ body: 'Read: https://example.com/article', networkWide: true });
    expect(created.body.link).toEqual({ provider: 'OTHER', url: 'https://example.com/article', src: null });
  });

  it('needs an audience and something to post', async () => {
    const a = await signedInAdminAccount();
    const post = (body: object) => a.agent.post('/api/share-into-app/posts').set('X-CSRF-Token', a.csrf).send(body);
    expect((await post({ body: 'Hi' })).status).toBe(400); // no audience
    expect((await post({ networkWide: true })).status).toBe(400); // nothing to post
  });

  it('nobody else can add files to or publish someone’s shared post', async () => {
    const a = await signedInAdminAccount();
    const created = await a.agent.post('/api/share-into-app/posts').set('X-CSRF-Token', a.csrf).send({ body: 'Hi', networkWide: true });
    const other = await signedInAdminProfile();
    expect((await other.agent.post(`/api/share-into-app/posts/${created.body.id}/publish`).set('X-CSRF-Token', other.csrf)).status).toBe(404);
    // Published twice? Refused the second time.
    expect((await a.agent.post(`/api/share-into-app/posts/${created.body.id}/publish`).set('X-CSRF-Token', a.csrf)).status).toBe(200);
    expect((await a.agent.post(`/api/share-into-app/posts/${created.body.id}/publish`).set('X-CSRF-Token', a.csrf)).status).toBe(409);
  });

  it('the phone’s Share menu fallback opens the Share screen', async () => {
    const res = await agentWithIp().post('/share-target');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/share?missed=1');
  });
});
