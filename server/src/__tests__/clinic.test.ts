import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { currentClinicBook, processClinicAutoSend } from '../lib/clinic';
import { createAdmin, createLeader } from './helpers';
import { bootstrap } from './testUtils';

// Dominion Clinic: the monthly book is SENT to members — by their leader in one
// tap, by the central admin to everyone, or automatically after two days — and
// only a member it was sent to can open it. A teaching can point at the part of
// the book it is taught from.
const app = createApp();
const HOUR = 60 * 60 * 1000;

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
async function memberSignIn(personId: string) {
  n += 1;
  const email = `clinic${n}@example.com`;
  await prisma.memberAccount.create({ data: { personId, email } });
  const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/member/auth/request-code').set('X-CSRF-Token', csrf).send({ email });
  const code = spy.mock.calls[0][0].code as string;
  spy.mockRestore();
  await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
  return { agent, csrf };
}
const person = (name: string, language: 'en' | 'fr' = 'en') => {
  n += 1;
  return prisma.person.create({ data: { name, whatsappNumber: `+2376660${String(n).padStart(5, '0')}`, preferredLanguage: language, profileCompletedAt: new Date() } });
};

async function world(startedHoursAgo = 1) {
  const admin = await createAdmin('clinic-admin@test.local', 'AdminPass123!');
  const hq = await prisma.community.create({ data: { name: 'Assembly' } });
  const devotional = await prisma.monthlyDevotional.create({
    data: { titleEn: 'Kingdom Secrets', titleFr: 'Secrets du Royaume', contentEn: 'x', status: 'PUBLISHED', startDate: new Date(Date.now() - startedHoursAgo * HOUR), endDate: new Date(Date.now() + 20 * 24 * HOUR) },
  });
  const book = await prisma.libraryBook.create({ data: { kind: 'DEVOTIONAL', titleEn: 'Kingdom Secrets', titleFr: 'Secrets du Royaume', devotionalId: devotional.id, storageKey: 'books/k.pdf', byteSize: 10, pageCount: 40 } });
  const member = async (name: string, language: 'en' | 'fr' = 'en') => {
    const p = await person(name, language);
    await prisma.communityMembership.create({ data: { personId: p.id, communityId: hq.id, status: 'ACTIVE' } });
    return p;
  };
  const leader = async (name: string) => {
    const { user } = await createLeader(name, `${name.toLowerCase().replace(/\W/g, '')}@test.local`, `CL${n}${name.slice(0, 3).toUpperCase()}`);
    const p = await member(name);
    await prisma.user.update({ where: { id: user.id }, data: { personId: p.id } });
    await prisma.roleAssignment.create({ data: { personId: p.id, roleType: 'SCOPED_LEADER', communityId: hq.id, assignedByUserId: admin.id } });
    return { user, p, email: `${name.toLowerCase().replace(/\W/g, '')}@test.local` };
  };
  const follow = (leaderId: string, personId: string) =>
    prisma.followUpAssignment.create({ data: { followerId: leaderId, followedPersonId: personId, contextType: 'COMMUNITY', contextId: hq.id, assignedByUserId: admin.id } });
  return { admin, hq, devotional, book, member, leader, follow };
}
async function login(email: string, password: string) {
  const agent = agentWithUniqueIp();
  const { csrf } = await bootstrap(agent as any);
  await agent.post('/api/auth/login').set('X-CSRF-Token', csrf).send({ email, password });
  return { agent, csrf };
}

describe('this month\'s book', () => {
  it('is the newest published monthly book that is running now and has a file', async () => {
    const w = await world();
    expect((await currentClinicBook())?.bookId).toBe(w.book.id);
    await prisma.monthlyDevotional.update({ where: { id: w.devotional.id }, data: { status: 'DRAFT' } });
    expect(await currentClinicBook()).toBeNull();
  });
});

