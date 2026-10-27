import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';

vi.mock('../lib/storage', async () => {
  const actual = await vi.importActual<typeof import('../lib/storage')>('../lib/storage');
  return {
    ...actual,
    isStorageConfigured: () => true,
    headObject: vi.fn(async () => ({ contentLength: 1000, contentType: 'audio/webm' })),
  };
});

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { generateStorageKey } from '../lib/attachmentPolicy';
import { bootstrap } from './testUtils';

// Events and attendance: a leader adds an event to an assembly, members say
// "I will come" and "I'm here" (with the code), the leader sees the sheet, and a
// recorded teaching attached to the event counts as present by replay.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;

function agentWithIp() {
  n += 1;
  const raw = request.agent(app);
  const ip = `10.144.${Math.floor(n / 256)}.${n % 256}`;
  const methods = ['get', 'post', 'patch', 'put', 'delete'] as const;
  const w = {} as Record<(typeof methods)[number], (p: string) => request.Test>;
  for (const m of methods) w[m] = (p: string) => raw[m](p).set('X-Forwarded-For', ip);
  return w;
}

async function signedIn(name: string, opts: { admin?: boolean; communityId?: string; leaderOf?: string } = {}) {
  n += 1;
  const email = `evt${n}@example.com`;
  const person = await prisma.person.create({
    data: { name: `${name} ${n}`, whatsappNumber: `+2376580${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() },
  });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (opts.admin) await prisma.user.create({ data: { name: 'Central Admin', email: `evt-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
  if (opts.communityId) await prisma.communityMembership.create({ data: { personId: person.id, communityId: opts.communityId, status: 'ACTIVE' } });

  if (opts.leaderOf) {
    const boss = await prisma.user.create({ data: { name: 'Boss', email: `evt-boss-${n}@test.local`, passwordHash: 'x', role: 'ADMIN' } });
    await prisma.roleAssignment.create({ data: { personId: person.id, roleType: 'SCOPED_LEADER', communityId: opts.leaderOf, assignedByUserId: boss.id } });
  }

  const agent = agentWithIp();
  const { csrf } = await bootstrap(agent as any);
  if (opts.admin) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await agent.post('/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  } else {
    await agent.post('/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  }
  return { person, agent, csrf };
}
type Who = Awaited<ReturnType<typeof signedIn>>;


const QUESTIONS = [{ textEn: 'Who is the teaching about?', options: [{ textEn: 'Jesus', isCorrect: true }, { textEn: 'Paul', isCorrect: false }] }];

async function community(name = 'Events Test') {
  return prisma.community.create({ data: { name: `${name} ${n++}` } });
}

const HOUR = 60 * 60 * 1000;
const send = (who: Who, method: 'post' | 'put' | 'patch' | 'delete', path: string, body: Record<string, unknown> = {}) => who.agent[method](path).set('X-CSRF-Token', who.csrf).send(body);

async function addEvent(who: Who, communityId: string, over: Record<string, unknown> = {}) {
  return send(who, 'post', '/api/events', { communityId, title: 'Sunday service', startsAt: new Date(Date.now() + 5 * HOUR).toISOString(), ...over });
}

/** Moves an event so that it is happening now (the "I'm here" window is open). */
async function startNow(eventId: string) {
  await prisma.assemblyEvent.update({ where: { id: eventId }, data: { startsAt: new Date(Date.now() - 10 * 60_000), endsAt: new Date(Date.now() + 100 * 60_000) } });
}

afterEach(() => vi.restoreAllMocks());

describe('Adding events', () => {
  it('leaders of the assembly and the central admin can add events; members cannot; members of the assembly are told', async () => {
    const c = await community();
    const other = await community('Other');
    const leader = await signedIn('Leader', { communityId: c.id, leaderOf: c.id });
    const member = await signedIn('Member', { communityId: c.id });
    const admin = await signedIn('Admin', { admin: true });

    expect((await addEvent(member, c.id)).status).toBe(403);
    expect((await addEvent(leader, other.id)).status).toBe(403); // leads another assembly, not this one
    const made = await addEvent(leader, c.id, { title: 'Prayer night', location: 'Main hall', onlineUrl: 'https://youtube.com/live/x', description: 'Come and pray' });
    expect(made.status).toBe(201);
    expect((await addEvent(admin, other.id)).status).toBe(201); // the central admin may in any assembly

    const note = await prisma.notification.findFirst({ where: { recipientPersonId: member.person.id, type: 'EVENT_NEW' } });
    expect(note?.targetId).toBe(made.body.id);
    // The one who added it is not told about their own event.
    expect(await prisma.notification.count({ where: { recipientPersonId: leader.person.id, type: 'EVENT_NEW' } })).toBe(0);

    const list = await member.agent.get('/api/events');
    expect(list.body.upcoming.map((e: any) => [e.title, e.communityName === c.name, e.going])).toEqual([['Prayer night', true, false]]);
    expect(list.body.creatable).toEqual([]);
    expect((await leader.agent.get('/api/events')).body.creatable).toEqual([{ id: c.id, name: c.name }]);
  });

  it('checks the details: a title, an end after the start, a date within a year, an http link', async () => {
    const c = await community();
    const leader = await signedIn('Leader', { communityId: c.id, leaderOf: c.id });
    expect((await addEvent(leader, c.id, { title: '' })).status).toBe(400);
    expect((await addEvent(leader, c.id, { endsAt: new Date(Date.now() + HOUR).toISOString() })).status).toBe(400);
    expect((await addEvent(leader, c.id, { startsAt: new Date(Date.now() + 400 * 24 * HOUR).toISOString() })).status).toBe(400);
    expect((await addEvent(leader, c.id, { onlineUrl: 'javascript:alert(1)' })).status).toBe(400);
  });

  it('only people of the assembly can see its events; the leader sees the code, members do not', async () => {
    const c = await community();
    const leader = await signedIn('Leader', { communityId: c.id, leaderOf: c.id });
    const member = await signedIn('Member', { communityId: c.id });
    const stranger = await signedIn('Stranger');
    const made = await addEvent(leader, c.id);
    expect((await stranger.agent.get(`/api/events/${made.body.id}`)).status).toBe(404);
    expect((await stranger.agent.get('/api/events')).body.upcoming).toEqual([]);
    const asLeader = await leader.agent.get(`/api/events/${made.body.id}`);
    expect(asLeader.body.checkInCode).toMatch(/^\d{4}$/);
    expect(asLeader.body.canManage).toBe(true);
    const asMember = await member.agent.get(`/api/events/${made.body.id}`);
    expect(asMember.body.checkInCode).toBeUndefined();
    expect(asMember.body.canManage).toBe(false);
    expect((await member.agent.get(`/api/events/${made.body.id}/attendance`)).status).toBe(403);
  });
});

describe('"I will come" and "I\'m here"', () => {
  it('members say they will come (and can change their mind); it is counted', async () => {
    const c = await community();
    const leader = await signedIn('Leader', { communityId: c.id, leaderOf: c.id });
    const a = await signedIn('Ann', { communityId: c.id });
    const b = await signedIn('Ben', { communityId: c.id });
    const made = await addEvent(leader, c.id);
    expect((await send(a, 'put', `/api/events/${made.body.id}/rsvp`)).body).toEqual({ going: true, goingCount: 1 });
    expect((await send(a, 'put', `/api/events/${made.body.id}/rsvp`)).body.goingCount).toBe(1);
    expect((await send(b, 'put', `/api/events/${made.body.id}/rsvp`)).body.goingCount).toBe(2);
    expect((await a.agent.get(`/api/events/${made.body.id}`)).body).toMatchObject({ going: true, goingCount: 2 });
    expect((await send(a, 'delete', `/api/events/${made.body.id}/rsvp`)).body).toEqual({ going: false, goingCount: 1 });
  });

  it('"I\'m here" works only with the right code, only while the event is open, and only once', async () => {
    const c = await community();
    const leader = await signedIn('Leader', { communityId: c.id, leaderOf: c.id });
    const m = await signedIn('Member', { communityId: c.id });
    const made = await addEvent(leader, c.id);
    const code = (await leader.agent.get(`/api/events/${made.body.id}`)).body.checkInCode as string;

    // Too early: opens half an hour before the start.
    const early = await send(m, 'post', `/api/events/${made.body.id}/check-in`, { code });
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('NOT_OPEN_YET');

    await startNow(made.body.id);
    const wrong = await send(m, 'post', `/api/events/${made.body.id}/check-in`, { code: code === '0000' ? '1111' : '0000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('WRONG_CODE');
    expect((await send(m, 'post', `/api/events/${made.body.id}/check-in`, { code })).body).toEqual({ present: true });
    expect((await send(m, 'post', `/api/events/${made.body.id}/check-in`, { code })).status).toBe(200); // again is harmless
    expect(await prisma.eventAttendance.count({ where: { eventId: made.body.id } })).toBe(1);
    expect((await m.agent.get(`/api/events/${made.body.id}`)).body.mine).toEqual({ live: 'SELF', replayDone: false });

    // After the event is over it closes.
    await prisma.assemblyEvent.update({ where: { id: made.body.id }, data: { startsAt: new Date(Date.now() - 5 * HOUR), endsAt: new Date(Date.now() - 3 * HOUR) } });
    const late = await send(m, 'post', `/api/events/${made.body.id}/check-in`, { code });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('CLOSED');
  });

  it('a cancelled event takes no more "I will come" or "I\'m here"', async () => {
    const c = await community();
    const leader = await signedIn('Leader', { communityId: c.id, leaderOf: c.id });
    const m = await signedIn('Member', { communityId: c.id });
    const made = await addEvent(leader, c.id);
    expect((await send(m, 'post', `/api/events/${made.body.id}/cancel`)).status).toBe(403);
    expect((await send(leader, 'post', `/api/events/${made.body.id}/cancel`)).status).toBe(200);
    expect((await send(m, 'put', `/api/events/${made.body.id}/rsvp`)).body.code).toBe('CANCELLED');
    expect((await m.agent.get('/api/events')).body.upcoming[0].cancelled).toBe(true);
  });
});

describe('The attendance sheet', () => {
  it('shows who came (typed the code, or ticked by the leader), who said they would, and lets the leader tick and untick', async () => {
    const c = await community();
    const leader = await signedIn('Leader', { communityId: c.id, leaderOf: c.id });
    const ann = await signedIn('Ann', { communityId: c.id });
    const ben = await signedIn('Ben', { communityId: c.id });
    const cleo = await signedIn('Cleo', { communityId: c.id });
    const made = await addEvent(leader, c.id);
    await startNow(made.body.id);
    const code = (await leader.agent.get(`/api/events/${made.body.id}`)).body.checkInCode as string;
    await send(ann, 'put', `/api/events/${made.body.id}/rsvp`);
    await send(ann, 'post', `/api/events/${made.body.id}/check-in`, { code });
    await send(ben, 'put', `/api/events/${made.body.id}/rsvp`);
    // Cleo has no phone data: the leader ticks her.
    expect((await send(leader, 'put', `/api/events/${made.body.id}/attendance/${cleo.person.id}`, { present: true })).body.present).toBe(true);

    const sheet = await leader.agent.get(`/api/events/${made.body.id}/attendance`);
    expect(sheet.body.totals).toMatchObject({ members: 4, going: 2, present: 2, live: 2, replay: 0 });
    const by = (name: string) => sheet.body.items.find((i: any) => i.name.startsWith(name));
    expect(by('Ann')).toMatchObject({ going: true, live: 'SELF', present: true });
    expect(by('Cleo')).toMatchObject({ going: false, live: 'LEADER', present: true });
    expect(by('Ben')).toMatchObject({ going: true, live: null, present: false });
    expect((await leader.agent.get(`/api/events/${made.body.id}`)).body.presentCount).toBe(2);

    // A wrong tick can be taken back; members cannot tick anyone.
    expect((await send(leader, 'put', `/api/events/${made.body.id}/attendance/${cleo.person.id}`, { present: false })).body.present).toBe(false);
    expect((await send(ann, 'put', `/api/events/${made.body.id}/attendance/${ben.person.id}`, { present: true })).status).toBe(403);
    const outsider = await signedIn('Outsider');
    expect((await send(leader, 'put', `/api/events/${made.body.id}/attendance/${outsider.person.id}`, { present: true })).status).toBe(404);
  });

  it('counts a member as present by replay once they finish the teaching attached to the event', async () => {
    const c = await community();
    const admin = await signedIn('Coordinator', { admin: true });
    const leader = await signedIn('Leader', { communityId: c.id, leaderOf: c.id });
    const ann = await signedIn('Ann', { communityId: c.id });
    const ben = await signedIn('Ben', { communityId: c.id });
    const teaching = await admin.agent
      .post('/api/teachings')
      .set('X-CSRF-Token', admin.csrf)
      .send({ communityId: c.id, title: 'Sunday message', text: 'Love one another as I have loved you. '.repeat(12), questions: QUESTIONS, passMark: 50, openDays: 7 });
    expect(teaching.status).toBe(201);

    const options = await leader.agent.get(`/api/events/replay-options?communityId=${c.id}`);
    expect(options.body.items.map((t: any) => t.title)).toEqual(['Sunday message']);
    const other = await community('Elsewhere');
    expect((await addEvent(leader, c.id, { replayTeachingId: 'not-a-teaching' })).status).toBe(400);
    void other;
    const made = await addEvent(leader, c.id, { replayTeachingId: teaching.body.id, startsAt: new Date(Date.now() - 6 * HOUR).toISOString(), endsAt: new Date(Date.now() - 4 * HOUR).toISOString() });
    expect(made.status).toBe(201);

    // Ben came live; Ann watched the replay (read the whole teaching).
    await prisma.eventAttendance.create({ data: { eventId: made.body.id, personId: ben.person.id, method: 'LEADER' } });
    await ann.agent.post(`/api/teachings/${teaching.body.id}/progress`).set('X-CSRF-Token', ann.csrf).send({});
    await prisma.teachingProgress.updateMany({ where: { teachingId: teaching.body.id, personId: ann.person.id }, data: { openedAt: new Date(Date.now() - 5 * 60_000) } });
    await ann.agent.post(`/api/teachings/${teaching.body.id}/progress`).set('X-CSRF-Token', ann.csrf).send({ textRead: true });

    const sheet = await leader.agent.get(`/api/events/${made.body.id}/attendance`);
    expect(sheet.body.totals).toMatchObject({ present: 2, live: 1, replay: 1 });
    expect(sheet.body.items.find((i: any) => i.name.startsWith('Ann'))).toMatchObject({ live: null, replay: true, present: true });
    expect((await ann.agent.get(`/api/events/${made.body.id}`)).body).toMatchObject({ mine: { live: null, replayDone: true }, replay: { teachingId: teaching.body.id, title: 'Sunday message' } });
    expect((await ann.agent.get('/api/events')).body.past[0].presence).toBe('REPLAY');
    expect((await ben.agent.get('/api/events')).body.past[0].presence).toBe('LIVE');
  });

  it('summarises the last events per member, those who came least first', async () => {
    const c = await community();
    const leader = await signedIn('Leader', { communityId: c.id, leaderOf: c.id });
    const ann = await signedIn('Ann', { communityId: c.id });
    const ben = await signedIn('Ben', { communityId: c.id });
    const past = async (title: string, daysAgo: number) =>
      (await addEvent(leader, c.id, { title, startsAt: new Date(Date.now() - daysAgo * 24 * HOUR).toISOString(), endsAt: new Date(Date.now() - daysAgo * 24 * HOUR + 2 * HOUR).toISOString() })).body.id as string;
    const e1 = await past('One', 21);
    const e2 = await past('Two', 14);
    const e3 = await past('Three', 7);
    for (const e of [e1, e2, e3]) await prisma.eventAttendance.create({ data: { eventId: e, personId: ann.person.id, method: 'LEADER' } });
    await prisma.eventAttendance.create({ data: { eventId: e3, personId: ben.person.id, method: 'SELF' } });

    const summary = await leader.agent.get(`/api/events/summary?communityId=${c.id}`);
    expect(summary.body.total).toBe(3);
    expect(summary.body.items.map((r: any) => [r.name.split(' ')[0], r.present])).toEqual([['Leader', 0], ['Ben', 1], ['Ann', 3]]);
    expect((await ann.agent.get(`/api/events/summary?communityId=${c.id}`)).status).toBe(403);
  });
});

describe('Reminders', () => {
  it('tells the assembly once, about an hour before the event starts', async () => {
    const { processEventReminders } = await import('../lib/eventReminders');
    const c = await community();
    const leader = await signedIn('Leader', { communityId: c.id, leaderOf: c.id });
    const m = await signedIn('Member', { communityId: c.id });
    const soon = await addEvent(leader, c.id, { title: 'Soon', startsAt: new Date(Date.now() + 40 * 60_000).toISOString() });
    await addEvent(leader, c.id, { title: 'Far away', startsAt: new Date(Date.now() + 3 * 24 * HOUR).toISOString() });
    expect(await processEventReminders()).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { recipientPersonId: m.person.id, type: 'EVENT_REMINDER', targetId: soon.body.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { recipientPersonId: m.person.id, type: 'EVENT_REMINDER' } })).toBe(1);
    // Only once.
    await processEventReminders();
    expect(await prisma.notification.count({ where: { recipientPersonId: m.person.id, type: 'EVENT_REMINDER', targetId: soon.body.id } })).toBe(1);
    // A cancelled event is not announced.
    const gone = await addEvent(leader, c.id, { title: 'Gone', startsAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    await send(leader, 'post', `/api/events/${gone.body.id}/cancel`);
    await processEventReminders();
    expect(await prisma.notification.count({ where: { recipientPersonId: m.person.id, type: 'EVENT_REMINDER', targetId: gone.body.id } })).toBe(0);
  });
});
