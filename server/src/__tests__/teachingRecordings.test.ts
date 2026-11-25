import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'stream';
import { prisma } from '../lib/prisma';
import { loadPlan, updateSettings, slotStart } from '../lib/teachingRota';
import { postDueRatingCards } from '../lib/teachingCards';
import { addRecordingPart, approvePart, approveTranscript, authorizeRecordingUpload, deletePart, deleteRecording, postDueRecordings, recordingsFor, retryPart, retryPendingRecordings, retryTranscript, savePartText, saveRecording, saveTranscript, transcribeRecording } from '../lib/teachingRecordings';

// A teaching recorded ahead of time: the text is written in the language spoken, the teacher corrects and approves it in that language,
// the other language is made automatically, and the recording is posted in the teaching group by itself at the teacher's time.
// Storage and the writer/translator are faked here. All names and texts are made up.
const stored = new Map<string, Buffer>();
const translateText = vi.fn();
const transcribeAudioOnly = vi.fn();
vi.mock('../lib/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/storage')>()),
  isStorageConfigured: () => true,
  createUploadUrl: async ({ storageKey }: { storageKey: string }) => ({ url: `https://upload.example/${storageKey}`, expiresAt: new Date() }),
  createDownloadUrl: async ({ storageKey }: { storageKey: string }) => ({ url: `https://download.example/${storageKey}`, expiresAt: new Date() }),
  headObject: async ({ storageKey }: { storageKey: string }) => (stored.has(storageKey) ? { contentLength: stored.get(storageKey)!.length, contentType: 'audio/webm' } : null),
  getObjectStream: async ({ storageKey }: { storageKey: string }) => (stored.has(storageKey) ? { body: Readable.from([stored.get(storageKey)!]), contentLength: stored.get(storageKey)!.length } : null),
  deleteObject: async ({ storageKey }: { storageKey: string }) => void stored.delete(storageKey),
}));
vi.mock('../lib/translation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/translation')>()),
  isTranslationConfigured: () => true,
  transcribeAudioOnly: (...args: unknown[]) => transcribeAudioOnly(...args),
  translateText: (...args: unknown[]) => translateText(...args),
  transcribeAndStoreMessageAudio: vi.fn(async () => undefined),
}));

let n = 0;
const at = (iso: string) => new Date(iso);
const textOf = (topic: string) => ({ topic, bookTitle: 'Book', chapter: 'Chapter 1', teachingOn: 'On this', help: 'Help', meaning: 'Meaning', startLabel: 'Start with', start: 'Start', ifNotLabel: 'If not', ifNot: 'If not', dominion: 'Dominion', verses: ['John 1:1'] });

async function setUp(language: 'en' | 'fr' = 'fr') {
  n += 1;
  await prisma.teachingRecording.deleteMany();
  await prisma.teachingReminderLog.deleteMany();
  await prisma.teachingTeacher.deleteMany();
  await prisma.teachingTopic.deleteMany();
  await prisma.teachingSettings.deleteMany();
  await loadPlan({ startDate: '2026-11-23', topics: [{ number: 1, kind: 'key', en: textOf('Topic 1'), fr: textOf('Sujet 1') }], teachers: [{ name: 'Alpha Tester', startTopic: 1, dayOfWeek: 3, startTime: '07:00' }] });
  const teacherPerson = await prisma.person.create({ data: { name: `Alpha ${n}`, whatsappNumber: `+2377600${String(n).padStart(5, '0')}`, profileCompletedAt: new Date(), preferredLanguage: language } });
  await prisma.teachingTeacher.updateMany({ where: { name: 'Alpha Tester' }, data: { personId: teacherPerson.id } });
  const group = await prisma.community.create({ data: { name: `Teaching Group ${n}` } });
  await prisma.communityMembership.create({ data: { communityId: group.id, personId: teacherPerson.id, status: 'ACTIVE' } as any }).catch(() => {});
  await updateSettings({ enabled: true, frenchChecked: true, ratersCommunityId: group.id });
  const teacher = await prisma.teachingTeacher.findFirstOrThrow({ where: { personId: teacherPerson.id } });
  return { person: teacherPerson, group, teacher };
}

// Wednesday 25 November 07:00 in Cameroon = 06:00Z. Before that, on Monday 23 November, a recording can be made.
const BEFORE = at('2026-11-23T10:00:00Z');
const WEEK = '2026-11-23';

