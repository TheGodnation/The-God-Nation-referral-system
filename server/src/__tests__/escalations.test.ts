import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { processEscalationBypass } from '../lib/escalations';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Escalation: a leader's hard question to the parent assembly's leaders or the
// central admin; an urgent flag; passed on to the central admin when nobody
// answers in 24 hours (2 when urgent) or the leaders asked are away, with the
// skipped leaders and the asker told.
const app = createApp();
const HOUR = 60 * 60 * 1000;

let ip = 0;
function agentWithUniqueIp() {
  ip += 1;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', `10.153.0.${ip}`);
  return wrapped;
}

let n = 0;
async function person(name: string) {
  n += 1;
  return prisma.person.create({ data: { name, whatsappNumber: `+2376620${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
}
async function login(email: string, password: string) {
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

async function world() {
  const admin = await createAdmin('esc-admin@test.local', 'AdminPass123!');
  const adminPerson = await person('Central Admin');
  await prisma.user.update({ where: { id: admin.id }, data: { personId: adminPerson.id } });
  const parent = await prisma.community.create({ data: { name: 'Parent assembly' } });
  const child = await prisma.community.create({ data: { name: 'Child assembly', parentId: parent.id } });
  async function leader(name: string, community: { id: string }) {
    const email = `${name.toLowerCase().replace(/\W/g, '')}${n}@test.local`;
    const { user } = await createLeader(name, email, `C${n}${name.slice(0, 3).toUpperCase()}`);
    const p = await person(name);
    await prisma.user.update({ where: { id: user.id }, data: { personId: p.id } });
    await prisma.roleAssignment.create({ data: { personId: p.id, roleType: 'SCOPED_LEADER', communityId: community.id, assignedByUserId: admin.id } });
    return { user, p, email };
  }
  const asker = await leader('Asking Ada', child);
  const member = await person('Struggling Sam');
  await prisma.communityMembership.create({ data: { personId: member.id, communityId: child.id, status: 'ACTIVE' } });
  await prisma.followUpAssignment.create({ data: { followerId: asker.p.id, followedPersonId: member.id, contextType: 'COMMUNITY', contextId: child.id, assignedByUserId: admin.id } });
  const ask = async (extra: Record<string, unknown> = {}) => {
    const s = await login(asker.email, 'password123');
    return s.agent.post('/api/leader/escalations').set('X-CSRF-Token', s.csrf).send({ aboutPersonId: member.id, question: 'What should I do?', urgent: false, to: 'PARENT', ...extra });
  };
  return { admin, adminPerson, parent, child, leader, asker, member, ask };
}
const notices = (personId: string, type: string) => prisma.notification.count({ where: { recipientPersonId: personId, type: type as any } });

describe('asking the parent leaders', () => {
  it('goes to the parent assembly leaders who are present, with 24 hours (2 when urgent); away leaders are told they were passed over', async () => {
    const w = await world();
    const p1 = await w.leader('Parent Paul', w.parent);
    const p2 = await w.leader('Away Alice', w.parent);
    await prisma.person.update({ where: { id: p2.p.id }, data: { awayUntil: new Date(Date.now() + 3 * 24 * HOUR) } });

    const res = await w.ask();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ level: 'PARENT_LEADERS', bypassed: false });
    const row = await prisma.followUpEscalation.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.dueAt!.getTime() - Date.now()).toBeGreaterThan(23 * HOUR);
    expect(await notices(p1.p.id, 'ESCALATION_RECEIVED')).toBe(1);
    expect(await notices(p2.p.id, 'ESCALATION_RECEIVED')).toBe(0);
    expect(await notices(p2.p.id, 'ESCALATION_BYPASSED')).toBe(1);

    const urgent = await w.ask({ urgent: true });
    const urgentRow = await prisma.followUpEscalation.findUniqueOrThrow({ where: { id: urgent.body.id } });
    expect(urgentRow.urgent).toBe(true);
    expect(urgentRow.dueAt!.getTime() - Date.now()).toBeLessThan(2.1 * HOUR);
  });

  it('a parent leader answers: it is marked answered, the asker is told, and it is never passed on', async () => {
    const w = await world();
    const p1 = await w.leader('Parent Paul', w.parent);
    const res = await w.ask();
    const s = await login(p1.email, 'password123');
    const inbox = await s.agent.get('/api/leader/escalations/inbox');
    expect(inbox.body.items.map((i: any) => i.id)).toEqual([res.body.id]);
    const reply = await s.agent.post(`/api/leader/escalations/${res.body.id}/messages`).set('X-CSRF-Token', s.csrf).send({ body: 'Visit him and pray together.' });
    expect(reply.status).toBe(201);
    expect(reply.body.item.status).toBe('ANSWERED');
    expect(await notices(w.asker.p.id, 'ESCALATION_ANSWERED')).toBe(1);

    await prisma.followUpEscalation.update({ where: { id: res.body.id }, data: { dueAt: new Date(Date.now() - HOUR) } });
    expect(await processEscalationBypass()).toBe(0);
    const mine = await (await login(w.asker.email, 'password123')).agent.get('/api/leader/escalations/mine');
    expect(mine.body.items[0].messages.map((m: any) => m.body)).toEqual(['What should I do?', 'Visit him and pray together.']);
  });

  it('nobody answers in time: it passes to the central admin and the skipped leaders and the asker are told', async () => {
    const w = await world();
    const p1 = await w.leader('Parent Paul', w.parent);
    const res = await w.ask();
    expect(await processEscalationBypass()).toBe(0); // not yet due

    await prisma.followUpEscalation.update({ where: { id: res.body.id }, data: { dueAt: new Date(Date.now() - 60 * 1000) } });
    expect(await processEscalationBypass()).toBe(1);
    const row = await prisma.followUpEscalation.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).toMatchObject({ level: 'CENTRAL_ADMIN', bypassReason: 'NO_REPLY', status: 'OPEN' });
    expect(row.bypassedAt).not.toBeNull();
    expect(await notices(w.adminPerson.id, 'ESCALATION_RECEIVED')).toBe(1);
    expect(await notices(p1.p.id, 'ESCALATION_BYPASSED')).toBe(1);
    expect(await notices(w.asker.p.id, 'ESCALATION_BYPASSED')).toBe(1);
    // It happens once.
    expect(await processEscalationBypass()).toBe(0);
  });

  it('all the parent leaders are away: it goes straight to the central admin', async () => {
    const w = await world();
    const p1 = await w.leader('Away Alice', w.parent);
    await prisma.person.update({ where: { id: p1.p.id }, data: { awayUntil: new Date(Date.now() + 24 * HOUR) } });
    const res = await w.ask({ urgent: true });
    expect(res.body).toMatchObject({ level: 'CENTRAL_ADMIN', bypassed: true });
    const row = await prisma.followUpEscalation.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row).toMatchObject({ bypassReason: 'AWAY', dueAt: null });
    expect(await notices(w.adminPerson.id, 'ESCALATION_RECEIVED')).toBe(1);
    expect(await notices(p1.p.id, 'ESCALATION_BYPASSED')).toBe(1);
    expect(await notices(w.asker.p.id, 'ESCALATION_BYPASSED')).toBe(1);
  });

  it('an assembly with nobody above it sends the question to the central admin', async () => {
    const w = await world();
    const res = await w.ask();
    expect(res.body).toMatchObject({ level: 'CENTRAL_ADMIN', bypassed: false });
    expect(await notices(w.adminPerson.id, 'ESCALATION_RECEIVED')).toBe(1);
  });
});

describe('asking the central admin directly, and answering as the central admin', () => {
  it('shows up in the admin dashboard and in the central admin member profile list; his reply answers it', async () => {
    const w = await world();
    await w.leader('Parent Paul', w.parent);
    const res = await w.ask({ to: 'CENTRAL', urgent: true });
    expect(res.body.level).toBe('CENTRAL_ADMIN');

    const { agent, csrf } = await login('esc-admin@test.local', 'AdminPass123!');
    const list = await agent.get('/api/admin/cells/escalations');
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ id: res.body.id, urgent: true, askerName: 'Asking Ada', aboutName: 'Struggling Sam', communityName: 'Child assembly', status: 'OPEN' });
    const reply = await agent.post(`/api/admin/cells/escalations/${res.body.id}/messages`).set('X-CSRF-Token', csrf).send({ body: 'I will call him today.' });
    expect(reply.status).toBe(201);
    expect(reply.body.item).toMatchObject({ status: 'ANSWERED' });
    expect(reply.body.item.messages[1]).toMatchObject({ senderName: 'Central Admin', mine: true });
    expect(await notices(w.asker.p.id, 'ESCALATION_ANSWERED')).toBe(1);
  });
});

describe('who may ask and who may read', () => {
  it('only for one of my people; another leader cannot read or answer; visitors are refused', async () => {
    const w = await world();
    const other = await w.leader('Other Olga', w.child); // same assembly, not the asker's person
    const stranger = await person('Not followed');
    const bad = await (async () => {
      const s = await login(w.asker.email, 'password123');
      return s.agent.post('/api/leader/escalations').set('X-CSRF-Token', s.csrf).send({ aboutPersonId: stranger.id, question: 'q', urgent: false, to: 'CENTRAL' });
    })();
    expect(bad.status).toBe(403);

    const res = await w.ask({ to: 'CENTRAL' });
    const s = await login(other.email, 'password123');
    expect((await s.agent.post(`/api/leader/escalations/${res.body.id}/messages`).set('X-CSRF-Token', s.csrf).send({ body: 'hi' })).status).toBe(403);
    expect((await s.agent.get('/api/leader/escalations/inbox')).body.items).toEqual([]);
    expect((await agentWithUniqueIp().get('/api/leader/escalations/mine')).status).toBe(401);
    expect((await agentWithUniqueIp().get('/api/admin/cells/escalations')).status).toBe(401);
  });
});
