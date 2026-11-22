import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../app';
import { EmailService } from '../lib/email';
import { bootstrap } from './testUtils';
import { prisma } from '../lib/prisma';
import { approveScheduled, clearScheduledQuiz, createScheduled, deleteScheduled, listScheduled, postDueScheduledTeachings, postScheduledNow, retryPendingScheduled, retryScheduledText, saveScheduledText, setScheduledQuiz, updateScheduled } from '../lib/scheduledTeachings';

// "Send later": a voice teaching recorded now and posted in a group at a chosen time. The words are written from the recording,
// the author corrects and approves them in their own language, and the other language is made automatically (one recording) or is
// the author's own words (an English and a French recording). Storage and the writer/translator are faked. Names are made up.
const stored = new Map<string, Buffer>();
const translateText = vi.fn();
const transcribeAudioOnly = vi.fn();
vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  isStorageConfigured: () => true,
  createDownloadUrl: async ({ storageKey }: { storageKey: string }) => ({ url: `https://download.example/${storageKey}`, expiresAt: new Date() }),
  headObject: async ({ storageKey }: { storageKey: string }) => (stored.has(storageKey) ? { contentLength: stored.get(storageKey)!.length, contentType: 'audio/webm' } : null),
  getObjectStream: async ({ storageKey }: { storageKey: string }) => (stored.has(storageKey) ? { body: Readable.from([stored.get(storageKey)!]), contentLength: stored.get(storageKey)!.length } : null),
  deleteObject: async ({ storageKey }: { storageKey: string }) => void stored.delete(storageKey),
}));
const storeAudio = vi.fn(async () => undefined);
const storeBody = vi.fn(async () => undefined);
vi.mock('../lib/translation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/translation')>()),
  isTranslationConfigured: () => true,
  transcribeAudioOnly: (...args: unknown[]) => transcribeAudioOnly(...args),
  translateText: (...args: unknown[]) => translateText(...args),
  transcribeAndStoreMessageAudio: (...args: unknown[]) => storeAudio(...(args as [])),
  translateAndStoreMessage: (...args: unknown[]) => storeBody(...(args as [])),
}));

let n = 0;
const NOW = new Date('2026-12-01T09:00:00Z');
const LATER = new Date('2026-12-01T12:00:00Z');