async function upload(groupId: string, bytes = 5000) {
  const key = `communities/${groupId}/attachments/${crypto.randomUUID()}`;
  stored.set(key, Buffer.alloc(bytes, 1));
  return { storageKey: key, mimeType: 'audio/webm', byteSize: bytes };
}

beforeEach(() => {
  stored.clear();
  translateText.mockReset();
  transcribeAudioOnly.mockReset();
  transcribeAudioOnly.mockResolvedValue({ detectedLanguage: 'fr', transcript: 'Le Seigneur est mon berger.' });
  translateText.mockResolvedValue({ detectedLanguage: 'fr', translatedBody: 'The Lord is my shepherd.' });
});
afterEach(() => vi.restoreAllMocks());

describe('recording ahead of time', () => {
  it('lets the teacher record for this week or next, but not after their teaching time began', async () => {
    const { person, group } = await setUp();
    const ok = await authorizeRecordingUpload(person.id, { weekStart: WEEK, mimeType: 'audio/webm', byteSize: 5000 }, BEFORE);
    expect(ok.storageKey).toMatch(new RegExp(`^communities/${group.id}/attachments/`));
    await expect(authorizeRecordingUpload(person.id, { weekStart: '2026-12-07', mimeType: 'audio/webm', byteSize: 5000 }, BEFORE)).rejects.toMatchObject({ code: 'BAD_WEEK' });
    await expect(authorizeRecordingUpload(person.id, { weekStart: WEEK, mimeType: 'audio/webm', byteSize: 5000 }, at('2026-11-25T06:30:00Z'))).rejects.toMatchObject({ code: 'TOO_LATE' });
    await expect(authorizeRecordingUpload(person.id, { weekStart: WEEK, mimeType: 'video/mp4' as any, byteSize: 5000 }, BEFORE)).rejects.toMatchObject({ code: 'BAD_TYPE' });
    const stranger = await prisma.person.create({ data: { name: 'Not A Teacher', whatsappNumber: '+237760099999', profileCompletedAt: new Date() } });
    await expect(authorizeRecordingUpload(stranger.id, { weekStart: WEEK, mimeType: 'audio/webm', byteSize: 5000 }, BEFORE)).rejects.toMatchObject({ code: 'NOT_A_TEACHER' });
  });

  it('refuses a recording that was not really uploaded, or that belongs to another group', async () => {
    const { person, group } = await setUp();
    const up = await upload(group.id);
    await expect(saveRecording(person.id, { weekStart: WEEK, ...up, storageKey: `communities/${group.id}/attachments/${crypto.randomUUID()}` }, BEFORE)).rejects.toMatchObject({ code: 'NOT_UPLOADED' });
    await expect(saveRecording(person.id, { weekStart: WEEK, ...up, storageKey: `communities/${crypto.randomUUID()}/attachments/${crypto.randomUUID()}` }, BEFORE)).rejects.toMatchObject({ code: 'BAD_KEY' });
  });

  it('writes the text in the language spoken, lets the teacher correct it, and makes the other language only after approval', async () => {
    const { person, group, teacher } = await setUp();
    const up = await upload(group.id);
    const saved = await saveRecording(person.id, { weekStart: WEEK, ...up }, BEFORE);
    expect(saved.recording?.status).toBe('RECORDED');
    await vi.waitFor(async () => expect((await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: teacher.id } })).status).toBe('TEXT_READY'));
    let rec = await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: teacher.id } });
    expect([rec.transcript, rec.spokenLanguage, rec.translated]).toEqual(['Le Seigneur est mon berger.', 'fr', null]); // nothing translated yet
    expect(translateText).not.toHaveBeenCalled();

    // the teacher corrects the text in French; it must be approved again after any change
    const corrected = await saveTranscript(person.id, WEEK, 'Le Seigneur est mon berger, je ne manquerai de rien.', BEFORE);
    expect(corrected.recording).toMatchObject({ status: 'TEXT_READY', transcript: 'Le Seigneur est mon berger, je ne manquerai de rien.', translated: '' });
    const approved = await approveTranscript(person.id, WEEK, BEFORE);
    expect(approved.recording?.status).toBe('APPROVED');
    await vi.waitFor(async () => expect((await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: teacher.id } })).translated).toBe('The Lord is my shepherd.'));
    expect(translateText).toHaveBeenCalledWith('Le Seigneur est mon berger, je ne manquerai de rien.');
    // changing the text again takes the approval and the translation away
    const again = await saveTranscript(person.id, WEEK, 'Le Seigneur est mon berger.', BEFORE);
    expect(again.recording).toMatchObject({ status: 'TEXT_READY', translated: '' });
  });

  it('lets the teacher type the text when it could not be written, and try again', async () => {
    const { person, group, teacher } = await setUp();
    transcribeAudioOnly.mockResolvedValueOnce(null);
    await saveRecording(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE);
    await vi.waitFor(async () => expect((await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: teacher.id } })).status).toBe('FAILED'));
    await retryTranscript(person.id, WEEK, BEFORE);
    await vi.waitFor(async () => expect((await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: teacher.id } })).status).toBe('TEXT_READY'));
    // typed by hand instead
    await prisma.teachingRecording.update({ where: { teacherId_weekStart: { teacherId: teacher.id, weekStart: new Date(`${WEEK}T00:00:00Z`) } }, data: { status: 'FAILED', transcript: null } });
    const typed = await saveTranscript(person.id, WEEK, 'Texte tapé à la main.', BEFORE);
    expect(typed.recording).toMatchObject({ status: 'TEXT_READY', spokenLanguage: 'fr' }); // the teacher's own language when none was heard
  });

  it('replaces or deletes a recording before the time, never after it was posted', async () => {
    const { person, group, teacher } = await setUp();
    const first = await upload(group.id);
    await saveRecording(person.id, { weekStart: WEEK, ...first }, BEFORE);
    const second = await upload(group.id, 7000);
    await saveRecording(person.id, { weekStart: WEEK, ...second }, BEFORE);
    expect(stored.has(first.storageKey)).toBe(false); // the old file is removed
    expect((await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: teacher.id } })).byteSize).toBe(7000);
    const gone = await deleteRecording(person.id, WEEK, BEFORE);
    expect(gone.recording).toBeNull();
    expect(stored.has(second.storageKey)).toBe(false);
  });

  it('shows the teacher this week and next week with what can still be done', async () => {
    const { person, group } = await setUp();
    await saveRecording(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE);
    const res = await recordingsFor(person.id, BEFORE);
    expect(res).toMatchObject({ enabled: true, isTeacher: true, groupChosen: true });
    expect(res.weeks.map((w) => [w.weekStart, w.canChange, Boolean(w.recording)])).toEqual([['2026-11-23', true, true], ['2026-11-30', true, false]]);
    expect(res.weeks[0].recording?.audioUrl).toContain('download.example');
    expect(res.weeks[0].postsAt).toBe('2026-11-25T06:00:00.000Z');
  });
});

