import { describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { appointLeader } from '../lib/cells';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// Making people leaders of the new Headquarters in one step: added to the assembly if needed, appointed, and given the
// Leader account that opens their leadership dashboard.
const app = createApp();
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.158.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
async function adminSession() {
  n += 1;
  const email = `ml-admin-${n}@test.local`;
  const user = await createAdmin(email, 'AdminPass123!');
  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password: 'AdminPass123!' });
  return { agent, csrf, user };
}
async function person(name: string, opts: { account?: boolean } = {}) {
  n += 1;
  const p = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2377800${String(n).padStart(5, '0')}` } });
  if (opts.account !== false) await prisma.memberAccount.create({ data: { personId: p.id, email: `ml${n}@example.com`, passwordHash: await bcrypt.hash('x', 4) } });
  return p;
}
const community = (name: string, kind: 'ASSEMBLY' | 'GROUP' = 'ASSEMBLY', parentId: string | null = null) => prisma.community.create({ data: { name: `${name} ${++n}`, kind, parentId } });
const makeLeaders = (s: Awaited<ReturnType<typeof adminSession>>, body: unknown) => s.agent.post('/api/admin/cells/make-leaders').set('X-CSRF-Token', s.csrf).send(body as object);

describe('Making leaders of an assembly in one step', () => {
  it('adds them to the assembly, appoints them and gives each the Leader account that opens the dashboard', async () => {
    const s = await adminSession();
    const hq = await community('MlHQ');
    const a = await person('Ada Leader');
    const b = await person('Ben Leader');
    const res = await makeLeaders(s, { communityId: hq.id, personIds: [a.id, b.id] });
    expect(res.status).toBe(201);
    expect(res.body.results).toHaveLength(2);
    for (const r of res.body.results) expect(r).toMatchObject({ status: 'APPOINTED', addedToAssembly: true, leaderAccount: 'CREATED' });
    for (const p of [a, b]) {
      expect((await prisma.communityMembership.findUnique({ where: { personId_communityId: { personId: p.id, communityId: hq.id } } }))?.status).toBe('ACTIVE');
      expect(await prisma.roleAssignment.count({ where: { personId: p.id, communityId: hq.id, roleType: 'SCOPED_LEADER', status: 'ACTIVE' } })).toBe(1);
      const user = await prisma.user.findUnique({ where: { personId: p.id } });
      expect(user).toMatchObject({ role: 'LEADER', active: true });
      expect(await prisma.notification.count({ where: { recipientPersonId: p.id, type: 'ROLE_ASSIGNED' } })).toBe(1);
    }
    expect(await prisma.auditLog.findFirst({ where: { action: 'ROLE_ASSIGNMENT_CREATED', metadata: { path: ['via'], equals: 'make-leaders' } } })).toBeTruthy();
  });

  it('is safe to repeat, keeps existing members as they are, and tells you about anyone who has not joined the app', async () => {
    const s = await adminSession();
    const hq = await community('MlHQ2');
    const member = await person('Already Member');
    await prisma.communityMembership.create({ data: { personId: member.id, communityId: hq.id } });
    const noApp = await person('Not On App', { account: false });
    const first = await makeLeaders(s, { communityId: hq.id, personIds: [member.id, noApp.id] });
    const byId = Object.fromEntries(first.body.results.map((r: any) => [r.personId, r]));
    expect(byId[member.id]).toMatchObject({ status: 'APPOINTED', addedToAssembly: false, leaderAccount: 'CREATED' });
    // Appointed, but no dashboard yet: they have not joined the app as a member.
    expect(byId[noApp.id]).toMatchObject({ status: 'APPOINTED', leaderAccount: 'NO_MEMBER_ACCOUNT' });
    expect(await prisma.user.findUnique({ where: { personId: noApp.id } })).toBeNull();

    const again = await makeLeaders(s, { communityId: hq.id, personIds: [member.id] });
    expect(again.body.results[0]).toMatchObject({ status: 'ALREADY_LEADER', addedToAssembly: false, leaderAccount: 'ALREADY' });
    expect(await prisma.roleAssignment.count({ where: { personId: member.id, communityId: hq.id, status: 'ACTIVE' } })).toBe(1);
  });

  it('brings the leaders of the old Leadership Team group to the new Headquarters', async () => {
    const s = await adminSession();
    const hq = await community('MlNewHQ');
    const team = await community('MlLeadershipTeam', 'GROUP', hq.id);
    const l1 = await person('Team Leader One');
    const l2 = await person('Team Leader Two');
    for (const p of [l1, l2]) {
      await prisma.communityMembership.create({ data: { personId: p.id, communityId: team.id } });
      await prisma.roleAssignment.create({ data: { personId: p.id, roleType: 'SCOPED_LEADER', communityId: team.id, assignedByUserId: s.user.id } });
    }
    const list = await s.agent.get(`/api/admin/cells/leaders-of?communityId=${team.id}`);
    expect(list.body.items.map((p: any) => p.id).sort()).toEqual([l1.id, l2.id].sort());
    const res = await makeLeaders(s, { communityId: hq.id, personIds: list.body.items.map((p: any) => p.id) });
    expect(res.body.results.every((r: any) => r.status === 'APPOINTED' && r.addedToAssembly && r.leaderAccount === 'CREATED')).toBe(true);
    // They now lead the Headquarters as well (their group role is untouched).
    expect(await prisma.roleAssignment.count({ where: { communityId: hq.id, personId: { in: [l1.id, l2.id] }, status: 'ACTIVE' } })).toBe(2);
    expect(await prisma.roleAssignment.count({ where: { communityId: team.id, personId: { in: [l1.id, l2.id] }, status: 'ACTIVE' } })).toBe(2);
  });

  it('finds people by name or number, saying who has not joined the app', async () => {
    const s = await adminSession();
    const joined = await person('Findable Joined');
    const notJoined = await person('Findable Absent', { account: false });
    expect((await s.agent.get('/api/admin/cells/people?search=a')).body.items).toEqual([]); // too short
    const res = await s.agent.get('/api/admin/cells/people?search=Findable');
    const byId = Object.fromEntries(res.body.items.map((p: any) => [p.id, p]));
    expect(byId[joined.id].hasMemberAccount).toBe(true);
    expect(byId[notJoined.id].hasMemberAccount).toBe(false);
    const byNumber = await s.agent.get(`/api/admin/cells/people?search=${encodeURIComponent(joined.whatsappNumber!)}`);
    expect(byNumber.body.items.map((p: any) => p.id)).toContain(joined.id);
  });

  it('refuses bad requests and an unknown assembly, and is for the central admin only', async () => {
    const s = await adminSession();
    const p = await person('Whoever');
    expect((await makeLeaders(s, { communityId: '', personIds: [p.id] })).status).toBe(400);
    expect((await makeLeaders(s, { communityId: 'x', personIds: [] })).status).toBe(400);
    expect((await makeLeaders(s, { communityId: 'does-not-exist', personIds: [p.id] })).status).toBe(404);
    const hq = await community('MlHQ3');
    const unknown = await makeLeaders(s, { communityId: hq.id, personIds: ['nobody'] });
    expect(unknown.body.results[0]).toMatchObject({ status: 'NOT_FOUND' });
    const anon = agentWithIp();
    expect((await anon.get('/api/admin/cells/people?search=abc')).status).toBe(401);
    expect((await anon.get('/api/member/central-cells/people?search=abc')).status).toBe(401);
  });

  it('the "Ready to lead" appointment now also gives the Leader account, so the dashboard follows them', async () => {
    const s = await adminSession();
    const hq = await community('MlHQ4');
    const p = await person('Graduate');
    const result = await appointLeader(p.id, hq.id, { id: s.user.id, email: s.user.email });
    expect(result).toMatchObject({ ok: true, leaderAccount: 'CREATED' });
    expect(await prisma.user.findUnique({ where: { personId: p.id } })).toMatchObject({ role: 'LEADER' });
  });
});
