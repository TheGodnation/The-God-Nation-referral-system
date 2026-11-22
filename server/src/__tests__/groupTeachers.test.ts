import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { prisma } from '../lib/prisma';
import { TeacherError, addGroupTeacher, addTeachingDay, canTeachIn, cameroonParts, listGroupTeachers, removeGroupTeacher, sendTeachingDayReminders, startsAtOf, teachesAnywhere, teachingToday } from '../lib/groupTeachers';
import { createScheduled, listScheduled, postDueScheduledTeachings } from '../lib/scheduledTeachings';

// Teachers who teach with the central admin in the groups the central admin allows, and their teaching days. Names are made up.
const stored = new Map<string, Buffer>();
vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  isStorageConfigured: () => true,
  createDownloadUrl: async ({ storageKey }: { storageKey: string }) => ({ url: `https://download.example/${storageKey}`, expiresAt: new Date() }),
  headObject: async ({ storageKey }: { storageKey: string }) => (stored.has(storageKey) ? { contentLength: stored.get(storageKey)!.length, contentType: 'audio/webm' } : null),
  getObjectStream: async ({ storageKey }: { storageKey: string }) => (stored.has(storageKey) ? { body: Readable.from([stored.get(storageKey)!]), contentLength: stored.get(storageKey)!.length } : null),
  deleteObject: async ({ storageKey }: { storageKey: string }) => void stored.delete(storageKey),
}));
vi.mock('../lib/translation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/translation')>()),
  isTranslationConfigured: () => false,
  transcribeAndStoreMessageAudio: vi.fn(async () => undefined),
  translateAndStoreMessage: vi.fn(async () => undefined),
}));

const app = createApp();
const PASSWORD = 'GoodPass123!';
let n = 0;
const at = (iso: string) => new Date(iso);

async function person(name: string, opts: { account?: boolean; admin?: boolean; language?: 'en' | 'fr' } = {}) {
  n += 1;
  const p = await prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2377900${String(n).padStart(5, '0')}`, profileCompletedAt: new Date(), preferredLanguage: opts.language ?? 'en' } });
  if (opts.account !== false) await prisma.memberAccount.create({ data: { personId: p.id, email: `gt${n}-${Date.now()}@example.com`, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
  if (opts.admin) await prisma.user.create({ data: { name: 'Central', email: `gt-admin-${n}-${Date.now()}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: p.id } });
  return p;
}
const group = (name = 'Headquarters') => prisma.community.create({ data: { name: `${name} ${++n}` } });
const join = (communityId: string, personId: string) => prisma.communityMembership.create({ data: { communityId, personId, status: 'ACTIVE' } as any });

beforeEach(async () => {
  stored.clear();
  await prisma.scheduledTeaching.deleteMany();
  await prisma.groupTeacher.deleteMany();
  await prisma.teachingReminderLog.deleteMany();
});
afterEach(() => vi.restoreAllMocks());

describe('allowing a teacher in a group', () => {
  it('needs a member with an app account in a real group, is not for the central admin, and is the same twice', async () => {
    const g = await group();
    const teacher = await person('Teacher');
    const noAccount = await person('Nobody', { account: false });
    const admin = await person('Admin', { admin: true });
    await expect(addGroupTeacher(noAccount.id, g.id)).rejects.toMatchObject({ code: 'NO_ACCOUNT' });
    await expect(addGroupTeacher(admin.id, g.id)).rejects.toMatchObject({ code: 'IS_ADMIN' });
    await expect(addGroupTeacher('nobody', g.id)).rejects.toMatchObject({ code: 'NO_PERSON' });
    await expect(addGroupTeacher(teacher.id, 'nowhere')).rejects.toMatchObject({ code: 'NO_GROUP' });
    const a = await addGroupTeacher(teacher.id, g.id);
    expect((await addGroupTeacher(teacher.id, g.id)).id).toBe(a.id);
    expect(await prisma.groupTeacher.count()).toBe(1);
    expect(await listGroupTeachers()).toMatchObject([{ personId: teacher.id, communityId: g.id, days: [] }]);
  });

  it('lets a teacher teach only in their groups, the central admin everywhere, and nobody else anywhere', async () => {
    const g1 = await group('One');
    const g2 = await group('Two');
    const teacher = await person('Teacher');
    const admin = await person('Admin', { admin: true });
    const plain = await person('Plain');
    const row = await addGroupTeacher(teacher.id, g1.id);
    expect([await canTeachIn(teacher.id, g1.id), await canTeachIn(teacher.id, g2.id)]).toEqual([true, false]);
    expect([await canTeachIn(admin.id, g1.id), await canTeachIn(admin.id, g2.id)]).toEqual([true, true]);
    expect(await canTeachIn(plain.id, g1.id)).toBe(false);
    expect([await teachesAnywhere(teacher.id), await teachesAnywhere(plain.id), await teachesAnywhere(admin.id)]).toEqual([true, false, true]);
    await removeGroupTeacher(row.id);
    expect(await canTeachIn(teacher.id, g1.id)).toBe(false);
  });
});

