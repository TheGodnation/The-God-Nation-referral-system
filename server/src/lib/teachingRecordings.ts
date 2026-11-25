import type { Language, Prisma, TeachingRecording } from '@prisma/client';
import { prisma } from './prisma';
import { weekStartOf, addDays, dayKey } from './weeklyReports';
import { MIN, RotaError, loadBase, slotStart } from './teachingRota';
import { generateStorageKey, isStorageKeyForCommunity } from './attachmentPolicy';
import { createDownloadUrl, createUploadUrl, deleteObject, getObjectStream, headObject, isStorageConfigured } from './storage';
import { isTranslationConfigured, transcribeAndStoreMessageAudio, transcribeAudioOnly, translateText } from './translation';
import { getOrCreateConversation } from './communityConversation';
import { pushToPersons } from './push';
import { isFrench } from './privateNotice';

// A teacher's teaching recorded ahead of time, in as many parts as they like (about 5 minutes each is easiest). For every part, in
// order: its text is written in the language spoken, the teacher reads and corrects it in that same language (they are never asked
// to read the other one) and approves it; the other language is then made automatically. Then they record the next part, and so on.
// At the teacher's time every part is posted in the teaching group by itself, one voice note after the other, each with its text.

export const RECORDING_MIMES = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg'] as const;
/** The text writer reads a recording of up to this size; a larger one can still be posted, but without automatic text. */
export const MAX_RECORDING_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 60000;
const MAX_ATTEMPTS = 5;
/** Parts that can be added after the first one (a safety limit only: far more than any teaching needs). */
const MAX_EXTRA_PARTS = 49;
/** A recording whose time passed this long ago without being posted is still posted when the server catches up. */
const POST_WINDOW_MS = 3 * 24 * 60 * MIN;

/** One part of the teaching, as the teacher sees it: its audio, where its text is, and the text itself. */
export interface PartView {
  /** null for the first part (the recording itself); the part's id for every part after it. */
  id: string | null;
  /** 1, 2, 3… in order. */
  n: number;
  audioUrl: string | null;
  /** writing: the text is being written; ready: written, to be checked and approved; failed: could not be written (type it, or try
   * again); approved: checked and approved by the teacher. */
  state: 'writing' | 'ready' | 'failed' | 'approved';
  transcript: string;
  translated: string;
}

export interface RecordingView {
  weekStart: string;
  /** When the recording will be posted in the group. */
  postsAt: string;
  /** Whether a recording can still be made or changed for this week. */
  canChange: boolean;
  recording: null | {
    status: TeachingRecording['status'];
    spokenLanguage: Language | null;
    transcript: string;
    translated: string;
    /** Short-lived link so the teacher can listen again (the first part). */
    audioUrl: string | null;
    /** Every part in order (the first one, then each one added after it), each with its own text and a short-lived link. */
    parts: PartView[];
    /** How many added parts the text could not be written for (the teacher can try again or type those words). */
    partsWithoutText: number;
  };
}

type Teacher = { id: string; personId: string | null; dayOfWeek: number; startMinute: number };

async function context(personId: string, now: Date) {
  const { settings } = await loadBase();
  if (!settings || !settings.enabled) throw new RotaError('The weekly teaching is not open.', 409, 'OFF');
  const teacher = await prisma.teachingTeacher.findFirst({ where: { personId, active: true } });
  if (!teacher) throw new RotaError('You are not on the teaching list.', 403, 'NOT_A_TEACHER');
  const thisMonday = weekStartOf(now);
  const first = thisMonday.getTime() < settings.startDate.getTime() ? settings.startDate : thisMonday;
  return { settings, teacher: teacher as Teacher, mondays: [first, addDays(first, 7)] };
}

/** The week the teacher means (this week or next), and whether its time has not started yet. */
async function weekFor(personId: string, weekStart: string, now: Date) {
  const ctx = await context(personId, now);
  const monday = ctx.mondays.find((m) => dayKey(m) === weekStart);
  if (!monday) throw new RotaError('That week is not open for a recording.', 400, 'BAD_WEEK');
  const startsAt = slotStart(monday, ctx.teacher.dayOfWeek, ctx.teacher.startMinute);
  return { ...ctx, monday, startsAt, open: now.getTime() < startsAt.getTime() };
}