describe('a leader sends the book in one tap', () => {
  it('sends it as a private message, in each person\'s language, only to those who do not have it', async () => {
    const w = await world();
    const lead = await w.leader('Leader Lea');
    const en = await w.member('English Eve');
    const fr = await w.member('Francine', 'fr');
    const had = await w.member('Had It');
    for (const p of [en, fr, had]) await w.follow(lead.p.id, p.id);
    await prisma.bookDelivery.create({ data: { personId: had.id, bookId: w.book.id, via: 'ADMIN' } });

    const { agent, csrf } = await login(lead.email, 'password123');
    const status = (await agent.get('/api/leader/clinic')).body;
    expect(status).toMatchObject({ people: 3, sent: 1, waiting: 2, book: { id: w.book.id } });

    const res = await agent.post('/api/leader/clinic/send').set('X-CSRF-Token', csrf).send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: 2, alreadyHad: 1 });
    expect(await prisma.bookDelivery.count({ where: { bookId: w.book.id, via: 'LEADER', sentByPersonId: lead.p.id } })).toBe(2);

    const enChat = await prisma.privateConversation.findUniqueOrThrow({ where: { memberPersonId_initiatorPersonId: { memberPersonId: en.id, initiatorPersonId: lead.p.id } }, include: { messages: true } });
    expect(enChat.messages[0].body).toContain('Dominion Clinic book has arrived');
    const frChat = await prisma.privateConversation.findUniqueOrThrow({ where: { memberPersonId_initiatorPersonId: { memberPersonId: fr.id, initiatorPersonId: lead.p.id } }, include: { messages: true } });
    expect(frChat.messages[0].body).toContain('Clinique de la Domination');
    expect(await prisma.notification.count({ where: { recipientPersonId: en.id, type: 'PRIVATE_MESSAGE_RECEIVED' } })).toBe(1);

    // A second tap sends nothing more.
    expect((await agent.post('/api/leader/clinic/send').set('X-CSRF-Token', csrf).send({})).body).toEqual({ sent: 0, alreadyHad: 3 });
    expect((await agent.get('/api/leader/clinic')).body).toMatchObject({ sent: 3, waiting: 0 });
  });
});

describe('only a member the book was sent to can open it', () => {
  it('refuses the book until it is sent, then opens; the central admin always can; the member list says which are sent', async () => {
    const w = await world();
    const a = await w.member('Not sent');
    const b = await w.member('Sent');
    await prisma.bookDelivery.create({ data: { personId: b.id, bookId: w.book.id, via: 'LEADER' } });
    const ma = await memberSignIn(a.id);
    const mb = await memberSignIn(b.id);
    expect((await ma.agent.get(`/api/member/library/books/${w.book.id}`)).status).toBe(404);
    expect((await mb.agent.get(`/api/member/library/books/${w.book.id}`)).status).toBe(200);

    const worldA = (await ma.agent.get('/api/member/exam-world')).body;
    expect(worldA.devotionals[0]).toMatchObject({ bookId: w.book.id, bookSent: false });
    expect((await mb.agent.get('/api/member/exam-world')).body.devotionals[0].bookSent).toBe(true);

    // The central admin's own profile can always read it.
    const owner = await w.member('Owner');
    await prisma.user.update({ where: { id: w.admin.id }, data: { personId: owner.id } });
    const mo = await memberSignIn(owner.id);
    expect((await mo.agent.get(`/api/member/library/books/${w.book.id}`)).status).toBe(200);
  });
});

