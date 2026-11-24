import crypto from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../lib/storage', () => ({
  isStorageConfigured: vi.fn(() => true),
  createUploadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({ url: `https://mock-r2.example/upload/${storageKey}`, expiresAt: new Date(Date.now() + 5 * 60 * 1000) })),
  createDownloadUrl: vi.fn(async ({ storageKey }: { storageKey: string }) => ({ url: `https://mock-r2.example/download/${storageKey}`, expiresAt: new Date(Date.now() + 5 * 60 * 1000) })),
  headObject: vi.fn(async () => null),
}));
// The phone alerts are captured instead of sent: each call is the list of people and the alert built for English and for French.
const pushed: { to: string[]; en: any; fr: any }[] = [];
vi.mock('../lib/pushLocalized', () => ({
  pushToPersonsLocalized: vi.fn(async (to: string[], build: (french: boolean) => unknown) => {
    pushed.push({ to, en: build(false), fr: build(true) });
  }),
}));

import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { EmailService } from '../lib/email';
import * as storage from '../lib/storage';
import { bootstrap } from './testUtils';
import { announceTeachingAudio } from '../lib/teachingLive';
import { cameroonParts } from '../lib/groupTeachers';
import { loadPlan, updateSettings } from '../lib/teachingRota';

// When someone who is teaching sends their voice notes in the group, the whole group is told: a loud phone alert and a bell entry
// for the first one, a quiet alert for each further one. Everyone else's messages are left alone.
const app = createApp();
let n = 0;
const at = (iso: string) => new Date(iso);

async function person(name: string, language: 'en' | 'fr' = 'en') {
  n += 1;
  return prisma.person.create({ data: { name: `${name} ${n}`, whatsappNumber: `+2377300${String(n).padStart(5, '0')}`, profileCompletedAt: new Date(), preferredLanguage: language } });
}
async function group(memberIds: string[]) {
  n += 1;
  const g = await prisma.community.create({ data: { name: `Leadership Development ${n}` } });
  for (const personId of memberIds) await prisma.communityMembership.create({ data: { personId, communityId: g.id, status: 'ACTIVE' } });
  return g;
}
const textOf = (topic: string, lang: 'en' | 'fr' = 'en') => ({ topic: `${topic}${lang === 'fr' ? ' (fr)' : ''}`, bookTitle: 'Book', chapter: 'Chapter 1', teachingOn: 'On this', help: 'Help', meaning: 'Meaning', startLabel: 'Start with this', start: 'Start', ifNotLabel: 'If not', ifNot: 'If not', dominion: 'Dominion', verses: ['John 1:1'] });
const topic = (number: number) => ({ number, kind: 'key' as const, en: textOf(`Topic ${number}`), fr: textOf(`Topic ${number}`, 'fr') });
const bells = (personId: string) => prisma.notification.findMany({ where: { recipientPersonId: personId, type: 'TEACHING_ROTA' } });
const input = (teacher: { id: string; name: string }, g: { id: string; name: string }, recipients: string[], now: Date) => ({ teacherPersonId: teacher.id, teacherName: teacher.name, communityId: g.id, communityName: g.name, recipientIds: recipients, now });

beforeEach(async () => {
  pushed.length = 0;
  await prisma.teachingRating.deleteMany();
  await prisma.teachingReminderLog.deleteMany();
  await prisma.teachingTeacher.deleteMany();
  await prisma.teachingTopic.deleteMany();
  await prisma.teachingSettings.deleteMany();
});
afterEach(() => vi.restoreAllMocks());