async function view(monday: Date, teacher: Teacher, rec: TeachingRecording | null, open: boolean): Promise<RecordingView> {
  const extra = rec ? await prisma.teachingRecordingPart.findMany({ where: { recordingId: rec.id }, orderBy: { position: 'asc' } }) : [];
  const link = async (storageKey: string) => (rec && rec.status !== 'POSTED' && isStorageConfigured() ? (await createDownloadUrl({ storageKey }).catch(() => null))?.url ?? null : null);
  const mainState = (status: TeachingRecording['status']): PartView['state'] =>
    status === 'RECORDED' || status === 'WRITING' ? 'writing' : status === 'FAILED' ? 'failed' : status === 'TEXT_READY' ? 'ready' : 'approved';
  const parts: PartView[] = rec
    ? [
        { id: null, n: 1, audioUrl: await link(rec.storageKey), state: mainState(rec.status), transcript: rec.transcript ?? '', translated: rec.translated ?? '' },
        ...(await Promise.all(
          extra.map(async (p, i) => ({
            id: p.id,
            n: i + 2,
            audioUrl: await link(p.storageKey),
            state: (p.approvedAt ? 'approved' : p.textState === 'WAITING' ? 'writing' : p.textState === 'FAILED' && !p.transcript?.trim() ? 'failed' : 'ready') as PartView['state'],
            transcript: p.transcript ?? '',
            translated: p.translated ?? '',
          })),
        )),
      ]
    : [];
  return {
    weekStart: dayKey(monday),
    postsAt: slotStart(monday, teacher.dayOfWeek, teacher.startMinute).toISOString(),
    canChange: open && (!rec || rec.status !== 'POSTED'),
    recording: rec
      ? { status: rec.status, spokenLanguage: rec.spokenLanguage, transcript: rec.transcript ?? '', translated: rec.translated ?? '', audioUrl: parts[0]?.audioUrl ?? null, parts, partsWithoutText: extra.filter((p) => p.textState === 'FAILED').length }
      : null,
  };
}

/** For the teacher's page: this week's and next week's recording, each with what can be done to it. */
export async function recordingsFor(personId: string, now = new Date()) {
  const { settings } = await loadBase();
  if (!settings || !settings.enabled) return { enabled: false, isTeacher: false, groupChosen: false, weeks: [] as RecordingView[] };
  const teacher = await prisma.teachingTeacher.findFirst({ where: { personId, active: true } });
  if (!teacher) return { enabled: true, isTeacher: false, groupChosen: false, weeks: [] as RecordingView[] };
  const { mondays } = await context(personId, now);
  const recs = await prisma.teachingRecording.findMany({ where: { teacherId: teacher.id, weekStart: { in: mondays } } });
  const weeks: RecordingView[] = [];
  for (const monday of mondays) {
    const startsAt = slotStart(monday, teacher.dayOfWeek, teacher.startMinute);
    weeks.push(await view(monday, teacher, recs.find((r) => r.weekStart.getTime() === monday.getTime()) ?? null, now.getTime() < startsAt.getTime()));
  }
  return { enabled: true, isTeacher: true, groupChosen: Boolean(settings.ratersCommunityId), weeks };
}

/** Step 1: a place to upload the recording (straight from the phone to storage). */
export async function authorizeRecordingUpload(personId: string, input: { weekStart: string; mimeType: string; byteSize: number }, now = new Date()) {
  const w = await weekFor(personId, input.weekStart, now);
  if (!w.open) throw new RotaError('Your teaching time has already begun.', 409, 'TOO_LATE');
  if (!w.settings.ratersCommunityId) throw new RotaError('No group is chosen for the teachings yet.', 409, 'NO_GROUP');
  if (!isStorageConfigured()) throw new RotaError('Recordings are not available right now.', 503, 'STORAGE_UNAVAILABLE');
  if (!(RECORDING_MIMES as readonly string[]).includes(input.mimeType)) throw new RotaError('That kind of recording is not supported.', 400, 'BAD_TYPE');
  if (input.byteSize <= 0 || input.byteSize > 20 * 1024 * 1024) throw new RotaError('The recording is too large.', 400, 'TOO_LARGE');
  const storageKey = generateStorageKey(w.settings.ratersCommunityId);
  const { url } = await createUploadUrl({ storageKey, mimeType: input.mimeType });
  return { storageKey, uploadUrl: url };
}

