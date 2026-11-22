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

// A teacher's teaching recorded ahead of time. The text is written in the language spoken; the teacher reads it and corrects it in
// that same language (they are never asked to read the other one) and approves it; the other language is then made automatically.
// At the teacher's time the recording is posted in the teaching group by itself, with its text under it.

export const RECORDING_MIMES = ['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg'] as const;
/** The text writer reads a recording of up to this size; a larger one can still be posted, but without automatic text. */
export const MAX_RECORDING_BYTES = 15 * 1024 * 1024;
const MAX_TEXT_CHARS = 60000;
const MAX_ATTEMPTS = 5;
/** Parts that can be added after the first one. */
const MAX_EXTRA_PARTS = 11;
/** A recording whose time passed this long ago without being posted is still posted when the server catches up. */
const POST_WINDOW_MS = 3 * 24 * 60 * MIN;

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
    /** Every part in order (the first one, then each one added with Add more), each with a short-lived link. */
    parts: { audioUrl: string | null }[];
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
  const parts = rec ? [{ audioUrl: await link(rec.storageKey) }, ...(await Promise.all(extra.map(async (p) => ({ audioUrl: await link(p.storageKey) }))))] : [];
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
  // Only if the teacher has not moved on meanwhile (replaced the recording, or typed the text).
  const waiting = await prisma.teachingRecordingPart.count({ where: { recordingId: id, textState: 'WAITING' } });
  if (result) {
    // The first part's words come first; words already added from later parts follow them.
    const now = await prisma.teachingRecording.findUnique({ where: { id }, select: { transcript: true } });
    const transcript = [result.transcript, now?.transcript ?? ''].filter((t) => t.trim()).join('\n\n');
    await prisma.teachingRecording.updateMany({
      where: { id, storageKey: rec.storageKey, status: 'WRITING' },
      data: { status: waiting > 0 ? 'WRITING' : 'TEXT_READY', transcript, mainTextDone: true, spokenLanguage: rec.spokenLanguage ?? result.detectedLanguage },
    });
  } else {
    await prisma.teachingRecording.updateMany({ where: { id, storageKey: rec.storageKey, status: 'WRITING' }, data: { status: waiting > 0 ? 'WRITING' : 'FAILED' } });
  }
}

/** Adds one more part to the recording (Add more): kept in order, its words are written and added to the text, which needs approving again. */
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
  // The words change: they are written again for this part, and the teacher approves the whole text once more.
  // If the first part's text is not being written (typed by the teacher, or it could not be written), it counts as settled.
  const mainInFlight = rec.status === 'RECORDED' || rec.status === 'WRITING';
  const updated = await prisma.teachingRecording.update({ where: { id: rec.id }, data: { status: 'WRITING', approvedAt: null, translated: null, ...(mainInFlight ? {} : { mainTextDone: true }) } });
  void transcribePart(part.id).catch(() => {});
  return view(w.monday, w.teacher, updated, true);
}

