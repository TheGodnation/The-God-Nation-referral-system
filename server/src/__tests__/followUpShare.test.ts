import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Sharing an assembly's people among its leaders by headcount, handing people
// (with their notes and chat) from one leader to another, and the away status.
const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

let ip = 0;
function agentWithUniqueIp() {
  ip += 1;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', `10.152.0.${ip}`);
  return wrapped;
}

let n = 0;
async function person(name: string) {
  n += 1;
  return prisma.person.create({ data: { name, whatsappNumber: `+2376610${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
}

async function login(email: string, password: string) {
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

async function world() {
  const admin = await createAdmin('share-admin@test.local', 'AdminPass123!');
  const hq = await prisma.community.create({ data: { name: 'Assembly' } });
  async function leader(name: string) {
    const email = `${name.toLowerCase().replace(/\W/g, '')}@test.local`;
    const { user } = await createLeader(name, email, name.toUpperCase().replace(/\W/g, '').slice(0, 8) + n);
    const p = await person(name);
    await prisma.user.update({ where: { id: user.id }, data: { personId: p.id } });
    const role = await prisma.roleAssignment.create({ data: { personId: p.id, roleType: 'SCOPED_LEADER', communityId: hq.id, assignedByUserId: admin.id } });
    return { user, p, email, role };
  }
  async function member(name: string) {
    const p = await person(name);
    await prisma.communityMembership.create({ data: { personId: p.id, communityId: hq.id, status: 'ACTIVE' } });
    return p;
  }
  const follow = (leaderId: string, personId: string) =>
    prisma.followUpAssignment.create({ data: { followerId: leaderId, followedPersonId: personId, contextType: 'COMMUNITY', contextId: hq.id, assignedByUserId: admin.id } });
  const count = (leaderId: string) => prisma.followUpAssignment.count({ where: { followerId: leaderId, status: 'ACTIVE' } });
  return { admin, hq, leader, member, follow, count };
}

describe('share the people nobody follows, evenly by headcount', () => {
  it('gives each person to the lightest leader, skips a leader who is away, never gives a leader to a leader', async () => {
    const w = await world();
    const a = await w.leader('Anna');
    const b = await w.leader('Boris');
    const away = await w.leader('Away Alice');
    await prisma.person.update({ where: { id: away.p.id }, data: { awayUntil: new Date(Date.now() + 5 * DAY) } });
    // Anna already follows two people.
    for (const name of ['Old one', 'Old two']) await w.follow(a.p.id, (await w.member(name)).id);
    for (let i = 0; i < 6; i++) await w.member(`New ${i}`);

    const { agent, csrf } = await login('share-admin@test.local', 'AdminPass123!');
    const overview = (await agent.get('/api/admin/cells/overview')).body.items.find((r: any) => r.id === w.hq.id);
    expect(overview.unassigned).toBe(6);

    const res = await agent.post('/api/admin/cells/share').set('X-CSRF-Token', csrf).send({ communityId: w.hq.id });
    expect(res.status).toBe(200);
    expect(res.body.assigned).toBe(6);
    // Anna had 2, Boris 0: six more go 4 to Boris, 2 to Anna → 4 and 4. Away Alice gets none.
    expect(await w.count(a.p.id)).toBe(4);
    expect(await w.count(b.p.id)).toBe(4);
    expect(await w.count(away.p.id)).toBe(0);
    expect(await prisma.followUpAssignment.count({ where: { followedPersonId: { in: [a.p.id, b.p.id, away.p.id] } } })).toBe(0);
    // Doing it again changes nothing.
    expect((await agent.post('/api/admin/cells/share').set('X-CSRF-Token', csrf).send({ communityId: w.hq.id })).body.assigned).toBe(0);
    expect((await agent.get('/api/admin/cells/overview')).body.items.find((r: any) => r.id === w.hq.id).unassigned).toBe(0);
  });

  it('says so when the assembly has no leader yet', async () => {
    const w = await world();
    await w.member('Lonely');
    const { agent, csrf } = await login('share-admin@test.local', 'AdminPass123!');
    const res = await agent.post('/api/admin/cells/share').set('X-CSRF-Token', csrf).send({ communityId: w.hq.id });
    expect(res.body).toMatchObject({ assigned: 0, noLeaders: true });
  });
});

describe('handing people to another leader', () => {
  it('when a leader stops leading, their people, notes and chat go to the other leaders', async () => {
    const w = await world();
    const leaving = await w.leader('Leaving Leo');
    const staying = await w.leader('Staying Sam');
    const people = [await w.member('P1'), await w.member('P2'), await w.member('P3')];
    const a1 = await w.follow(leaving.p.id, people[0].id);
    for (const p of people.slice(1)) await w.follow(leaving.p.id, p.id);
    await prisma.followUpContact.create({ data: { followUpAssignmentId: a1.id, wellbeingStatus: 'GOOD', note: 'Remember: exam on Friday', loggedByUserId: leaving.user.id } });
    const chat = await prisma.privateConversation.create({ data: { memberPersonId: people[0].id, initiatorPersonId: leaving.p.id } });
    await prisma.privateMessage.create({ data: { conversationId: chat.id, senderPersonId: leaving.p.id, body: 'History to keep' } });

    const { agent, csrf } = await login('share-admin@test.local', 'AdminPass123!');
    const end = await agent.patch(`/api/admin/role-assignments/${leaving.role.id}/end`).set('X-CSRF-Token', csrf).send({});
    expect(end.status).toBe(200);

    expect(await w.count(leaving.p.id)).toBe(0);
    expect(await w.count(staying.p.id)).toBe(3);
    const moved = await prisma.followUpAssignment.findUniqueOrThrow({ where: { id: a1.id }, include: { contacts: true } });
    expect(moved.followerId).toBe(staying.p.id);
    expect(moved.contacts[0].note).toBe('Remember: exam on Friday');
    const chatNow = await prisma.privateConversation.findUniqueOrThrow({ where: { id: chat.id } });
    expect(chatNow.initiatorPersonId).toBe(staying.p.id);
    expect(await prisma.notification.count({ where: { recipientPersonId: staying.p.id, type: 'FOLLOW_UP_ASSIGNED' } })).toBe(3);
  });

  it('keeps the people where they are when there is nobody else to take them', async () => {
    const w = await world();
    const only = await w.leader('Only Olga');
    await w.follow(only.p.id, (await w.member('P')).id);
    const { agent, csrf } = await login('share-admin@test.local', 'AdminPass123!');
    expect((await agent.patch(`/api/admin/role-assignments/${only.role.id}/end`).set('X-CSRF-Token', csrf).send({})).status).toBe(200);
    expect(await w.count(only.p.id)).toBe(1);
  });

  it('a leader shares one person with a colleague (both follow), or hands them over', async () => {
    const w = await world();
    const me = await w.leader('Mine Mia');
    const other = await w.leader('Other Otto');
    const stranger = await w.leader('Stranger Stan');
    await prisma.roleAssignment.update({ where: { id: stranger.role.id }, data: { status: 'ENDED', endedAt: new Date() } });
    const p1 = await w.member('Shared one');
    const p2 = await w.member('Handed one');
    await w.follow(me.p.id, p1.id);
    await w.follow(me.p.id, p2.id);

    const { agent, csrf } = await login(me.email, 'password123');
    const colleagues = await agent.get('/api/leader/my-people/colleagues');
    expect(colleagues.body.items[0].leaders.map((l: any) => l.name).sort()).toEqual(['Other Otto']);

    const share = await agent.post(`/api/leader/my-people/${p1.id}/share`).set('X-CSRF-Token', csrf).send({ toLeaderPersonId: other.p.id, mode: 'share' });
    expect(share.status).toBe(200);
    expect(await prisma.followUpAssignment.count({ where: { followedPersonId: p1.id, status: 'ACTIVE' } })).toBe(2);

    const hand = await agent.post(`/api/leader/my-people/${p2.id}/share`).set('X-CSRF-Token', csrf).send({ toLeaderPersonId: other.p.id, mode: 'handover' });
    expect(hand.body.done).toBe(true);
    expect(await prisma.followUpAssignment.count({ where: { followedPersonId: p2.id, followerId: me.p.id, status: 'ACTIVE' } })).toBe(0);
    expect(await prisma.followUpAssignment.count({ where: { followedPersonId: p2.id, followerId: other.p.id, status: 'ACTIVE' } })).toBe(1);

    // Not to someone who is not a leader of the assembly, not for someone who is not mine.
    expect((await agent.post(`/api/leader/my-people/${p1.id}/share`).set('X-CSRF-Token', csrf).send({ toLeaderPersonId: stranger.p.id, mode: 'share' })).status).toBe(400);
    expect((await agent.post(`/api/leader/my-people/${p2.id}/share`).set('X-CSRF-Token', csrf).send({ toLeaderPersonId: other.p.id, mode: 'share' })).status).toBe(403);
  });
});

describe('away status', () => {
  it('a leader can say they are away until a date and that they are back; the date must be in the near future', async () => {
    const w = await world();
    const me = await w.leader('Travelling Tom');
    const { agent, csrf } = await login(me.email, 'password123');
    const until = new Date(Date.now() + 7 * DAY).toISOString();
    const set = await agent.put('/api/leader/my-people/away').set('X-CSRF-Token', csrf).send({ until });
    expect(set.status).toBe(200);
    await w.follow(me.p.id, (await w.member('P')).id);
    expect((await agent.get('/api/leader/my-people')).body.away.until).toBe(until);

    expect((await agent.put('/api/leader/my-people/away').set('X-CSRF-Token', csrf).send({ until: new Date(Date.now() - DAY).toISOString() })).status).toBe(400);
    expect((await agent.put('/api/leader/my-people/away').set('X-CSRF-Token', csrf).send({ until: new Date(Date.now() + 800 * DAY).toISOString() })).status).toBe(400);

    await agent.put('/api/leader/my-people/away').set('X-CSRF-Token', csrf).send({ until: null });
    expect((await agent.get('/api/leader/my-people')).body.away).toBeNull();
  });
});