/** Step 2: the upload is finished; keep it for this week (replacing an earlier one) and start writing the text. */
export async function saveRecording(personId: string, input: { weekStart: string; storageKey: string; mimeType: string; byteSize: number }, now = new Date()): Promise<RecordingView> {
  const w = await weekFor(personId, input.weekStart, now);
  if (!w.open) throw new RotaError('Your teaching time has already begun.', 409, 'TOO_LATE');
  if (!w.settings.ratersCommunityId || !isStorageKeyForCommunity(input.storageKey, w.settings.ratersCommunityId)) throw new RotaError('Invalid recording reference.', 400, 'BAD_KEY');
  if (!(RECORDING_MIMES as readonly string[]).includes(input.mimeType)) throw new RotaError('That kind of recording is not supported.', 400, 'BAD_TYPE');
  const head = await headObject({ storageKey: input.storageKey });
  if (!head || head.contentLength !== input.byteSize) throw new RotaError('The recording upload could not be verified.', 400, 'NOT_UPLOADED');
  const existing = await prisma.teachingRecording.findUnique({ where: { teacherId_weekStart: { teacherId: w.teacher.id, weekStart: w.monday } } });
  if (existing?.status === 'POSTED') throw new RotaError('This teaching was already posted.', 409, 'POSTED');
  const data = { storageKey: input.storageKey, mimeType: input.mimeType, byteSize: input.byteSize, status: 'RECORDED' as const, spokenLanguage: null, transcript: null, translated: null, attempts: 0, mainTextDone: false, approvedAt: null };
  // A new recording replaces everything, the parts added earlier included.
  const oldParts = existing ? await prisma.teachingRecordingPart.findMany({ where: { recordingId: existing.id } }) : [];
  if (existing) await prisma.teachingRecordingPart.deleteMany({ where: { recordingId: existing.id } });
  for (const part of oldParts) await deleteObject({ storageKey: part.storageKey }).catch(() => {});
  const rec = existing
    ? await prisma.teachingRecording.update({ where: { id: existing.id }, data })
    : await prisma.teachingRecording.create({ data: { teacherId: w.teacher.id, weekStart: w.monday, ...data } });
  if (existing && existing.storageKey !== input.storageKey) await deleteObject({ storageKey: existing.storageKey }).catch(() => {});
  void transcribeRecording(rec.id).catch(() => {});
  return view(w.monday, w.teacher, rec, true);
}

async function owned(personId: string, weekStart: string, now: Date) {
  const w = await weekFor(personId, weekStart, now);
  const rec = await prisma.teachingRecording.findUnique({ where: { teacherId_weekStart: { teacherId: w.teacher.id, weekStart: w.monday } } });
  if (!rec) throw new RotaError('There is no recording for that week.', 404, 'NO_RECORDING');
  if (rec.status === 'POSTED') throw new RotaError('This teaching was already posted.', 409, 'POSTED');
  return { w, rec };
}

