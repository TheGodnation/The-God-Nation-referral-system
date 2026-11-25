import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { sendAssignmentsNow, sendHowToNow, sendRotaReminders } from '../lib/teachingReminders';
import { finishState, finishTeaching, postDueRatingCards, rate, ratingCardInfos } from '../lib/teachingCards';
import { RotaError, saveTopic, topicPreview, addTeacher, ratingDetail, ratingSummaries, resolveBook, isRater, adminOverview, loadPlan, matchTeachers, slotStart, teacherView, topicNumberFor, updateSettings, updateTeacher, weekNumber } from '../lib/teachingRota';

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
const plan = (over: Record<string, unknown> = {}) => ({
  startDate: '2026-11-23',
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
  const call = (m: 'get' | 'post' | 'put' | 'patch' | 'delete', p: string) => raw[m](p).set('X-Forwarded-For', ip);
  const { csrf } = await bootstrap(raw as any);
  const res = await call('post', '/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
  if (res.body.codeRequired) {
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await call('post', '/api/member/auth/login').set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
    await call('post', '/api/member/auth/verify-code').set('X-CSRF-Token', csrf).send({ email, code });
    spy.mockRestore();
  }
  return { person, get: (p: string) => call('get', p), send: (m: 'post' | 'put' | 'patch' | 'delete', p: string, body?: unknown) => call(m, p).set('X-CSRF-Token', csrf).send(body as object) };
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
    expect(await teacherView(a.person.id)).toEqual({ enabled: false, isTeacher: false });
    await updateSettings({ enabled: true, frenchChecked: true });
    const stranger = await member('Somebody Else');
    expect(await teacherView(stranger.person.id)).toEqual({ enabled: true, isTeacher: false });
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
    expect(wk1.guide).toBeUndefined(); // there is no guide any more

    const frenchView = (await teacherView(fr.person.id, new Date('2026-11-25T10:00:00Z'))) as any;
    expect(frenchView.language).toBe('fr');
    expect(frenchView.weeks[0].text.topic).toBe('Topic 2 (fr)');

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

  it('matches a name to the one member whose name holds the same words and a few more, but not when two fit', async () => {
    await loadPlan(plan({ teachers: [{ name: 'Mbeki Ndlovu Tester', startTopic: 1, dayOfWeek: 1, startTime: '07:00' }, { name: 'Shared Tester', startTopic: 2, dayOfWeek: 1, startTime: '16:00' }] }));
    const zora = await member('Zora Mbeki Ndlovu Tester');
    await member('Shared Tester One');
    await member('Shared Tester Two');
    const result = await matchTeachers();
    expect(result.matched).toBe(1);
    expect(result.ambiguous).toEqual(['Shared Tester']);
    expect((await prisma.teachingTeacher.findFirstOrThrow({ where: { name: { startsWith: 'Mbeki' } } })).personId).toBe(zora.person.id);
  });

  it('lists members who have no app account yet in the picker, marked, after those who have one', async () => {
    const admin = await member('The Coordinator', { admin: true });
    const withAccount = await member('Zelda Pickable');
    n += 1;
    const without = await prisma.person.create({ data: { name: `Zelda Pickable NoAccount ${n}`, whatsappNumber: `+2377300${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
    const found = (await admin.get('/api/member/central-teaching-rota/members?search=zelda%20pickable')).body.items;
    expect(found.map((f: any) => [f.id, f.hasAccount])).toEqual([[withAccount.person.id, true], [without.id, false]]);
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
    expect(found.body.items).toEqual([{ id: target.person.id, name: 'Pickme Findable', language: 'fr', hasAccount: true, takenBy: rows[0].name }]);
  });

  it('still finds a member who is marked as test data, and shows near matches when no one has every word', async () => {
    const admin = await member('The Coordinator Two', { admin: true });
    const odd = await member('Xyzzyq Etabu Wombat', {});
    await prisma.person.update({ where: { id: odd.person.id }, data: { isTestData: true } });
    const url = (q: string) => `/api/member/central-teaching-rota/members?search=${encodeURIComponent(q)}`;
    const exact = (await admin.get(url('Etabu Wombat'))).body;
    expect(exact.items.map((i: any) => i.id)).toEqual([odd.person.id]);
    expect(exact.note).toBeNull();
    // a spelling that differs a little: nobody has every word, but the one word that matches still brings her up
    const near = (await admin.get(url('Xyzzyq Wombatt'))).body;
    expect(near.items.map((i: any) => i.id)).toEqual([odd.person.id]);
    expect(near.note).toBe('PARTIAL');
  });

  it('says so when the person was removed from the app', async () => {
    const admin = await member('The Coordinator Three', { admin: true });
    const gone = await prisma.person.create({ data: { name: 'Qwertyu Removedperson', whatsappNumber: '+237710088888', erasedAt: new Date() } });
    const res = (await admin.get('/api/member/central-teaching-rota/members?search=Qwertyu%20Removedperson')).body;
    expect(res).toEqual({ items: [], note: 'ERASED' });
    expect(gone.id).toBeTruthy();
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

describe('a weekly teacher reading the books to prepare', () => {
  it('can open any of the books even before it is unlocked for them, and nothing is marked as opened, owed or paid', async () => {
    const tag = `tr${Math.random().toString(36).slice(2, 7)}`;
    const book = await prisma.libraryBook.create({ data: { kind: 'TRAINING', trainingOrder: 9, titleEn: `${tag} Keys, Volume IX`, storageKey: `books/${tag}.pdf` } as any });
    const monthly = await prisma.libraryBook.create({ data: { kind: 'DEVOTIONAL', titleEn: `${tag} Monthly`, storageKey: `books/${tag}-m.pdf` } as any });
    const teacher = await member('Teacher Reader');
    const plain = await member('Plain Reader');
    await prisma.teachingTeacher.create({ data: { name: 'Teacher Reader', personId: teacher.person.id, dayOfWeek: 1, startMinute: 420, startTopic: 1, active: true } });
    try {
      expect((await resolveBook([`${tag} Keys`, 'Volume 9|Volume IX'], teacher.person.id))?.canOpen).toBe(true);
      expect((await resolveBook([`${tag} Keys`, 'Volume 9|Volume IX'], plain.person.id))?.canOpen).toBe(false); // not a teacher, not unlocked
      expect(await prisma.trainingBookOpen.count({ where: { personId: teacher.person.id } })).toBe(0);
      expect(await prisma.bookPayment.count({ where: { personId: teacher.person.id } })).toBe(0);
      // The monthly book keeps its own rule (it must have been sent to the member).
      expect((await resolveBook([`${tag} Monthly`], teacher.person.id))?.canOpen).toBe(false);
      // and the reader itself lets the teacher in
      expect((await teacher.get(`/api/member/library/books/${book.id}`)).status).not.toBe(404);
    } finally {
      await prisma.teachingTeacher.deleteMany({ where: { personId: teacher.person.id } });
      await prisma.libraryBook.deleteMany({ where: { id: { in: [book.id, monthly.id] } } });
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

describe('the rating card in the group', () => {
  // Alpha teaches Monday 23 Nov, 07:00 Cameroon time = 06:00Z. Card auto time = 06:20Z.
  async function group() {
    const g = await prisma.community.create({ data: { name: `Leadership Development ${++n}` } });
    await updateSettings({ ratersCommunityId: g.id });
    return g;
  }
  const cardsIn = async (communityId: string) => {
    const conversation = await prisma.conversation.findFirst({ where: { communityId } });
    return conversation ? prisma.message.findMany({ where: { conversationId: conversation.id, kind: 'TEACHING_RATING' } }) : [];
  };

  it('offers "I have finished" to the teacher in the teaching group only, from the start of their slot, until the card is posted', async () => {
    const { people } = await setUp();
    const g = await group();
    const other = await prisma.community.create({ data: { name: `Other ${++n}` } });
    expect((await finishState(people.alpha.id, g.id, 'en', at('2026-11-23T05:59:00Z'))).available).toBe(false); // before 07:00
    const open = await finishState(people.alpha.id, g.id, 'en', at('2026-11-23T06:10:00Z'));
    expect(open).toEqual({ available: true, topic: 'Topic 1' });
    expect((await finishState(people.alpha.id, other.id, 'en', at('2026-11-23T06:10:00Z'))).available).toBe(false); // another group
    expect((await finishState(people.beta.id, g.id, 'en', at('2026-11-23T06:10:00Z'))).available).toBe(false); // Beta teaches at 16:00
    expect((await finishState(people.alpha.id, g.id, 'en', at('2026-11-24T07:00:00Z'))).available).toBe(false); // more than a day later
    await finishTeaching(people.alpha.id, at('2026-11-23T06:12:00Z'));
    expect((await finishState(people.alpha.id, g.id, 'en', at('2026-11-23T06:13:00Z'))).available).toBe(false); // card is up
  });

  it('offers nothing and posts nothing before the first week has started', async () => {
    const { people } = await setUp();
    const g = await group();
    // Tuesday 17 November, 20:30 in Cameroon: Gamma's slot (Tuesday 20:00) of the week BEFORE the first week (23 November) has passed
    const before = at('2026-11-17T19:30:00Z');
    expect((await finishState(people.gamma.id, g.id, 'en', before)).available).toBe(false);
    await expect(finishTeaching(people.gamma.id, before)).rejects.toMatchObject({ code: 'NOT_YET' });
    expect(await postDueRatingCards(at('2026-11-17T20:00:00Z'))).toBe(0);
    expect(await cardsIn(g.id)).toHaveLength(0);
  });

  it('posts the card in the group when the teacher taps, once, with the teacher as its author', async () => {
    const { people } = await setUp();
    await expect(finishTeaching(people.alpha.id, at('2026-11-23T06:12:00Z'))).rejects.toMatchObject({ code: 'NO_GROUP' });
    const g = await group();
    await expect(finishTeaching(people.alpha.id, at('2026-11-23T05:00:00Z'))).rejects.toMatchObject({ code: 'NOT_YET' });
    await expect(finishTeaching((await person('Nobody')).id, at('2026-11-23T06:12:00Z'))).rejects.toMatchObject({ code: 'NOT_A_TEACHER' });
    expect(await finishTeaching(people.alpha.id, at('2026-11-23T06:12:00Z'))).toEqual({ posted: true });
    expect(await finishTeaching(people.alpha.id, at('2026-11-23T06:13:00Z'))).toEqual({ posted: false }); // a second tap changes nothing
    const cards = await cardsIn(g.id);
    expect(cards).toHaveLength(1);
    expect(cards[0].senderPersonId).toBe(people.alpha.id);
  });

  it('posts the card by itself 25 minutes after the slot starts, unless the teacher already did or it is very late', async () => {
    const { people } = await setUp();
    const g = await group();
    expect(await postDueRatingCards(at('2026-11-23T06:24:00Z'))).toBe(0); // 24 minutes after 07:00
    expect(await postDueRatingCards(at('2026-11-23T06:26:00Z'))).toBe(1); // Alpha
    expect(await postDueRatingCards(at('2026-11-23T06:30:00Z'))).toBe(0); // not twice
    // Beta taps at 16:05 (15:05Z); the automatic one finds the card already there
    await finishTeaching(people.beta.id, at('2026-11-23T15:05:00Z'));
    expect(await postDueRatingCards(at('2026-11-23T15:30:00Z'))).toBe(0);
    expect(await cardsIn(g.id)).toHaveLength(2);
    // Gamma (Tuesday 20:00): a card that is more than 3 days overdue is not posted any more
    expect(await postDueRatingCards(at('2026-11-28T20:00:00Z'))).toBe(0);
  });

  it('suggests the group called Leadership Development when the plan is loaded', async () => {
    const g = await prisma.community.create({ data: { name: `Leadership Development group ${Math.random().toString(36).slice(2, 6)}` } });
    await loadPlan(plan());
    const settings = await prisma.teachingSettings.findUniqueOrThrow({ where: { id: 'main' } });
    // another run of the tests may leave a second group of that name; then nothing is chosen for you
    expect([g.id, null]).toContain(settings.ratersCommunityId);
  });

  it('does nothing while the rota is off or no group is chosen', async () => {
    await loadPlan(plan());
    const a = await person('Alpha');
    await prisma.teachingTeacher.updateMany({ where: { name: 'Alpha Tester' }, data: { personId: a.id } });
    expect(await postDueRatingCards(at('2026-11-23T06:30:00Z'))).toBe(0); // off
    await updateSettings({ enabled: true, frenchChecked: true });
    expect(await postDueRatingCards(at('2026-11-23T06:30:00Z'))).toBe(0); // no group
  });

  it('lets members of the group rate at any time and change it, never their own, never from outside the group', async () => {
    const { people } = await setUp();
    const g = await group();
    const rater = await person('Rater');
    const outsider = await person('Outsider');
    await prisma.communityMembership.create({ data: { personId: rater.id, communityId: g.id } });
    await prisma.communityMembership.create({ data: { personId: people.alpha.id, communityId: g.id } });
    await finishTeaching(people.alpha.id, at('2026-11-23T06:12:00Z'));
    const card = (await cardsIn(g.id))[0];

    await expect(rate(outsider.id, { messageId: card.id, level: 'GOOD' })).rejects.toMatchObject({ code: 'NOT_RATER' });
    await expect(rate(people.alpha.id, { messageId: card.id, level: 'EXCELLENT' })).rejects.toMatchObject({ code: 'OWN_TEACHING' });
    await expect(rate(rater.id, { messageId: 'no-such-card', level: 'GOOD' })).rejects.toMatchObject({ code: 'NO_CARD' });
    await rate(rater.id, { messageId: card.id, level: 'GOOD' });
    const changed = await rate(rater.id, { messageId: card.id, level: 'EXCELLENT' });
    expect(changed.card).toMatchObject({ myLevel: 'EXCELLENT', total: 1, canRate: true, isOwnTeaching: false });
    expect(await prisma.teachingRating.count({ where: { teacherId: (await prisma.teachingTeacher.findFirstOrThrow({ where: { personId: people.alpha.id } })).id } })).toBe(1);
    // weeks later: still open
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2027-03-01T10:00:00Z'));
    try {
      await rate(rater.id, { messageId: card.id, level: 'VERY_GOOD' });
    } finally {
      vi.useRealTimers();
    }
    expect((await ratingCardInfos(rater.id, [card.id], 'en')).get(card.id)!.myLevel).toBe('VERY_GOOD');
  });

  it('shows the group how many gave each level and who rated (name, photo, level, newest first), and the central admin’s own rating on top', async () => {
    const { people } = await setUp();
    const g = await group();
    const raters = [await person('Rater A'), await person('Rater B'), await person('Rater C')];
    for (const r of raters) await prisma.communityMembership.create({ data: { personId: r.id, communityId: g.id } });
    const coordinator = await person('Evangelist Coordinator');
    await prisma.user.create({ data: { name: 'Central Admin', email: `card-admin-${++n}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: coordinator.id } });
    await finishTeaching(people.alpha.id, at('2026-11-23T06:12:00Z'));
    const card = (await cardsIn(g.id))[0];
    await rate(raters[0].id, { messageId: card.id, level: 'EXCELLENT' });
    await rate(raters[1].id, { messageId: card.id, level: 'EXCELLENT' });
    await rate(raters[2].id, { messageId: card.id, level: 'KEEP_GROWING' });
    await rate(coordinator.id, { messageId: card.id, level: 'GOOD' });

    const seenByRaterA = (await ratingCardInfos(raters[0].id, [card.id], 'en')).get(card.id)!;
    expect(seenByRaterA).toMatchObject({ total: 4, counts: { EXCELLENT: 2, VERY_GOOD: 0, GOOD: 1, KEEP_GROWING: 1 }, myLevel: 'EXCELLENT', coordinator: { name: coordinator.name, level: 'GOOD' }, teacherName: people.alpha.name, topic: 'Topic 1' });
    // the National Coordinator counts as a rater and is listed first; then everyone else with name and level, the newest first
    expect(seenByRaterA.raters.map((r) => [r.name, r.level, Boolean(r.isCoordinator)])).toEqual([
      [coordinator.name, 'GOOD', true],
      [raters[2].name, 'KEEP_GROWING', false],
      [raters[1].name, 'EXCELLENT', false],
      [raters[0].name, 'EXCELLENT', false],
    ]);
    expect(seenByRaterA.raters.every((r) => r.photoUrl === null)).toBe(true); // nobody has a picture yet
    // a rater who has a picture shows it; changing a rating moves that rater to the top
    await prisma.person.update({ where: { id: raters[0].id }, data: { photoStorageKey: 'photos/a.jpg', photoUpdatedAt: new Date('2026-11-23T08:00:00Z') } });
    await rate(raters[0].id, { messageId: card.id, level: 'VERY_GOOD' });
    const again = (await ratingCardInfos(raters[1].id, [card.id], 'en')).get(card.id)!;
    expect(again.raters[1]).toMatchObject({ name: raters[0].name, level: 'VERY_GOOD', photoUrl: `/api/people/${raters[0].id}/photo?v=${new Date('2026-11-23T08:00:00Z').getTime()}` });
    await rate(raters[0].id, { messageId: card.id, level: 'EXCELLENT' });
    // another member sees their own choice only (none) and can rate
    const late = await person('Rater D');
    await prisma.communityMembership.create({ data: { personId: late.id, communityId: g.id } });
    expect((await ratingCardInfos(late.id, [card.id], 'en')).get(card.id)).toMatchObject({ myLevel: null, canRate: true });
    // the teacher sees the same card but cannot rate it
    expect((await ratingCardInfos(people.alpha.id, [card.id], 'fr')).get(card.id)).toMatchObject({ isOwnTeaching: true, canRate: false, topic: 'Topic 1 (fr)' });
    // the admin still sees every rating with names in the panel
    const teacher = await prisma.teachingTeacher.findFirstOrThrow({ where: { personId: people.alpha.id } });
    expect((await ratingSummaries()).get(teacher.id)).toMatchObject({ total: 4 });
    expect((await ratingDetail(teacher.id)).weeks[0].raters.map((r) => r.name).sort()).toEqual([coordinator.name, ...raters.map((r) => r.name)].sort());
  });

  it('tells the teacher when someone rates, in one bell entry that counts up, without saying who or what', async () => {
    const { people } = await setUp();
    const g = await group();
    const r1 = await person('Rater One');
    const r2 = await person('Rater Two');
    for (const r of [r1, r2]) await prisma.communityMembership.create({ data: { personId: r.id, communityId: g.id } });
    await finishTeaching(people.alpha.id, at('2026-11-23T06:12:00Z'));
    const card = (await cardsIn(g.id))[0];
    await rate(r1.id, { messageId: card.id, level: 'KEEP_GROWING' });
    let rows = await notices(people.alpha.id, 'rated');
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ kind: 'rated', count: 1, topicEn: 'Topic 1' });
    await prisma.notification.update({ where: { id: rows[0].id }, data: { readAt: new Date() } });
    await rate(r2.id, { messageId: card.id, level: 'EXCELLENT' });
    rows = await notices(people.alpha.id, 'rated');
    expect(rows).toHaveLength(1); // the same entry, updated and unread again
    expect(rows[0].readAt).toBeNull();
    expect((rows[0].metadata as any).count).toBe(2);
    expect(JSON.stringify(rows[0].metadata)).not.toMatch(/Rater|KEEP_GROWING|EXCELLENT/);
  });

  it('lets a member take their rating back: it leaves the card and the totals, and the teacher\'s bell count follows', async () => {
    const { people } = await setUp();
    const g = await group();
    const r1 = await member('Rater One');
    const r2 = await member('Rater Two');
    for (const r of [r1, r2]) await prisma.communityMembership.create({ data: { personId: r.person.id, communityId: g.id } });
    await finishTeaching(people.alpha.id, at('2026-11-23T06:12:00Z'));
    const card = (await cardsIn(g.id))[0];
    await r1.send('post', '/api/member/teaching-rota/rate', { messageId: card.id, level: 'GOOD' });
    await r2.send('post', '/api/member/teaching-rota/rate', { messageId: card.id, level: 'EXCELLENT' });
    const back = await r1.send('post', '/api/member/teaching-rota/rate', { messageId: card.id, level: null });
    expect(back.status).toBe(200);
    expect(back.body.card).toMatchObject({ myLevel: null, total: 1 });
    expect((await notices(people.alpha.id, 'rated'))[0].metadata).toMatchObject({ count: 1 });
    // Taking back a rating that is not there is harmless, and the last one removed clears the teacher's bell entry.
    expect((await r1.send('post', '/api/member/teaching-rota/rate', { messageId: card.id, level: null })).status).toBe(200);
    await r2.send('post', '/api/member/teaching-rota/rate', { messageId: card.id, level: null });
    expect(await notices(people.alpha.id, 'rated')).toHaveLength(0);
    expect(await prisma.teachingRating.count()).toBe(0);
  });

  it('lets the central admin remove a card when nobody taught: it leaves the chat, cannot be rated, and does not come back by itself', async () => {
    const { people } = await setUp();
    const g = await group();
    const admin = await member('The Admin', { admin: true });
    const viewer = await member('Group Viewer2');
    const groupLeader = await member('Group Leader');
    for (const m of [admin, viewer, groupLeader]) await prisma.communityMembership.create({ data: { personId: m.person.id, communityId: g.id } });
    const adminUser = await prisma.user.findFirstOrThrow({ where: { personId: admin.person.id } });
    await prisma.roleAssignment.create({ data: { personId: groupLeader.person.id, roleType: 'SCOPED_LEADER', communityId: g.id, assignedByUserId: adminUser.id } });
    await finishTeaching(people.alpha.id, at('2026-11-23T06:12:00Z'));
    const card = (await cardsIn(g.id))[0];
    expect((await viewer.send('delete', `/api/communities/${g.id}/conversation/messages/${card.id}`)).status).toBe(403); // an ordinary member cannot
    // Nor can the group's own leader (leaders often teach themselves): only the central admin.
    const byLeader = await groupLeader.send('delete', `/api/communities/${g.id}/conversation/messages/${card.id}`);
    expect(byLeader.status).toBe(403);
    expect(byLeader.body.error).toBe('Only the central admin may remove a rating card.');
    expect((await admin.send('delete', `/api/communities/${g.id}/conversation/messages/${card.id}`)).status).toBe(200);
    const list = await viewer.get(`/api/communities/${g.id}/conversation/messages`);
    const item = list.body.items.find((m: any) => m.id === card.id);
    expect(item.deleted).toBe(true);
    expect(item.ratingCard).toBeUndefined();
    expect((await viewer.send('post', '/api/member/teaching-rota/rate', { messageId: card.id, level: 'GOOD' })).status).toBe(404);
    expect(await postDueRatingCards(at('2026-11-23T06:40:00Z'))).toBe(0); // the automatic card does not put it back
  });

  it('puts the card into the group’s message list for members, with the counts and their own choice', async () => {
    const { people } = await setUp();
    const g = await group();
    const viewer = await member('Group Viewer');
    const outsider = await member('Not In Group');
    await prisma.communityMembership.create({ data: { personId: viewer.person.id, communityId: g.id } });
    await finishTeaching(people.alpha.id, at('2026-11-23T06:12:00Z'));
    const card = (await cardsIn(g.id))[0];
    expect((await viewer.send('post', '/api/member/teaching-rota/rate', { messageId: card.id, level: 'GOOD' })).body.card).toMatchObject({ myLevel: 'GOOD', total: 1 });
    expect((await viewer.send('post', '/api/member/teaching-rota/rate', { messageId: card.id, level: 'AMAZING' })).status).toBe(400);
    expect((await outsider.send('post', '/api/member/teaching-rota/rate', { messageId: card.id, level: 'GOOD' })).status).toBe(403);

    const list = await viewer.get(`/api/communities/${g.id}/conversation/messages`);
    expect(list.status).toBe(200);
    const item = list.body.items.find((m: any) => m.id === card.id);
    expect(item.kind).toBe('TEACHING_RATING');
    expect(item.ratingCard).toMatchObject({ myLevel: 'GOOD', total: 1, counts: { GOOD: 1 }, topic: 'Topic 1', canRate: true });
    expect(list.body.unreadCount).toBe(0); // a card is never an unread message
  });
});