describe('teaching days', () => {
  it('takes a weekday that repeats or one date, checks them, and ignores the same one twice', async () => {
    const g = await group();
    const row = await addGroupTeacher((await person('Teacher')).id, g.id);
    const now = at('2026-12-02T10:00:00Z'); // Wednesday 2 December
    await addTeachingDay(row.id, { dayOfWeek: 3, time: '07:00' }, now);
    await addTeachingDay(row.id, { dayOfWeek: 3, time: '07:00' }, now);
    await addTeachingDay(row.id, { date: '2026-12-10', time: '18:30' }, now);
    expect((await listGroupTeachers())[0].days.map((d) => [d.dayOfWeek, d.date, d.time])).toEqual([[null, '2026-12-10', '18:30'], [3, null, '07:00']]);
    const bad = (input: Parameters<typeof addTeachingDay>[1]) => addTeachingDay(row.id, input, now);
    await expect(bad({ time: '07:00' })).rejects.toMatchObject({ code: 'BAD_DAY' });
    await expect(bad({ dayOfWeek: 3, date: '2026-12-10', time: '07:00' })).rejects.toMatchObject({ code: 'BAD_DAY' });
    await expect(bad({ dayOfWeek: 9, time: '07:00' })).rejects.toMatchObject({ code: 'BAD_DAY' });
    await expect(bad({ dayOfWeek: 3, time: '7am' })).rejects.toMatchObject({ code: 'BAD_TIME' });
    await expect(bad({ date: '2026-12-01', time: '07:00' })).rejects.toMatchObject({ code: 'PAST' });
    await expect(bad({ date: 'soon', time: '07:00' })).rejects.toMatchObject({ code: 'BAD_DATE' });
    await expect(addTeachingDay('nope', { dayOfWeek: 1, time: '07:00' }, now)).rejects.toBeInstanceOf(TeacherError);
  });

  it('works in Cameroon time: the date and the weekday change one hour before midnight UTC', () => {
    expect(cameroonParts(at('2026-12-02T22:59:00Z'))).toMatchObject({ dateKey: '2026-12-02', weekday: 3 });
    expect(cameroonParts(at('2026-12-02T23:00:00Z'))).toMatchObject({ dateKey: '2026-12-03', weekday: 4, minute: 0 });
    expect(cameroonParts(at('2026-12-06T12:00:00Z')).weekday).toBe(7); // Sunday is 7
    expect(startsAtOf('2026-12-02', 7 * 60).toISOString()).toBe('2026-12-02T06:00:00.000Z');
  });

  it('says who teaches today in this group, earliest first, for a weekly day and for a date, and never in another group', async () => {
    const g = await group();
    const other = await group('Other');
    const a = await person('Alpha');
    const b = await person('Beta');
    const ra = await addGroupTeacher(a.id, g.id);
    const rb = await addGroupTeacher(b.id, g.id);
    const ro = await addGroupTeacher(a.id, other.id);
    const now = at('2026-12-02T06:30:00Z'); // Wednesday, 07:30 in Cameroon
    await addTeachingDay(ra.id, { dayOfWeek: 3, time: '18:00' }, now);
    await addTeachingDay(rb.id, { date: '2026-12-02', time: '07:00' }, now);
    await addTeachingDay(rb.id, { dayOfWeek: 4, time: '07:00' }, now); // Thursday: not today
    await addTeachingDay(ro.id, { dayOfWeek: 3, time: '09:00' }, now);
    const today = await teachingToday(g.id, now);
    expect(today.map((t) => [t.name.split(' ')[0], t.startsAt, t.passed])).toEqual([['Beta', '2026-12-02T06:00:00.000Z', false], ['Alpha', '2026-12-02T17:00:00.000Z', false]]);
    expect((await teachingToday(g.id, at('2026-12-02T09:00:00Z')))[0].passed).toBe(true); // two hours after it began
    expect(await teachingToday(g.id, at('2026-12-05T10:00:00Z'))).toEqual([]);
  });
});

