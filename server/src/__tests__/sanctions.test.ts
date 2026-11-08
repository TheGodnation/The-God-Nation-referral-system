import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { sweepEndedMutes } from '../lib/sanctions';
import { bootstrap } from './testUtils';

// Mutes (3/7/15/30 days), lifting rules, requests for excuse and removal requests.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.152.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}

type Who = Awaited<ReturnType<typeof signedIn>>;

async function signedIn(name: string, kind: 'member' | 'admin' | 'leader' = 'member', leadsId?: string) {
  n += 1;
  const email = `sanc${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2376800${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  let user: { id: string } | null = null;
  if (kind === 'admin') user = await prisma.user.create({ data: { name: 'Central Admin', email: `sanc-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
  if (kind === 'leader' && leadsId) {
    const any = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
    const assigner = any ?? (await prisma.user.create({ data: { name: 'Assigner', email: `sanc-as-${n}@test.local`, passwordHash: 'x', role: 'ADMIN' } }));
    await prisma.roleAssignment.create({ data: { personId: person.id, roleType: 'SCOPED_LEADER', communityId: leadsId, assignedByUserId: assigner.id } });
  }
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  const res = await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  if (res.body.codeRequired) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  }
  return { person, user, agent, csrf };
}

async function assembly(name: string) {
  const c = await prisma.community.create({ data: { name: `${name} ${++n}` } });
  await prisma.conversation.create({ data: { communityId: c.id } });
  return c;
}
const join = (personId: string, communityId: string) => prisma.communityMembership.create({ data: { personId, communityId } });
const post = (w: Who, path: string, body: unknown) => w.agent.post(path).set('X-CSRF-Token', w.csrf).send(body as object);
const mute = (w: Who, communityId: string, personId: string, over: Record<string, unknown> = {}) =>
  post(w, '/api/member/sanctions/mute', { communityId, personId, days: 7, reason: 'Posting unrelated links', ...over });
const say = (w: Who, communityId: string, body = 'Hello') => post(w, `/api/communities/${communityId}/conversation/messages`, { body });

afterEach(() => vi.restoreAllMocks());

// A fixture most tests share: an assembly with a leader, two members and a central admin.
async function world() {
  const a = await assembly('SancAssembly');
  const other = await assembly('SancOther');
  const leader = await signedIn('Leader', 'leader', a.id);
  const member = await signedIn('Member');
  const second = await signedIn('Second');
  const admin = await signedIn('Admin', 'admin');
  await join(leader.person.id, a.id);
  await join(member.person.id, a.id);
  await join(second.person.id, a.id);
  return { a, other, leader, member, second, admin };
}