describe('A teacher on the weekly rota sends their voice notes', () => {
  // Alpha teaches Monday 23 Nov 2026 at 07:00 Cameroon time = 06:00 UTC; the topic is Topic 1.
  async function setUp() {
    const alpha = await person('Alpha');
    const listener = await person('Listener', 'fr');
    const other = await person('Other');
    await loadPlan({ startDate: '2026-11-23', topics: [topic(1), topic(2)], teachers: [{ name: 'Alpha Tester', startTopic: 1, dayOfWeek: 1, startTime: '07:00' }] } as any);
    await prisma.teachingTeacher.updateMany({ where: { name: 'Alpha Tester' }, data: { personId: alpha.id } });
    const g = await group([alpha.id, listener.id, other.id]);
    await updateSettings({ enabled: true, frenchChecked: true, ratersCommunityId: g.id });
    return { alpha, listener, other, g };
  }

  it('tells the whole group once, loudly, with a bell entry that opens the group, then quietly for each further audio', async () => {
    const { alpha, listener, other, g } = await setUp();
    const everyone = [alpha.id, listener.id, other.id];
    expect(await announceTeachingAudio(input(alpha, g, everyone, at('2026-11-23T06:05:00Z')))).toBe(true);

    // The first audio: a loud alert that stays until tapped, to everyone but the teacher, worded for each language.
    expect(pushed).toHaveLength(1);
    expect(pushed[0].to.sort()).toEqual([listener.id, other.id].sort());
    expect(pushed[0].en).toMatchObject({ title: `🔴 ${alpha.name} is teaching now`, urgent: true, url: `/member/chats/group/${g.id}` });
    expect(pushed[0].en.body).toBe(`Topic 1 · ${g.name}`);
    expect(pushed[0].fr).toMatchObject({ title: `🔴 ${alpha.name} enseigne maintenant`, urgent: true });
    expect(pushed[0].fr.body).toBe(`Topic 1 (fr) · ${g.name}`);
    // And in the bell, for everyone but the teacher.
    expect(await bells(alpha.id)).toHaveLength(0);
    const entry = (await bells(listener.id))[0];
    expect(entry).toMatchObject({ targetType: 'TeachingLive', targetId: g.id });
    expect(entry.metadata).toMatchObject({ kind: 'live', teacherName: alpha.name, groupName: g.name, topicEn: 'Topic 1', topicFr: 'Topic 1 (fr)', communityId: g.id });
    expect(await bells(other.id)).toHaveLength(1);

    // The second and third audio of the same teaching: only a quiet alert, no second bell entry, not "stay until tapped".
    expect(await announceTeachingAudio(input(alpha, g, everyone, at('2026-11-23T06:20:00Z')))).toBe(true);
    expect(await announceTeachingAudio(input(alpha, g, everyone, at('2026-11-23T06:40:00Z')))).toBe(true);
    expect(pushed).toHaveLength(3);
    expect(pushed[1].en).toMatchObject({ title: `🎙️ ${alpha.name} · new teaching audio`, body: g.name });
    expect(pushed[1].en.urgent).toBeUndefined();
    expect(pushed[1].fr.title).toBe(`🎙️ ${alpha.name} · nouvel audio d'enseignement`);
    expect(await bells(listener.id)).toHaveLength(1);
  });

  it('counts audios from half an hour before the slot until six hours after it, and not outside that', async () => {
    const { alpha, g, listener } = await setUp();
    const ok = (iso: string) => announceTeachingAudio(input(alpha, g, [listener.id], at(iso)));
    expect(await ok('2026-11-23T05:29:00Z')).toBe(false); // 31 minutes before
    expect(await ok('2026-11-23T05:30:00Z')).toBe(true); // 30 minutes before
    expect(await ok('2026-11-23T11:59:00Z')).toBe(true); // just under 6 hours after
    expect(await ok('2026-11-23T12:00:00Z')).toBe(false); // 6 hours after
    // The next week's slot is announced again (a new teaching).
    expect(await ok('2026-11-30T06:05:00Z')).toBe(true);
    expect(await bells(listener.id)).toHaveLength(2);
  });

  it('leaves everyone else alone: another member, another group, or the rota switched off', async () => {
    const { alpha, listener, other, g } = await setUp();
    const elsewhere = await group([alpha.id, listener.id]);
    expect(await announceTeachingAudio(input(listener, g, [alpha.id, other.id], at('2026-11-23T06:05:00Z')))).toBe(false); // not a teacher
    expect(await announceTeachingAudio(input(alpha, elsewhere, [listener.id], at('2026-11-23T06:05:00Z')))).toBe(false); // not the teaching group
    await updateSettings({ enabled: false });
    expect(await announceTeachingAudio(input(alpha, g, [listener.id], at('2026-11-23T06:05:00Z')))).toBe(false); // rota off
    expect(pushed).toHaveLength(0);
    expect(await bells(listener.id)).toHaveLength(0);
  });
});

