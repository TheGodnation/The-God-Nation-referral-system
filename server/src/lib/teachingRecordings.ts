import type { Language, TeachingRecording } from '@prisma/client';
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
    /** Short-lived link so the teacher can listen again. */
    audioUrl: string | null;
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
  let audioUrl: string | null = null;
  if (rec && rec.status !== 'POSTED' && isStorageConfigured()) audioUrl = (await createDownloadUrl({ storageKey: rec.storageKey }).catch(() => null))?.url ?? null;
  return {
    weekStart: dayKey(monday),
    postsAt: slotStart(monday, teacher.dayOfWeek, teacher.startMinute).toISOString(),
    canChange: open && (!rec || rec.status !== 'POSTED'),
    recording: rec ? { status: rec.status, spokenLanguage: rec.spokenLanguage, transcript: rec.transcript ?? '', translated: rec.translated ?? '', audioUrl } : null,
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
  const data = { storageKey: input.storageKey, mimeType: input.mimeType, byteSize: input.byteSize, status: 'RECORDED' as const, spokenLanguage: null, transcript: null, translated: null, attempts: 0, approvedAt: null };
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
  if (result) {
    await prisma.teachingRecording.updateMany({
      where: { id, storageKey: rec.storageKey, status: 'WRITING' },
      data: { status: 'TEXT_READY', transcript: result.transcript, spokenLanguage: result.detectedLanguage },
    });
  } else {
    await prisma.teachingRecording.updateMany({ where: { id, storageKey: rec.storageKey, status: 'WRITING' }, data: { status: 'FAILED' } });
  }
}

/** The teacher asks for the text to be written again. */
export async function retryTranscript(personId: string, weekStart: string, now = new Date()): Promise<RecordingView> {
  const { w, rec } = await owned(personId, weekStart, now);
  if (rec.status !== 'FAILED' && rec.status !== 'RECORDED') throw new RotaError('The text is already written.', 409, 'NOT_NEEDED');
  await prisma.teachingRecording.update({ where: { id: rec.id }, data: { status: 'RECORDED', attempts: 0 } });
  void transcribeRecording(rec.id).catch(() => {});
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
  await prisma.teachingRecording.delete({ where: { id: rec.id } });
  await deleteObject({ storageKey: rec.storageKey }).catch(() => {});
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
      const message = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          senderPersonId: teacher.personId,
          body: null,
          transcribedBody: fresh.transcript?.trim() ? fresh.transcript : null,
          transcribedLanguage: fresh.transcript?.trim() ? fresh.spokenLanguage : null,
          translatedTranscript: fresh.transcript?.trim() && fresh.translated ? fresh.translated : null,
          transcribedAt: fresh.transcript?.trim() ? now : null,
          attachments: { create: [{ storageKey: fresh.storageKey, originalFilename: `teaching.${EXTENSION[fresh.mimeType] ?? 'webm'}`, mimeType: fresh.mimeType, byteSize: fresh.byteSize, uploadedByPersonId: teacher.personId }] },
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
    if (rec.status === 'WRITING') await prisma.teachingRecording.updateMany({ where: { id: rec.id, status: 'WRITING' }, data: { status: 'RECORDED' } }); // a try that never finished
    await transcribeRecording(rec.id).catch(() => {});
  }
  const untranslated = await prisma.teachingRecording.findMany({ where: { status: 'APPROVED', translated: null, attempts: { lt: MAX_ATTEMPTS } }, take: 20 });
  for (const rec of untranslated) await translateRecording(rec.id).catch(() => false);
}
