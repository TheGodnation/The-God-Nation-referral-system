import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { RotaError, addTeacher, resolveBook, adminOverview, loadPlan, matchTeachers, slotStart, teacherView, topicNumberFor, updateSettings, updateTeacher, weekNumber } from '../lib/teachingRota';

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