describe('a teacher teaching with Send later', () => {
  const NOW = at('2026-12-01T09:00:00Z');
  const clip = async (groupId: string) => {
    const storageKey = `communities/${groupId}/attachments/${crypto.randomUUID()}`;
    stored.set(storageKey, Buffer.alloc(2000, 5));
    return { language: 'fr' as const, storageKey, mimeType: 'audio/webm', byteSize: 2000 };
  };

  it('schedules in their own group only, posts under their name, and stops posting when they are taken off', async () => {
    const mine = await group('Mine');
    const notMine = await group('NotMine');
    const teacher = await person('Teacher');
    const row = await addGroupTeacher(teacher.id, mine.id);
    await expect(createScheduled(teacher.id, { communityId: notMine.id, postAt: at('2026-12-01T12:00:00Z'), liveTeaching: false, clips: [await clip(notMine.id)] }, NOW)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const made = await createScheduled(teacher.id, { communityId: mine.id, postAt: at('2026-12-01T12:00:00Z'), liveTeaching: true, clips: [await clip(mine.id)] }, NOW);
    expect((await listScheduled(teacher.id, NOW)).map((x) => x.id)).toEqual([made.id]);
    expect(await postDueScheduledTeachings(at('2026-12-01T12:01:00Z'))).toBe(1);
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { communityId: mine.id } });
    const message = await prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id, kind: 'USER' } });
    expect([message.senderPersonId, message.liveTeaching]).toEqual([teacher.id, true]);
    // taken off the group: a waiting teaching is not posted any more
    const second = await createScheduled(teacher.id, { communityId: mine.id, postAt: at('2026-12-01T15:00:00Z'), liveTeaching: false, clips: [await clip(mine.id)] }, NOW);
    await removeGroupTeacher(row.id);
    expect(await postDueScheduledTeachings(at('2026-12-01T15:01:00Z'))).toBe(0);
    expect((await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id: second.id } })).status).not.toBe('POSTED');
  });
});

describe('reminders to the teacher', () => {
  async function setUp(language: 'en' | 'fr' = 'en') {
    const admin = await person('Admin', { admin: true });
    const g = await group('Reminder group');
    const teacher = await person('Teacher', { language });
    const row = await addGroupTeacher(teacher.id, g.id);
    return { admin, g, teacher, row };
  }
  // The private messages the teacher received (the teacher is the member side of the chat; the central admin writes).
  const messagesTo = async (personId: string) => {
    const rows = await prisma.privateMessage.findMany({ where: { conversation: { memberPersonId: personId }, NOT: { senderPersonId: personId } }, orderBy: { createdAt: 'asc' } });
    return rows.map((m) => m.body);
  };

  it('the evening before: once, in the teacher’s language, with the group, the time and how to record it ahead', async () => {
    const { teacher, row } = await setUp('fr');
    await addTeachingDay(row.id, { dayOfWeek: 4, time: '07:00' }, at('2026-12-02T10:00:00Z')); // Thursdays
    expect(await sendTeachingDayReminders(at('2026-12-02T15:59:00Z'))).toEqual({ dayBefore: 0, nothingRecorded: 0 }); // 16:59 in Cameroon: too early
    expect((await sendTeachingDayReminders(at('2026-12-02T16:05:00Z'))).dayBefore).toBe(1); // 17:05
    expect((await sendTeachingDayReminders(at('2026-12-02T17:00:00Z'))).dayBefore).toBe(0); // never twice
    const [text] = await messagesTo(teacher.id);
    expect(text).toContain('Demain, vous enseignez');
    expect(text).toContain('07:00');
    expect(text).toContain('Envoyer plus tard');
    expect(text).toContain('/member/me?tab=scheduled');
  });

  it('on the day, three hours before: only when nothing is recorded for that day', async () => {
    const { teacher, g, row } = await setUp();
    await addTeachingDay(row.id, { dayOfWeek: 4, time: '12:00' }, at('2026-12-02T10:00:00Z'));
    expect((await sendTeachingDayReminders(at('2026-12-03T07:00:00Z'))).nothingRecorded).toBe(0); // 08:00: 4 hours before
    expect((await sendTeachingDayReminders(at('2026-12-03T08:30:00Z'))).nothingRecorded).toBe(1); // 09:30: inside the 3 hours
    expect((await sendTeachingDayReminders(at('2026-12-03T09:00:00Z'))).nothingRecorded).toBe(0); // once
    expect((await messagesTo(teacher.id)).pop()).toContain('nothing is recorded yet');
    // with a teaching already scheduled that day, no message is sent
    const second = await setUp();
    await addTeachingDay(second.row.id, { dayOfWeek: 4, time: '12:00' }, at('2026-12-02T10:00:00Z'));
    await prisma.scheduledTeaching.create({ data: { communityId: second.g.id, authorPersonId: second.teacher.id, postAt: at('2026-12-03T11:00:00Z'), clips: { create: [{ position: 0, language: 'en', storageKey: `k-${Date.now()}-${n}`, mimeType: 'audio/webm', byteSize: 10 }] } } });
    expect((await sendTeachingDayReminders(at('2026-12-03T08:30:00Z'))).nothingRecorded).toBe(0);
    void g;
  });
});