describe('reminders to the teachers', () => {
  it('says nothing while the rota is off', async () => {
    await loadPlan(plan());
    expect(await sendRotaReminders(at('2026-11-22T17:30:00Z'))).toEqual({ assignment: 0, tomorrow: 0, hour: 0 });
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

  it('"send the assignments now" reaches the teachers whose slot is still ahead, and never twice', async () => {
    const { people } = await setUp();
    // Monday 23 November, 10:00 in Cameroon: Alpha's 07:00 has passed
    const first = await sendAssignmentsNow(at('2026-11-23T09:00:00Z'));
    expect(first).toMatchObject({ sent: 2, alreadySent: 0, notMatched: [] });
    expect(first.passed.map((x) => x.split(' ')[0])).toEqual(['Alpha']);
    expect(first.sentTo.map((x) => x.split(' ')[0]).sort()).toEqual(['Beta', 'Gamma']);
    expect(await notices(people.alpha.id, 'assignment')).toHaveLength(0);
    expect(await notices(people.beta.id, 'assignment')).toHaveLength(1);
    expect(await sendAssignmentsNow(at('2026-11-23T09:30:00Z'))).toMatchObject({ sent: 0, alreadySent: 2 });
    // and the scheduled Sunday message does not repeat it
    expect((await sendRotaReminders(at('2026-11-23T09:40:00Z'))).assignment).toBe(0);
  });
});

describe('editing the teachings', () => {
  it('changes a teaching, keeps the French optional, and asks for the French to be read again when it changes', async () => {
    await loadPlan(plan());
    await updateSettings({ frenchChecked: true });
    const edited = await saveTopic(1, { kind: 'key', en: { ...textOf('Topic 1 edited'), help: 'New help text' }, fr: textOf('Topic 1', 'fr') });
    expect((edited.en as any).topic).toBe('Topic 1 edited');
    expect((edited.en as any).help).toBe('New help text');
    // the French was the same as before: nothing to read again
    expect((await adminOverview()).settings?.frenchChecked).toBe(true);
    await saveTopic(1, { kind: 'key', en: textOf('Topic 1 edited'), fr: { ...textOf('Topic 1', 'fr'), help: 'Aide changée' } });
    expect((await adminOverview()).settings?.frenchChecked).toBe(false);
    // a teaching with no French at all is allowed
    const noFrench = await saveTopic(2, { kind: 'right', en: textOf('Topic 2') });
    expect(noFrench.fr).toBeNull();
    expect((await topicPreview(2)).kind).toBe('right');
  });

  it('adds a new teaching at the end of the list, and refuses an incomplete one', async () => {
    await loadPlan(plan());
    await expect(saveTopic(null, { kind: 'key', en: { ...textOf('Half done'), help: '' } })).rejects.toMatchObject({ code: 'BAD_TOPIC' });
    await expect(saveTopic(99, { kind: 'key', en: textOf('Nope') })).rejects.toMatchObject({ status: 404 });
    const added = await saveTopic(null, { kind: 'key', en: textOf('Topic 4'), fr: textOf('Topic 4', 'fr') });
    expect(added.number).toBe(4);
    expect((await adminOverview()).topics.map((t) => t.number)).toEqual([1, 2, 3, 4]);
  });

  it('lets only the central admin edit, over the member door', async () => {
    const admin = await member('The Coordinator', { admin: true });
    const other = await member('Somebody');
    await loadPlan(plan());
    const body = { kind: 'key', en: textOf('Changed by admin') };
    expect((await other.send('put', '/api/member/central-teaching-rota/topics/1', body)).status).toBe(403);
    const res = await admin.send('put', '/api/member/central-teaching-rota/topics/1', body);
    expect(res.status).toBe(200);
    expect(res.body.topic.en.topic).toBe('Changed by admin');
    expect(res.body.overview.topics[0].title).toBe('Changed by admin');
    const add = await admin.send('post', '/api/member/central-teaching-rota/topics', { kind: 'right', en: textOf('Brand new') });
    expect(add.status).toBe(201);
    expect((await admin.send('put', '/api/member/central-teaching-rota/topics/1', { kind: 'key', en: { topic: 'x' } })).status).toBe(400);
  });
});

describe('the assignment as a private message', () => {
  const chatOf = (a: string, b: string) => prisma.privateConversation.findFirst({ where: { OR: [{ memberPersonId: a, initiatorPersonId: b }, { memberPersonId: b, initiatorPersonId: a }] } });

  it('arrives in the teacher\'s private chat from the central admin, and the admin can see it was sent, opened and answered', async () => {
    const admin = await member('Central Tester', { admin: true });
    const { people, teachers } = await setUp();
    await prisma.user.updateMany({ where: { role: 'ADMIN', personId: { not: admin.person.id } }, data: { active: false } }); // only this admin sends
    const week = async () => (await adminOverview(at('2026-11-23T09:00:00Z'))).teachers.find((t) => t.id === teachers.beta.id)!.assignment;
    expect(await week()).toBeNull(); // nothing sent yet

    await sendAssignmentsNow(at('2026-11-23T09:00:00Z'));
    const chat = (await chatOf(people.beta.id, admin.person.id))!;
    const message = await prisma.privateMessage.findFirstOrThrow({ where: { conversationId: chat.id } });
    expect(message.senderPersonId).toBe(admin.person.id);
    expect(message.body).toContain('Your teaching this week: Topic 2');
    expect(message.body).toContain('/member/my-teaching');
    expect(message.body).toContain('Please reply here');
    expect(await week()).toMatchObject({ messageSent: true, conversationId: chat.id, seen: false, replied: false });

    await prisma.privateConversationRead.create({ data: { personId: people.beta.id, conversationId: chat.id, lastReadAt: new Date(message.createdAt.getTime() + 1000) } });
    expect(await week()).toMatchObject({ seen: true, replied: false });
    await prisma.privateMessage.create({ data: { conversationId: chat.id, senderPersonId: people.beta.id, body: 'Received, thank you.' } });
    expect(await week()).toMatchObject({ seen: true, replied: true });
  });

  it('is written in French for a French-speaking teacher, and says who could not be reached', async () => {
    const admin = await member('Central Tester Two', { admin: true });
    const { people, teachers } = await setUp({ fr: true });
    await prisma.user.updateMany({ where: { role: 'ADMIN', personId: { not: admin.person.id } }, data: { active: false } });
    await prisma.teachingTeacher.update({ where: { id: teachers.gamma.id }, data: { personId: null } });
    const result = await sendAssignmentsNow(at('2026-11-22T20:00:00Z')); // Sunday evening: everyone's slot is ahead
    expect(result.notMatched).toEqual(['Gamma Tester']);
    const chat = (await chatOf(people.alpha.id, admin.person.id))!;
    const message = await prisma.privateMessage.findFirstOrThrow({ where: { conversationId: chat.id } });
    expect(message.body).toContain('Votre enseignement cette semaine');
    expect(message.body).toContain('Merci de répondre ici');
  });

  it('adds the private message, once and without a second alert, for an assignment that only went out as an alert before', async () => {
    const admin = await member('Central Tester Three', { admin: true });
    const { people, teachers } = await setUp();
    await prisma.user.updateMany({ where: { role: 'ADMIN', personId: { not: admin.person.id } }, data: { active: false } });
    const key = `assignment:${teachers.beta.id}:2026-11-23`;
    await prisma.teachingReminderLog.create({ data: { key } }); // the old way: logged, no private message
    const before = (await notices(people.beta.id, 'assignment')).length;
    const result = await sendAssignmentsNow(at('2026-11-23T09:00:00Z'));
    expect(result.sentTo.map((x) => x.split(' ')[0])).toContain('Beta');
    expect(await chatOf(people.beta.id, admin.person.id)).not.toBeNull();
    expect((await notices(people.beta.id, 'assignment')).length).toBe(before); // no second bell entry
    expect((await prisma.teachingReminderLog.findUniqueOrThrow({ where: { key } })).messageId).not.toBeNull();
    expect(await sendAssignmentsNow(at('2026-11-23T09:10:00Z'))).toMatchObject({ sent: 0 }); // and never again
  });

  it('lets the central admin see exactly the page a teacher sees, and nobody else', async () => {
    const admin = await member('Central Tester Four', { admin: true });
    const plain = await member('Plain Tester');
    const { teachers, people } = await setUp();
    const mine = await admin.get(`/api/member/central-teaching-rota/teachers/${teachers.beta.id}/page`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ enabled: true, isTeacher: true });
    expect(mine.body.weeks[0].text.topic).toBe('Topic 2');
    expect(mine.body.weeks.map((w: any) => w.text.topic)).toEqual(['Topic 2', 'Topic 3']); // that teacher's own this week and next week, and nothing else
    expect((await plain.get(`/api/member/central-teaching-rota/teachers/${teachers.beta.id}/page`)).status).toBe(403);
    await prisma.teachingTeacher.update({ where: { id: teachers.gamma.id }, data: { personId: null } });
    expect((await admin.get(`/api/member/central-teaching-rota/teachers/${teachers.gamma.id}/page`)).status).toBe(409);
    expect(people.beta.id).toBeTruthy();
  });

  it('adds the voice-note line to the assignment once a teaching group is chosen, and sends the how-it-works message once to each teacher', async () => {
    const admin = await member('Central Tester Five', { admin: true });
    const { people, teachers } = await setUp({ fr: true });
    await prisma.user.updateMany({ where: { role: 'ADMIN', personId: { not: admin.person.id } }, data: { active: false } });
    const g = await prisma.community.create({ data: { name: `Voice Group ${++n}` } });
    await updateSettings({ ratersCommunityId: g.id });
    await prisma.teachingTeacher.update({ where: { id: teachers.gamma.id }, data: { personId: null } });

    await sendAssignmentsNow(at('2026-11-22T20:00:00Z'));
    const alphaChat = (await chatOf(people.alpha.id, admin.person.id))!;
    const assignment = await prisma.privateMessage.findFirstOrThrow({ where: { conversationId: alphaChat.id } });
    expect(assignment.body).toContain(`dans le groupe « ${g.name} »`); // Alpha reads French
    expect(assignment.body).toContain("J'ai terminé mon enseignement");
    const betaChat = (await chatOf(people.beta.id, admin.person.id))!;
    expect((await prisma.privateMessage.findFirstOrThrow({ where: { conversationId: betaChat.id } })).body).toContain(`in the group “${g.name}”, then tap “I have finished my teaching”`);

    const first = await sendHowToNow();
    expect(first).toMatchObject({ sent: 2, alreadySent: 0 });
    expect(first.notMatched).toEqual(['Gamma Tester']);
    const betaMessages = await prisma.privateMessage.findMany({ where: { conversationId: betaChat.id }, orderBy: { createdAt: 'asc' } });
    expect(betaMessages).toHaveLength(2);
    expect(betaMessages[1].body).toContain('How your weekly teaching works');
    expect(betaMessages[1].body).toContain('25 minutes');
    expect(betaMessages[1].body).toContain('about 5 minutes');
    expect(betaMessages[1].body).toContain('/member/my-teaching/guide');
    expect(await sendHowToNow()).toMatchObject({ sent: 0, alreadySent: 2 }); // never twice
    expect(await prisma.privateMessage.count({ where: { conversationId: betaChat.id } })).toBe(2);
    // "Send again": an updated copy to everyone, marked as replacing the earlier one; a double tap does not send it twice
    const again = await sendHowToNow(true, at('2026-11-23T10:00:00Z'));
    expect(again).toMatchObject({ sent: 2, alreadySent: 0 });
    expect(await sendHowToNow(true, at('2026-11-23T10:05:00Z'))).toMatchObject({ sent: 0, alreadySent: 2 });
    const afterAgain = await prisma.privateMessage.findMany({ where: { conversationId: betaChat.id }, orderBy: { createdAt: 'asc' } });
    expect(afterAgain).toHaveLength(3);
    expect(afterAgain[2].body).toContain('Updated: this replaces the earlier message');
    expect(afterAgain[2].body).toContain('How your weekly teaching works');
    expect(await sendHowToNow(true, at('2026-11-23T12:00:00Z'))).toMatchObject({ sent: 2 }); // later, it can be sent again
    const alphaLast = (await prisma.privateMessage.findMany({ where: { conversationId: alphaChat.id }, orderBy: { createdAt: 'asc' } })).at(-1)!;
    expect(alphaLast.body).toContain('Mise à jour : ce message remplace le précédent'); // Alpha reads French
  });
});