describe('the central admin sends it to everyone, and the fallback sends it after two days', () => {
  it('send-all reaches everyone who does not have it, as a message from the central administration', async () => {
    const w = await world();
    const people = [await w.member('One'), await w.member('Two')];
    await prisma.bookDelivery.create({ data: { personId: people[0].id, bookId: w.book.id, via: 'LEADER' } });
    const { agent, csrf } = await login('clinic-admin@test.local', 'AdminPass123!');
    expect((await agent.get('/api/admin/cells/clinic')).body).toMatchObject({ members: 2, sent: 1, waiting: 1 });
    const res = await agent.post('/api/admin/cells/clinic/send-all').set('X-CSRF-Token', csrf).send({});
    expect(res.body).toEqual({ sent: 1, alreadyHad: 1 });
    expect(await prisma.bookDelivery.count({ where: { personId: people[1].id, via: 'ADMIN' } })).toBe(1);
    const chat = await prisma.privateConversation.findFirstOrThrow({ where: { memberPersonId: people[1].id, initiatorUserId: w.admin.id }, include: { messages: true } });
    expect(chat.messages[0].senderUserId).toBe(w.admin.id);
  });

  it('the fallback waits two days (leaders get it at once), then sends to the rest, once', async () => {
    const w = await world(1); // the book opened an hour ago
    const lead = await w.leader('Leader Lea');
    const member = await w.member('Waiting Wendy');
    expect(await processClinicAutoSend()).toBe(1); // only the leader
    expect(await prisma.bookDelivery.count({ where: { personId: lead.p.id, via: 'AUTO' } })).toBe(1);
    expect(await prisma.bookDelivery.count({ where: { personId: member.id } })).toBe(0);

    expect(await processClinicAutoSend(new Date(Date.now() + 50 * HOUR))).toBe(1);
    expect(await prisma.bookDelivery.count({ where: { personId: member.id, via: 'AUTO' } })).toBe(1);
    expect(await processClinicAutoSend(new Date(Date.now() + 60 * HOUR))).toBe(0);
  });

  it('a member who joins later waits two days from joining, not from the start of the month', async () => {
    const w = await world(10 * 24); // opened ten days ago
    const late = await w.member('Late Joiner');
    expect(await processClinicAutoSend()).toBe(0); // joined just now
    expect(await processClinicAutoSend(new Date(Date.now() + 49 * HOUR))).toBe(1);
    void late;
  });
});

describe('a member can unsubscribe from the monthly book', () => {
  it('is not sent it by the admin, the fallback or a leader, and is not counted as waiting; subscribing again includes them', async () => {
    const w = await world(60); // opened 60 hours ago: the fallback is due
    const lead = await w.leader('Leader Lea');
    const keeps = await w.member('Stays Subscribed');
    const leaves = await w.member('Unsubscribes');
    await w.follow(lead.p.id, keeps.id);
    await w.follow(lead.p.id, leaves.id);
    await prisma.person.update({ where: { id: leaves.id }, data: { clinicBookUnsubscribedAt: new Date() } });

    const { agent, csrf } = await login('clinic-admin@test.local', 'AdminPass123!');
    expect((await agent.get('/api/admin/cells/clinic')).body).toMatchObject({ members: 2 }); // the leader and the subscribed member (not the one who unsubscribed)
    const lagent = await login(lead.email, 'password123');
    expect((await lagent.agent.get('/api/leader/clinic')).body).toMatchObject({ people: 1, waiting: 1 });
    expect((await lagent.agent.post('/api/leader/clinic/send').set('X-CSRF-Token', lagent.csrf).send({})).body).toEqual({ sent: 1, alreadyHad: 0 });
    expect(await prisma.bookDelivery.count({ where: { personId: leaves.id } })).toBe(0);

    const all = await agent.post('/api/admin/cells/clinic/send-all').set('X-CSRF-Token', csrf).send({});
    expect(all.status).toBe(200);
    expect(await processClinicAutoSend(new Date(Date.now() + 60 * HOUR))).toBeGreaterThanOrEqual(0);
    expect(await prisma.bookDelivery.count({ where: { personId: leaves.id } })).toBe(0);

    // They subscribe again and are included from then on.
    await prisma.person.update({ where: { id: leaves.id }, data: { clinicBookUnsubscribedAt: null } });
    expect((await agent.post('/api/admin/cells/clinic/send-all').set('X-CSRF-Token', csrf).send({})).body).toMatchObject({ sent: 1 });
    expect(await prisma.bookDelivery.count({ where: { personId: leaves.id } })).toBe(1);
  });

  it('the member sees whether they are subscribed, can unsubscribe and subscribe again, and keeps a book already sent', async () => {
    const w = await world();
    const me = await w.member('Reader Rita');
    await prisma.bookDelivery.create({ data: { personId: me.id, bookId: w.book.id, via: 'ADMIN' } });
    const s = await memberSignIn(me.id);
    expect((await s.agent.get('/api/member/clinic')).body.subscribed).toBe(true);
    const off = await s.agent.put('/api/member/clinic/subscription').set('X-CSRF-Token', s.csrf).send({ subscribed: false });
    expect(off.body).toEqual({ subscribed: false });
    expect((await s.agent.get('/api/member/clinic')).body.subscribed).toBe(false);
    expect((await prisma.person.findUniqueOrThrow({ where: { id: me.id } })).clinicBookUnsubscribedAt).not.toBeNull();
    // The book they already have stays theirs.
    expect(await prisma.bookDelivery.count({ where: { personId: me.id } })).toBe(1);
    expect((await s.agent.put('/api/member/clinic/subscription').set('X-CSRF-Token', s.csrf).send({ subscribed: true })).body).toEqual({ subscribed: true });
    expect((await s.agent.get('/api/member/clinic')).body.subscribed).toBe(true);
    expect((await s.agent.put('/api/member/clinic/subscription').set('X-CSRF-Token', s.csrf).send({ subscribed: 'yes' })).status).toBe(400);
  });
});

