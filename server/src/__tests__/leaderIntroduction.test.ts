import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { createInstruction, remindUnfinished, instructionNotice } from '../lib/leaderInstructions';
import { introducePendingAssignments, myLeaderOf } from '../lib/leaderIntro';

// Two things for the leaders' work: an instruction (and its reminder) also arrives as a short private message from
// the sender, and a person is told who their leader is (notification, first message, "Your leader" card) once the
// leader has opened their dashboard.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.181.${Math.floor(n / 256) % 256}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}
async function person(name: string, lang: 'en' | 'fr' = 'en') {
  n += 1;
  return prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2377900${String(n).padStart(5, '0')}`, preferredLanguage: lang, profileCompletedAt: new Date() } });
}
async function signedIn(p: { id: string }) {
  n += 1;
  const email = `li${n}@example.com`;
  await prisma.memberAccount.create({ data: { personId: p.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
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
  return { agent, csrf };
}
const adminUser = async () => (await prisma.user.findFirst({ where: { role: 'ADMIN' } })) ?? (await prisma.user.create({ data: { name: 'A', email: `li-a-${++n}@test.local`, passwordHash: 'x', role: 'ADMIN' } }));
async function makeLeader(name: string, lang: 'en' | 'fr' = 'en') {
  const p = await person(name, lang);
  const community = await prisma.community.create({ data: { name: `LiAssembly ${++n}`, autoPlacementEligible: false } });
  await prisma.roleAssignment.create({ data: { personId: p.id, roleType: 'SCOPED_LEADER', communityId: community.id, assignedByUserId: (await adminUser()).id } });
  return { p, community };
}
const assign = async (leaderId: string, personId: string, communityId: string) =>
  prisma.followUpAssignment.create({ data: { followerId: leaderId, followedPersonId: personId, contextType: 'COMMUNITY', contextId: communityId, assignedByUserId: (await adminUser()).id } });
const messagesFrom = (fromId: string, toId: string) =>
  prisma.privateMessage.findMany({ where: { senderPersonId: fromId, conversation: { memberPersonId: toId } }, orderBy: { createdAt: 'asc' } });

afterEach(() => vi.restoreAllMocks());

describe('Instructions also arrive as a private message', () => {
  it('each leader gets a short message from the sender, in their language, with a link that opens the instruction; a reminder follows the same way', async () => {
    const sender = await person('National Coordinator');
    const senderUser = await prisma.user.create({ data: { name: 'Coordinator', email: `li-s-${++n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: sender.id } });
    const en = await makeLeader('LeaderEn');
    const fr = await makeLeader('LeaderFr', 'fr');
    const due = new Date('2026-11-20T12:00:00Z');
    const made = await createInstruction({ title: 'Contact your people', body: '# Steps\n\n- Write to each person', audience: 'PICKED', generations: [], personIds: [en.p.id, fr.p.id], dueAt: due, repliesVisible: false, createdByUserId: senderUser.id, createdByPersonId: sender.id });
    expect(made.ok).toBe(true);
    const id = (made as any).id as string;

    const [toEn] = await messagesFrom(sender.id, en.p.id);
    expect(toEn.body).toContain('📌 New instruction: Contact your people');
    expect(toEn.body).toContain('Due: 20 November 2026');
    expect(toEn.body).toContain(`/member/leadership-dashboard?section=instructions&instruction=${id}`);
    const [toFr] = await messagesFrom(sender.id, fr.p.id);
    expect(toFr.body).toContain('📌 Nouvelle instruction : Contact your people');
    expect(toFr.body).toContain('Pour le : 20 novembre 2026');

    const reminded = await remindUnfinished(id);
    expect(reminded).toEqual({ reminded: 2 });
    const all = await messagesFrom(sender.id, en.p.id);
    expect(all).toHaveLength(2);
    expect(all[1].body).toContain('⏰ Reminder: Contact your people');
    expect((await messagesFrom(sender.id, fr.p.id))[1].body).toContain('⏰ Rappel : Contact your people');
  });

  it('works when the central admin writes from the dashboard (the message comes from the admin\'s own member profile), and never fails the instruction if no profile is linked', async () => {
    const sender = await person('Dash Coordinator');
    const linked = await prisma.user.create({ data: { name: 'Linked', email: `li-l-${++n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: sender.id } });
    const unlinked = await prisma.user.create({ data: { name: 'Unlinked', email: `li-u-${++n}@test.local`, passwordHash: 'x', role: 'ADMIN' } });
    const leader = await makeLeader('LeaderDash');
    const a = await createInstruction({ title: 'Linked one', body: 'Body', audience: 'PICKED', generations: [], personIds: [leader.p.id], dueAt: null, repliesVisible: false, createdByUserId: linked.id, createdByPersonId: null });
    expect(a.ok).toBe(true);
    expect((await messagesFrom(sender.id, leader.p.id)).map((m) => m.body)[0]).toContain('Linked one');
    const b = await createInstruction({ title: 'Unlinked one', body: 'Body', audience: 'PICKED', generations: [], personIds: [leader.p.id], dueAt: null, repliesVisible: false, createdByUserId: unlinked.id, createdByPersonId: null });
    expect(b.ok).toBe(true);
    // The in-app notice is still there even with no private message.
    expect(await prisma.notification.count({ where: { recipientPersonId: leader.p.id, type: 'INSTRUCTION_RECEIVED', targetId: (b as any).id } })).toBe(1);
  });

  it('writes the notice without a due date when there is none', () => {
    expect(instructionNotice('new', 'T', null, 'abc', false)).not.toContain('Due');
    expect(instructionNotice('new', 'T', null, 'abc', true)).not.toContain('Pour le');
  });
});

describe('Your leader', () => {
  it('tells the person who their leader is once, with a notification and a first message in their language, and shows the leader on their card', async () => {
    const leader = await makeLeader('Grace Mbah');
    const en = await person('Member En');
    const fr = await person('Membre Fr', 'fr');
    await assign(leader.p.id, en.id, leader.community.id);
    await assign(leader.p.id, fr.id, leader.community.id);

    // Before the leader opens their dashboard: nothing is sent, and there is no card.
    expect(await messagesFrom(leader.p.id, en.id)).toHaveLength(0);
    expect(await myLeaderOf(en.id)).toBeNull();

    expect(await introducePendingAssignments(leader.p.id)).toBe(2);
    const [hi] = await messagesFrom(leader.p.id, en.id);
    expect(hi.body).toBe(`Hello, I'm ${leader.p.name}, from the Leadership Team. I've been assigned to walk with you. You can write to me here any time.`);
    const [salut] = await messagesFrom(leader.p.id, fr.id);
    expect(salut.body).toContain('de l’équipe de leadership');
    const note = await prisma.notification.findFirstOrThrow({ where: { recipientPersonId: en.id, type: 'LEADER_ASSIGNED' } });
    expect(note.targetId).toBe(leader.p.id);
    expect((note.metadata as any).leaderName).toBe(leader.p.name);
    expect(await myLeaderOf(en.id)).toMatchObject({ personId: leader.p.id, name: leader.p.name });

    // Opening the dashboard again tells nobody twice.
    expect(await introducePendingAssignments(leader.p.id)).toBe(0);
    expect(await messagesFrom(leader.p.id, en.id)).toHaveLength(1);
    expect(await prisma.notification.count({ where: { recipientPersonId: en.id, type: 'LEADER_ASSIGNED' } })).toBe(1);
  });

  it('a person handed to another leader is told about the new leader, and a closed assignment shows no leader', async () => {
    const first = await makeLeader('First Leader');
    const second = await makeLeader('Second Leader');
    const member = await person('Handed Over');
    const a = await assign(first.p.id, member.id, first.community.id);
    await introducePendingAssignments(first.p.id);
    expect((await myLeaderOf(member.id))?.personId).toBe(first.p.id);
    // Handing over resets the introduction, so the new leader introduces themselves on opening the dashboard.
    await prisma.followUpAssignment.update({ where: { id: a.id }, data: { followerId: second.p.id, introducedAt: null } });
    expect(await myLeaderOf(member.id)).toBeNull();
    expect(await introducePendingAssignments(second.p.id)).toBe(1);
    expect((await myLeaderOf(member.id))?.personId).toBe(second.p.id);
    await prisma.followUpAssignment.update({ where: { id: a.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    expect(await myLeaderOf(member.id)).toBeNull();
  });

  it('only leaders introduce anyone, and nobody erased is told', async () => {
    const notLeader = await person('Not A Leader');
    const leader = await makeLeader('Careful Leader');
    const gone = await person('Erased Person');
    await assign(leader.p.id, gone.id, leader.community.id);
    await prisma.person.update({ where: { id: gone.id }, data: { erasedAt: new Date() } });
    expect(await introducePendingAssignments(notLeader.id)).toBe(0);
    expect(await introducePendingAssignments(leader.p.id)).toBe(0);
    expect(await messagesFrom(leader.p.id, gone.id)).toHaveLength(0);
  });

  it('the routes: a leader opening the dashboard introduces themselves, and the person reads who their leader is', async () => {
    const leader = await makeLeader('Route Leader');
    const member = await person('Route Member');
    await assign(leader.p.id, member.id, leader.community.id);
    const leaderSession = await signedIn(leader.p);
    const memberSession = await signedIn(member);
    expect((await memberSession.agent.get('/api/member/my-leader')).body).toEqual({ leader: null });
    const res = await leaderSession.agent.post('/api/member/my-leader/introduce').set('X-CSRF-Token', leaderSession.csrf).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ told: 1 });
    const mine = await memberSession.agent.get('/api/member/my-leader');
    expect(mine.body.leader).toMatchObject({ personId: leader.p.id, name: leader.p.name });
    expect((await request(app).get('/api/member/my-leader')).status).toBe(401);
  });

  it('existing assignments are not introduced (the migration marks them done), so nobody gets a message out of the blue', async () => {
    const leader = await makeLeader('Old Leader');
    const member = await person('Old Member');
    const a = await assign(leader.p.id, member.id, leader.community.id);
    // What the migration does to assignments that existed before this feature.
    await prisma.followUpAssignment.update({ where: { id: a.id }, data: { introducedAt: a.assignedAt } });
    expect(await introducePendingAssignments(leader.p.id)).toBe(0);
    expect(await messagesFrom(leader.p.id, member.id)).toHaveLength(0);
    // The card still shows for them.
    expect((await myLeaderOf(member.id))?.personId).toBe(leader.p.id);
  });
});