/** One try at writing the words of an added part, and adding them to the end of the text. */
export async function transcribePart(partId: string): Promise<void> {
  const part = await prisma.teachingRecordingPart.findUnique({ where: { id: partId }, include: { recording: true } });
  if (!part || part.textState === 'DONE' || part.recording.status === 'POSTED') return;
  const finish = async (words: { transcript: string; detectedLanguage: Language } | null) => {
    if (words) {
      const cur = await prisma.teachingRecording.findUnique({ where: { id: part.recordingId }, select: { transcript: true, spokenLanguage: true } });
      const transcript = [cur?.transcript ?? '', words.transcript].filter((t) => t.trim()).join('\n\n');
      await prisma.teachingRecording.update({ where: { id: part.recordingId }, data: { transcript, spokenLanguage: cur?.spokenLanguage ?? words.detectedLanguage, translated: null, approvedAt: null } });
    }
    await prisma.teachingRecordingPart.update({ where: { id: part.id }, data: { textState: words ? 'DONE' : 'FAILED' } });
    await settleRecording(part.recordingId);
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

/** When no part is still being written, the recording shows its text (or that none could be written). */
async function settleRecording(recordingId: string): Promise<void> {
  const waiting = await prisma.teachingRecordingPart.count({ where: { recordingId, textState: 'WAITING' } });
  if (waiting > 0) return;
  const rec = await prisma.teachingRecording.findUnique({ where: { id: recordingId }, select: { status: true, transcript: true, mainTextDone: true } });
  // While the first part's own text is still being written, that writing settles the recording itself.
  if (!rec || rec.status !== 'WRITING' || !rec.mainTextDone) return;
  await prisma.teachingRecording.updateMany({ where: { id: recordingId, status: 'WRITING' }, data: { status: rec.transcript?.trim() ? 'TEXT_READY' : 'FAILED' } });
}

/** The teacher asks for the text to be written again (the first part, and any added part whose words could not be written). */
export async function retryTranscript(personId: string, weekStart: string, now = new Date()): Promise<RecordingView> {
  const { w, rec } = await owned(personId, weekStart, now);
  const failedParts = await prisma.teachingRecordingPart.findMany({ where: { recordingId: rec.id, textState: 'FAILED' } });
  const mainNeeds = rec.status === 'FAILED' || rec.status === 'RECORDED';
  if (!mainNeeds && failedParts.length === 0) throw new RotaError('The text is already written.', 409, 'NOT_NEEDED');
  if (failedParts.length) {
    await prisma.teachingRecordingPart.updateMany({ where: { id: { in: failedParts.map((p) => p.id) } }, data: { textState: 'WAITING', attempts: 0 } });
    await prisma.teachingRecording.update({ where: { id: rec.id }, data: { status: 'WRITING', approvedAt: null, translated: null } });
    for (const p of failedParts) void transcribePart(p.id).catch(() => {});
  }
  if (mainNeeds) {
    await prisma.teachingRecording.update({ where: { id: rec.id }, data: { status: 'RECORDED', attempts: 0, mainTextDone: false } });
    void transcribeRecording(rec.id).catch(() => {});
  }
  return view(w.monday, w.teacher, await prisma.teachingRecording.findUniqueOrThrow({ where: { id: rec.id } }), w.open);
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

/** Posts every recording whose teaching time has come, in the teaching group, under the teacher's name, with its text. */
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
      const fresh = await prisma.teachingRecording.findUniqueOrThrow({ where: { id: rec.id } });
      const conversation = await getOrCreateConversation(communityId);
      const teacherPersonId: string = teacher.personId;
      const extra = await prisma.teachingRecordingPart.findMany({ where: { recordingId: rec.id }, orderBy: { position: 'asc' } });
      const files = [
        { storageKey: fresh.storageKey, mimeType: fresh.mimeType, byteSize: fresh.byteSize },
        ...extra.map((p) => ({ storageKey: p.storageKey, mimeType: p.mimeType, byteSize: p.byteSize })),
      ];
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderPersonId: teacher.personId,
          body: null,
          transcribedBody: fresh.transcript?.trim() ? fresh.transcript : null,
          transcribedLanguage: fresh.transcript?.trim() ? fresh.spokenLanguage : null,
          translatedTranscript: fresh.transcript?.trim() && fresh.translated ? fresh.translated : null,
          transcribedAt: fresh.transcript?.trim() ? now : null,
          attachments: {
            create: files.map((f, i): Prisma.MessageAttachmentUncheckedCreateWithoutMessageInput => ({ storageKey: f.storageKey, originalFilename: `teaching${files.length > 1 ? `-${i + 1}` : ''}.${EXTENSION[f.mimeType] ?? 'webm'}`, mimeType: f.mimeType, byteSize: f.byteSize, uploadedByPersonId: teacherPersonId })),
          },
        },
      });
      await prisma.teachingRecording.update({ where: { id: rec.id }, data: { messageId: message.id } });
      // With no text of the teacher's own, the usual automatic writer does it (as for any voice note).
      if (!fresh.transcript?.trim()) void transcribeAndStoreMessageAudio(message.id, fresh.storageKey, fresh.mimeType).catch(() => {});
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
    if (part.attempts >= MAX_ATTEMPTS) {
      await prisma.teachingRecordingPart.update({ where: { id: part.id }, data: { textState: 'FAILED' } });
      await settleRecording(part.recordingId);
    } else await transcribePart(part.id).catch(() => {});
  }
  const untranslated = await prisma.teachingRecording.findMany({ where: { status: 'APPROVED', translated: null, attempts: { lt: MAX_ATTEMPTS } }, take: 20 });
  for (const rec of untranslated) await translateRecording(rec.id).catch(() => false);
}