describe('a teaching points at the part of the book', () => {
  it('the central admin maps the portion; a member who was sent the book can open it, another sees it cannot yet', async () => {
    const w = await world();
    const owner = await w.member('Owner');
    await prisma.user.update({ where: { id: w.admin.id }, data: { personId: owner.id } });
    const conv = await prisma.conversation.create({ data: { communityId: w.hq.id } });
    const message = await prisma.message.create({ data: { conversationId: conv.id, senderPersonId: owner.id, body: 'Teaching' } });
    const assessment = await prisma.assessment.create({ data: { titleEn: 'Quiz', passMark: 70, status: 'PUBLISHED' } });
    const teaching = await prisma.teaching.create({ data: { communityId: w.hq.id, messageId: message.id, assessmentId: assessment.id, authorPersonId: owner.id, title: 'Authority', text: 'x', closesAt: new Date(Date.now() + 7 * 24 * HOUR) } });
    const got = await w.member('Got it');
    const lacks = await w.member('Lacks it');
    await prisma.bookDelivery.create({ data: { personId: got.id, bookId: w.book.id, via: 'LEADER' } });

    const mo = await memberSignIn(owner.id);
    const put = await mo.agent.put(`/api/teachings/${teaching.id}/portion`).set('X-CSRF-Token', mo.csrf).send({ portion: { bookId: w.book.id, page: 12, label: 'Chapter 3: Authority' } });
    expect(put.status).toBe(200);

    const mg = await memberSignIn(got.id);
    const ml = await memberSignIn(lacks.id);
    expect((await mg.agent.get(`/api/teachings/${teaching.id}`)).body.portion).toEqual({ bookId: w.book.id, page: 12, label: 'Chapter 3: Authority', canOpen: true });
    expect((await ml.agent.get(`/api/teachings/${teaching.id}`)).body.portion.canOpen).toBe(false);
    // Only the central admin can map it.
    expect((await mg.agent.put(`/api/teachings/${teaching.id}/portion`).set('X-CSRF-Token', mg.csrf).send({ portion: null })).status).toBe(403);
    // And clear it.
    await mo.agent.put(`/api/teachings/${teaching.id}/portion`).set('X-CSRF-Token', mo.csrf).send({ portion: null });
    expect((await mg.agent.get(`/api/teachings/${teaching.id}`)).body.portion).toBeNull();
  });
});
