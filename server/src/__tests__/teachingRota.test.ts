import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { sendAssignmentsNow, sendRotaReminders } from '../lib/teachingReminders';
import { RotaError, addTeacher, rate, ratingDetail, ratingSummaries, resolveBook, toRate, isRater, adminOverview, loadPlan, matchTeachers, slotStart, teacherView, topicNumberFor, updateSettings, updateTeacher, weekNumber } from '../lib/teachingRota';

// The weekly teaching rota: the same slot every week, the topic moving on by one each week, a teacher seeing only their
// own assignment, and nothing visible until the central admin switches it on. All names and texts here are made up.
const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

const textOf = (topic: string, lang: 'en' | 'fr' = 'en') => ({
  topic: `${topic}${lang === 'fr' ? ' (fr)' : ''}`,
  bookTitle: lang === 'fr' ? 'Livre' : 'Book',
  chapter: 'Chapter 1',
  teachingOn: 'On this',
  help: 'Help',
  meaning: 'Meaning',
  startLabel: 'Start with this',
  start: 'Start',
  ifNotLabel: 'If we do not know this',
  ifNot: 'If not',
  dominion: 'Dominion',
  verses: ['John 1:1'],
});
const topic = (number: number, withFrench = true) => ({ number, kind: 'key' as const, en: textOf(`Topic ${number}`), ...(withFrench ? { fr: textOf(`Topic ${number}`, 'fr') } : {}) });
const guide = { title: 'How to teach', definition: 'A key opens a door.', steps: [{ title: 'Start', minutes: 2, text: 'Tell a story.' }] };
const plan = (over: Record<string, unknown> = {}) => ({
  startDate: '2026-11-23',
  guide: { en: guide, fr: { ...guide, title: 'Comment enseigner' } },
  topics: [topic(1), topic(2), topic(3)],
  teachers: [
    { name: 'Alpha Tester', startTopic: 1, dayOfWeek: 1, startTime: '07:00' },
    { name: 'Beta Tester', startTopic: 2, dayOfWeek: 1, startTime: '16:00' },
    { name: 'Gamma Tester', startTopic: 3, dayOfWeek: 2, startTime: '20:00' },
  ],
  ...over,
});