/** One try at writing the text of a recording, in the language spoken. */
export async function transcribeRecording(id: string): Promise<void> {
  const rec = await prisma.teachingRecording.findUnique({ where: { id } });
  if (!rec || rec.status === 'POSTED' || rec.status === 'APPROVED' || rec.status === 'TEXT_READY') return;
  // No writer configured, or a recording too large to read: the teacher types the text, or leaves it without text.
  if (!isTranslationConfigured() || rec.byteSize > MAX_RECORDING_BYTES) {
    await prisma.teachingRecording.updateMany({ where: { id, status: { in: ['RECORDED', 'WRITING', 'FAILED'] } }, data: { status: 'FAILED', attempts: MAX_ATTEMPTS } });
    return;
  }
  await prisma.teachingRecording.updateMany({ where: { id, status: { in: ['RECORDED', 'FAILED'] } }, data: { status: 'WRITING', attempts: { increment: 1 } } });
  let result: Awaited<ReturnType<typeof transcribeAudioOnly>> = null;
  try {
    const object = await getObjectStream({ storageKey: rec.storageKey });
    if (object) {
      const chunks: Buffer[] = [];
      for await (const chunk of object.body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      result = await transcribeAudioOnly(Buffer.concat(chunks).toString('base64'), rec.mimeType);
    }
  } catch {
    result = null;
  }
  // Only if the teacher has not moved on meanwhile (replaced the recording, or typed the text). This is the first part's own text only.
  if (result) {
    await prisma.teachingRecording.updateMany({
      where: { id, storageKey: rec.storageKey, status: 'WRITING' },
      data: { status: 'TEXT_READY', transcript: result.transcript, mainTextDone: true, spokenLanguage: rec.spokenLanguage ?? result.detectedLanguage },
    });
  } else {
    await prisma.teachingRecording.updateMany({ where: { id, storageKey: rec.storageKey, status: 'WRITING' }, data: { status: 'FAILED', mainTextDone: true } });
  }
}

/** Adds the next part of the teaching: kept in order, with its own text, written from its audio, to check and approve on its own. */
export async function addRecordingPart(personId: string, input: { weekStart: string; storageKey: string; mimeType: string; byteSize: number }, now = new Date()): Promise<RecordingView> {
  const w = await weekFor(personId, input.weekStart, now);
  if (!w.open) throw new RotaError('Your teaching time has already begun.', 409, 'TOO_LATE');
  if (!w.settings.ratersCommunityId || !isStorageKeyForCommunity(input.storageKey, w.settings.ratersCommunityId)) throw new RotaError('Invalid recording reference.', 400, 'BAD_KEY');
  if (!(RECORDING_MIMES as readonly string[]).includes(input.mimeType)) throw new RotaError('That kind of recording is not supported.', 400, 'BAD_TYPE');
  const rec = await prisma.teachingRecording.findUnique({ where: { teacherId_weekStart: { teacherId: w.teacher.id, weekStart: w.monday } } });
  if (!rec) throw new RotaError('Record the first part before adding more.', 409, 'NO_RECORDING');
  if (rec.status === 'POSTED') throw new RotaError('This teaching was already posted.', 409, 'POSTED');
  const count = await prisma.teachingRecordingPart.count({ where: { recordingId: rec.id } });
  if (count >= MAX_EXTRA_PARTS) throw new RotaError('There are already many parts. Start over with a single recording, or post what you have.', 409, 'TOO_MANY_PARTS');
  const head = await headObject({ storageKey: input.storageKey });
  if (!head || head.contentLength !== input.byteSize) throw new RotaError('The recording upload could not be verified.', 400, 'NOT_UPLOADED');
  const last = await prisma.teachingRecordingPart.findFirst({ where: { recordingId: rec.id }, orderBy: { position: 'desc' }, select: { position: true } });
  const part = await prisma.teachingRecordingPart.create({ data: { recordingId: rec.id, position: (last?.position ?? 0) + 1, storageKey: input.storageKey, mimeType: input.mimeType, byteSize: input.byteSize } });
  // The parts before it are left exactly as they are (their texts and approvals stay).
  void transcribePart(part.id).catch(() => {});
  return view(w.monday, w.teacher, rec, true);
}

/** One try at writing the words of a part (its own text). */
export async function transcribePart(partId: string): Promise<void> {
  const part = await prisma.teachingRecordingPart.findUnique({ where: { id: partId }, include: { recording: true } });
  if (!part || part.textState === 'DONE' || part.recording.status === 'POSTED') return;
  const finish = async (words: { transcript: string; detectedLanguage: Language } | null) => {
    // Only while it is still waiting (the teacher may have typed the words meanwhile).
    await prisma.teachingRecordingPart.updateMany({
      where: { id: part.id, textState: 'WAITING' },
      data: words?.transcript.trim()
        ? { textState: 'DONE', transcript: words.transcript.trim(), spokenLanguage: part.spokenLanguage ?? part.recording.spokenLanguage ?? words.detectedLanguage }
        : { textState: 'FAILED' },
    });
  };
  if (!isTranslationConfigured() || part.byteSize > MAX_RECORDING_BYTES) return finish(null);
  await prisma.teachingRecordingPart.update({ where: { id: part.id }, data: { attempts: { increment: 1 } } });
  let result: Awaited<ReturnType<typeof transcribeAudioOnly>> = null;
  try {
    const object = await getObjectStream({ storageKey: part.storageKey });
    if (object) {
      const chunks: Buffer[] = [];
      for await (const chunk of object.body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      result = await transcribeAudioOnly(Buffer.concat(chunks).toString('base64'), part.mimeType);
    }
  } catch {
    result = null;
  }
  await finish(result);
}

/** The teacher asks for the first part's text to be written again (it could not be written). */
export async function retryTranscript(personId: string, weekStart: string, now = new Date()): Promise<RecordingView> {
  const { w, rec } = await owned(personId, weekStart, now);
  if (rec.status !== 'FAILED' && rec.status !== 'RECORDED') throw new RotaError('The text is already written.', 409, 'NOT_NEEDED');
  await prisma.teachingRecording.update({ where: { id: rec.id }, data: { status: 'RECORDED', attempts: 0, mainTextDone: false } });
  void transcribeRecording(rec.id).catch(() => {});
  return view(w.monday, w.teacher, await prisma.teachingRecording.findUniqueOrThrow({ where: { id: rec.id } }), w.open);
}

/** A part after the first, belonging to this teacher's recording for that week (not posted yet). */
async function ownedPart(personId: string, weekStart: string, partId: string, now: Date) {
  const { w, rec } = await owned(personId, weekStart, now);
  const part = await prisma.teachingRecordingPart.findFirst({ where: { id: partId, recordingId: rec.id } });
  if (!part) throw new RotaError('That part was not found.', 404, 'NO_PART');
  return { w, rec, part };
}

/** The teacher saves a part's text as corrected (in the language spoken). It has to be approved again after any change. */
export async function savePartText(personId: string, weekStart: string, partId: string, text: string, now = new Date()): Promise<RecordingView> {
  const { w, rec, part } = await ownedPart(personId, weekStart, partId, now);
  if (!w.open) throw new RotaError('Your teaching time has already begun.', 409, 'TOO_LATE');
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length > MAX_TEXT_CHARS) throw new RotaError('The text is too long.', 400, 'TOO_LONG');
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { preferredLanguage: true } });
  await prisma.teachingRecordingPart.update({
    where: { id: part.id },
    data: { transcript: clean || null, textState: clean ? 'DONE' : 'FAILED', translated: null, approvedAt: null, translateAttempts: 0, spokenLanguage: part.spokenLanguage ?? rec.spokenLanguage ?? (isFrench(person?.preferredLanguage) ? 'fr' : 'en') },
  });
  return view(w.monday, w.teacher, rec, true);
}