describe('the doors', () => {
  async function signedIn(personId: string) {
    const account = await prisma.memberAccount.findFirstOrThrow({ where: { personId } });
    const raw = request.agent(app);
    const ip = `10.193.${Math.floor(n / 256) % 256}.${n % 256}`;
    const { csrf } = await bootstrap(raw as any);
    const login = await raw.post('/api/member/auth/login').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email: account.email, password: PASSWORD });
    if (login.body.codeRequired) {
      const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
      await raw.post('/api/member/auth/login').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email: account.email, password: PASSWORD });
      const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
      await raw.post('/api/member/auth/verify-code').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email: account.email, code });
      spy.mockRestore();
    }
    const call = (m: 'get' | 'post' | 'delete', path: string) => (raw as any)[m](path).set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf);
    return { get: (p: string) => call('get', p), post: (p: string) => call('post', p), del: (p: string) => call('delete', p) };
  }

  it('the central admin makes teachers and sets their days; nobody else can; the group sees who teaches today and who may teach', async () => {
    const admin = await person('Admin', { admin: true });
    const teacher = await person('Teacher');
    const member = await person('Member');
    const g = await group('Door group');
    const other = await group('Other door group');
    await join(g.id, teacher.id);
    await join(g.id, member.id);
    await join(other.id, teacher.id);
    const a = await signedIn(admin.id);
    const t = await signedIn(teacher.id);
    const m = await signedIn(member.id);

    expect((await t.get('/api/member/central-teachers')).status).toBe(403);
    expect((await t.post('/api/member/central-teachers').send({ personId: teacher.id, communityId: g.id })).status).toBe(403);
    const added = await a.post('/api/member/central-teachers').send({ personId: teacher.id, communityId: g.id });
    expect(added.status).toBe(201);
    const id = added.body.teachers[0].id as string;
    const found = await a.get(`/api/member/central-teachers/groups?search=Door`);
    expect(found.body.items.map((x: any) => x.id)).toContain(g.id);
    expect((await a.post(`/api/member/central-teachers/${id}/days`).send({ dayOfWeek: cameroonParts(new Date()).weekday, time: '07:00' })).status).toBe(201);
    expect((await a.post(`/api/member/central-teachers/${id}/days`).send({ time: '07:00' })).status).toBe(400);

    // who may post a teaching in which group
    expect((await t.get(`/api/communities/${g.id}/conversation`)).body.canPostTeaching).toBe(true);
    expect((await t.get(`/api/communities/${other.id}/conversation`)).body.canPostTeaching).toBe(false);
    expect((await m.get(`/api/communities/${g.id}/conversation`)).body.canPostTeaching).toBe(false);
    expect((await t.get('/api/member/auth/me')).body.member.canTeach).toBe(true);
    expect((await m.get('/api/member/auth/me')).body.member.canTeach).toBe(false);

    // every member of the group sees who teaches today; a stranger to the group does not
    const today = await m.get(`/api/communities/${g.id}/conversation/teaching-today`);
    expect(today.status).toBe(200);
    expect(today.body.items).toHaveLength(1);
    expect(today.body.items[0].name).toContain('Teacher');
    expect((await m.get(`/api/communities/${other.id}/conversation/teaching-today`)).status).toBe(403);

    const removed = await a.del(`/api/member/central-teachers/${id}`);
    expect(removed.body.teachers).toEqual([]);
    expect((await t.get(`/api/communities/${g.id}/conversation`)).body.canPostTeaching).toBe(false);
    const logs = await prisma.auditLog.findMany({ where: { targetId: id } });
    expect(logs.map((l) => l.action).sort()).toEqual(['GROUP_TEACHER_ADDED', 'GROUP_TEACHER_REMOVED']);
  });
});