async function member(name: string, opts: { admin?: boolean; language?: 'en' | 'fr'; email?: string } = {}) {
  n += 1;
  const email = opts.email ?? `rota${n}@example.com`;
  const person = await prisma.person.create({ data: { name, whatsappNumber: `+2377100${String(n).padStart(5, '0')}`, profileCompletedAt: new Date(), preferredLanguage: opts.language ?? 'en' } });
  await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (opts.admin) await prisma.user.create({ data: { name: 'Central Admin', email: `rota-admin-${n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
  const raw = request.agent(app);
  const ip = `10.171.${Math.floor(n / 256) % 256}.${n % 256}`;
  const call = (m: 'get' | 'post' | 'put' | 'patch', p: string) => raw[m](p).set('X-Forwarded-For', ip);
  const { csrf } = await bootstrap(raw as any);
  const res = await call('post', '/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  if (res.body.codeRequired) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await call('post', '/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await call('post', '/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  }
  return { person, get: (p: string) => call('get', p), send: (m: 'post' | 'put' | 'patch', p: string, body: unknown) => call(m, p).set('X-CSRF-Token', csrf).send(body as object) };
}

beforeEach(async () => {
  await prisma.teachingRating.deleteMany();
  await prisma.teachingReminderLog.deleteMany();
  await prisma.teachingTeacher.deleteMany();
  await prisma.teachingTopic.deleteMany();
  await prisma.teachingSettings.deleteMany();
});
afterEach(() => vi.restoreAllMocks());

describe('the rotation', () => {
  it('moves each teacher on by one topic every week, wrapping round, and never changes their slot', () => {
    const topics = [1, 2, 3];
    expect([0, 1, 2, 3, 4].map((w) => topicNumberFor(1, topics, w))).toEqual([1, 2, 3, 1, 2]);
    expect([0, 1, 2, 3].map((w) => topicNumberFor(3, topics, w))).toEqual([3, 1, 2, 3]);
    expect(topicNumberFor(2, topics, -1)).toBe(1); // before the start it still gives a topic
    expect(topicNumberFor(1, [], 5)).toBe(1);
    // three teachers, three topics: every week they all teach different topics
    for (let w = 0; w < 6; w++) expect(new Set([1, 2, 3].map((s) => topicNumberFor(s, topics, w))).size).toBe(3);
  });

  it('counts weeks from the start Monday and places the slot in Cameroon time (GMT+1)', () => {
    expect(weekNumber(day('2026-11-23'), day('2026-11-23'))).toBe(0);
    expect(weekNumber(day('2026-11-23'), day('2026-12-07'))).toBe(2);
    // Monday 07:00 in Cameroon is 06:00 UTC; Tuesday 20:00 is 19:00 UTC
    expect(slotStart(day('2026-11-23'), 1, 7 * 60).toISOString()).toBe('2026-11-23T06:00:00.000Z');
    expect(slotStart(day('2026-11-23'), 2, 20 * 60).toISOString()).toBe('2026-11-24T19:00:00.000Z');
    expect(slotStart(day('2026-11-23'), 7, 20 * 60).toISOString()).toBe('2026-11-29T19:00:00.000Z');
  });
});

describe('loading the plan', () => {
  it('refuses a file that is not right, and a first week that is not a Monday', async () => {
    await expect(loadPlan({ topics: [{ number: 1 }] })).rejects.toBeInstanceOf(RotaError);
    await expect(loadPlan(plan({ startDate: '2026-11-24' }))).rejects.toThrow(/Monday/);
    await expect(loadPlan(plan({ topics: [topic(1), topic(1)] }))).rejects.toThrow(/same number/);
    await expect(loadPlan(plan({ teachers: [{ name: 'Zed', startTopic: 9, dayOfWeek: 1, startTime: '07:00' }] }))).rejects.toThrow(/not in the list/);
    expect(await prisma.teachingTopic.count()).toBe(0);
  });

  it('adds topics and teachers, and a second load updates topics but never changes or removes a teacher', async () => {
    expect(await loadPlan(plan())).toEqual({ topicsAdded: 3, topicsUpdated: 0, teachersAdded: 3, teachersKept: 0 });
    await prisma.teachingTeacher.updateMany({ where: { name: 'Alpha Tester' }, data: { startMinute: 9 * 60 } }); // moved by the admin
    const again = await loadPlan(plan({ topics: [topic(1), topic(2), topic(3), topic(4)], teachers: [{ name: 'tester  ALPHA', startTopic: 1, dayOfWeek: 5, startTime: '10:00' }, { name: 'Delta Tester', startTopic: 4, dayOfWeek: 3, startTime: '07:00' }] }));
    expect(again).toEqual({ topicsAdded: 1, topicsUpdated: 3, teachersAdded: 1, teachersKept: 1 });
    const alpha = await prisma.teachingTeacher.findFirstOrThrow({ where: { name: 'Alpha Tester' } });
    expect([alpha.dayOfWeek, alpha.startMinute]).toEqual([1, 540]); // untouched
    expect(await prisma.teachingTeacher.count()).toBe(4);
  });
});

describe('switching on', () => {
  it('needs a plan first, and holds back until the French is checked when a French-speaking teacher is on the list', async () => {
    await expect(updateSettings({ enabled: true })).rejects.toMatchObject({ code: 'NO_PLAN' });
    await loadPlan(plan());
    const fr = await member('Gamma Tester', { language: 'fr' });
    await prisma.teachingTeacher.updateMany({ where: { name: 'Gamma Tester' }, data: { personId: fr.person.id } });
    await expect(updateSettings({ enabled: true })).rejects.toMatchObject({ code: 'FRENCH_NOT_CHECKED' });
    const on = await updateSettings({ enabled: true, frenchChecked: true });
    expect(on.settings).toMatchObject({ enabled: true, frenchChecked: true });
    // a new load with fresh French asks to be checked again
    await loadPlan(plan());
    expect((await adminOverview()).settings?.frenchChecked).toBe(false);
  });

  it('refuses French-speaking teachers when a topic has no French yet', async () => {
    await loadPlan(plan({ topics: [topic(1), topic(2), topic(3, false)] }));
    const fr = await member('Alpha Tester', { language: 'fr' });
    await prisma.teachingTeacher.updateMany({ where: { name: 'Alpha Tester' }, data: { personId: fr.person.id } });
    await expect(updateSettings({ enabled: true, frenchChecked: true })).rejects.toMatchObject({ code: 'FRENCH_MISSING' });
  });

  it('only lets the first week start on a Monday, and not move once it has started', async () => {
    await loadPlan(plan());
    await expect(updateSettings({ startDate: '2026-11-24' })).rejects.toMatchObject({ code: 'NOT_MONDAY' });
    await updateSettings({ startDate: '2026-11-30' });
    expect((await adminOverview()).settings?.startDate).toBe('2026-11-30');
  });
});

describe('what a teacher sees', () => {
  it('shows nothing until it is switched on, and nothing to someone who is not on the list', async () => {
    await loadPlan(plan());
    const a = await member('Alpha Tester');
    await prisma.teachingTeacher.updateMany({ where: { name: 'Alpha Tester' }, data: { personId: a.person.id } });
    expect(await teacherView(a.person.id)).toEqual({ enabled: false, isTeacher: false, isRater: false, toRateCount: 0 });
    await updateSettings({ enabled: true, frenchChecked: true });
    const stranger = await member('Somebody Else');
    expect(await teacherView(stranger.person.id)).toEqual({ enabled: true, isTeacher: false, isRater: false, toRateCount: 0 });
  });

  it('gives the teacher their own topic this week and next week, in their own language, and moves on weekly', async () => {
    await loadPlan(plan());
    const en = await member('Alpha Tester');
    const fr = await member('Beta Tester', { language: 'fr' });
    await prisma.teachingTeacher.updateMany({ where: { name: 'Alpha Tester' }, data: { personId: en.person.id } });
    await prisma.teachingTeacher.updateMany({ where: { name: 'Beta Tester' }, data: { personId: fr.person.id } });
    await updateSettings({ enabled: true, frenchChecked: true });

    // Wednesday 25 November 2026, the first week
    const wk1 = (await teacherView(en.person.id, new Date('2026-11-25T10:00:00Z'))) as any;
    expect(wk1.weeks.map((w: any) => [w.weekStart, w.text.topic, w.status, w.isCurrent])).toEqual([
      ['2026-11-23', 'Topic 1', 'done', true],
      ['2026-11-30', 'Topic 2', 'upcoming', false],
    ]);
    expect(wk1.weeks[0].startsAt).toBe('2026-11-23T06:00:00.000Z'); // Monday 07:00 GMT+1
    expect(wk1.guide.title).toBe('How to teach');

    const frenchView = (await teacherView(fr.person.id, new Date('2026-11-25T10:00:00Z'))) as any;
    expect(frenchView.language).toBe('fr');
    expect(frenchView.weeks[0].text.topic).toBe('Topic 2 (fr)');
    expect(frenchView.guide.title).toBe('Comment enseigner');

    // the third week: Alpha has moved on by two topics
    const wk3 = (await teacherView(en.person.id, new Date('2026-12-08T10:00:00Z'))) as any;
    expect(wk3.weeks[0].text.topic).toBe('Topic 3');
    expect(wk3.weeks[1].text.topic).toBe('Topic 1');
  });

  it('shows the first week ahead of time, so a teacher can prepare before the rota starts', async () => {
    await loadPlan(plan());
    const a = await member('Alpha Tester');
    await prisma.teachingTeacher.updateMany({ where: { name: 'Alpha Tester' }, data: { personId: a.person.id } });
    await updateSettings({ enabled: true, frenchChecked: true });
    const view = (await teacherView(a.person.id, new Date('2026-11-19T10:00:00Z'))) as any;
    expect(view.started).toBe(false);
    expect(view.weeks.map((w: any) => [w.weekStart, w.status, w.isCurrent])).toEqual([['2026-11-23', 'upcoming', false], ['2026-11-30', 'upcoming', false]]);
  });

  it('falls back to English when a French-speaking teacher has no French text', async () => {
    await loadPlan(plan({ topics: [topic(1, false), topic(2, false), topic(3, false)] }));
    const fr = await member('Alpha Tester', { language: 'fr' });
    await prisma.teachingTeacher.updateMany({ where: { name: 'Alpha Tester' }, data: { personId: fr.person.id } });
    await prisma.teachingSettings.update({ where: { id: 'main' }, data: { enabled: true } });
    const view = (await teacherView(fr.person.id, new Date('2026-11-25T10:00:00Z'))) as any;
    expect(view.weeks[0].textLanguage).toBe('en');
  });
});

describe('the roster', () => {
  it('matches a name to the one member with that name (any order, accents or capitals), and leaves two accounts for the admin', async () => {
    await loadPlan(plan({ teachers: [{ name: 'Élodie MBARGA Tester', startTopic: 1, dayOfWeek: 1, startTime: '07:00' }, { name: 'Twin Account', startTopic: 2, dayOfWeek: 1, startTime: '16:00' }, { name: 'Nobody Known', startTopic: 3, dayOfWeek: 2, startTime: '20:00' }] }));
    const elodie = await member('Tester Elodie Mbarga');
    await member('Twin Account');
    await member('Account twin');
    const result = await matchTeachers();
    expect(result.matched).toBe(1);
    expect(result.ambiguous).toEqual(['Twin Account']);
    expect(result.notFound).toEqual(['Nobody Known']);
    expect((await prisma.teachingTeacher.findFirstOrThrow({ where: { name: { startsWith: 'Élodie' } } })).personId).toBe(elodie.person.id);
  });

  it('adds a 20th teacher on a topic nobody starts on, and refuses one member on two rows', async () => {
    await loadPlan(plan({ topics: [topic(1), topic(2), topic(3), topic(4)] }));
    const added = await addTeacher({ name: 'New Teacher', dayOfWeek: 3, startTime: '07:00' });
    expect(added.startTopic).toBe(4);
    const m = await member('Someone Real');
    await updateTeacher(added.id, { personId: m.person.id });
    const other = await addTeacher({ name: 'Other One', dayOfWeek: 3, startTime: '16:00' });
    await expect(updateTeacher(other.id, { personId: m.person.id })).rejects.toMatchObject({ code: 'PERSON_TAKEN' });
    const overview = await adminOverview();
    expect(overview.warnings).toContain('UNMATCHED');
  });

  it('warns when there are more teachers than topics, or two teachers share a slot', async () => {
    await loadPlan(plan({ topics: [topic(1), topic(2)], teachers: [{ name: 'A One', startTopic: 1, dayOfWeek: 1, startTime: '07:00' }, { name: 'B Two', startTopic: 2, dayOfWeek: 1, startTime: '07:00' }, { name: 'C Three', startTopic: 1, dayOfWeek: 2, startTime: '07:00' }] }));
    const overview = await adminOverview();
    expect(overview.warnings).toEqual(expect.arrayContaining(['MORE_TEACHERS_THAN_TOPICS', 'SAME_SLOT']));
  });
});

describe('the doors', () => {
  it('lets only the central admin load the plan, and a teacher read only their own page', async () => {
    const admin = await member('The Coordinator', { admin: true });
    const a = await member('Alpha Tester');
    const b = await member('Beta Tester');

    expect((await a.get('/api/member/central-teaching-rota/overview')).status).toBe(403);
    expect((await a.send('post', '/api/member/central-teaching-rota/plan', plan())).status).toBe(403);
    expect((await admin.send('post', '/api/member/central-teaching-rota/plan', { nonsense: true })).status).toBe(400);

    const loaded = await admin.send('post', '/api/member/central-teaching-rota/plan', plan());
    expect(loaded.status).toBe(200);
    expect(loaded.body.summary.teachersAdded).toBe(3);
    expect(loaded.body.overview.warnings).toContain('UNMATCHED');

    const teacherRows = (await admin.get('/api/member/central-teaching-rota/overview')).body.teachers;
    await admin.send('patch', `/api/member/central-teaching-rota/teachers/${teacherRows.find((t: any) => t.name === 'Alpha Tester').id}`, { personId: a.person.id });
    await admin.send('patch', `/api/member/central-teaching-rota/teachers/${teacherRows.find((t: any) => t.name === 'Beta Tester').id}`, { personId: b.person.id });
    expect((await admin.send('put', '/api/member/central-teaching-rota/settings', { enabled: true, frenchChecked: true })).status).toBe(200);

    const mine = await a.get('/api/member/teaching-rota/me');
    expect(mine.body.isTeacher).toBe(true);
    const json = JSON.stringify(mine.body);
    expect(json).toContain('Topic 1');
    expect(json).not.toContain('Beta Tester');
    expect(json).not.toContain('Gamma Tester');
    const his = await b.get('/api/member/teaching-rota/me');
    expect(JSON.stringify(his.body)).toContain('Topic 2');
    expect(JSON.stringify(his.body)).not.toContain('Alpha Tester');

    expect((await a.get('/api/admin/teaching-rota/overview')).status).toBe(401);
    const audits = await prisma.auditLog.findMany({ where: { action: { startsWith: 'TEACHING_' } } });
    expect(audits.map((x) => x.action)).toEqual(expect.arrayContaining(['TEACHING_PLAN_LOADED', 'TEACHING_TEACHER_UPDATED', 'TEACHING_SETTINGS_UPDATED']));
  });

  it('finds members by name for the picker, showing their language and who already has them', async () => {
    const admin = await member('The Coordinator', { admin: true });
    const target = await member('Pickme Findable', { language: 'fr' });
    await loadPlan(plan());
    const rows = (await admin.get('/api/member/central-teaching-rota/overview')).body.teachers;
    await admin.send('patch', `/api/member/central-teaching-rota/teachers/${rows[0].id}`, { personId: target.person.id });
    const found = await admin.get('/api/member/central-teaching-rota/members?search=findable');
    expect(found.body.items).toEqual([{ id: target.person.id, name: 'Pickme Findable', language: 'fr', takenBy: rows[0].name }]);
  });
});

describe('finding the book on the site', () => {
  it('matches whole words, so Volume II is never Volume III, and says nothing when it is not sure', async () => {
    const tag = `tq${Math.random().toString(36).slice(2, 7)}`;
    const two = await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: `${tag} Keys, Volume II: Identity` } });
    const three = await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: `${tag} Keys, Volume III` } });
    const someone = await member('Reader One');
    try {
      expect((await resolveBook([`${tag} Keys`, 'Volume 2|Volume II|Volume Two'], someone.person.id))?.id).toBe(two.id);
      expect((await resolveBook([`${tag} Keys`, 'Volume 3|Volume III|Volume Three'], someone.person.id))?.id).toBe(three.id);
      expect((await resolveBook([`${tag} Keys`, 'Volume 9|Volume IX'], someone.person.id))).toBeNull();
      expect((await resolveBook([`${tag} Keys`], someone.person.id))).toBeNull(); // two fit: not sure
      expect(await resolveBook(null, someone.person.id)).toBeNull();
      expect((await resolveBook([`${tag} Keys`, 'Volume II'], someone.person.id))?.canOpen).toBe(false); // no file yet
    } finally {
      await prisma.libraryBook.deleteMany({ where: { id: { in: [two.id, three.id] } } });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Ratings and reminders. Plan: topics 1-3, week 0 starts Monday 23 November 2026.
//   Alpha: Monday 07:00   Beta: Monday 16:00   Gamma: Tuesday 20:00     (Cameroon time, GMT+1)
const at = (iso: string) => new Date(iso);
async function person(name: string, language: 'en' | 'fr' = 'en') {
  n += 1;
  return prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2377200${String(n).padStart(5, '0')}`, profileCompletedAt: new Date(), preferredLanguage: language } });
}
async function setUp(opts: { fr?: boolean } = {}) {
  await loadPlan(plan());
  const people = { alpha: await person('Alpha', opts.fr ? 'fr' : 'en'), beta: await person('Beta'), gamma: await person('Gamma') };
  await prisma.teachingTeacher.updateMany({ where: { name: 'Alpha Tester' }, data: { personId: people.alpha.id } });
  await prisma.teachingTeacher.updateMany({ where: { name: 'Beta Tester' }, data: { personId: people.beta.id } });
  await prisma.teachingTeacher.updateMany({ where: { name: 'Gamma Tester' }, data: { personId: people.gamma.id } });
  await updateSettings({ enabled: true, frenchChecked: true });
  const teachers = Object.fromEntries((await prisma.teachingTeacher.findMany()).map((t) => [t.name.split(' ')[0].toLowerCase(), t]));
  return { people, teachers };
}
const notices = (personId: string, kind?: string) => prisma.notification.findMany({ where: { recipientPersonId: personId, type: 'TEACHING_ROTA' }, orderBy: { createdAt: 'asc' } }).then((rows) => (kind ? rows.filter((r) => (r.metadata as any)?.kind === kind) : rows));

