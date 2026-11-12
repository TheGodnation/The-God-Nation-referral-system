import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { bootstrap } from './testUtils';
import { centralAdminPerson } from '../lib/trainingWelcome';
import { agreementRequired, pendingAgreements } from '../lib/assemblyAgreement';
import { agreedMessage } from '../lib/assemblyAgreeing';
import { announceJoined } from '../lib/joinNotice';

// The Assembly Agreement: a new member is already in the group and can read and react, but cannot post or reply
// until they agree to its rules. Agreeing counts as joining (the "just joined" line, and a private message with a link).
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.194.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
type Who = Awaited<ReturnType<typeof signedIn>>;

async function signedIn(name: string, opts: { createdAt?: Date; lang?: 'en' | 'fr'; leadsId?: string; admin?: boolean } = {}) {
  n += 1;
  const email = `agr${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2378500${String(n).padStart(5, '0')}`, preferredLanguage: opts.lang ?? 'en', profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4), ...(opts.createdAt ? { createdAt: opts.createdAt } : {}) } });
  if (opts.admin) await prisma.user.create({ data: { name: 'Central Admin', email: `agr-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
  if (opts.leadsId) {
    const any = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const assigner = any ?? (await prisma.user.create({ data: { name: 'Assigner', email: `agr-as-${n}@test.local`, passwordHash: 'x', role: 'ADMIN' } }));
    await prisma.roleAssignment.create({ data: { personId: person.id, roleType: 'SCOPED_LEADER', communityId: opts.leadsId, assignedByUserId: assigner.id } });
  }
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { person, agent, csrf };
}
async function assembly(name: string) {
  const c = await prisma.community.create({ data: { name: `${name} ${++n}` } });
  await prisma.conversation.create({ data: { communityId: c.id } });
  return c;
}
const join = (personId: string, communityId: string) => prisma.communityMembership.create({ data: { personId, communityId } });
const post = (w: Who, path: string, body: unknown = {}) => w.agent.post(path).set('X-CSRF-Token', w.csrf).send(body as object);
const say = (w: Who, communityId: string, body = 'Hello', extra: object = {}) => post(w, `/api/communities/${communityId}/conversation/messages`, { body, ...extra });
const agree = (w: Who, communityId: string) => post(w, `/api/communities/${communityId}/agreement`);
const startRule = (from = new Date(Date.now() - 24 * 3600 * 1000)) => prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', assemblyAgreementFrom: from }, update: { assemblyAgreementFrom: from } });
async function founderId() {
  const existing = await centralAdminPerson();
  if (existing) return existing.id;
  return (await signedIn('Founder', { admin: true })).person.id;
}

beforeEach(async () => {
  await prisma.settings.updateMany({ data: { assemblyAgreementFrom: null } });
});
afterEach(async () => {
  vi.restoreAllMocks();
  // Posting and reacting start notifications in the background; let them finish before the next test clears the tables
  // (otherwise the cleanup and a late background write can deadlock in the database).
  await new Promise((r) => setTimeout(r, 400));
});

describe('Before the rule starts (or while it is off)', () => {
  it('everyone writes as before', async () => {
    const a = await assembly('AgrOff');
    const m = await signedIn('Newbie');
    await join(m.person.id, a.id);
    expect(await agreementRequired(m.person.id, a.id)).toBe(false);
    expect((await say(m, a.id)).status).toBe(201);
  });
});

describe('A new member', () => {
  it('can read and react but not post or reply until they agree', async () => {
    await startRule();
    const a = await assembly('AgrNew');
    const leader = await signedIn('Leader', { leadsId: a.id, createdAt: new Date(Date.now() - 90 * 86400000) });
    await join(leader.person.id, a.id);
    const spoken = await say(leader, a.id, 'Welcome all');
    expect(spoken.status).toBe(201);
    const m = await signedIn('Newbie');
    await join(m.person.id, a.id);

    const read = await m.agent.get(`/api/communities/${a.id}/conversation/messages`);
    expect(read.status).toBe(200);
    expect(read.body.items.length).toBeGreaterThan(0);
    expect(read.body.canPost).toBe(false);
    expect(read.body.agreementRequired).toBe(true);

    const blocked = await say(m, a.id, 'Hi everyone');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('AGREEMENT_REQUIRED');
    const reply = await say(m, a.id, 'Amen', { replyToMessageId: spoken.body.id ?? spoken.body.message?.id });
    expect(reply.status).toBe(403);

    const messageId = spoken.body.id ?? spoken.body.message?.id;
    const react = await m.agent.put(`/api/communities/${a.id}/conversation/messages/${messageId}/reaction`).set('X-CSRF-Token', m.csrf).send({ emoji: '🙏' });
    expect(react.status).toBe(200);
  });

  it('can write after agreeing, and agreeing again changes nothing', async () => {
    await startRule();
    const a = await assembly('AgrAgree');
    const m = await signedIn('Newbie');
    await join(m.person.id, a.id);
    const ok = await agree(m, a.id);
    expect(ok.status).toBe(200);
    expect(ok.body.alreadyAgreed).toBe(false);
    expect((await say(m, a.id, 'Hello, I am here')).status).toBe(201);
    const again = await agree(m, a.id);
    expect(again.body.alreadyAgreed).toBe(true);
    expect(await prisma.assemblyAgreement.count({ where: { personId: m.person.id, communityId: a.id } })).toBe(1);
    const read = await m.agent.get(`/api/communities/${a.id}/conversation/messages`);
    expect(read.body.canPost).toBe(true);
    expect(read.body.agreementRequired).toBe(false);
  });

  it('agrees assembly by assembly, and only for one they belong to', async () => {
    await startRule();
    const a = await assembly('AgrOne');
    const b = await assembly('AgrTwo');
    const m = await signedIn('Newbie');
    await join(m.person.id, a.id);
    expect((await agree(m, b.id)).status).toBe(403);
    await agree(m, a.id);
    await join(m.person.id, b.id);
    expect(await agreementRequired(m.person.id, a.id)).toBe(false);
    expect(await agreementRequired(m.person.id, b.id)).toBe(true);
    expect((await pendingAgreements(m.person.id)).map((p) => p.communityId)).toEqual([b.id]);
  });

  it('agreeing counts as joining: the join line appears then (not before) and they get a private message with a link', async () => {
    await startRule();
    const fromId = await founderId();
    const a = await assembly('AgrJoin');
    const m = await signedIn('Newbie');
    await join(m.person.id, a.id);
    const conv = await prisma.conversation.findUnique({ where: { communityId: a.id } });
    await announceJoined(a.id, [m.person.id]);
    expect(await prisma.message.count({ where: { conversationId: conv!.id, kind: 'JOINED' } })).toBe(0);

    await agree(m, a.id);
    expect(await prisma.message.count({ where: { conversationId: conv!.id, kind: 'JOINED', senderPersonId: m.person.id } })).toBe(1);
    const notice = await prisma.privateMessage.findFirst({ where: { senderPersonId: fromId, conversation: { memberPersonId: m.person.id } }, orderBy: { createdAt: 'desc' } });
    expect(notice?.body).toContain(a.name);
    expect(notice?.body).toContain(`/member/chats/group/${a.id}`);
  });

  it('the private message is in French for a French speaker', () => {
    const t = agreedMessage(true, 'Assemblée Un', 'abc');
    expect(t).toContain('Vous faites maintenant partie de Assemblée Un');
    expect(t).toContain('/member/chats/group/abc?lang=fr');
    expect(agreedMessage(false, 'Assembly One', 'abc')).toContain('You are now part of Assembly One');
  });
});

describe('Nobody else is asked', () => {
  it('existing members (account older than the rule), the central admin, leaders and representatives write freely', async () => {
    await startRule(new Date());
    const a = await assembly('AgrFree');
    const old = await signedIn('Old', { createdAt: new Date(Date.now() - 30 * 86400000) });
    const admin = await signedIn('Admin', { admin: true, createdAt: new Date(Date.now() + 1000) });
    const leader = await signedIn('Leader', { leadsId: a.id, createdAt: new Date(Date.now() + 1000) });
    for (const w of [old, admin, leader]) await join(w.person.id, a.id);
    for (const w of [old, admin, leader]) {
      expect(await agreementRequired(w.person.id, a.id)).toBe(false);
      // (The central admin's own profile signs in with an emailed code on a new phone, so only the others post here.)
      if (w !== admin) expect((await say(w, a.id)).status).toBe(201);
    }
    const stillNew = await signedIn('Fresh', { createdAt: new Date(Date.now() + 1000) });
    await join(stillNew.person.id, a.id);
    expect(await agreementRequired(stillNew.person.id, a.id)).toBe(true);
  });

  it('a moved or added existing member is not announced late: the join line still appears for them', async () => {
    await startRule(new Date());
    const a = await assembly('AgrMove');
    const old = await signedIn('Old', { createdAt: new Date(Date.now() - 30 * 86400000) });
    await join(old.person.id, a.id);
    const conv = await prisma.conversation.findUnique({ where: { communityId: a.id } });
    await announceJoined(a.id, [old.person.id]);
    expect(await prisma.message.count({ where: { conversationId: conv!.id, kind: 'JOINED' } })).toBe(1);
  });
});

describe('Welcome checklist facts', () => {
  it('a new member has the assembly to agree in; an existing member is marked as such and has nothing waiting', async () => {
    await startRule();
    const a = await assembly('AgrStatus');
    const fresh = await signedIn('Fresh');
    const old = await signedIn('Old', { createdAt: new Date(Date.now() - 60 * 86400000) });
    await join(fresh.person.id, a.id);
    await join(old.person.id, a.id);
    const f = await fresh.agent.get('/api/member/onboarding');
    expect(f.body).toMatchObject({ existingMember: false, agreementCommunityId: a.id });
    const o = await old.agent.get('/api/member/onboarding');
    expect(o.body).toMatchObject({ existingMember: true, agreementCommunityId: null });
    await agree(fresh, a.id);
    expect((await fresh.agent.get('/api/member/onboarding')).body.agreementCommunityId).toBeNull();
  });
});
