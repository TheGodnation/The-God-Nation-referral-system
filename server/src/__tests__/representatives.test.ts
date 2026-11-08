import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { getEligibleLeadershipCollaborationGenerations, roomSenderBadges } from '../lib/leadershipCollaboration';
import { bootstrap } from './testUtils';

// One representative per generation, chosen by the central admin from the leaders; their powers stop at their generation.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.153.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}

type Who = Awaited<ReturnType<typeof signedIn>>;

async function signedIn(name: string, kind: 'member' | 'admin' = 'member') {
  n += 1;
  const email = `rep${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2376900${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (kind === 'admin') await prisma.user.create({ data: { name: 'Central Admin', email: `rep-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
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
  return { person, agent, csrf };
}

const post = (w: Who, path: string, body: unknown) => w.agent.post(path).set('X-CSRF-Token', w.csrf).send(body as object);
const community = async (name: string, parentId?: string) => {
  const c = await prisma.community.create({ data: { name: `${name} ${++n}`, parentId: parentId ?? null } });
  await prisma.conversation.create({ data: { communityId: c.id } });
  return c;
};
const lead = async (personId: string, communityId: string) => {
  const any = (await prisma.user.findFirst({ where: { role: 'ADMIN' } })) ?? (await prisma.user.create({ data: { name: 'A', email: `rep-a-${++n}@test.local`, passwordHash: 'x', role: 'ADMIN' } }));
  await prisma.roleAssignment.create({ data: { personId, roleType: 'SCOPED_LEADER', communityId, assignedByUserId: any.id } });
};
const join = (personId: string, communityId: string) => prisma.communityMembership.create({ data: { personId, communityId } });

afterEach(() => vi.restoreAllMocks());

// HQ -> A (gen 1), C (gen 1); A -> B (gen 2). Leaders: a1 leads A, a2 leads C, b1 leads B. Admin signed in.
async function world() {
  const hq = await community('RepHQ');
  const A = await community('RepA', hq.id);
  const C = await community('RepC', hq.id);
  const B = await community('RepB', A.id);
  await prisma.settings.upsert({ where: { id: 'singleton' }, update: { headquartersCommunityId: hq.id }, create: { id: 'singleton', headquartersCommunityId: hq.id } as any });
  const admin = await signedIn('Admin', 'admin');
  const a1 = await signedIn('LeaderA');
  const a2 = await signedIn('LeaderC');
  const b1 = await signedIn('LeaderB');
  await lead(a1.person.id, A.id);
  await lead(a2.person.id, C.id);
  await lead(b1.person.id, B.id);
  const plain = await signedIn('Plain');
  return { hq, A, B, C, admin, a1, a2, b1, plain };
}
const R = '/api/member/central-representatives';

describe('Appointing representatives', () => {
  it('only the central admin appoints or ends; a representative must be a leader; one per generation', async () => {
    const { A, admin, a1, a2, b1, plain } = await world();
    expect((await post(a1, `${R}/appoint`, { personId: a2.person.id, generation: 1 })).status).toBe(403);
    expect((await post(admin, `${R}/appoint`, { personId: plain.person.id, generation: 1 })).status).toBe(400);
    expect((await post(admin, `${R}/appoint`, { personId: a1.person.id, generation: 9 })).status).toBe(400);
    expect((await post(admin, `${R}/appoint`, { personId: a1.person.id, generation: 0 })).status).toBe(400);

    const ok = await post(admin, `${R}/appoint`, { personId: a1.person.id, generation: 1 });
    expect(ok.status).toBe(201);
    expect(await prisma.notification.count({ where: { recipientPersonId: a1.person.id, type: 'REPRESENTATIVE_APPOINTED' } })).toBe(1);
    expect(await prisma.auditLog.findFirst({ where: { action: 'REPRESENTATIVE_APPOINTED', targetId: ok.body.id } })).toBeTruthy();
    // The generation is taken; the leader cannot take a second one.
    expect((await post(admin, `${R}/appoint`, { personId: a2.person.id, generation: 1 })).status).toBe(409);
    expect((await post(admin, `${R}/appoint`, { personId: a1.person.id, generation: 2 })).status).toBe(409);

    const overview = await admin.agent.get(`${R}/overview`);
    expect(overview.body.generations.map((g: any) => g.generation)).toEqual([1, 2]);
    expect(overview.body.generations[0].representative).toMatchObject({ name: expect.stringContaining('LeaderA') });
    expect(overview.body.generations[1].representative).toBeNull();

    const eligible = await admin.agent.get(`${R}/leaders?search=Leader`);
    const names = eligible.body.items.map((l: any) => l.id);
    expect(names).not.toContain(a1.person.id);
    expect(names).toContain(a2.person.id);

    expect((await a1.agent.get('/api/member/representative/me')).body.generation).toBe(1);
    // A representative cannot end their own (or anyone's) role.
    expect((await post(a1, `${R}/${ok.body.id}/remove`, {})).status).toBe(403);
    expect((await post(admin, `${R}/${ok.body.id}/remove`, {})).status).toBe(200);
    expect((await a1.agent.get('/api/member/representative/me')).body.generation).toBeNull();
    expect(await prisma.notification.count({ where: { recipientPersonId: a1.person.id, type: 'REPRESENTATIVE_ENDED' } })).toBe(1);
    expect((await post(admin, `${R}/${ok.body.id}/remove`, {})).status).toBe(404);
    expect((await post(admin, `${R}/appoint`, { personId: a2.person.id, generation: 1 })).status).toBe(201);
    void A; void b1;
  });
});

