import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';

// A representative gives the people nobody follows yet to the leaders of an assembly of THEIR generation.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.156.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
type Who = Awaited<ReturnType<typeof signedIn>>;
async function signedIn(name: string, admin = false) {
  n += 1;
  const email = `rc${n}@example.com`;
  const person = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2377400${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (admin) await prisma.user.create({ data: { name: 'Central Admin', email: `rc-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
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
const community = (name: string, parentId?: string) => prisma.community.create({ data: { name: `${name} ${++n}`, parentId: parentId ?? null } });
const assigner = async () => (await prisma.user.findFirst({ where: { role: 'ADMIN' } })) ?? (await prisma.user.create({ data: { name: 'A', email: `rc-a-${++n}@test.local`, passwordHash: 'x', role: 'ADMIN' } }));
const lead = async (personId: string, communityId: string) => prisma.roleAssignment.create({ data: { personId, roleType: 'SCOPED_LEADER', communityId, assignedByUserId: (await assigner()).id } });
const join = (personId: string, communityId: string) => prisma.communityMembership.create({ data: { personId, communityId } });

afterEach(() => vi.restoreAllMocks());

// HQ -> A (gen 1, the representative's), A's sibling C (gen 1), A's child B (gen 2).
async function world() {
  const hq = await community('RcHQ');
  const A = await community('RcA', hq.id);
  const C = await community('RcC', hq.id);
  const B = await community('RcB', A.id);
  await prisma.settings.upsert({ where: { id: 'singleton' }, update: { headquartersCommunityId: hq.id }, create: { id: 'singleton', headquartersCommunityId: hq.id } as any });
  const admin = await signedIn('Admin', true);
  const rep = await signedIn('Rep');
  await lead(rep.person.id, A.id);
  await join(rep.person.id, A.id);
  expect((await post(admin, '/api/member/central-representatives/appoint', { personId: rep.person.id, generation: 1 })).status).toBe(201);
  const leaderC = await signedIn('LeaderC');
  const leaderB = await signedIn('LeaderB');
  await lead(leaderC.person.id, C.id);
  await join(leaderC.person.id, C.id);
  await lead(leaderB.person.id, B.id);
  await join(leaderB.person.id, B.id);
  const inC: Who[] = [];
  for (const name of ['P1', 'P2', 'P3', 'P4']) {
    const p = await signedIn(name);
    await join(p.person.id, C.id);
    inC.push(p);
  }
  const inB = await signedIn('InB');
  await join(inB.person.id, B.id);
  return { A, B, C, admin, rep, leaderC, leaderB, inC, inB };
}
const R = '/api/member/rep-cells';

describe('A representative assigns people in their generation', () => {
  it('sees only the assemblies of their generation, with who is unassigned', async () => {
    const { A, B, C, rep } = await world();
    const res = await rep.agent.get(`${R}/overview`);
    expect(res.status).toBe(200);
    expect(res.body.generation).toBe(1);
    const ids = res.body.items.map((r: any) => r.id);
    expect(ids).toContain(A.id);
    expect(ids).toContain(C.id);
    expect(ids).not.toContain(B.id);
    expect(res.body.items.find((r: any) => r.id === C.id).unassigned).toBeGreaterThanOrEqual(4);
  });

  it('previews, then shares the unassigned people among the leaders, with a record', async () => {
    const { C, rep, leaderC, inC } = await world();
    const leaders = await rep.agent.get(`${R}/leaders?communityId=${C.id}`);
    expect(leaders.body.items.map((l: any) => l.personId)).toContain(leaderC.person.id);

    const preview = await post(rep, `${R}/share`, { communityId: C.id, leaderPersonIds: [leaderC.person.id], perLeader: 2, dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ dryRun: true, assigned: 2 });
    expect(await prisma.followUpAssignment.count({ where: { followerId: leaderC.person.id } })).toBe(0);

    const done = await post(rep, `${R}/share`, { communityId: C.id, leaderPersonIds: [leaderC.person.id], perLeader: 2 });
    expect(done.body).toMatchObject({ dryRun: false, assigned: 2 });
    const mine = await prisma.followUpAssignment.findMany({ where: { followerId: leaderC.person.id, status: 'ACTIVE' } });
    expect(mine).toHaveLength(2);
    expect(inC.map((p) => p.person.id)).toEqual(expect.arrayContaining(mine.map((m) => m.followedPersonId)));
    const audit = await prisma.auditLog.findFirst({ where: { action: 'FOLLOW_UP_BULK_DISTRIBUTED', targetId: C.id }, orderBy: { createdAt: 'desc' } });
    expect(audit?.metadata).toMatchObject({ via: 'representative', generation: 1, totalAssigned: 2 });
  });

  it('refuses an assembly of another generation, and anyone who is not a representative', async () => {
    const { B, C, rep, leaderC, inC, admin } = await world();
    expect((await rep.agent.get(`${R}/leaders?communityId=${B.id}`)).status).toBe(403);
    const refused = await post(rep, `${R}/share`, { communityId: B.id, dryRun: false });
    expect(refused.status).toBe(403);
    expect(await prisma.followUpAssignment.count({ where: { contextId: B.id } })).toBe(0);
    // Not a representative: a leader, an ordinary member, even the central admin's profile (they have their own tool).
    for (const who of [leaderC, inC[0], admin]) {
      expect((await who.agent.get(`${R}/overview`)).status).toBe(403);
      expect((await post(who, `${R}/share`, { communityId: C.id, dryRun: true })).status).toBe(403);
    }
    const anon = agentWithIp();
    expect((await anon.get(`${R}/overview`)).status).toBe(401);
  });

  it('stops working once they are no longer the representative', async () => {
    const { admin, rep, C } = await world();
    const overview = await admin.agent.get('/api/member/central-representatives/overview');
    const repId = overview.body.generations.find((g: any) => g.representative?.personId === rep.person.id).representative.id;
    expect((await post(admin, `/api/member/central-representatives/${repId}/remove`, {})).status).toBe(200);
    expect((await rep.agent.get(`${R}/overview`)).status).toBe(403);
    expect((await post(rep, `${R}/share`, { communityId: C.id, dryRun: true })).status).toBe(403);
  });
});
