import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// The National Coordinator's instructions to leaders: to everyone, to chosen generations, or to hand-picked leaders;
// each leader marks Seen and Done; the central admin follows up and reminds; only the recipients see it.
const app = createApp();

let ip = 0;
function agentWithUniqueIp() {
  ip += 1;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', `10.156.0.${ip}`);
  return wrapped;
}
let n = 0;
async function member(name: string) {
  n += 1;
  const email = `instr${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: `+2376651${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.memberAccount.create({ data: { personId: person.id, email } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf, person };
}

async function world() {
  const admin = await createAdmin(`instr-admin${++n}@test.local`, 'AdminPass123!');
  const hq = await prisma.community.create({ data: { name: 'Headquarters' } });
  await prisma.settings.upsert({ where: { id: 'singleton' }, update: { headquartersCommunityId: hq.id }, create: { id: 'singleton', headquartersCommunityId: hq.id } });
  const a = await prisma.community.create({ data: { name: 'Assembly A', parentId: hq.id } });
  const b = await prisma.community.create({ data: { name: 'Assembly B', parentId: a.id } });
  const lead = async (name: string, communities: string[]) => {
    const m = await member(name);
    for (const communityId of communities) {
      await prisma.roleAssignment.create({ data: { personId: m.person.id, roleType: 'SCOPED_LEADER', communityId, assignedByUserId: admin.id } });
    }
    return m;
  };
  const l1 = await lead('Leader HQ', [hq.id]);
  const l2 = await lead('Leader A', [a.id]);
  const l3 = await lead('Leader B', [b.id]);
  const l4 = await lead('Leader AB', [a.id, b.id]);
  const plain = await member('Plain Member');
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: admin.email, password: 'AdminPass123!' });
  return { admin, l1, l2, l3, l4, plain, central: { agent, csrf } };
}

const send = (w: Awaited<ReturnType<typeof world>>, body: Record<string, unknown>) =>
  w.central.agent.post('/api/admin/instructions').set('X-CSRF-Token', w.central.csrf).send({ title: 'Report your people', body: 'Please contact every person assigned to you this week.', ...body });

describe('who an instruction goes to', () => {
  it('lists the leaders with their generations, and sends to every leader', async () => {
    const w = await world();
    const list = (await w.central.agent.get('/api/admin/instructions/leaders')).body;
    expect(list.generations).toEqual([0, 1, 2]);
    expect(list.leaders.find((l: any) => l.name === 'Leader AB').generations).toEqual([1, 2]);

    const res = await send(w, { audience: 'ALL_LEADERS' });
    expect(res.status).toBe(201);
    expect(res.body.recipients).toBe(4);
    for (const l of [w.l1, w.l2, w.l3, w.l4]) {
      const mine = (await l.agent.get('/api/member/instructions')).body.items;
      expect(mine).toHaveLength(1);
      expect(mine[0]).toMatchObject({ title: 'Report your people', status: 'WAITING' });
    }
    expect((await w.plain.agent.get('/api/member/instructions')).body.items).toEqual([]);
    // Each leader is told.
    expect(await prisma.notification.count({ where: { type: 'INSTRUCTION_RECEIVED', targetId: res.body.id } })).toBe(4);
  });

  it('sends to chosen generations only', async () => {
    const w = await world();
    const res = await send(w, { audience: 'GENERATIONS', generations: [1] });
    expect(res.body.recipients).toBe(2); // Leader A and Leader AB (who also leads in generation 2)
    expect((await w.l1.agent.get('/api/member/instructions')).body.items).toHaveLength(0);
    expect((await w.l3.agent.get('/api/member/instructions')).body.items).toHaveLength(0);
    expect((await w.l2.agent.get('/api/member/instructions')).body.items).toHaveLength(1);
    expect((await w.l4.agent.get('/api/member/instructions')).body.items).toHaveLength(1);
  });

  it('sends to hand-picked leaders only, and never to someone who is not a leader', async () => {
    const w = await world();
    const res = await send(w, { audience: 'PICKED', personIds: [w.l3.person.id, w.plain.person.id] });
    expect(res.body.recipients).toBe(1);
    expect((await w.l3.agent.get('/api/member/instructions')).body.items).toHaveLength(1);
    expect((await w.plain.agent.get('/api/member/instructions')).body.items).toHaveLength(0);
    expect((await send(w, { audience: 'PICKED', personIds: [w.plain.person.id] })).status).toBe(400);
    expect((await send(w, { audience: 'PICKED', personIds: [] })).status).toBe(400);
    expect((await send(w, { audience: 'GENERATIONS', generations: [] })).status).toBe(400);
    expect((await send(w, { audience: 'GENERATIONS', generations: [9] })).status).toBe(400);
  });
});