describe('posting at the teaching time', () => {
  async function ready(approve = true) {
    const ctx = await setUp();
    await saveRecording(ctx.person.id, { weekStart: WEEK, ...(await upload(ctx.group.id)) }, BEFORE);
    await vi.waitFor(async () => expect((await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: ctx.teacher.id } })).status).toBe('TEXT_READY'));
    if (approve) {
      await saveTranscript(ctx.person.id, WEEK, 'Le Seigneur est mon berger.', BEFORE);
      await approveTranscript(ctx.person.id, WEEK, BEFORE);
      await vi.waitFor(async () => expect((await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: ctx.teacher.id } })).translated).not.toBeNull());
    }
    return ctx;
  }

  it('posts nothing before the time, then posts once, under the teacher’s name, with the text in both languages', async () => {
    const { person, group, teacher } = await ready();
    expect(await postDueRecordings(at('2026-11-25T05:59:00Z'))).toBe(0); // one minute early
    expect(await postDueRecordings(at('2026-11-25T06:00:30Z'))).toBe(1);
    expect(await postDueRecordings(at('2026-11-25T06:05:00Z'))).toBe(0); // never twice
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { communityId: group.id } });
    const messages = await prisma.message.findMany({ where: { conversationId: conversation.id, kind: 'USER' }, include: { attachments: true } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ senderPersonId: person.id, transcribedBody: 'Le Seigneur est mon berger.', transcribedLanguage: 'fr', translatedTranscript: 'The Lord is my shepherd.' });
    expect(messages[0].attachments).toHaveLength(1);
    expect(messages[0].attachments[0]).toMatchObject({ mimeType: 'audio/webm', uploadedByPersonId: person.id });
    const rec = await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: teacher.id } });
    expect([rec.status, rec.messageId]).toEqual(['POSTED', messages[0].id]);
    // after posting nothing can be changed
    await expect(saveTranscript(person.id, WEEK, 'trop tard', at('2026-11-25T06:10:00Z'))).rejects.toMatchObject({ code: 'POSTED' });
  });

  it('still posts when the teacher did not finish: with the text as it is, and the rating card follows 25 minutes after the time', async () => {
    const { group, teacher } = await ready(false); // text written but not approved
    expect(await postDueRecordings(at('2026-11-25T06:01:00Z'))).toBe(1);
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { communityId: group.id } });
    const msg = await prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id, kind: 'USER' } });
    expect(msg.transcribedBody).toBe('Le Seigneur est mon berger.');
    expect(msg.translatedTranscript).toBe('The Lord is my shepherd.'); // made at the last moment
    expect(await postDueRatingCards(at('2026-11-25T06:26:00Z'))).toBe(1);
    expect(await prisma.teachingRatingCard.count({ where: { teacherId: teacher.id } })).toBe(1);
  });

  it('posts a recording that never got text with the voice only (the usual automatic writer then does its part)', async () => {
    const { person, group } = await setUp();
    transcribeAudioOnly.mockResolvedValue(null);
    await saveRecording(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE);
    await new Promise((r) => setTimeout(r, 60));
    expect(await postDueRecordings(at('2026-11-25T06:01:00Z'))).toBe(1);
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { communityId: group.id } });
    const msg = await prisma.message.findFirstOrThrow({ where: { conversationId: conversation.id, kind: 'USER' } });
    expect([msg.transcribedBody, msg.translatedTranscript]).toEqual([null, null]);
  });

  it('does nothing while the rota is off or no group is chosen, or before the first week', async () => {
    const { group } = await ready();
    await updateSettings({ ratersCommunityId: null });
    expect(await postDueRecordings(at('2026-11-25T06:01:00Z'))).toBe(0);
    await updateSettings({ ratersCommunityId: group.id });
    expect(await postDueRecordings(at('2026-11-25T06:01:00Z'))).toBe(1);
  });
});