describe('A group teacher sends their voice notes on a teaching day', () => {
  async function setUp() {
    const teacher = await person('Teacher');
    const listener = await person('Listener');
    const g = await group([teacher.id, listener.id]);
    const gt = await prisma.groupTeacher.create({ data: { personId: teacher.id, communityId: g.id } });
    return { teacher, listener, g, gt };
  }

  it('tells the group once for the day (no topic is known for these teachings)', async () => {
    const { teacher, listener, g, gt } = await setUp();
    // Wednesday 25 Nov 2026, 07:00 Cameroon time = 06:00 UTC.
    await prisma.teachingDay.create({ data: { groupTeacherId: gt.id, dayOfWeek: 3, startMinute: 7 * 60 } });
    expect(await announceTeachingAudio(input(teacher, g, [listener.id], at('2026-11-25T06:10:00Z')))).toBe(true);
    expect(pushed[0].en).toMatchObject({ title: `🔴 ${teacher.name} is teaching now`, urgent: true, body: g.name });
    expect((await bells(listener.id))[0].metadata).toMatchObject({ kind: 'live', topicEn: null, communityId: g.id });
    expect(await announceTeachingAudio(input(teacher, g, [listener.id], at('2026-11-25T07:00:00Z')))).toBe(true);
    expect(await bells(listener.id)).toHaveLength(1);
    // Another day, or far from the teaching time: an ordinary message.
    expect(await announceTeachingAudio(input(teacher, g, [listener.id], at('2026-11-26T06:10:00Z')))).toBe(false);
    expect(await announceTeachingAudio(input(teacher, g, [listener.id], at('2026-11-25T15:00:00Z')))).toBe(false); // 9 hours after
  });

  it('a one-off teaching date works too', async () => {
    const { teacher, listener, g, gt } = await setUp();
    await prisma.teachingDay.create({ data: { groupTeacherId: gt.id, date: '2026-12-02', startMinute: 18 * 60 } });
    expect(await announceTeachingAudio(input(teacher, g, [listener.id], at('2026-12-02T17:30:00Z')))).toBe(true);
    expect(await announceTeachingAudio(input(teacher, g, [listener.id], at('2026-12-09T17:30:00Z')))).toBe(false);
  });
});

describe('Sending a voice note in the group (the real route)', () => {
  let ipCounter = 0;
  async function signedIn(personId: string, email: string) {
    ipCounter += 1;
    const ip = `10.141.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`;
    await prisma.memberAccount.create({ data: { personId, email } });
    const raw = request.agent(app);
    const { csrf } = await bootstrap(raw as any);
    const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
    await raw.post('/api/member/auth/request-code').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email });
    const code = spy.mock.calls[0][0].code as string;
    spy.mockRestore();
    await raw.post('/api/member/auth/verify-code').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, code });
    return { csrf, post: (path: string, body: object) => raw.post(path).set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send(body) };
  }
  const voice = (communityId: string) => ({ storageKey: `communities/${communityId}/attachments/${crypto.randomUUID()}`, originalFilename: 'voice-note.m4a', mimeType: 'audio/mp4', byteSize: 48_000, durationMs: 9_000 });
  const settle = () => new Promise((r) => setTimeout(r, 250)); // the alerts are sent just after the reply

  it('alerts the whole group when the teacher sends audio during their teaching, and not when an ordinary member does', async () => {
    const teacher = await person('Teacher');
    const member = await person('Member');
    const listener = await person('Listener');
    const g = await group([teacher.id, member.id, listener.id]);
    const now = new Date();
    const { weekday, minute } = cameroonParts(now);
    const gt = await prisma.groupTeacher.create({ data: { personId: teacher.id, communityId: g.id } });
    await prisma.teachingDay.create({ data: { groupTeacherId: gt.id, dayOfWeek: weekday, startMinute: Math.max(0, minute - 5) } });
    vi.mocked(storage.headObject).mockResolvedValue({ contentLength: 48_000, contentType: 'audio/mp4' } as any);
    const t = await signedIn(teacher.id, `teach-live-${n}@example.com`);
    const m = await signedIn(member.id, `member-live-${n}@example.com`);

    // An ordinary member's voice note: no teaching alert, no bell entry.
    expect((await m.post(`/api/communities/${g.id}/conversation/messages`, { attachments: [voice(g.id)] })).status).toBe(201);
    await settle();
    expect(pushed).toHaveLength(0);
    expect(await bells(listener.id)).toHaveLength(0);

    // The teacher's voice note: everyone else is told.
    expect((await t.post(`/api/communities/${g.id}/conversation/messages`, { attachments: [voice(g.id)] })).status).toBe(201);
    await settle();
    expect(pushed).toHaveLength(1);
    expect(pushed[0].to.sort()).toEqual([member.id, listener.id].sort());
    expect(pushed[0].en.title).toBe(`🔴 ${teacher.name} is teaching now`);
    expect(await bells(listener.id)).toHaveLength(1);
    expect(await bells(member.id)).toHaveLength(1);
    expect(await bells(teacher.id)).toHaveLength(0);

    // A second audio: quiet alert only.
    expect((await t.post(`/api/communities/${g.id}/conversation/messages`, { attachments: [voice(g.id)] })).status).toBe(201);
    await settle();
    expect(pushed).toHaveLength(2);
    expect(pushed[1].en.title).toContain('new teaching audio');
    expect(await bells(listener.id)).toHaveLength(1);

    // A text message from the teacher is an ordinary group message.
    expect((await t.post(`/api/communities/${g.id}/conversation/messages`, { body: 'Please read John 1 first.' })).status).toBe(201);
    await settle();
    expect(pushed).toHaveLength(2);
    vi.mocked(storage.headObject).mockResolvedValue(null);
  });
});