/** The teacher approves a part's text. Its other language is made automatically. */
export async function approvePart(personId: string, weekStart: string, partId: string, now = new Date()): Promise<RecordingView> {
  const { w, rec, part } = await ownedPart(personId, weekStart, partId, now);
  if (!w.open) throw new RotaError('Your teaching time has already begun.', 409, 'TOO_LATE');
  if (!part.transcript?.trim()) throw new RotaError('There is no text to approve yet.', 409, 'NO_TEXT');
  await prisma.teachingRecordingPart.update({ where: { id: part.id }, data: { approvedAt: now, translated: null, translateAttempts: 0, textState: 'DONE' } });
  void translatePart(part.id).catch(() => {});
  return view(w.monday, w.teacher, rec, true);
}

/** The teacher asks for a part's text to be written again (it could not be written). */
export async function retryPart(personId: string, weekStart: string, partId: string, now = new Date()): Promise<RecordingView> {
  const { w, rec, part } = await ownedPart(personId, weekStart, partId, now);
  if (part.textState !== 'FAILED') throw new RotaError('The text is already written.', 409, 'NOT_NEEDED');
  await prisma.teachingRecordingPart.update({ where: { id: part.id }, data: { textState: 'WAITING', attempts: 0 } });
  void transcribePart(part.id).catch(() => {});
  return view(w.monday, w.teacher, rec, w.open);
}