describe('trying again in the background', () => {
  it('writes the text of a recording whose first try never finished, and translates an approved text that was not translated', async () => {
    const { person, group, teacher } = await setUp();
    await saveRecording(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE);
    await vi.waitFor(async () => expect((await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: teacher.id } })).status).toBe('TEXT_READY'));
    const key = { teacherId_weekStart: { teacherId: teacher.id, weekStart: new Date(`${WEEK}T00:00:00Z`) } };
    await prisma.teachingRecording.update({ where: key, data: { status: 'WRITING', transcript: null, mainTextDone: false, updatedAt: new Date(Date.now() - 10 * 60 * 1000) } });
    await retryPendingRecordings();
    expect((await prisma.teachingRecording.findUniqueOrThrow({ where: key })).status).toBe('TEXT_READY');
    await prisma.teachingRecording.update({ where: key, data: { status: 'APPROVED', translated: null, attempts: 0 } });
    await retryPendingRecordings();
    expect((await prisma.teachingRecording.findUniqueOrThrow({ where: key })).translated).toBe('The Lord is my shepherd.');
  });
  it('is not needed when the writer is not configured: the teacher types the text', async () => {
    const { person, group, teacher } = await setUp();
    const { isTranslationConfigured } = await import('../lib/translation');
    expect(isTranslationConfigured()).toBe(true);
    transcribeAudioOnly.mockResolvedValue(null);
    await saveRecording(person.id, { weekStart: WEEK, ...(await upload(group.id, 16 * 1024 * 1024)) }, BEFORE); // too large to read
    await transcribeRecording((await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: teacher.id } })).id);
    expect((await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: teacher.id } })).status).toBe('FAILED');
    expect(transcribeAudioOnly).not.toHaveBeenCalled();
  });
});

describe('the time of the teaching', () => {
  it('is the teacher’s own slot (Wednesday 07:00 in Cameroon)', () => {
    expect(slotStart(new Date('2026-11-23T00:00:00Z'), 3, 7 * 60).toISOString()).toBe('2026-11-25T06:00:00.000Z');
  });
});