describe('What a representative can do', () => {
  async function withRep() {
    const w = await world();
    const rep = await post(w.admin, `${R}/appoint`, { personId: w.a1.person.id, generation: 1 });
    expect(rep.status).toBe(201);
    return w;
  }
  const mute = (who: Who, communityId: string, personId: string) => post(who, '/api/member/sanctions/mute', { communityId, personId, days: 7, reason: 'Posting unrelated links' });

  it('mutes in every assembly of their generation, not another; cannot lift the central admin’s mutes or remove directly', async () => {
    const { A, B, C, admin, a1 } = await withRep();
    const inC = await signedIn('InC');
    const inB = await signedIn('InB');
    await join(inC.person.id, C.id);
    await join(inB.person.id, B.id);

    // C is in the representative's generation (they do not lead it).
    const assemblies = await a1.agent.get('/api/member/sanctions/assemblies');
    expect(assemblies.body.items.map((c: any) => c.id).sort()).toEqual([A.id, C.id].sort());
    const res = await mute(a1, C.id, inC.person.id);
    expect(res.status).toBe(201);
    expect((await prisma.memberSanction.findUnique({ where: { id: res.body.id } }))?.createdByRole).toBe('REPRESENTATIVE');
    // B is generation 2 — outside their generation.
    expect((await mute(a1, B.id, inB.person.id)).status).toBe(403);

    // They cannot lift what the central admin placed, but can lift their own.
    const inC2 = await signedIn('InC2');
    await join(inC2.person.id, C.id);
    const byAdmin = await mute(admin, C.id, inC2.person.id);
    expect((await post(a1, `/api/member/sanctions/${byAdmin.body.id}/lift`, {})).status).toBe(403);
    expect((await post(a1, `/api/member/sanctions/${res.body.id}/lift`, {})).status).toBe(200);

    // Removal: request only.
    expect((await post(a1, '/api/member/sanctions/remove', { communityId: C.id, personId: inC.person.id })).status).toBe(403);
    expect((await post(a1, '/api/member/sanctions/removal-requests', { communityId: C.id, personId: inC.person.id, reason: 'Keeps insulting' })).status).toBe(201);
    const seen = await a1.agent.get('/api/member/sanctions/overview');
    expect(seen.body.sanctions.every((s: any) => s.communityId === C.id || s.communityId === A.id)).toBe(true);
  });

  it('posts instructions only to the leaders of their own generation and follows only their own', async () => {
    const { admin, a1, a2, b1, plain } = await withRep();
    const send = (who: Who, body: Record<string, unknown>) => post(who, '/api/member/rep-instructions', { title: 'Visit new people', body: 'Please visit them this week.', repliesVisible: false, ...body });

    expect((await send(plain, { audience: 'GENERATIONS', generations: [1] })).status).toBe(403);
    expect((await send(a1, { audience: 'ALL_LEADERS' })).status).toBe(403);
    expect((await send(a1, { audience: 'GENERATIONS', generations: [2] })).status).toBe(403);
    expect((await send(a1, { audience: 'GENERATIONS', generations: [1, 2] })).status).toBe(403);
    expect((await send(a1, { audience: 'PICKED', personIds: [b1.person.id] })).status).toBe(403);

    const leaders = await a1.agent.get('/api/member/rep-instructions/leaders');
    expect(leaders.body.generations).toEqual([1]);
    expect(leaders.body.leaders.map((l: any) => l.personId).sort()).toEqual([a1.person.id, a2.person.id].sort());

    const ok = await send(a1, { audience: 'GENERATIONS', generations: [1] });
    expect(ok.status).toBe(201);
    expect(ok.body.recipients).toBe(2);
    expect(await prisma.notification.count({ where: { type: 'INSTRUCTION_RECEIVED', targetId: ok.body.id, recipientPersonId: b1.person.id } })).toBe(0);
    expect(await prisma.notification.count({ where: { type: 'INSTRUCTION_RECEIVED', targetId: ok.body.id, recipientPersonId: a2.person.id } })).toBe(1);
    const picked = await send(a1, { audience: 'PICKED', personIds: [a2.person.id] });
    expect(picked.status).toBe(201);
    expect(picked.body.recipients).toBe(1);

    // The leader sees who it came from; the representative follows who is done and can remind.
    const theirs = await a2.agent.get('/api/member/instructions');
    expect(theirs.body.items.find((i: any) => i.id === ok.body.id).sender).toBe('REPRESENTATIVE');
    const mine = await a1.agent.get('/api/member/rep-instructions');
    expect(mine.body.items.map((i: any) => i.id).sort()).toEqual([ok.body.id, picked.body.id].sort());
    expect((await a1.agent.get(`/api/member/rep-instructions/${ok.body.id}`)).status).toBe(200);
    expect((await post(a1, `/api/member/rep-instructions/${ok.body.id}/remind`, {})).status).toBe(200);

    // The central admin's own instruction is invisible to the representative, and the central admin sees both.
    const adminOwn = await post(admin, '/api/member/central-instructions', { title: 'From the top', body: 'Hello leaders', audience: 'ALL_LEADERS', generations: [], personIds: [], repliesVisible: false });
    expect(adminOwn.status).toBe(201);
    expect((await a1.agent.get(`/api/member/rep-instructions/${adminOwn.body.id}`)).status).toBe(404);
    expect((await post(a1, `/api/member/rep-instructions/${adminOwn.body.id}/remind`, {})).status).toBe(404);
    const all = await admin.agent.get('/api/member/central-instructions');
    expect(all.body.items.map((i: any) => i.id)).toEqual(expect.arrayContaining([ok.body.id, picked.body.id, adminOwn.body.id]));
    expect((await a2.agent.get('/api/member/instructions')).body.items.find((i: any) => i.id === adminOwn.body.id).sender).toBe('NATIONAL_COORDINATOR');
  });

  it('is in the leaders’ room of the generation they represent, labelled', async () => {
    const { a1, a2, admin } = await withRep();
    // a1 leads only A (generation 1) but also represents generation 1; a2 leads only C.
    expect(await getEligibleLeadershipCollaborationGenerations(a1.person.id)).toContain(1);
    const badges = await roomSenderBadges([a1.person.id, a2.person.id, admin.person.id]);
    expect(badges.get(a1.person.id)).toBe('REPRESENTATIVE');
    expect(badges.get(a2.person.id)).toBeUndefined();
    expect(badges.get(admin.person.id)).toBe('NATIONAL_COORDINATOR');
  });
});

describe('Closed to others', () => {
  it('needs a signed-in member for the representative screens', async () => {
    const anon = agentWithIp();
    expect((await anon.get('/api/member/representative/me')).status).toBe(401);
    expect((await anon.get('/api/admin/representatives/overview')).status).toBe(401);
    expect((await anon.get('/api/member/rep-instructions')).status).toBe(401);
  });
});