describe('Muting', () => {
  it('a leader mutes a member: they can read but not write, with the reason and end shown, and are told', async () => {
    const { a, leader, member } = await world();
    expect((await say(member, a.id, 'before')).status).toBe(201);
    const res = await mute(leader, a.id, member.person.id, { days: 15 });
    expect(res.status).toBe(201);

    const blocked = await say(member, a.id, 'after');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MUTED');
    expect(blocked.body.mute.reason).toBe('Posting unrelated links');

    const read = await member.agent.get(`/api/communities/${a.id}/conversation/messages`);
    expect(read.status).toBe(200);
    expect(read.body.canPost).toBe(false);
    expect(read.body.mute).toMatchObject({ reason: 'Posting unrelated links', excuseSent: false });
    const days = (new Date(read.body.mute.endsAt).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(14.9);
    expect(days).toBeLessThan(15.1);

    expect(await prisma.notification.count({ where: { recipientPersonId: member.person.id, type: 'SANCTION_PLACED' } })).toBe(1);
    expect(await prisma.auditLog.findFirst({ where: { action: 'MEMBER_MUTED', targetId: res.body.id } })).toBeTruthy();
    // Only in that assembly — and others still write normally.
    expect((await say(await signedIn('Bystander'), a.id)).status).toBe(403); // not a member at all
  });

  it('only offers 3, 7, 15 or 30 days and always needs a reason', async () => {
    const { a, leader, member } = await world();
    expect((await mute(leader, a.id, member.person.id, { days: 5 })).status).toBe(400);
    expect((await mute(leader, a.id, member.person.id, { days: 1 })).status).toBe(400);
    expect((await mute(leader, a.id, member.person.id, { reason: '  ' })).status).toBe(400);
    for (const days of [3, 30]) {
      const m = await signedIn('Day');
      await join(m.person.id, a.id);
      expect((await mute(leader, a.id, m.person.id, { days })).status).toBe(201);
    }
  });

  it('keeps leaders to their own assembly, and away from leaders, the central admin and themselves', async () => {
    const { a, other, leader, member, admin } = await world();
    const foreign = await signedIn('Foreign');
    await join(foreign.person.id, other.id);
    expect((await mute(leader, other.id, foreign.person.id)).status).toBe(403);
    const peer = await signedIn('PeerLeader', 'leader', a.id);
    await join(peer.person.id, a.id);
    expect((await mute(leader, a.id, peer.person.id)).status).toBe(403);
    await join(admin.person.id, a.id);
    expect((await mute(leader, a.id, admin.person.id)).status).toBe(403);
    expect((await mute(admin, a.id, admin.person.id)).status).toBe(400);
    expect((await mute(leader, a.id, leader.person.id)).status).toBe(400);
    // A plain member has no authority at all.
    expect((await mute(member, a.id, leader.person.id)).status).toBe(403);
    // The central admin can mute anyone, even a leader, in any assembly.
    expect((await mute(admin, a.id, peer.person.id)).status).toBe(201);
  });

  it('refuses a second mute while one is running, and a person who is not in the assembly', async () => {
    const { a, leader, member } = await world();
    expect((await mute(leader, a.id, member.person.id)).status).toBe(201);
    expect((await mute(leader, a.id, member.person.id)).status).toBe(409);
    const outsider = await signedIn('Outsider');
    expect((await mute(leader, a.id, outsider.person.id)).status).toBe(404);
  });

  it('ends by itself, writing works again, and the person is told once', async () => {
    const { a, leader, member } = await world();
    const res = await mute(leader, a.id, member.person.id);
    await prisma.memberSanction.update({ where: { id: res.body.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    expect((await say(member, a.id, 'back')).status).toBe(201);
    await sweepEndedMutes();
    await sweepEndedMutes();
    expect(await prisma.notification.count({ where: { recipientPersonId: member.person.id, type: 'SANCTION_ENDED' } })).toBe(1);
  });
});

describe('Lifting', () => {
  it('a leader lifts their own mute; the person writes again and is told', async () => {
    const { a, leader, member } = await world();
    const res = await mute(leader, a.id, member.person.id);
    expect((await post(leader, `/api/member/sanctions/${res.body.id}/lift`, {})).status).toBe(200);
    expect((await say(member, a.id)).status).toBe(201);
    expect(await prisma.notification.count({ where: { recipientPersonId: member.person.id, type: 'SANCTION_LIFTED' } })).toBe(1);
  });

  it('a leader can never lift a mute the central admin placed, but the central admin can lift a leader’s', async () => {
    const { a, leader, member, second, admin } = await world();
    const byAdmin = await mute(admin, a.id, member.person.id);
    const denied = await post(leader, `/api/member/sanctions/${byAdmin.body.id}/lift`, {});
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('ADMIN_ONLY');
    expect((await say(member, a.id)).status).toBe(403);

    const byLeader = await mute(leader, a.id, second.person.id);
    expect((await post(admin, `/api/member/sanctions/${byLeader.body.id}/lift`, {})).status).toBe(200);
    expect((await post(admin, `/api/member/sanctions/${byAdmin.body.id}/lift`, {})).status).toBe(200);
    expect((await say(member, a.id)).status).toBe(201);
  });

  it('someone with no authority there cannot lift', async () => {
    const { a, leader, member, second } = await world();
    const res = await mute(leader, a.id, member.person.id);
    const otherLeader = await signedIn('OtherLeader', 'leader', (await assembly('SancElsewhere')).id);
    expect((await post(otherLeader, `/api/member/sanctions/${res.body.id}/lift`, {})).status).toBe(403);
    expect((await post(second, `/api/member/sanctions/${res.body.id}/lift`, {})).status).toBe(403);
  });
});

describe('Asking for excuse', () => {
  it('the muted person can ask once; the one who muted them is told; others cannot use it', async () => {
    const { a, leader, member, second } = await world();
    const res = await mute(leader, a.id, member.person.id);
    expect((await post(second, `/api/member/sanctions/${res.body.id}/excuse`, { message: 'Sorry, I was not me' })).status).toBe(404);
    expect((await post(member, `/api/member/sanctions/${res.body.id}/excuse`, { message: '' })).status).toBe(400);
    expect((await post(member, `/api/member/sanctions/${res.body.id}/excuse`, { message: 'I am sorry, I will not do it again.' })).status).toBe(200);
    expect((await post(member, `/api/member/sanctions/${res.body.id}/excuse`, { message: 'Please again' })).status).toBe(409);
    expect(await prisma.notification.count({ where: { recipientPersonId: leader.person.id, type: 'EXCUSE_REQUESTED' } })).toBe(1);
    const mine = await member.agent.get('/api/member/sanctions/mine');
    expect(mine.body.items[0]).toMatchObject({ reason: 'Posting unrelated links', excuseSent: true });
    const seen = await leader.agent.get('/api/member/sanctions/overview');
    expect(seen.body.sanctions[0].excuseMessage).toBe('I am sorry, I will not do it again.');
  });
});

describe('Removal', () => {
  it('a leader can only send a request; only the central admin decides; approving removes the person', async () => {
    const { a, leader, member, admin } = await world();
    expect((await post(leader, '/api/member/sanctions/remove', { communityId: a.id, personId: member.person.id })).status).toBe(403);
    expect((await post(leader, '/api/member/sanctions/removal-requests', { communityId: a.id, personId: member.person.id, reason: '' })).status).toBe(400);
    const mutedFirst = await mute(leader, a.id, member.person.id);
    const req = await post(leader, '/api/member/sanctions/removal-requests', { communityId: a.id, personId: member.person.id, reason: 'Keeps insulting others' });
    expect(req.status).toBe(201);
    expect((await post(leader, '/api/member/sanctions/removal-requests', { communityId: a.id, personId: member.person.id, reason: 'Again' })).status).toBe(409);
    expect(await prisma.notification.count({ where: { recipientPersonId: admin.person.id, type: 'REMOVAL_REQUESTED' } })).toBe(1);

    // A leader cannot decide.
    expect((await post(leader, `/api/member/sanctions/removal-requests/${req.body.id}/decide`, { approve: true })).status).toBe(403);
    expect((await prisma.communityMembership.findFirst({ where: { personId: member.person.id, communityId: a.id } }))?.status).toBe('ACTIVE');

    const seenByAdmin = await admin.agent.get('/api/member/sanctions/overview');
    expect(seenByAdmin.body.removalRequests[0]).toMatchObject({ status: 'PENDING', reason: 'Keeps insulting others' });
    const decided = await post(admin, `/api/member/sanctions/removal-requests/${req.body.id}/decide`, { approve: true, note: 'Agreed' });
    expect(decided.status).toBe(200);
    expect((await prisma.communityMembership.findFirst({ where: { personId: member.person.id, communityId: a.id } }))?.status).toBe('INACTIVE');
    expect((await prisma.memberSanction.findUnique({ where: { id: mutedFirst.body.id } }))?.liftedAt).toBeTruthy();
    expect(await prisma.notification.count({ where: { recipientPersonId: member.person.id, type: 'REMOVED_FROM_ASSEMBLY' } })).toBe(1);
    expect(await prisma.notification.count({ where: { recipientPersonId: leader.person.id, type: 'REMOVAL_DECIDED' } })).toBe(1);
    expect((await post(admin, `/api/member/sanctions/removal-requests/${req.body.id}/decide`, { approve: false })).status).toBe(409);
  });

  it('declining keeps the person; the central admin can also remove directly', async () => {
    const { a, leader, member, second, admin } = await world();
    const req = await post(leader, '/api/member/sanctions/removal-requests', { communityId: a.id, personId: member.person.id, reason: 'Concern' });
    expect((await post(admin, `/api/member/sanctions/removal-requests/${req.body.id}/decide`, { approve: false, note: 'Not enough' })).status).toBe(200);
    expect((await prisma.communityMembership.findFirst({ where: { personId: member.person.id, communityId: a.id } }))?.status).toBe('ACTIVE');
    expect((await prisma.removalRequest.findUnique({ where: { id: req.body.id } }))?.decisionNote).toBe('Not enough');
    expect((await post(admin, '/api/member/sanctions/remove', { communityId: a.id, personId: second.person.id })).status).toBe(200);
    expect((await prisma.communityMembership.findFirst({ where: { personId: second.person.id, communityId: a.id } }))?.status).toBe('INACTIVE');
  });
});

describe('What each person sees', () => {
  it('a leader sees only their assembly; the central admin sees everything; leaders can lift flags reflect the rule', async () => {
    const { a, other, leader, member, admin } = await world();
    const foreign = await signedIn('Foreign');
    await join(foreign.person.id, other.id);
    await mute(leader, a.id, member.person.id);
    await mute(admin, other.id, foreign.person.id);

    const mine = await leader.agent.get('/api/member/sanctions/overview');
    expect(mine.body.isCentralAdmin).toBe(false);
    expect(mine.body.durations).toEqual([3, 7, 15, 30]);
    expect(mine.body.sanctions.map((s: any) => s.personId)).toEqual([member.person.id]);
    expect(mine.body.sanctions[0].canLift).toBe(true);

    const all = await admin.agent.get('/api/member/sanctions/overview');
    expect(all.body.isCentralAdmin).toBe(true);
    expect(all.body.sanctions.map((s: any) => s.personId).sort()).toEqual([member.person.id, foreign.person.id].sort());

    const led = await leader.agent.get('/api/member/sanctions/assemblies');
    expect(led.body.items.map((c: any) => c.id)).toEqual([a.id]);
    const people = await leader.agent.get(`/api/member/sanctions/members?communityId=${a.id}`);
    expect(people.body.items.map((p: any) => p.id)).toContain(member.person.id);
    expect((await leader.agent.get(`/api/member/sanctions/members?communityId=${other.id}`)).status).toBe(403);
  });

  it('is closed to signed-out visitors', async () => {
    const anon = agentWithIp();
    expect((await anon.get('/api/member/sanctions/overview')).status).toBe(401);
    expect((await anon.get('/api/admin/sanctions/overview')).status).toBe(401);
  });
});
