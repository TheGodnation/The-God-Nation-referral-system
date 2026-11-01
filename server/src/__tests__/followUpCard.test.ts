import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { createLeader } from './helpers';
import { bootstrap } from './testUtils';

// "My people": the follow-up card of each person a leader follows — last
// contact, the twice-a-week rule, who has not replied, wellbeing, school and
// book-payment status — most urgent first. Members never see their own card.
const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

let ip = 0;
function agentWithUniqueIp() {
  ip += 1;
  const raw = request.agent(app);
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const wrapped = {} as Record<(typeof methods)[number], (path: string) => request.Test>;
  for (const m of methods) wrapped[m] = (path: string) => raw[m](path).set('X-Forwarded-For', `10.151.0.${ip}`);
  return wrapped;
}

let n = 0;
async function person(name: string) {
  n += 1;
  return prisma.person.create({ data: { name: `${name}`, whatsappNumber: `+2376600${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
}

async function setup() {
  const { user } = await createLeader('Lead Er', 'lead@test.local', 'LEADCODE1');
  const leader = await person('Leader');
  await prisma.user.update({ where: { id: user.id }, data: { personId: leader.id } });
  const hq = await prisma.community.create({ data: { name: 'Assembly' } });
  await prisma.roleAssignment.create({ data: { personId: leader.id, roleType: 'SCOPED_LEADER', communityId: hq.id, assignedByUserId: user.id } });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email: 'lead@test.local', password: 'password123' });

  async function follow(name: string, assignedDaysAgo = 10) {
    const p = await person(name);
    await prisma.communityMembership.create({ data: { personId: p.id, communityId: hq.id, status: 'ACTIVE' } });
    const a = await prisma.followUpAssignment.create({
      data: { followerId: leader.id, followedPersonId: p.id, contextType: 'COMMUNITY', contextId: hq.id, assignedByUserId: user.id, assignedAt: new Date(Date.now() - assignedDaysAgo * DAY) },
    });
    return { p, a };
  }
  const contact = (assignmentId: string, daysAgo: number, wellbeingStatus: 'GOOD' | 'EMERGENCY' | 'NEEDS_ATTENTION' = 'GOOD', extra: { nextFollowUpDate?: Date; note?: string } = {}) =>
    prisma.followUpContact.create({ data: { followUpAssignmentId: assignmentId, contactedAt: new Date(Date.now() - daysAgo * DAY), wellbeingStatus, loggedByUserId: user.id, ...extra } });
  return { user, leader, hq, agent, csrf, follow, contact };
}

describe('GET /api/leader/my-people', () => {
  it('lists each person with their card, the most urgent first', async () => {
    const s = await setup();
    const quiet = await s.follow('Quiet one');
    const steady = await s.follow('Steady one');
    const emergency = await s.follow('Emergency one');
    const silent = await s.follow('Silent one');

    await s.contact(steady.a.id, 1, 'GOOD', { nextFollowUpDate: new Date(Date.now() + DAY), note: 'Doing well' });
    await s.contact(steady.a.id, 3);
    await s.contact(emergency.a.id, 1, 'EMERGENCY', { note: 'Lost a job' });
    await s.contact(emergency.a.id, 2);
    // The leader wrote to Silent 5 days ago; no answer since.
    const conv = await prisma.privateConversation.create({ data: { memberPersonId: silent.p.id, initiatorPersonId: s.leader.id } });
    await prisma.privateMessage.create({ data: { conversationId: conv.id, senderPersonId: s.leader.id, body: 'Hello?', createdAt: new Date(Date.now() - 5 * DAY) } });
    // Steady has opened a book and not paid yet.
    const book = await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: 'B1', trainingOrder: 1 } });
    await prisma.trainingBookOpen.create({ data: { personId: steady.p.id, bookId: book.id } });

    const res = await s.agent.get('/api/leader/my-people');
    expect(res.status).toBe(200);
    expect(res.body.contactTarget).toBe(2);
    expect(res.body.total).toBe(4);
    const byName = Object.fromEntries(res.body.items.map((c: any) => [c.name, c]));

    expect(res.body.items[0].name).toBe('Emergency one');
    expect(byName['Emergency one'].flags[0]).toBe('EMERGENCY');
    expect(byName['Emergency one'].note).toBe('Lost a job');

    expect(byName['Quiet one'].flags).toEqual(expect.arrayContaining(['NOT_YET_CONTACTED', 'CONTACT_TWICE_WEEK']));
    expect(byName['Quiet one'].lastContactAt).toBeNull();

    expect(byName['Silent one']).toMatchObject({ replied: false, conversationId: conv.id });
    expect(byName['Silent one'].flags).toEqual(expect.arrayContaining(['NO_REPLY', 'CONTACT_TWICE_WEEK']));

    expect(byName['Steady one']).toMatchObject({ contactDaysThisWeek: 2, contactTarget: 2, wellbeing: 'GOOD', payment: { owedBooks: 1, waitingConfirmation: 0 } });
    expect(byName['Steady one'].flags).toEqual(['PAYMENT_OWED']);
    expect(byName['Steady one'].nextAction.overdue).toBe(false);
    expect(res.body.needingAttention).toBe(4);
  });

  it('counts messages to the person as contact, and a reply clears "no reply"', async () => {
    const s = await setup();
    const one = await s.follow('Chatty one');
    const conv = await prisma.privateConversation.create({ data: { memberPersonId: one.p.id, initiatorPersonId: s.leader.id } });
    await prisma.privateMessage.create({ data: { conversationId: conv.id, senderPersonId: s.leader.id, body: 'a', createdAt: new Date(Date.now() - 4 * DAY) } });
    await prisma.privateMessage.create({ data: { conversationId: conv.id, senderPersonId: s.leader.id, body: 'b', createdAt: new Date(Date.now() - 1 * DAY) } });
    await prisma.privateMessage.create({ data: { conversationId: conv.id, senderPersonId: one.p.id, body: 'thanks', createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000) } });

    const card = (await s.agent.get('/api/leader/my-people')).body.items[0];
    expect(card.contactDaysThisWeek).toBe(2);
    expect(card.replied).toBe(true);
    expect(card.flags).toEqual([]);
  });

  it('flags an overdue next action, and does not flag a brand-new assignment for the weekly rule', async () => {
    const s = await setup();
    const late = await s.follow('Late one');
    const fresh = await s.follow('Fresh one', 1);
    await s.contact(late.a.id, 2);
    await s.contact(late.a.id, 1, 'GOOD', { nextFollowUpDate: new Date(Date.now() - 60 * 60 * 1000) });
    await s.contact(fresh.a.id, 0);
    const items = (await s.agent.get('/api/leader/my-people')).body.items;
    expect(items.find((c: any) => c.name === 'Late one').flags).toEqual(['OVERDUE']);
    expect(items.find((c: any) => c.name === 'Fresh one').flags).toEqual([]);
  });

  it('only shows people this leader follows, and is closed to members and visitors', async () => {
    const s = await setup();
    await s.follow('Mine');
    const other = await createLeader('Other', 'other@test.local', 'OTHERCOD1');
    const otherPerson = await person('Other leader');
    await prisma.user.update({ where: { id: other.user.id }, data: { personId: otherPerson.id } });
    const stranger = await person('Not mine');
    await prisma.followUpAssignment.create({
      data: { followerId: otherPerson.id, followedPersonId: stranger.id, contextType: 'COMMUNITY', contextId: s.hq.id, assignedByUserId: other.user.id },
    });
    const names = (await s.agent.get('/api/leader/my-people')).body.items.map((c: any) => c.name);
    expect(names).toEqual(['Mine']);
    expect((await agentWithUniqueIp().get('/api/leader/my-people')).status).toBe(401);
  });
});

describe('POST /api/leader/my-people/:personId/chat', () => {
  it('opens the private chat with one of my people (the same chat every time), and refuses anyone else', async () => {
    const s = await setup();
    const mine = await s.follow('Mine');
    const stranger = await person('Stranger');
    const first = await s.agent.post(`/api/leader/my-people/${mine.p.id}/chat`).set('X-CSRF-Token', s.csrf).send({});
    expect(first.status).toBe(200);
    const again = await s.agent.post(`/api/leader/my-people/${mine.p.id}/chat`).set('X-CSRF-Token', s.csrf).send({});
    expect(again.body.conversationId).toBe(first.body.conversationId);
    const row = await prisma.privateConversation.findUniqueOrThrow({ where: { id: first.body.conversationId } });
    expect(row).toMatchObject({ memberPersonId: mine.p.id, initiatorPersonId: s.leader.id });
    const no = await s.agent.post(`/api/leader/my-people/${stranger.id}/chat`).set('X-CSRF-Token', s.csrf).send({});
    expect(no.status).toBe(403);
  });
});