async function setUp() {
  n += 1;
  const person = await prisma.person.create({ data: { name: `Admin ${n}`, whatsappNumber: `+2377800${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.user.create({ data: { name: 'Central', email: `sched-admin-${n}-${Date.now()}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
  const group = await prisma.community.create({ data: { name: `Group ${n}` } });
  const other = await prisma.person.create({ data: { name: `Member ${n}`, whatsappNumber: `+2377801${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
  await prisma.communityMembership.create({ data: { communityId: group.id, personId: other.id, status: 'ACTIVE' } as any }).catch(() => {});
  return { person, group, other };
}
async function clip(groupId: string, language: 'en' | 'fr', bytes = 4000) {
  const storageKey = `communities/${groupId}/attachments/${crypto.randomUUID()}`;
  stored.set(storageKey, Buffer.alloc(bytes, language === 'en' ? 7 : 9));
  return { language, storageKey, mimeType: 'audio/webm', byteSize: bytes };
}
// Each recording is told apart by its bytes, so the two written at the same moment never swap.
const bothLanguages = () =>
  transcribeAudioOnly.mockImplementation(async (b64: string) =>
    Buffer.from(b64, 'base64')[0] === 7 ? { detectedLanguage: 'en', transcript: 'Hello everyone.' } : { detectedLanguage: 'fr', transcript: 'Bonjour à tous.' },
  );
const words = (text: string) => transcribeAudioOnly.mockResolvedValueOnce({ detectedLanguage: 'fr', transcript: text });
const status = async (id: string) => (await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id } })).status;
const textReady = (id: string) => vi.waitFor(async () => expect(await status(id)).toBe('TEXT_READY'));

beforeEach(async () => {
  stored.clear();
  translateText.mockReset();
  transcribeAudioOnly.mockReset();
  storeAudio.mockClear();
  storeBody.mockClear();
  transcribeAudioOnly.mockResolvedValue({ detectedLanguage: 'fr', transcript: 'Le Seigneur est mon berger.' });
  translateText.mockResolvedValue({ detectedLanguage: 'fr', translatedBody: 'The Lord is my shepherd.' });
  await prisma.scheduledTeaching.deleteMany();
});
afterEach(() => vi.restoreAllMocks());

describe('scheduling a teaching', () => {
  it('is for the central admin only, needs a real group, a future time and real recordings', async () => {
    const { person, group, other } = await setUp();
    const c = await clip(group.id, 'fr');
    await expect(createScheduled(other.id, { communityId: group.id, postAt: LATER, liveTeaching: false, clips: [c] }, NOW)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(createScheduled(person.id, { communityId: 'nope', postAt: LATER, liveTeaching: false, clips: [c] }, NOW)).rejects.toMatchObject({ code: 'NO_GROUP' });
    await expect(createScheduled(person.id, { communityId: group.id, postAt: new Date('2026-12-01T08:00:00Z'), liveTeaching: false, clips: [c] }, NOW)).rejects.toMatchObject({ code: 'PAST' });
    await expect(createScheduled(person.id, { communityId: group.id, postAt: new Date('2027-06-01T08:00:00Z'), liveTeaching: false, clips: [c] }, NOW)).rejects.toMatchObject({ code: 'TOO_FAR' });
    await expect(createScheduled(person.id, { communityId: group.id, postAt: LATER, liveTeaching: false, clips: [] }, NOW)).rejects.toMatchObject({ code: 'BAD_CLIPS' });
    await expect(createScheduled(person.id, { communityId: group.id, postAt: LATER, liveTeaching: false, clips: [c, await clip(group.id, 'fr')] }, NOW)).rejects.toMatchObject({ code: 'BAD_CLIPS' });
    await expect(createScheduled(person.id, { communityId: group.id, postAt: LATER, liveTeaching: false, clips: [{ ...c, storageKey: 'communities/other/attachments/x' }] }, NOW)).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(createScheduled(person.id, { communityId: group.id, postAt: LATER, liveTeaching: false, clips: [{ ...c, storageKey: `communities/${group.id}/attachments/${crypto.randomUUID()}` }] }, NOW)).rejects.toMatchObject({ code: 'NOT_UPLOADED' });
    await expect(createScheduled(person.id, { communityId: group.id, postAt: LATER, liveTeaching: false, clips: [{ ...c, mimeType: 'application/pdf' }] }, NOW)).rejects.toMatchObject({ code: 'BAD_TYPE' });
    expect(await prisma.scheduledTeaching.count()).toBe(0);
  });

  it('with one recording: writes the words in the language spoken, the author corrects them, and the other language is made only after approval', async () => {
    const { person, group } = await setUp();
    const made = await createScheduled(person.id, { communityId: group.id, postAt: LATER, liveTeaching: false, clips: [await clip(group.id, 'fr')] }, NOW);
    expect(made).toMatchObject({ mode: 'single', spoken: 'fr', status: 'RECORDED' });
    await textReady(made.id);
    let row = await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id: made.id } });
    expect([row.textFr, row.textEn]).toEqual(['Le Seigneur est mon berger.', null]);
    expect(translateText).not.toHaveBeenCalled();
    const fixed = await saveScheduledText(person.id, made.id, { textFr: 'Le Seigneur est mon berger, je ne manquerai de rien.' }, NOW);
    expect(fixed).toMatchObject({ status: 'TEXT_READY', textFr: 'Le Seigneur est mon berger, je ne manquerai de rien.', textEn: '' });
    await approveScheduled(person.id, made.id, NOW);
    await vi.waitFor(async () => expect((await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id: made.id } })).textEn).toBe('The Lord is my shepherd.'));
    row = await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id: made.id } });
    expect(row.translatedInto).toBe('en');
    expect(translateText).toHaveBeenCalledWith('Le Seigneur est mon berger, je ne manquerai de rien.');
    // changing the spoken words again takes the approval and the automatic other language away
    const again = await saveScheduledText(person.id, made.id, { textFr: 'Autre mot.', textEn: 'ignored: the English is made by the app' }, NOW);
    expect(again).toMatchObject({ status: 'TEXT_READY', textFr: 'Autre mot.', textEn: '', autoTranslated: null });
  });

  it('with an English and a French recording: each language is its own words and nothing is translated', async () => {
    const { person, group } = await setUp();
    bothLanguages();
    const made = await createScheduled(person.id, { communityId: group.id, postAt: LATER, liveTeaching: true, clips: [await clip(group.id, 'en'), await clip(group.id, 'fr')] }, NOW);
    expect(made.mode).toBe('pair');
    await textReady(made.id);
    const row = await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id: made.id } });
    expect([row.textEn, row.textFr]).toEqual(['Hello everyone.', 'Bonjour à tous.']);
    const fixed = await saveScheduledText(person.id, made.id, { textEn: 'Hello, everyone.', textFr: 'Bonjour, à tous.' }, NOW);
    expect([fixed.textEn, fixed.textFr]).toEqual(['Hello, everyone.', 'Bonjour, à tous.']);
    await approveScheduled(person.id, made.id, NOW);
    expect(translateText).not.toHaveBeenCalled();
  });

  it('says so when the words of a recording could not be written, and trying again writes them', async () => {
    const { person, group } = await setUp();
    transcribeAudioOnly.mockReset();
    transcribeAudioOnly.mockResolvedValueOnce(null);
    const made = await createScheduled(person.id, { communityId: group.id, postAt: LATER, liveTeaching: false, clips: [await clip(group.id, 'en')] }, NOW);
    await vi.waitFor(async () => expect(await status(made.id)).toBe('FAILED'));
    expect((await listScheduled(person.id, NOW))[0].clips[0].textState).toBe('FAILED');
    words('Hello again.');
    await retryScheduledText(person.id, made.id, NOW);
    await textReady(made.id);
    expect((await listScheduled(person.id, NOW))[0]).toMatchObject({ textFr: '', status: 'TEXT_READY' });
    // the author can also type the words by hand
    const typed = await saveScheduledText(person.id, made.id, { textEn: 'My own words.' }, NOW);
    expect(typed.textEn).toBe('My own words.');
  });

  it('changes the time, refuses a past time, lists in order, and deletes with its recordings', async () => {
    const { person, group } = await setUp();
    const a = await clip(group.id, 'fr');
    const first = await createScheduled(person.id, { communityId: group.id, postAt: LATER, liveTeaching: false, clips: [a] }, NOW);
    const second = await createScheduled(person.id, { communityId: group.id, postAt: new Date('2026-12-01T10:00:00Z'), liveTeaching: false, clips: [await clip(group.id, 'en')] }, NOW);
    expect((await listScheduled(person.id, NOW)).map((x) => x.id)).toEqual([second.id, first.id]);
    await expect(updateScheduled(person.id, first.id, { postAt: new Date('2026-12-01T08:00:00Z') }, NOW)).rejects.toMatchObject({ code: 'PAST' });
    const moved = await updateScheduled(person.id, first.id, { postAt: new Date('2026-12-02T07:00:00Z'), liveTeaching: true }, NOW);
    expect([moved.postAt, moved.liveTeaching]).toEqual(['2026-12-02T07:00:00.000Z', true]);
    await deleteScheduled(person.id, first.id);
    expect(stored.has(a.storageKey)).toBe(false);
    expect((await listScheduled(person.id, NOW)).map((x) => x.id)).toEqual([second.id]);
  });
});

describe('posting at the time', () => {
  async function ready(clips: ('en' | 'fr')[] = ['fr'], approve = true) {
    const ctx = await setUp();
    if (clips.length === 2) bothLanguages();
    const made = await createScheduled(ctx.person.id, { communityId: ctx.group.id, postAt: LATER, liveTeaching: false, clips: await Promise.all(clips.map((l) => clip(ctx.group.id, l))) }, NOW);
    await textReady(made.id);
    if (approve) {
      await approveScheduled(ctx.person.id, made.id, NOW);
      if (clips.length === 1) await vi.waitFor(async () => expect((await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id: made.id } })).translatedInto).toBeTruthy());
    }
    return { ...ctx, made };
  }
  const messagesOf = async (groupId: string) => {
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { communityId: groupId } });
    return prisma.message.findMany({ where: { conversationId: conversation.id, kind: 'USER' }, include: { attachments: true } });
  };

  it('posts nothing early, then once, under the author’s name, with the voice and the words in both languages', async () => {
    const { person, group, made } = await ready();
    expect(await postDueScheduledTeachings(new Date('2026-12-01T11:59:00Z'))).toBe(0);
    expect(await postDueScheduledTeachings(new Date('2026-12-01T12:00:30Z'))).toBe(1);
    expect(await postDueScheduledTeachings(new Date('2026-12-01T12:05:00Z'))).toBe(0); // never twice
    const messages = await messagesOf(group.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ senderPersonId: person.id, transcribedBody: 'Le Seigneur est mon berger.', transcribedLanguage: 'fr', translatedTranscript: 'The Lord is my shepherd.', liveTeaching: false });
    expect(messages[0].attachments).toHaveLength(1);
    expect(messages[0].attachments[0].language).toBeNull(); // one recording is an ordinary voice note
    const row = await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id: made.id } });
    expect([row.status, row.messageId]).toEqual(['POSTED', messages[0].id]);
    await expect(saveScheduledText(person.id, made.id, { textFr: 'trop tard' }, new Date('2026-12-01T12:10:00Z'))).rejects.toMatchObject({ code: 'POSTED' });
  });

  it('posts an English and a French recording as a labelled pair, with the live mark, and each language’s own words', async () => {
    const { group } = await ready(['en', 'fr']);
    expect(await postDueScheduledTeachings(new Date('2026-12-01T12:01:00Z'))).toBe(1);
    const [message] = await messagesOf(group.id);
    expect(message.attachments.map((a) => a.language).sort()).toEqual(['en', 'fr']);
    expect([message.body, message.translatedBody, message.detectedLanguage]).toEqual(['Hello everyone.', 'Bonjour à tous.', 'en']);
  });

  it('still posts when the author did not finish: the words as they are, or the usual automatic writer when there are none', async () => {
    const { group } = await ready(['fr'], false); // words written but never approved: nothing translated yet
    expect(await postDueScheduledTeachings(new Date('2026-12-01T12:01:00Z'))).toBe(1);
    const [message] = await messagesOf(group.id);
    expect(message.transcribedBody).toBe('Le Seigneur est mon berger.');
    expect(message.translatedTranscript).toBe('The Lord is my shepherd.'); // one last try at the other language at posting time
    // no words at all: voice only, and the automatic writer takes over
    const ctx = await setUp();
    transcribeAudioOnly.mockResolvedValueOnce(null);
    const bare = await createScheduled(ctx.person.id, { communityId: ctx.group.id, postAt: LATER, liveTeaching: false, clips: [await clip(ctx.group.id, 'en')] }, NOW);
    await vi.waitFor(async () => expect(await status(bare.id)).toBe('FAILED'));
    expect(await postDueScheduledTeachings(new Date('2026-12-01T12:02:00Z'))).toBe(1);
    const [voice] = await messagesOf(ctx.group.id);
    expect(voice.transcribedBody).toBeNull();
    expect(storeAudio).toHaveBeenCalled();
  });

  it('"Post now" posts at once; a teaching long past is not posted by itself but waits for "Post now"', async () => {
    const { person, group, made } = await ready();
    const posted = await postScheduledNow(person.id, made.id, new Date('2026-12-01T09:30:00Z'));
    expect(posted.status).toBe('POSTED');
    expect(await messagesOf(group.id)).toHaveLength(1);
    const old = await ready(['en'], false);
    expect(await postDueScheduledTeachings(new Date('2026-12-05T12:00:00Z'))).toBe(0); // four days after its time
    expect((await listScheduled(old.person.id, new Date('2026-12-05T12:00:00Z')))[0].missed).toBe(true);
    expect((await postScheduledNow(old.person.id, old.made.id, new Date('2026-12-05T12:00:00Z'))).status).toBe('POSTED');
  });

  it('retries the other language of approved words that were not translated yet', async () => {
    const { person, group, made } = await ready(['fr'], false);
    translateText.mockResolvedValueOnce(null);
    await approveScheduled(person.id, made.id, NOW);
    await vi.waitFor(async () => expect((await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id: made.id } })).attempts).toBeGreaterThan(0));
    expect((await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id: made.id } })).textEn).toBeNull();
    await retryPendingScheduled();
    expect((await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id: made.id } })).textEn).toBe('The Lord is my shepherd.');
    void group;
  });
});

describe('the screens\' doors', () => {
  const app = createApp();
  const PASSWORD = 'GoodPass123!';
  async function signedIn(admin: boolean) {
    n += 1;
    const email = `schr${n}-${Date.now()}@example.com`;
    const person = await prisma.person.create({ data: { name: `Door ${n}`, whatsappNumber: `+2377810${String(n).padStart(5, '0')}`, profileCompletedAt: new Date() } });
    await prisma.memberAccount.create({ data: { personId: person.id, email, passwordHash: await bcrypt.hash(PASSWORD, 4) } });
    if (admin) await prisma.user.create({ data: { name: 'Central', email: `schr-admin-${n}-${Date.now()}@test.local`, passwordHash: 'x', role: 'ADMIN', personId: person.id } });
    const raw = request.agent(app);
    const ip = `10.192.${Math.floor(n / 256) % 256}.${n % 256}`;
    const { csrf } = await bootstrap(raw as any);
    const login = await raw.post('/api/member/auth/login').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
    if (login.body.codeRequired) {
      const spy = vi.spyOn(EmailService, 'sendMemberLoginLink').mockResolvedValue({ ok: true });
      await raw.post('/api/member/auth/login').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, password: PASSWORD });
      const code = spy.mock.calls[spy.mock.calls.length - 1][0].code as string;
      await raw.post('/api/member/auth/verify-code').set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf).send({ email, code });
      spy.mockRestore();
    }
    const call = (m: 'get' | 'post' | 'patch' | 'put' | 'delete', path: string) => (raw as any)[m](path).set('X-Forwarded-For', ip).set('X-CSRF-Token', csrf);
    return { person, get: (p: string) => call('get', p), post: (p: string) => call('post', p), patch: (p: string) => call('patch', p), del: (p: string) => call('delete', p) };
  }

  it('lets the central admin schedule, list, change the time and delete, and keeps everyone else out', async () => {
    const admin = await signedIn(true);
    const plain = await signedIn(false);
    const group = await prisma.community.create({ data: { name: `Door group ${n}` } });
    const c = await clip(group.id, 'fr');
    const postAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    expect((await plain.get('/api/member/scheduled-teachings')).status).toBe(403);
    expect((await plain.post('/api/member/scheduled-teachings').send({ communityId: group.id, postAt, clips: [c] })).status).toBe(403);
    const made = await admin.post('/api/member/scheduled-teachings').send({ communityId: group.id, postAt, liveTeaching: true, clips: [c] });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ mode: 'single', spoken: 'fr', liveTeaching: true });
    expect((await admin.get('/api/member/scheduled-teachings')).body.items).toHaveLength(1);
    const later = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    expect((await admin.patch(`/api/member/scheduled-teachings/${made.body.id}`).send({ postAt: later })).body.postAt).toBe(later);
    expect((await admin.post('/api/member/scheduled-teachings').send({ communityId: group.id, postAt: 'soon', clips: [c] })).status).toBe(400);
    expect((await plain.del(`/api/member/scheduled-teachings/${made.body.id}`)).status).toBe(403);
    expect((await admin.del(`/api/member/scheduled-teachings/${made.body.id}`)).status).toBe(200);
    expect((await admin.get('/api/member/scheduled-teachings')).body.items).toHaveLength(0);
    const logs = await prisma.auditLog.findMany({ where: { targetId: made.body.id } });
    expect(logs.map((l) => l.action).sort()).toEqual(['TEACHING_SCHEDULED', 'TEACHING_SCHEDULE_DELETED']);
  });
});

describe('a counted teaching: a quiz and a book source', () => {
  const quiz = (over: Record<string, unknown> = {}) => ({
    title: 'Faith that moves',
    passMark: 70,
    openDays: 7,
    questions: [{ textEn: 'What did Peter do?', options: [{ textEn: 'He walked on water', isCorrect: true }, { textEn: 'He stayed in the boat', isCorrect: false }] }],
    ...over,
  });
  async function oneRecording(approve = false) {
    const ctx = await setUp();
    const made = await createScheduled(ctx.person.id, { communityId: ctx.group.id, postAt: LATER, liveTeaching: false, clips: [await clip(ctx.group.id, 'fr')] }, NOW);
    await textReady(made.id);
    if (approve) {
      await approveScheduled(ctx.person.id, made.id, NOW);
      await vi.waitFor(async () => expect((await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id: made.id } })).translatedInto).toBeTruthy());
    }
    return { ...ctx, made };
  }

  it('is for the central admin only, with one recording, a title and a proper quiz', async () => {
    const { person, group, made } = await oneRecording();
    const teacher = await prisma.person.create({ data: { name: 'Teacher Q', whatsappNumber: '+237781999991', profileCompletedAt: new Date() } });
    await prisma.groupTeacher.create({ data: { personId: teacher.id, communityId: group.id } });
    const mine = await createScheduled(teacher.id, { communityId: group.id, postAt: LATER, liveTeaching: false, clips: [await clip(group.id, 'en')] }, NOW);
    await expect(setScheduledQuiz(teacher.id, mine.id, quiz(), NOW)).rejects.toMatchObject({ code: 'ONLY_ADMIN' });
    const bad = (over: Record<string, unknown>) => setScheduledQuiz(person.id, made.id, quiz(over) as any, NOW);
    await expect(bad({ title: ' ' })).rejects.toMatchObject({ code: 'BAD_TITLE' });
    await expect(bad({ questions: [] })).rejects.toMatchObject({ code: 'BAD_QUESTIONS' });
    await expect(bad({ questions: [{ textEn: 'Q?', options: [{ textEn: 'A', isCorrect: true }, { textEn: 'B', isCorrect: true }] }] })).rejects.toMatchObject({ code: 'BAD_QUESTIONS' }); // two correct answers
    await expect(bad({ questions: [{ textEn: 'Q?', options: [{ textEn: 'A', isCorrect: true }] }] })).rejects.toMatchObject({ code: 'BAD_QUESTIONS' }); // one answer only
    await expect(bad({ passMark: 0 })).rejects.toMatchObject({ code: 'BAD_PASS_MARK' });
    await expect(bad({ openDays: 90 })).rejects.toMatchObject({ code: 'BAD_OPEN_DAYS' });
    await expect(bad({ portion: { bookId: 'nope', page: 3 } })).rejects.toMatchObject({ code: 'NO_BOOK' });
    // an English and a French recording together cannot carry a quiz
    transcribeAudioOnly.mockResolvedValue({ detectedLanguage: 'en', transcript: 'Hi.' });
    const pair = await createScheduled(person.id, { communityId: group.id, postAt: LATER, liveTeaching: false, clips: [await clip(group.id, 'en'), await clip(group.id, 'fr')] }, NOW);
    await expect(setScheduledQuiz(person.id, pair.id, quiz(), NOW)).rejects.toMatchObject({ code: 'PAIR_NO_QUIZ' });
    const ok = await setScheduledQuiz(person.id, made.id, quiz(), NOW);
    expect(ok.quiz).toMatchObject({ title: 'Faith that moves', passMark: 70, openDays: 7, portion: null });
    const cleared = await clearScheduledQuiz(person.id, made.id, NOW);
    expect(cleared.quiz).toBeNull();
  });

  it('when it posts it becomes a teaching with a quiz, its recording and words, and the book source, not a plain voice message', async () => {
    const { person, group, made } = await oneRecording(true);
    const book = await prisma.libraryBook.create({ data: { kind: 'TRAINING', titleEn: 'Kingdom Keys' } as any });
    await setScheduledQuiz(person.id, made.id, quiz({ portion: { bookId: book.id, page: 14, label: 'Chapter 3' } }) as any, NOW);
    expect(await postDueScheduledTeachings(new Date('2026-12-01T12:01:00Z'))).toBe(1);
    const teaching = await prisma.teaching.findFirstOrThrow({ where: { communityId: group.id }, include: { assessment: { include: { questions: { include: { options: true } } } }, message: { include: { attachments: true } } } });
    expect(teaching).toMatchObject({ title: 'Faith that moves', text: 'Le Seigneur est mon berger.', mediaKind: 'AUDIO', authorPersonId: person.id, portionBookId: book.id, portionPage: 14, portionLabel: 'Chapter 3' });
    expect(teaching.assessment.passMark).toBe(70);
    expect(teaching.assessment.questions).toHaveLength(1);
    expect(teaching.assessment.questions[0].options.filter((o) => o.isCorrect)).toHaveLength(1);
    expect(teaching.message.attachments).toHaveLength(1);
    expect(teaching.message.body).toBe('Faith that moves');
    expect(teaching.closesAt.getTime() - Date.now()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    const row = await prisma.scheduledTeaching.findUniqueOrThrow({ where: { id: made.id } });
    expect([row.status, row.messageId]).toEqual(['POSTED', teaching.messageId]);
    // it was posted once, as the teaching only (no second, plain voice message)
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { communityId: group.id } });
    expect(await prisma.message.count({ where: { conversationId: conversation.id, kind: 'USER' } })).toBe(1);
    expect(await postDueScheduledTeachings(new Date('2026-12-01T12:05:00Z'))).toBe(0);
  });

  it('a normal post stays a plain voice message when no quiz was added', async () => {
    const { group } = await oneRecording(true);
    expect(await postDueScheduledTeachings(new Date('2026-12-01T12:01:00Z'))).toBe(1);
    expect(await prisma.teaching.count({ where: { communityId: group.id } })).toBe(0);
  });
});