/** The teacher removes a part after the first (a mistake). The parts after it move up one place. */
export async function deletePart(personId: string, weekStart: string, partId: string, now = new Date()): Promise<RecordingView> {
  const { w, rec, part } = await ownedPart(personId, weekStart, partId, now);
  if (!w.open) throw new RotaError('Your teaching time has already begun.', 409, 'TOO_LATE');
  await prisma.teachingRecordingPart.delete({ where: { id: part.id } });
  await deleteObject({ storageKey: part.storageKey }).catch(() => {});
  return view(w.monday, w.teacher, rec, true);
}

/** One try at making the other language of an approved part. */
export async function translatePart(partId: string): Promise<boolean> {
  const part = await prisma.teachingRecordingPart.findUnique({ where: { id: partId } });
  if (!part?.approvedAt || !part.transcript?.trim() || part.translated) return Boolean(part?.translated);
  const result = await translateText(part.transcript).catch(() => null);
  if (!result) {
    await prisma.teachingRecordingPart.updateMany({ where: { id: partId }, data: { translateAttempts: { increment: 1 } } });
    return false;
  }
  const done = await prisma.teachingRecordingPart.updateMany({ where: { id: partId, transcript: part.transcript }, data: { translated: result.translatedBody, spokenLanguage: part.spokenLanguage ?? result.detectedLanguage } });
  return done.count === 1;
}

/** The teacher saves the text as corrected (in the language spoken). It has to be approved again after any change. */
export async function saveTranscript(personId: string, weekStart: string, text: string, now = new Date()): Promise<RecordingView> {
  const { w, rec } = await owned(personId, weekStart, now);
  if (!w.open) throw new RotaError('Your teaching time has already begun.', 409, 'TOO_LATE');
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length > MAX_TEXT_CHARS) throw new RotaError('The text is too long.', 400, 'TOO_LONG');
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { preferredLanguage: true } });
  const updated = await prisma.teachingRecording.update({
    where: { id: rec.id },
    data: { transcript: clean || null, status: clean ? 'TEXT_READY' : 'FAILED', translated: null, approvedAt: null, spokenLanguage: rec.spokenLanguage ?? (isFrench(person?.preferredLanguage) ? 'fr' : 'en') },
  });
  return view(w.monday, w.teacher, updated, true);
}

/** The teacher approves the text. The other language is made automatically (they are not asked to read it). */
export async function approveTranscript(personId: string, weekStart: string, now = new Date()): Promise<RecordingView> {
  const { w, rec } = await owned(personId, weekStart, now);
  if (!w.open) throw new RotaError('Your teaching time has already begun.', 409, 'TOO_LATE');
  if (!rec.transcript?.trim()) throw new RotaError('There is no text to approve yet.', 409, 'NO_TEXT');
  const updated = await prisma.teachingRecording.update({ where: { id: rec.id }, data: { status: 'APPROVED', approvedAt: now, translated: null, attempts: 0 } });
  void translateRecording(rec.id).catch(() => {});
  return view(w.monday, w.teacher, updated, true);
}