describe('following up', () => {
  it('shows who has seen it, who is done and who is late, and reminds only those not done, once in 12 hours', async () => {
    const w = await world();
    const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const res = await send(w, { audience: 'ALL_LEADERS', dueAt: past });
    const id = res.body.id as string;

    expect((await w.l1.agent.post(`/api/member/instructions/${id}/seen`).set('X-CSRF-Token', w.l1.csrf)).status).toBe(200);
    expect((await w.l2.agent.post(`/api/member/instructions/${id}/done`).set('X-CSRF-Token', w.l2.csrf).send({ note: 'Done, 12 contacted' })).status).toBe(200);

    const tracker = (await w.central.agent.get(`/api/admin/instructions/${id}`)).body;
    const byName = Object.fromEntries(tracker.recipients.map((r: any) => [r.name, r]));
    expect(byName['Leader A']).toMatchObject({ status: 'DONE', note: 'Done, 12 contacted' });
    expect(byName['Leader HQ'].status).toBe('LATE'); // seen, not done, past the deadline
    expect(byName['Leader HQ'].seenAt).toBeTruthy();

    const list = (await w.central.agent.get('/api/admin/instructions')).body.items;
    expect(list[0]).toMatchObject({ total: 4, seen: 2, done: 1, late: 3 });

    const first = await w.central.agent.post(`/api/admin/instructions/${id}/remind`).set('X-CSRF-Token', w.central.csrf);
    expect(first.body.reminded).toBe(3); // everyone except the one who is done
    expect(await prisma.notification.count({ where: { type: 'INSTRUCTION_REMINDER', targetId: id } })).toBe(3);
    const again = await w.central.agent.post(`/api/admin/instructions/${id}/remind`).set('X-CSRF-Token', w.central.csrf);
    expect(again.body.reminded).toBe(0);
  });

  it('shows leaders each other\'s notes only when the instruction allows it', async () => {
    const w = await world();
    const hidden = (await send(w, { audience: 'ALL_LEADERS', repliesVisible: false })).body.id as string;
    const shown = (await send(w, { audience: 'ALL_LEADERS', repliesVisible: true, title: 'Share how it went' })).body.id as string;
    for (const id of [hidden, shown]) {
      await w.l2.agent.post(`/api/member/instructions/${id}/done`).set('X-CSRF-Token', w.l2.csrf).send({ note: 'All good here' });
    }
    const items = (await w.l1.agent.get('/api/member/instructions')).body.items;
    expect(items.find((i: any) => i.id === hidden).replies).toEqual([]);
    expect(items.find((i: any) => i.id === shown).replies).toEqual([expect.objectContaining({ name: 'Leader A', note: 'All good here' })]);
  });

  it('only a recipient can mark an instruction, and only the central admin can write or follow up', async () => {
    const w = await world();
    const id = (await send(w, { audience: 'PICKED', personIds: [w.l1.person.id] })).body.id as string;
    expect((await w.l2.agent.post(`/api/member/instructions/${id}/seen`).set('X-CSRF-Token', w.l2.csrf)).status).toBe(404);
    expect((await w.l2.agent.post(`/api/member/instructions/${id}/done`).set('X-CSRF-Token', w.l2.csrf).send({})).status).toBe(404);
    // A leader cannot reach the central admin's routes, in either place.
    expect((await w.l1.agent.get('/api/member/central-instructions')).status).toBe(403);
    expect((await w.l1.agent.post('/api/member/central-instructions').set('X-CSRF-Token', w.l1.csrf).send({ title: 'x', body: 'y', audience: 'ALL_LEADERS' })).status).toBe(403);
    expect((await w.plain.agent.get('/api/member/central-instructions/leaders')).status).toBe(403);
    const anon = agentWithUniqueIp();
    expect((await anon.get('/api/admin/instructions')).status).toBe(401);
  });

  it('works from the central admin\'s own member profile too', async () => {
    const w = await world();
    const centralMember = await member('National Coordinator');
    await prisma.user.update({ where: { id: w.admin.id }, data: { personId: centralMember.person.id } });
    const res = await centralMember.agent.post('/api/member/central-instructions').set('X-CSRF-Token', centralMember.csrf).send({ title: 'From my profile', body: 'Hello leaders', audience: 'ALL_LEADERS' });
    expect(res.status).toBe(201);
    const tracker = (await centralMember.agent.get(`/api/member/central-instructions/${res.body.id}`)).body;
    expect(tracker.recipients).toHaveLength(4);
    expect(await prisma.auditLog.count({ where: { action: 'LEADER_INSTRUCTION_SENT' } })).toBeGreaterThan(0);
  });
});