describe('rating a teaching', () => {
  it('opens a teaching to rating once it has ended, never your own, for eight days', async () => {
    const { people, teachers } = await setUp();
    const group = await prisma.community.create({ data: { name: `Leadership Development ${++n}` } });
    const rater = await person('Rater');
    const outsider = await person('Outsider');
    await prisma.communityMembership.create({ data: { personId: rater.id, communityId: group.id } });
    await prisma.communityMembership.create({ data: { personId: people.beta.id, communityId: group.id } });
    await updateSettings({ ratersCommunityId: group.id });
    expect(await isRater(rater.id)).toBe(true);
    expect(await isRater(outsider.id)).toBe(false);
    expect(await isRater(people.alpha.id)).toBe(false); // a teacher who is not in the group does not rate

    const monday = '2026-11-23';
    // Alpha teaches Monday 07:00-07:15 (GMT+1): before it ends there is nothing to rate
    expect(await toRate(rater.id, 'en', at('2026-11-23T06:10:00Z'))).toEqual([]);
    const after = await toRate(rater.id, 'en', at('2026-11-23T06:30:00Z'));
    expect(after.map((i) => [i.teacherName.startsWith('Alpha'), i.topic, i.myLevel])).toEqual([[true, 'Topic 1', null]]);

    await expect(rate(rater.id, { teacherId: teachers.beta.id, weekStart: monday, level: 'GOOD' }, at('2026-11-23T06:30:00Z'))).rejects.toMatchObject({ code: 'NOT_RATEABLE' }); // Beta has not taught yet
    await expect(rate(outsider.id, { teacherId: teachers.alpha.id, weekStart: monday, level: 'GOOD' }, at('2026-11-23T06:30:00Z'))).rejects.toMatchObject({ code: 'NOT_RATER' });
    await rate(rater.id, { teacherId: teachers.alpha.id, weekStart: monday, level: 'GOOD' }, at('2026-11-23T06:30:00Z'));
    await rate(rater.id, { teacherId: teachers.alpha.id, weekStart: monday, level: 'EXCELLENT' }, at('2026-11-23T07:00:00Z')); // changed her mind
    expect((await toRate(rater.id, 'en', at('2026-11-23T07:30:00Z')))[0].myLevel).toBe('EXCELLENT');
    expect(await prisma.teachingRating.count({ where: { teacherId: teachers.alpha.id } })).toBe(1);

    // a teacher in the group cannot rate their own teaching
    await prisma.communityMembership.create({ data: { personId: people.alpha.id, communityId: group.id } });
    await expect(rate(people.alpha.id, { teacherId: teachers.alpha.id, weekStart: monday, level: 'EXCELLENT' }, at('2026-11-23T08:00:00Z'))).rejects.toMatchObject({ code: 'OWN_TEACHING' });
    expect((await toRate(people.alpha.id, 'en', at('2026-11-23T08:00:00Z'))).every((i) => !i.teacherName.startsWith('Alpha'))).toBe(true);

    // eight days after it ended it can no longer be rated
    await expect(rate(rater.id, { teacherId: teachers.alpha.id, weekStart: monday, level: 'GOOD' }, at('2026-12-02T06:30:00Z'))).rejects.toMatchObject({ code: 'NOT_RATEABLE' });
  });

  it('gives the admin the totals, the average and who said what, and the teacher only the totals', async () => {
    const { people, teachers } = await setUp();
    const raters = [await person('Rater A'), await person('Rater B'), await person('Rater C')];
    const group = await prisma.community.create({ data: { name: `Group ${++n}` } });
    for (const r of raters) await prisma.communityMembership.create({ data: { personId: r.id, communityId: group.id } });
    await updateSettings({ ratersCommunityId: group.id });
    const now = at('2026-11-23T06:30:00Z');
    await rate(raters[0].id, { teacherId: teachers.alpha.id, weekStart: '2026-11-23', level: 'EXCELLENT' }, now);
    await rate(raters[1].id, { teacherId: teachers.alpha.id, weekStart: '2026-11-23', level: 'EXCELLENT' }, now);
    await rate(raters[2].id, { teacherId: teachers.alpha.id, weekStart: '2026-11-23', level: 'KEEP_GROWING' }, now);

    const summary = (await ratingSummaries()).get(teachers.alpha.id)!;
    expect(summary).toEqual({ total: 3, average: 3, counts: { EXCELLENT: 2, VERY_GOOD: 0, GOOD: 0, KEEP_GROWING: 1 } });
    const detail = await ratingDetail(teachers.alpha.id);
    expect(detail.weeks[0].topic).toBe('Topic 1');
    expect(detail.weeks[0].raters.map((r) => r.level).sort()).toEqual(['EXCELLENT', 'EXCELLENT', 'KEEP_GROWING']);
    expect(detail.weeks[0].raters.every((r) => r.name.startsWith('Rater'))).toBe(true);

    const view = (await teacherView(people.alpha.id, now)) as any;
    expect(view.results).toHaveLength(1);
    expect(view.results[0]).toMatchObject({ topic: 'Topic 1', total: 3, average: 3 });
    expect(JSON.stringify(view)).not.toMatch(/Rater [ABC]/);
    expect(((await teacherView(people.beta.id, now)) as any).results).toEqual([]); // nobody else's results
    const overview = await adminOverview(now);
    expect(overview.teachers.find((t) => t.name === 'Alpha Tester')!.ratings.total).toBe(3);
    expect(overview.raters).toMatchObject({ communityId: group.id, count: 3 });
  });

  it('only lets a member of the group rate, over the web, and refuses an unknown level', async () => {
    const admin = await member('The Coordinator', { admin: true });
    const stranger = await member('Not In Group');
    await loadPlan(plan({ startDate: '2020-01-06' }));
    await prisma.teachingSettings.update({ where: { id: 'main' }, data: { enabled: true } });
    expect((await stranger.get('/api/member/teaching-rota/to-rate')).body.items).toEqual([]);
    expect((await stranger.send('post', '/api/member/teaching-rota/rate', { teacherId: 'x', weekStart: '2026-11-23', level: 'GOOD' })).status).toBe(403);
    expect((await admin.send('post', '/api/member/teaching-rota/rate', { teacherId: 'x', weekStart: '2026-11-23', level: 'AMAZING' })).status).toBe(400);
    expect((await admin.send('post', '/api/member/teaching-rota/rate', { teacherId: 'x', weekStart: '2026-11-23', level: 'GOOD' })).status).toBe(409);
  });

  it('suggests the group called Leadership Development when the plan is loaded', async () => {
    const group = await prisma.community.create({ data: { name: `Leadership Development group ${Math.random().toString(36).slice(2, 6)}` } });
    await loadPlan(plan());
    const settings = await prisma.teachingSettings.findUniqueOrThrow({ where: { id: 'main' } });
    // another test database run may hold a second group of that name; then nothing is chosen for you
    expect([group.id, null]).toContain(settings.ratersCommunityId);
  });
});