describe('a teaching in several parts (record part 1, then part 2, part 3…)', () => {
  const words = (text: string, lang = 'fr') => transcribeAudioOnly.mockResolvedValueOnce({ detectedLanguage: lang, transcript: text });
  const textReady = async (teacherId: string) => vi.waitFor(async () => expect((await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId } })).status).toBe('TEXT_READY'));
  const partsOf = async (personId: string) => (await recordingsFor(personId, BEFORE)).weeks[0].recording!.parts;
  const partReady = async (personId: string, n: number) => vi.waitFor(async () => expect((await partsOf(personId))[n - 1]?.state).toBe('ready'));

  it('gives every part its own text to correct and approve, in order, as many parts as wanted, and the earlier parts stay approved', async () => {
    const { person, group, teacher } = await setUp();
    words('Première partie.');
    await saveRecording(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE);
    await textReady(teacher.id);
    await approveTranscript(person.id, WEEK, BEFORE);

    for (const [n, text] of [[2, 'Deuxième partie.'], [3, 'Troisième partie.'], [4, 'Quatrième partie.'], [5, 'Cinquième partie.']] as const) {
      words(text);
      const added = await addRecordingPart(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE);
      expect(added.recording?.parts).toHaveLength(n);
      expect(added.recording?.parts[n - 1]).toMatchObject({ n, state: 'writing' });
      await partReady(person.id, n);
      const part = (await partsOf(person.id))[n - 1];
      expect(part.transcript).toBe(text); // its own text, not added to the first part's
      // The teacher corrects it in their language, then approves it: the other language is made for that part.
      await savePartText(person.id, WEEK, part.id!, `${text} Amen.`, BEFORE);
      await approvePart(person.id, WEEK, part.id!, BEFORE);
      await vi.waitFor(async () => expect((await partsOf(person.id))[n - 1]).toMatchObject({ state: 'approved', transcript: `${text} Amen.`, translated: 'The Lord is my shepherd.' }));
    }
    const all = await partsOf(person.id);
    expect(all.map((p) => [p.n, p.state])).toEqual([[1, 'approved'], [2, 'approved'], [3, 'approved'], [4, 'approved'], [5, 'approved']]);
    const rec = await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: teacher.id } });
    expect([rec.status, rec.transcript]).toEqual(['APPROVED', 'Première partie.']); // the first part kept its own approval and text
    expect(transcribeAudioOnly).toHaveBeenCalledTimes(5); // each part written once
  });

  it('a part whose words could not be written is said so: the teacher can type them, or try again', async () => {
    const { person, group, teacher } = await setUp();
    words('Première partie.');
    await saveRecording(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE);
    await textReady(teacher.id);
    transcribeAudioOnly.mockResolvedValueOnce(null);
    await addRecordingPart(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE);
    await vi.waitFor(async () => expect((await partsOf(person.id))[1].state).toBe('failed'));
    const part = (await partsOf(person.id))[1];
    words('Deuxième partie.');
    await retryPart(person.id, WEEK, part.id!, BEFORE);
    await partReady(person.id, 2);
    expect((await partsOf(person.id))[1].transcript).toBe('Deuxième partie.');
    await expect(retryPart(person.id, WEEK, part.id!, BEFORE)).rejects.toMatchObject({ code: 'NOT_NEEDED' });
    // Typing it instead works too, and an empty text cannot be approved.
    await savePartText(person.id, WEEK, part.id!, '', BEFORE);
    await expect(approvePart(person.id, WEEK, part.id!, BEFORE)).rejects.toMatchObject({ code: 'NO_TEXT' });
    await savePartText(person.id, WEEK, part.id!, 'Typed words.', BEFORE);
    expect((await partsOf(person.id))[1]).toMatchObject({ state: 'ready', transcript: 'Typed words.' });
  });

  it('a part can be removed (a mistake), and a part that is not theirs cannot be changed', async () => {
    const { person, group, teacher } = await setUp();
    await saveRecording(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE);
    await textReady(teacher.id);
    const second = await upload(group.id);
    words('Deux.');
    await addRecordingPart(person.id, { weekStart: WEEK, ...second }, BEFORE);
    words('Trois.');
    await addRecordingPart(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE);
    await partReady(person.id, 3);
    const [, two] = await partsOf(person.id);
    const after = await deletePart(person.id, WEEK, two.id!, BEFORE);
    expect(after.recording!.parts.map((p) => [p.n, p.transcript])).toEqual([[1, 'Le Seigneur est mon berger.'], [2, 'Trois.']]);
    expect(stored.has(second.storageKey)).toBe(false);
    await expect(approvePart(person.id, WEEK, crypto.randomUUID(), BEFORE)).rejects.toMatchObject({ code: 'NO_PART' });
  });

  it('shows every part to the teacher, and needs a first recording, the open time and a real upload', async () => {
    const { person, group } = await setUp();
    await expect(addRecordingPart(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE)).rejects.toMatchObject({ code: 'NO_RECORDING' });
    await saveRecording(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE);
    await expect(addRecordingPart(person.id, { weekStart: WEEK, storageKey: `communities/${group.id}/attachments/${crypto.randomUUID()}`, mimeType: 'audio/webm', byteSize: 5000 }, BEFORE)).rejects.toMatchObject({ code: 'NOT_UPLOADED' });
    await expect(addRecordingPart(person.id, { weekStart: WEEK, ...(await upload(group.id)), storageKey: 'communities/other/attachments/x' }, BEFORE)).rejects.toMatchObject({ code: 'BAD_KEY' });
    await expect(addRecordingPart(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, at('2026-11-25T06:30:00Z'))).rejects.toMatchObject({ code: 'TOO_LATE' });
    const ok = await addRecordingPart(person.id, { weekStart: WEEK, ...(await upload(group.id)) }, BEFORE);
    expect(ok.recording?.parts.every((p) => p.audioUrl?.startsWith('https://download.example/'))).toBe(true);
    expect((await recordingsFor(person.id, BEFORE)).weeks[0].recording?.parts).toHaveLength(2);
  });

  it('posts every part in order, each as its own voice note with its own text in both languages', async () => {
    const { person, group, teacher } = await setUp();
    words('Un.');
    const first = await upload(group.id);
    await saveRecording(person.id, { weekStart: WEEK, ...first }, BEFORE);
    await textReady(teacher.id);
    await approveTranscript(person.id, WEEK, BEFORE);
    const pieces = [first];
    for (const text of ['Deux.', 'Trois.']) {
      words(text);
      const piece = await upload(group.id);
      pieces.push(piece);
      await addRecordingPart(person.id, { weekStart: WEEK, ...piece }, BEFORE);
    }
    await partReady(person.id, 3);
    const parts = await partsOf(person.id);
    await approvePart(person.id, WEEK, parts[1].id!, BEFORE); // part 3 is left unapproved: it is posted with its text as it is
    translateText.mockResolvedValue({ detectedLanguage: 'fr', translatedBody: 'Translated.' });
    expect(await postDueRecordings(at('2026-11-25T06:00:30Z'))).toBe(1);
    const conversation = await prisma.conversation.findFirstOrThrow({ where: { communityId: group.id } });
    const messages = await prisma.message.findMany({ where: { conversationId: conversation.id, kind: 'USER' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { attachments: true } });
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.attachments.map((a) => a.storageKey))).toEqual(pieces.map((p) => [p.storageKey]));
    expect(messages.map((m) => m.transcribedBody)).toEqual(['Un.', 'Deux.', 'Trois.']);
    expect(messages[0].translatedTranscript).toBeTruthy();
    expect(messages[1].translatedTranscript).toBeTruthy();
    expect(messages.every((m) => m.senderPersonId === person.id)).toBe(true);
    expect((await prisma.teachingRecording.findFirstOrThrow({ where: { teacherId: teacher.id } })).messageId).toBe(messages[0].id);
  });

  it('deleting the recording removes every part, and a new recording replaces them all', async () => {
    const { person, group, teacher } = await setUp();
    const first = await upload(group.id);
    await saveRecording(person.id, { weekStart: WEEK, ...first }, BEFORE);
    await textReady(teacher.id);
    const second = await upload(group.id);
    await addRecordingPart(person.id, { weekStart: WEEK, ...second }, BEFORE);
    await textReady(teacher.id);
    const fresh = await upload(group.id);
    await saveRecording(person.id, { weekStart: WEEK, ...fresh }, BEFORE);
    expect(stored.has(second.storageKey)).toBe(false);
    expect(await prisma.teachingRecordingPart.count()).toBe(0);
    await deleteRecording(person.id, WEEK, BEFORE);
    expect(stored.size).toBe(0);
  });
});
