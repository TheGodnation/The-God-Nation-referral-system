import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { createAdmin } from './helpers';
import { bootstrap } from './testUtils';

// The leaders' rooms: one for each generation of the assembly tree and one for all leaders. The National Coordinator
// (the central admin) reads and writes in all of them, labelled as such; a leader only enters the rooms they belong to.
const app = createApp();

let ip = 0;
function agentWithUniqueIp() {
  ip += 1;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', `10.157.0.${ip}`);
  return wrapped;
}
let n = 0;
async function member(name: string) {
  n += 1;
  const email = `room${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: `+2376652${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
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
    // The leader's own session (the leaders' room routes are leader-only): created beside the member session.
    await prisma.user.create({ data: { name, email: `leader-${name.replace(/\s/g, "")}-${++n}@test.local`, passwordHash: 'x', role: 'LEADER', active: true, personId: m.person.id } });
    await m.agent.get('/api/auth/me');
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


async function centralMember(w: Awaited<ReturnType<typeof world>>) {
  const m = await member('National Coordinator');
  await prisma.user.update({ where: { id: w.admin.id }, data: { personId: m.person.id } });
  return m;
}
const ROOMS = '/api/member/central-leader-rooms';

describe('the National Coordinator in the leaders\' rooms', () => {
  it('sees the All leaders room and one room for each generation, with how many leaders each has', async () => {
    const w = await world();
    const nc = await centralMember(w);
    const res = await nc.agent.get(ROOMS);
    expect(res.status).toBe(200);
    expect(res.body.items.map((r: any) => [r.generation, r.leaders])).toEqual([[-1, 4], [0, 1], [1, 2], [2, 2]]);
  });

  it('writes in a generation room as National Coordinator; only the leaders of that generation read it, and they are told', async () => {
    const w = await world();
    const nc = await centralMember(w);
    const post = await nc.agent.post(`${ROOMS}/1/messages`).set('X-CSRF-Token', nc.csrf).send({ body: 'Generation 1: please report on Friday.' });
    expect(post.status).toBe(201);
    expect(post.body.notified).toBe(2); // Leader A and Leader AB

    const read = await w.l2.agent.get('/api/leader/leadership-collaboration/1/messages');
    expect(read.status).toBe(200);
    expect(read.body.items[0]).toMatchObject({ body: 'Generation 1: please report on Friday.', senderName: 'National Coordinator', senderBadge: 'NATIONAL_COORDINATOR' });
    // A leader of another generation cannot enter that room.
    expect((await w.l1.agent.get('/api/leader/leadership-collaboration/1/messages')).status).toBe(404);
    expect((await w.l3.agent.get('/api/leader/leadership-collaboration/1/messages')).status).toBe(404);
  });

  it('the All leaders room: every leader can read it and write in it, and the National Coordinator sees their replies', async () => {
    const w = await world();
    const nc = await centralMember(w);
    await nc.agent.post(`${ROOMS}/-1/messages`).set('X-CSRF-Token', nc.csrf).send({ body: 'To all leaders.' });
    for (const l of [w.l1, w.l2, w.l3, w.l4]) {
      const rooms = (await l.agent.get('/api/leader/leadership-collaboration')).body.items.map((i: any) => i.generation);
      expect(rooms).toContain(-1);
      expect((await l.agent.get('/api/leader/leadership-collaboration/-1/messages')).body.items[0].body).toBe('To all leaders.');
    }
    expect((await w.l3.agent.post('/api/leader/leadership-collaboration/-1/messages').set('X-CSRF-Token', w.l3.csrf).send({ body: 'Understood.' })).status).toBe(201);
    const seen = (await nc.agent.get(`${ROOMS}/-1/messages`)).body;
    expect(seen.items.map((m: any) => m.body)).toEqual(['To all leaders.', 'Understood.']);
    expect(seen.items[0].senderBadge).toBe('NATIONAL_COORDINATOR');
    expect(seen.items[1].senderBadge).toBeNull();
    expect(seen.unreadCount).toBe(1); // the leader's reply is new to the National Coordinator
    const mark = await nc.agent.post(`${ROOMS}/-1/read`).set('X-CSRF-Token', nc.csrf).send({ messageId: seen.items[1].id });
    expect(mark.body.unreadCount).toBe(0);
    // A person who is not a leader cannot enter it.
    expect((await w.plain.agent.get('/api/leader/leadership-collaboration/-1/messages')).status).toBeGreaterThanOrEqual(401);
  });

  it('refuses a room that does not exist, and everyone who is not the central admin', async () => {
    const w = await world();
    const nc = await centralMember(w);
    expect((await nc.agent.get(`${ROOMS}/9/messages`)).status).toBe(404);
    expect((await nc.agent.post(`${ROOMS}/9/messages`).set('X-CSRF-Token', nc.csrf).send({ body: 'x' })).status).toBe(404);
    expect((await w.l1.agent.get(ROOMS)).status).toBe(403);
    expect((await w.l1.agent.post(`${ROOMS}/-1/messages`).set('X-CSRF-Token', w.l1.csrf).send({ body: 'x' })).status).toBe(403);
    expect((await w.plain.agent.get(ROOMS)).status).toBe(403);
  });

  it('works in the admin dashboard too, but an admin without a member profile can read and not write', async () => {
    const w = await world();
    const list = await w.central.agent.get('/api/admin/leader-rooms');
    expect(list.status).toBe(200);
    expect(list.body.canWrite).toBe(false);
    const post = await w.central.agent.post('/api/admin/leader-rooms/-1/messages').set('X-CSRF-Token', w.central.csrf).send({ body: 'x' });
    expect(post.status).toBe(400);
    await centralMember(w);
    // With a linked member profile the admin dashboard can write as well.
    const again = await w.central.agent.post('/api/admin/leader-rooms/-1/messages').set('X-CSRF-Token', w.central.csrf).send({ body: 'From the dashboard' });
    expect(again.status).toBe(201);
  });
});