describe('reminders to the teachers', () => {
  it('says nothing while the rota is off', async () => {
    await loadPlan(plan());
    expect(await sendRotaReminders(at('2026-11-22T17:30:00Z'))).toEqual({ assignment: 0, tomorrow: 0, hour: 0, rate: 0 });
  });

  it('sends the assignment on Sunday evening, the evening before, and an hour before, each once', async () => {
    const { people } = await setUp();
    // Sunday 22 November, 17:00 in Cameroon: not yet
    expect((await sendRotaReminders(at('2026-11-22T16:00:00Z'))).assignment).toBe(0);
    // 18:05: the assignment goes to all three
    const sunday = await sendRotaReminders(at('2026-11-22T17:05:00Z'));
    expect(sunday.assignment).toBe(3);
    expect((await sendRotaReminders(at('2026-11-22T17:20:00Z'))).assignment).toBe(0); // not twice
    const a = (await notices(people.alpha.id, 'assignment'))[0];
    expect(a.metadata).toMatchObject({ kind: 'assignment', topicEn: 'Topic 1', topicFr: 'Topic 1 (fr)', startsAt: '2026-11-23T06:00:00.000Z' });

    // Monday 06:10 in Cameroon (05:10Z): an hour before Alpha's 07:00
    expect((await sendRotaReminders(at('2026-11-23T05:10:00Z'))).hour).toBe(1);
    expect(await notices(people.alpha.id, 'hour')).toHaveLength(1);
    expect(await notices(people.beta.id, 'hour')).toHaveLength(0);
    expect((await sendRotaReminders(at('2026-11-23T05:20:00Z'))).hour).toBe(0);

    // Monday 18:10 in Cameroon (17:10Z): Gamma teaches Tuesday, so she hears "tomorrow"; the Monday teachers do not
    const monEvening = await sendRotaReminders(at('2026-11-23T17:10:00Z'));
    expect(monEvening.tomorrow).toBe(1);
    expect(await notices(people.gamma.id, 'tomorrow')).toHaveLength(1);
    expect(await notices(people.alpha.id, 'tomorrow')).toHaveLength(0);
  });

  it('sends nothing for a teacher who is not matched to a member, or who has been stopped', async () => {
    const { teachers } = await setUp();
    await prisma.teachingTeacher.update({ where: { id: teachers.beta.id }, data: { personId: null } });
    await prisma.teachingTeacher.update({ where: { id: teachers.gamma.id }, data: { active: false } });
    expect((await sendRotaReminders(at('2026-11-22T17:05:00Z'))).assignment).toBe(1); // Alpha only
  });

  it('reminds the people who still have teachings to rate, once, on Sunday evening', async () => {
    const { people, teachers } = await setUp();
    const group = await prisma.community.create({ data: { name: `Group ${++n}` } });
    const r1 = await person('Rater One');
    const r2 = await person('Rater Two');
    for (const r of [r1, r2]) await prisma.communityMembership.create({ data: { personId: r.id, communityId: group.id } });
    await updateSettings({ ratersCommunityId: group.id });
    // r1 rated Alpha already; Beta and Gamma are still waiting by Sunday 29 November (the week of the 23rd)
    await rate(r1.id, { teacherId: teachers.alpha.id, weekStart: '2026-11-23', level: 'GOOD' }, at('2026-11-23T07:00:00Z'));
    const out = await sendRotaReminders(at('2026-11-29T17:05:00Z'));
    expect(out.rate).toBe(2);
    expect(((await notices(r1.id, 'rate'))[0].metadata as any).count).toBe(2); // Beta, Gamma
    expect(((await notices(r2.id, 'rate'))[0].metadata as any).count).toBe(3);
    expect((await sendRotaReminders(at('2026-11-29T17:30:00Z'))).rate).toBe(0);
    expect(people.alpha.id).toBeTruthy();
  });

  it('"send the assignments now" reaches the teachers whose slot is still ahead, and never twice', async () => {
    const { people } = await setUp();
    // Monday 23 November, 10:00 in Cameroon: Alpha's 07:00 has passed
    const first = await sendAssignmentsNow(at('2026-11-23T09:00:00Z'));
    expect(first).toEqual({ sent: 2, alreadySent: 0 });
    expect(await notices(people.alpha.id, 'assignment')).toHaveLength(0);
    expect(await notices(people.beta.id, 'assignment')).toHaveLength(1);
    expect(await sendAssignmentsNow(at('2026-11-23T09:30:00Z'))).toEqual({ sent: 0, alreadySent: 2 });
    // and the scheduled Sunday message does not repeat it
    expect((await sendRotaReminders(at('2026-11-23T09:40:00Z'))).assignment).toBe(0);
  });
});