/** One try at making the other language of an approved text. */
export async function translateRecording(id: string): Promise<boolean> {
  const rec = await prisma.teachingRecording.findUnique({ where: { id } });
  if (!rec?.transcript?.trim() || rec.translated) return Boolean(rec?.translated);
  const result = await translateText(rec.transcript).catch(() => null);
  if (!result) {
    await prisma.teachingRecording.updateMany({ where: { id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  // Only if the text is still the one that was translated.
  const done = await prisma.teachingRecording.updateMany({ where: { id, transcript: rec.transcript }, data: { translated: result.translatedBody, spokenLanguage: rec.spokenLanguage ?? result.detectedLanguage } });
  return done.count === 1;
}

export async function deleteRecording(personId: string, weekStart: string, now = new Date()): Promise<RecordingView> {
  const { w, rec } = await owned(personId, weekStart, now);
  if (!w.open) throw new RotaError('Your teaching time has already begun.', 409, 'TOO_LATE');
  const parts = await prisma.teachingRecordingPart.findMany({ where: { recordingId: rec.id } });
  await prisma.teachingRecording.delete({ where: { id: rec.id } });
  for (const key of [rec.storageKey, ...parts.map((p) => p.storageKey)]) await deleteObject({ storageKey: key }).catch(() => {});
  return view(w.monday, w.teacher, null, true);
}

const EXTENSION: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg' };

/** Posts every recording whose teaching time has come, in the teaching group, under the teacher's name: one voice note per part, in
 * order, each with its own text (and its other language when it is ready). */
export async function postDueRecordings(now = new Date()): Promise<number> {
  const { settings } = await loadBase();
  if (!settings?.enabled || !settings.ratersCommunityId) return 0;
  const communityId = settings.ratersCommunityId;
  const candidates = await prisma.teachingRecording.findMany({ where: { status: { not: 'POSTED' }, weekStart: { gte: settings.startDate } } });
  let posted = 0;
  for (const rec of candidates) {
    const teacher = await prisma.teachingTeacher.findUnique({ where: { id: rec.teacherId } });
    if (!teacher?.personId || !teacher.active) continue;
    const startsAt = slotStart(rec.weekStart, teacher.dayOfWeek, teacher.startMinute).getTime();
    if (now.getTime() < startsAt || now.getTime() > startsAt + POST_WINDOW_MS) continue;
    // Claim it first, so two runs never post it twice.
    const claim = await prisma.teachingRecording.updateMany({ where: { id: rec.id, status: { not: 'POSTED' } }, data: { status: 'POSTED', postedAt: now } });
    if (claim.count !== 1) continue;
    try {
      // An approved text whose translation is still missing gets one more try now; whatever is not ready is posted as it is.
      if (rec.transcript?.trim() && !rec.translated) await translateRecording(rec.id).catch(() => false);
      const extraBefore = await prisma.teachingRecordingPart.findMany({ where: { recordingId: rec.id }, orderBy: { position: 'asc' } });
      for (const p of extraBefore) if (p.approvedAt && p.transcript?.trim() && !p.translated) await translatePart(p.id).catch(() => false);
      const fresh = await prisma.teachingRecording.findUniqueOrThrow({ where: { id: rec.id } });
      const extra = await prisma.teachingRecordingPart.findMany({ where: { recordingId: rec.id }, orderBy: { position: 'asc' } });
      const conversation = await getOrCreateConversation(communityId);
      const teacherPersonId: string = teacher.personId;
      const pieces = [
        { storageKey: fresh.storageKey, mimeType: fresh.mimeType, byteSize: fresh.byteSize, transcript: fresh.transcript, translated: fresh.translated, language: fresh.spokenLanguage },
        ...extra.map((p) => ({ storageKey: p.storageKey, mimeType: p.mimeType, byteSize: p.byteSize, transcript: p.transcript, translated: p.translated, language: p.spokenLanguage ?? fresh.spokenLanguage })),
      ];
      let firstMessageId: string | null = null;
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        const hasText = Boolean(piece.transcript?.trim());
        // Each part one millisecond after the one before it, so they always show in the right order.
        const at = new Date(now.getTime() + i);
        const message = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderPersonId: teacherPersonId,
            body: null,
            createdAt: at,
            transcribedBody: hasText ? piece.transcript : null,
            transcribedLanguage: hasText ? piece.language : null,
            translatedTranscript: hasText && piece.translated ? piece.translated : null,
            transcribedAt: hasText ? now : null,
            attachments: {
              create: [{ storageKey: piece.storageKey, originalFilename: `teaching${pieces.length > 1 ? `-${i + 1}` : ''}.${EXTENSION[piece.mimeType] ?? 'webm'}`, mimeType: piece.mimeType, byteSize: piece.byteSize, uploadedByPersonId: teacherPersonId }],
            },
          },
        });
        firstMessageId ??= message.id;
        // With no text of the teacher's own for this part, the usual automatic writer does it (as for any voice note).
        if (!hasText) void transcribeAndStoreMessageAudio(message.id, piece.storageKey, piece.mimeType).catch(() => {});
      }
      await prisma.teachingRecording.update({ where: { id: rec.id }, data: { messageId: firstMessageId } });
      void pushToGroup(communityId, teacher.personId).catch(() => {});
      posted++;
    } catch (err) {
      // Could not post: let the next run try again.
      await prisma.teachingRecording.update({ where: { id: rec.id }, data: { status: rec.status, postedAt: null } }).catch(() => {});
      console.error('[teaching-recordings] could not post', { id: rec.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return posted;
}

async function pushToGroup(communityId: string, teacherPersonId: string): Promise<void> {
  const [teacher, community, recipients] = await Promise.all([
    prisma.person.findUnique({ where: { id: teacherPersonId }, select: { name: true } }),
    prisma.community.findUnique({ where: { id: communityId }, select: { name: true } }),
    prisma.communityMembership.findMany({ where: { communityId, status: 'ACTIVE', personId: { not: teacherPersonId } }, select: { personId: true } }),
  ]);
  await pushToPersons(recipients.map((r) => r.personId), {
    title: `${teacher?.name ?? 'A teacher'} • ${community?.name ?? 'Group'}`,
    body: '🎙️ Teaching · Enseignement',
    url: `/member/chats/group/${communityId}`,
    tag: `group-${communityId}`,
  });
}

/** Tries again, a few times, for recordings whose text was never written or whose approved text was not translated yet. */
export async function retryPendingRecordings(now = new Date()): Promise<void> {
  const waiting = await prisma.teachingRecording.findMany({
    where: { status: { in: ['RECORDED', 'WRITING'] }, attempts: { lt: MAX_ATTEMPTS }, updatedAt: { lt: new Date(now.getTime() - 3 * MIN) } },
    take: 20,
  });
  for (const rec of waiting) {
    // The first part's text is already written (only added parts are being written): leave it, the parts' own retry below handles them.
    if (rec.mainTextDone) continue;
    if (rec.status === 'WRITING') await prisma.teachingRecording.updateMany({ where: { id: rec.id, status: 'WRITING' }, data: { status: 'RECORDED' } }); // a try that never finished
    await transcribeRecording(rec.id).catch(() => {});
  }
  // Added parts whose words were never written (a try that never finished): try again a few times, then give up so the teacher can type them.
  const stale = await prisma.teachingRecordingPart.findMany({ where: { textState: 'WAITING', createdAt: { lt: new Date(now.getTime() - 3 * MIN) }, recording: { status: { not: 'POSTED' } } }, take: 20 });
  for (const part of stale) {
    if (part.attempts >= MAX_ATTEMPTS) await prisma.teachingRecordingPart.updateMany({ where: { id: part.id, textState: 'WAITING' }, data: { textState: 'FAILED' } });
    else await transcribePart(part.id).catch(() => {});
  }
  const untranslated = await prisma.teachingRecording.findMany({ where: { status: 'APPROVED', translated: null, attempts: { lt: MAX_ATTEMPTS } }, take: 20 });
  for (const rec of untranslated) await translateRecording(rec.id).catch(() => false);
  // Approved parts whose other language is still missing.
  const untranslatedParts = await prisma.teachingRecordingPart.findMany({ where: { approvedAt: { not: null }, translated: null, translateAttempts: { lt: MAX_ATTEMPTS }, recording: { status: { not: 'POSTED' } } }, take: 20 });
  for (const part of untranslatedParts) await translatePart(part.id).catch(() => false);
}
