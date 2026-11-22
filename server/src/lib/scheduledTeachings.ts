import { Prisma } from '@prisma/client';
import type { Language, ScheduledTeaching, ScheduledTeachingClip } from '@prisma/client';
import { prisma } from './prisma';
import { canTeachIn, teachesAnywhere } from './groupTeachers';
import { isCentralAdminPerson } from './centralAdmin';
import { createTeachingWithQuiz, type TeachingQuestionInput } from './teachingCreate';
import { isAllowedAttachmentMime, isStorageKeyForCommunity, maxBytesForMime } from './attachmentPolicy';
import { createDownloadUrl, deleteObject, getObjectStream, headObject, isStorageConfigured } from './storage';
import { isTranslationConfigured, transcribeAndStoreMessageAudio, transcribeAudioOnly, translateAndStoreMessage, translateText } from './translation';
import { getOrCreateConversation } from './communityConversation';
import { pushToPersons } from './push';

// "Send later": the central admin records a voice teaching (an English clip, a French clip, or both) and picks the group and the time
// it is posted. The words are written from the recording, corrected and approved by the author in their own language, and the other
// language is made automatically when only one was recorded. At the chosen time it is posted in the group under the author's name.
// There is no topic, no fixed weekly slot and no rating: this is the author's own way of teaching, in any group.
// The central admin may use it in any group; teachers the central admin allowed (lib/groupTeachers.ts) may use it in their groups.

export class ScheduleError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message);
  }
}

const MIN = 60 * 1000;
const MAX_CHARS = 60000;
const MAX_ATTEMPTS = 5;
/** Largest recording the text writer reads; a bigger one is still posted, without automatic text. */
const MAX_TEXT_BYTES = 15 * 1024 * 1024;
/** A teaching whose time passed this long ago without being posted is not posted any more by itself (it waits for "Post now"). */
const POST_WINDOW_MS = 3 * 24 * 60 * MIN;
const MIN_LEAD_MS = 1 * MIN;
const MAX_AHEAD_MS = 120 * 24 * 60 * MIN;

/** Who may schedule a teaching: the central admin in any group, a teacher in the groups they were allowed in (see groupTeachers). */
export async function canSchedule(personId: string, communityId?: string): Promise<boolean> {
  return communityId ? canTeachIn(personId, communityId) : teachesAnywhere(personId);
}

type Teaching = ScheduledTeaching & { clips: ScheduledTeachingClip[] };
const withClips = { clips: { orderBy: { position: 'asc' as const } } };

export interface ScheduledView {
  id: string;
  communityId: string;
  communityName: string;
  postAt: string;
  liveTeaching: boolean;
  status: ScheduledTeaching['status'];
  /** One clip in one language ("single"), or an English and a French clip ("pair"). */
  mode: 'single' | 'pair';
  /** In "single" mode: the language the author spoke (their text is the one they correct; the other is made automatically). */
  spoken: Language;
  clips: { language: Language; audioUrl: string | null; textState: 'WAITING' | 'DONE' | 'FAILED' }[];
  textEn: string;
  textFr: string;
  /** The text of this language was made by the app, not by the author (single mode, after approval). */
  autoTranslated: Language | null;
  /** The time has passed and it was not posted by itself: it waits for "Post now". */
  missed: boolean;
  canChange: boolean;
  postedAt: string | null;
  /** A counted teaching: when it posts it becomes a teaching with a quiz. Null for a normal post. */
  quiz: null | { title: string; passMark: number; openDays: number; questions: TeachingQuestionInput[]; portion: { bookId: string; page: number; label: string | null } | null };
}

interface StoredQuiz {
  passMark: number;
  openDays: number;
  questions: TeachingQuestionInput[];
}
const quizOf = (t: ScheduledTeaching): StoredQuiz | null => {
  const q = t.quiz as unknown as StoredQuiz | null;
  return q && typeof q === 'object' && Array.isArray(q.questions) ? q : null;
};

async function view(t: Teaching, now: Date): Promise<ScheduledView> {
  const community = await prisma.community.findUnique({ where: { id: t.communityId }, select: { name: true } });
  const link = async (storageKey: string) => (t.status !== 'POSTED' && isStorageConfigured() ? (await createDownloadUrl({ storageKey }).catch(() => null))?.url ?? null : null);
  const clips = await Promise.all(t.clips.map(async (c) => ({ language: c.language, audioUrl: await link(c.storageKey), textState: c.textState })));
  const mode = t.clips.length === 2 ? 'pair' : 'single';
  return {
    id: t.id,
    communityId: t.communityId,
    communityName: community?.name ?? '',
    postAt: t.postAt.toISOString(),
    liveTeaching: t.liveTeaching,
    status: t.status,
    mode,
    spoken: t.clips[0]?.language ?? 'en',
    clips,
    textEn: t.textEn ?? '',
    textFr: t.textFr ?? '',
    autoTranslated: t.translatedInto,
    missed: t.status !== 'POSTED' && t.postAt.getTime() < now.getTime(),
    canChange: t.status !== 'POSTED',
    postedAt: t.postedAt ? t.postedAt.toISOString() : null,
    quiz: quizOf(t) && t.title ? { title: t.title, ...quizOf(t)!, portion: t.portionBookId && t.portionPage ? { bookId: t.portionBookId, page: t.portionPage, label: t.portionLabel } : null } : null,
  };
}

async function load(personId: string, id: string): Promise<Teaching> {
  if (!(await canSchedule(personId))) throw new ScheduleError('You cannot do this.', 403, 'FORBIDDEN');
  const t = await prisma.scheduledTeaching.findUnique({ where: { id }, include: withClips });
  if (!t || t.authorPersonId !== personId) throw new ScheduleError('Not found.', 404, 'NOT_FOUND');
  return t;
}
async function loadOpen(personId: string, id: string): Promise<Teaching> {
  const t = await load(personId, id);
  if (t.status === 'POSTED') throw new ScheduleError('This teaching was already posted.', 409, 'POSTED');
  return t;
}
const fresh = (id: string) => prisma.scheduledTeaching.findUniqueOrThrow({ where: { id }, include: withClips });

/** The author's teachings that are waiting (and the ones posted in the last week), soonest first. */
export async function listScheduled(personId: string, now = new Date()): Promise<ScheduledView[]> {
  if (!(await canSchedule(personId))) throw new ScheduleError('You cannot do this.', 403, 'FORBIDDEN');
  const rows = await prisma.scheduledTeaching.findMany({
    where: { authorPersonId: personId, OR: [{ status: { not: 'POSTED' } }, { postedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * MIN) } }] },
    include: withClips,
    orderBy: { postAt: 'asc' },
    take: 100,
  });
  return Promise.all(rows.map((r) => view(r, now)));
}

export interface ClipInput {
  language: Language;
  storageKey: string;
  mimeType: string;
  byteSize: number;
}

/** Keeps a recording (uploaded the usual chat way) for a group and a time. Starts writing its words. */
export async function createScheduled(personId: string, input: { communityId: string; postAt: Date; liveTeaching: boolean; clips: ClipInput[] }, now = new Date()): Promise<ScheduledView> {
  if (!(await canSchedule(personId, input.communityId))) throw new ScheduleError('You cannot do this.', 403, 'FORBIDDEN');
  const community = await prisma.community.findUnique({ where: { id: input.communityId }, select: { id: true } });
  if (!community) throw new ScheduleError('Group not found.', 404, 'NO_GROUP');
  const lead = input.postAt.getTime() - now.getTime();
  if (lead < MIN_LEAD_MS) throw new ScheduleError('Choose a time that has not passed yet.', 400, 'PAST');
  if (lead > MAX_AHEAD_MS) throw new ScheduleError('Choose a time within the next four months.', 400, 'TOO_FAR');
  const clips = input.clips;
  const languages = new Set(clips.map((c) => c.language));
  if (clips.length < 1 || clips.length > 2 || languages.size !== clips.length) throw new ScheduleError('Add one recording, or one in English and one in French.', 400, 'BAD_CLIPS');
  if (!isStorageConfigured()) throw new ScheduleError('Recordings are not available right now.', 503, 'STORAGE_UNAVAILABLE');
  for (const c of clips) {
    if (!isStorageKeyForCommunity(c.storageKey, input.communityId)) throw new ScheduleError('Invalid recording reference.', 400, 'BAD_KEY');
    if (!c.mimeType.startsWith('audio/') || !isAllowedAttachmentMime(c.mimeType) || c.byteSize > (maxBytesForMime(c.mimeType) ?? 0)) throw new ScheduleError('That kind of recording is not supported.', 400, 'BAD_TYPE');
    const head = await headObject({ storageKey: c.storageKey });
    if (!head || head.contentLength !== c.byteSize) throw new ScheduleError('The recording upload could not be verified.', 400, 'NOT_UPLOADED');
  }
  const created = await prisma.scheduledTeaching.create({
    data: {
      communityId: input.communityId,
      authorPersonId: personId,
      postAt: input.postAt,
      liveTeaching: input.liveTeaching,
      clips: { create: clips.map((c, i) => ({ position: i, language: c.language, storageKey: c.storageKey, mimeType: c.mimeType, byteSize: c.byteSize })) },
    },
    include: withClips,
  });
  for (const c of created.clips) void transcribeClip(c.id).catch(() => {});
  return view(created, now);
}

/** Changes the time (and the "live teaching" mark). */
export async function updateScheduled(personId: string, id: string, patch: { postAt?: Date; liveTeaching?: boolean }, now = new Date()): Promise<ScheduledView> {
  const t = await loadOpen(personId, id);
  const data: Prisma.ScheduledTeachingUpdateInput = {};
  if (patch.postAt) {
    const lead = patch.postAt.getTime() - now.getTime();
    if (lead < MIN_LEAD_MS) throw new ScheduleError('Choose a time that has not passed yet.', 400, 'PAST');
    if (lead > MAX_AHEAD_MS) throw new ScheduleError('Choose a time within the next four months.', 400, 'TOO_FAR');
    data.postAt = patch.postAt;
  }
  if (patch.liveTeaching !== undefined) data.liveTeaching = patch.liveTeaching;
  await prisma.scheduledTeaching.update({ where: { id: t.id }, data });
  return view(await fresh(id), now);
}

// ---- The words -------------------------------------------------------------------------------------------------

/** One try at writing the words of one recording. */
export async function transcribeClip(clipId: string): Promise<void> {
  const clip = await prisma.scheduledTeachingClip.findUnique({ where: { id: clipId }, include: { teaching: true } });
  if (!clip || clip.textState === 'DONE' || clip.teaching.status === 'POSTED') return;
  const done = async (words: string | null) => {
    if (words !== null) {
      // Only into an empty place: words the author already typed are never replaced.
      const field = clip.language === 'fr' ? 'textFr' : 'textEn';
      const cur = await prisma.scheduledTeaching.findUnique({ where: { id: clip.teachingId }, select: { textEn: true, textFr: true } });
      if (!cur?.[field]?.trim()) await prisma.scheduledTeaching.update({ where: { id: clip.teachingId }, data: { [field]: words } });
    }
    await prisma.scheduledTeachingClip.update({ where: { id: clip.id }, data: { textState: words !== null ? 'DONE' : 'FAILED' } });
    await settle(clip.teachingId);
  };
  if (!isTranslationConfigured() || clip.byteSize > MAX_TEXT_BYTES) return done(null);
  await prisma.scheduledTeachingClip.update({ where: { id: clip.id }, data: { attempts: { increment: 1 } } });
  await prisma.scheduledTeaching.updateMany({ where: { id: clip.teachingId, status: { in: ['RECORDED', 'FAILED'] } }, data: { status: 'WRITING' } });
  let result: Awaited<ReturnType<typeof transcribeAudioOnly>> = null;
  try {
    const object = await getObjectStream({ storageKey: clip.storageKey });
    if (object) {
      const chunks: Buffer[] = [];
      for await (const chunk of object.body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
      result = await transcribeAudioOnly(Buffer.concat(chunks).toString('base64'), clip.mimeType);
    }
  } catch {
    result = null;
  }
  await done(result && result.transcript.trim() ? result.transcript.trim() : null);
}

/** When no recording is still being written, the teaching shows its words (or that none could be written). */
async function settle(id: string): Promise<void> {
  const waiting = await prisma.scheduledTeachingClip.count({ where: { teachingId: id, textState: 'WAITING' } });
  if (waiting > 0) return;
  const t = await prisma.scheduledTeaching.findUnique({ where: { id }, select: { status: true, textEn: true, textFr: true } });
  if (!t || (t.status !== 'WRITING' && t.status !== 'RECORDED')) return;
  const any = Boolean(t.textEn?.trim() || t.textFr?.trim());
  await prisma.scheduledTeaching.updateMany({ where: { id, status: { in: ['WRITING', 'RECORDED'] } }, data: { status: any ? 'TEXT_READY' : 'FAILED' } });
}

/** The author asks for the words to be written again (any recording whose words are missing). */
export async function retryScheduledText(personId: string, id: string, now = new Date()): Promise<ScheduledView> {
  const t = await loadOpen(personId, id);
  const failed = t.clips.filter((c) => c.textState === 'FAILED');
  if (failed.length === 0 && t.status !== 'FAILED' && t.status !== 'RECORDED') throw new ScheduleError('The text is already written.', 409, 'NOT_NEEDED');
  const targets = failed.length ? failed : t.clips.filter((c) => c.textState !== 'DONE');
  await prisma.scheduledTeachingClip.updateMany({ where: { id: { in: targets.map((c) => c.id) } }, data: { textState: 'WAITING', attempts: 0 } });
  await prisma.scheduledTeaching.update({ where: { id: t.id }, data: { status: 'RECORDED', attempts: 0, approvedAt: null } });
  for (const c of targets) void transcribeClip(c.id).catch(() => {});
  return view(await fresh(id), now);
}

/**
 * The author saves the words as corrected, in their own language. With one recording only the language spoken can be changed
 * (the other is made automatically); with an English and a French recording each language is its own words.
 */
export async function saveScheduledText(personId: string, id: string, input: { textEn?: string; textFr?: string }, now = new Date()): Promise<ScheduledView> {
  const t = await loadOpen(personId, id);
  const clean = (s: string | undefined) => (s === undefined ? undefined : s.replace(/\r\n/g, '\n').trim());
  const en = clean(input.textEn);
  const fr = clean(input.textFr);
  if ((en?.length ?? 0) > MAX_CHARS || (fr?.length ?? 0) > MAX_CHARS) throw new ScheduleError('The text is too long.', 400, 'TOO_LONG');
  const data: Prisma.ScheduledTeachingUpdateInput = { approvedAt: null };
  if (t.clips.length === 2) {
    if (en !== undefined) data.textEn = en || null;
    if (fr !== undefined) data.textFr = fr || null;
  } else {
    const spoken = t.clips[0]!.language;
    const mine = spoken === 'fr' ? fr : en;
    if (mine !== undefined) {
      data[spoken === 'fr' ? 'textFr' : 'textEn'] = mine || null;
      // The words changed: the automatic other language is made again after approval.
      data[spoken === 'fr' ? 'textEn' : 'textFr'] = null;
      data.translatedInto = null;
    }
  }
  const next = { textEn: 'textEn' in data ? (data.textEn as string | null) : t.textEn, textFr: 'textFr' in data ? (data.textFr as string | null) : t.textFr };
  const any = Boolean(next.textEn?.trim() || next.textFr?.trim());
  data.status = any ? 'TEXT_READY' : 'FAILED';
  await prisma.scheduledTeaching.update({ where: { id: t.id }, data });
  return view(await fresh(id), now);
}

/** The author approves the words. With one recording, the other language is made automatically (they are not asked to read it). */
export async function approveScheduled(personId: string, id: string, now = new Date()): Promise<ScheduledView> {
  const t = await loadOpen(personId, id);
  if (!t.textEn?.trim() && !t.textFr?.trim()) throw new ScheduleError('There is no text to approve yet.', 409, 'NO_TEXT');
  await prisma.scheduledTeaching.update({ where: { id: t.id }, data: { status: 'APPROVED', approvedAt: now, attempts: 0 } });
  if (t.clips.length === 1) void translateScheduled(t.id).catch(() => {});
  return view(await fresh(id), now);
}

/** One try at making the other language of an approved single-recording teaching. */
export async function translateScheduled(id: string): Promise<boolean> {
  const t = await prisma.scheduledTeaching.findUnique({ where: { id }, include: withClips });
  if (!t || t.clips.length !== 1) return false;
  const spoken = t.clips[0]!.language;
  const mine = (spoken === 'fr' ? t.textFr : t.textEn)?.trim();
  const other = spoken === 'fr' ? 'en' : 'fr';
  if (!mine) return false;
  if (t.translatedInto === other && (other === 'fr' ? t.textFr : t.textEn)?.trim()) return true;
  const result = await translateText(mine).catch(() => null);
  if (!result?.translatedBody) {
    await prisma.scheduledTeaching.updateMany({ where: { id }, data: { attempts: { increment: 1 } } });
    return false;
  }
  // Only if the words are still the ones that were translated.
  const done = await prisma.scheduledTeaching.updateMany({
    where: { id, ...(spoken === 'fr' ? { textFr: t.textFr } : { textEn: t.textEn }) },
    data: other === 'fr' ? { textFr: result.translatedBody, translatedInto: 'fr' } : { textEn: result.translatedBody, translatedInto: 'en' },
  });
  return done.count === 1;
}

/** Removes a waiting teaching and its recordings. */
export async function deleteScheduled(personId: string, id: string): Promise<void> {
  const t = await loadOpen(personId, id);
  await prisma.scheduledTeaching.delete({ where: { id: t.id } });
  for (const c of t.clips) await deleteObject({ storageKey: c.storageKey }).catch(() => {});
}

/** Posts it now, instead of waiting for its time. */
export async function postScheduledNow(personId: string, id: string, now = new Date()): Promise<ScheduledView> {
  const t = await loadOpen(personId, id);
  if (!(await canTeachIn(personId, t.communityId))) throw new ScheduleError('You may not teach in this group any more.', 403, 'FORBIDDEN');
  await postOne(t.id, now);
  return view(await fresh(id), now);
}

// ---- A counted teaching: a quiz and a book source ---------------------------------------------------------------

export interface QuizInput {
  title: string;
  passMark: number;
  openDays: number;
  questions: TeachingQuestionInput[];
  portion?: { bookId: string; page: number; label?: string } | null;
}

/**
 * Makes a waiting teaching a counted one: when it posts it becomes a teaching with a quiz, so everyone in the group is followed
 * (who read or listened to the end, who took the quiz, the results) the way the central admin's teachings are. Central admin only,
 * and only with one recording.
 */
export async function setScheduledQuiz(personId: string, id: string, input: QuizInput, now = new Date()): Promise<ScheduledView> {
  const t = await loadOpen(personId, id);
  if (!(await isCentralAdminPerson(personId))) throw new ScheduleError('Only the central admin can add a quiz.', 403, 'ONLY_ADMIN');
  if (t.clips.length !== 1) throw new ScheduleError('A quiz needs a single recording. Record in one language: the other language is made automatically.', 409, 'PAIR_NO_QUIZ');
  const title = input.title.trim();
  if (!title || title.length > 200) throw new ScheduleError('Give the teaching a title.', 400, 'BAD_TITLE');
  if (input.questions.length < 1 || input.questions.length > 20) throw new ScheduleError('Add between 1 and 20 questions.', 400, 'BAD_QUESTIONS');
  const questions: TeachingQuestionInput[] = [];
  for (const q of input.questions) {
    const textEn = q.textEn.trim();
    const options = q.options.map((o) => ({ textEn: o.textEn.trim(), textFr: o.textFr?.trim() || undefined, isCorrect: o.isCorrect }));
    if (!textEn || textEn.length > 500 || options.length < 2 || options.length > 6 || options.some((o) => !o.textEn || o.textEn.length > 300) || options.filter((o) => o.isCorrect).length !== 1) {
      throw new ScheduleError('Each question needs a text, two to six answers, and exactly one correct answer.', 400, 'BAD_QUESTIONS');
    }
    questions.push({ textEn, textFr: q.textFr?.trim() || undefined, options });
  }
  if (!(Number.isInteger(input.passMark) && input.passMark >= 1 && input.passMark <= 100)) throw new ScheduleError('The pass mark is a number from 1 to 100.', 400, 'BAD_PASS_MARK');
  if (!(Number.isInteger(input.openDays) && input.openDays >= 1 && input.openDays <= 60)) throw new ScheduleError('The quiz stays open for 1 to 60 days.', 400, 'BAD_OPEN_DAYS');
  let portion: { bookId: string; page: number; label: string | null } | null = null;
  if (input.portion) {
    if (!(Number.isInteger(input.portion.page) && input.portion.page >= 1 && input.portion.page <= 10000)) throw new ScheduleError('Choose a page of the book.', 400, 'BAD_PORTION');
    const book = await prisma.libraryBook.findUnique({ where: { id: input.portion.bookId }, select: { id: true } });
    if (!book) throw new ScheduleError('The book was not found.', 404, 'NO_BOOK');
    portion = { bookId: book.id, page: input.portion.page, label: input.portion.label?.trim() || null };
  }
  await prisma.scheduledTeaching.update({
    where: { id: t.id },
    data: { title, quiz: { passMark: input.passMark, openDays: input.openDays, questions } as unknown as Prisma.InputJsonValue, portionBookId: portion?.bookId ?? null, portionPage: portion?.page ?? null, portionLabel: portion?.label ?? null },
  });
  return view(await fresh(id), now);
}

/** Back to a normal post: no quiz, no book source. */
export async function clearScheduledQuiz(personId: string, id: string, now = new Date()): Promise<ScheduledView> {
  const t = await loadOpen(personId, id);
  await prisma.scheduledTeaching.update({ where: { id: t.id }, data: { title: null, quiz: Prisma.JsonNull, portionBookId: null, portionPage: null, portionLabel: null } });
  return view(await fresh(id), now);
}

// ---- Posting ---------------------------------------------------------------------------------------------------

const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/aac': 'aac', 'audio/wav': 'wav' };

/** Posts one teaching in its group. Returns false when it was already posted (or could not be). */
async function postOne(id: string, now: Date): Promise<boolean> {
  const before = await prisma.scheduledTeaching.findUnique({ where: { id } });
  if (!before || before.status === 'POSTED') return false;
  // Someone no longer allowed to teach in this group does not post there any more (it waits, and shows in their list).
  if (!(await canTeachIn(before.authorPersonId, before.communityId))) return false;
  // Claim it first, so two runs never post it twice.
  const claim = await prisma.scheduledTeaching.updateMany({ where: { id, status: { not: 'POSTED' } }, data: { status: 'POSTED', postedAt: now } });
  if (claim.count !== 1) return false;
  try {
    // Single-recording words whose other language is missing get one more try now; whatever is not ready is posted as it is.
    await translateScheduled(id).catch(() => false);
    const t = await fresh(id);
    const community = await prisma.community.findUnique({ where: { id: t.communityId }, select: { id: true, name: true } });
    if (!community) throw new Error('group is gone');
    const conversation = await getOrCreateConversation(t.communityId);
    const pair = t.clips.length === 2;
    // A counted teaching becomes a teaching with a quiz (the card, who read or listened, the results), not a plain voice message.
    const quiz = quizOf(t);
    if (quiz && t.title && !pair) {
      const clip = t.clips[0]!;
      const spokenText = (clip.language === 'fr' ? t.textFr : t.textEn)?.trim() || null;
      const teaching = await createTeachingWithQuiz({
        communityId: t.communityId,
        personId: t.authorPersonId,
        title: t.title,
        text: spokenText,
        attachment: { storageKey: clip.storageKey, originalFilename: `teaching.${EXT[clip.mimeType] ?? 'webm'}`, mimeType: clip.mimeType, byteSize: clip.byteSize },
        questions: quiz.questions,
        passMark: quiz.passMark,
        openDays: quiz.openDays,
        portion: t.portionBookId && t.portionPage ? { bookId: t.portionBookId, page: t.portionPage, label: t.portionLabel ?? undefined } : undefined,
      });
      await prisma.scheduledTeaching.update({ where: { id }, data: { messageId: teaching.messageId } });
      return true;
    }
    const en = t.textEn?.trim() || null;
    const fr = t.textFr?.trim() || null;
    const spoken = t.clips[0]!.language;
    const data: Prisma.MessageUncheckedCreateInput = {
      conversationId: conversation.id,
      senderPersonId: t.authorPersonId,
      body: null,
      liveTeaching: t.liveTeaching,
      attachments: {
        create: t.clips.map((c) => ({
          language: pair ? c.language : null,
          storageKey: c.storageKey,
          originalFilename: `teaching-${c.language}.${EXT[c.mimeType] ?? 'webm'}`,
          mimeType: c.mimeType,
          byteSize: c.byteSize,
          uploadedByPersonId: t.authorPersonId,
        })),
      },
    };
    let needsBodyTranslation = false;
    if (pair) {
      // An English and a French recording: the words of each are shown to the readers of that language.
      const first = en ?? fr;
      if (first) {
        data.body = first;
        data.detectedLanguage = en ? 'en' : 'fr';
        if (en && fr) {
          data.translatedBody = fr;
          data.translatedAt = now;
        } else needsBodyTranslation = true;
      }
    } else {
      const mine = spoken === 'fr' ? fr : en;
      const other = spoken === 'fr' ? en : fr;
      if (mine) {
        data.transcribedBody = mine;
        data.transcribedLanguage = spoken;
        data.translatedTranscript = other && t.translatedInto ? other : null;
        data.transcribedAt = now;
      }
    }
    const message = await prisma.message.create({ data });
    await prisma.scheduledTeaching.update({ where: { id }, data: { messageId: message.id } });
    // With no words of the author's own, the usual automatic writer does it, as for any voice note.
    if (!pair && !(spoken === 'fr' ? fr : en)) void transcribeAndStoreMessageAudio(message.id, t.clips[0]!.storageKey, t.clips[0]!.mimeType).catch(() => {});
    if (needsBodyTranslation && data.body) void translateAndStoreMessage(message.id, data.body).catch(() => {});
    void pushToGroup(community, t.authorPersonId, t.liveTeaching, pair).catch(() => {});
    return true;
  } catch (err) {
    // Could not post: back to what it was, so the next run (or "Post now") tries again.
    await prisma.scheduledTeaching.update({ where: { id }, data: { status: before.status, postedAt: null } }).catch(() => {});
    console.error('[scheduled-teachings] could not post', { id, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

async function pushToGroup(community: { id: string; name: string }, authorPersonId: string, live: boolean, pair: boolean): Promise<void> {
  const [author, recipients] = await Promise.all([
    prisma.person.findUnique({ where: { id: authorPersonId }, select: { name: true } }),
    prisma.communityMembership.findMany({ where: { communityId: community.id, status: 'ACTIVE', personId: { not: authorPersonId } }, select: { personId: true } }),
  ]);
  const suffix = pair ? ' (EN + FR)' : '';
  await pushToPersons(recipients.map((r) => r.personId), {
    title: `${author?.name ?? 'Someone'} • ${community.name}`,
    body: live ? `🔴 Live teaching · Enseignement en direct${suffix}` : `🎙️ Teaching · Enseignement${suffix}`,
    url: `/member/chats/group/${community.id}`,
    tag: `group-${community.id}`,
  });
}

/** Posts every teaching whose time has come. Run every minute. */
export async function postDueScheduledTeachings(now = new Date()): Promise<number> {
  const due = await prisma.scheduledTeaching.findMany({
    where: { status: { not: 'POSTED' }, postAt: { lte: now, gte: new Date(now.getTime() - POST_WINDOW_MS) } },
    select: { id: true },
    take: 50,
  });
  let posted = 0;
  for (const d of due) if (await postOne(d.id, now)) posted++;
  return posted;
}

/** Tries again, a few times, for recordings whose words were never written and for approved words not translated yet. */
export async function retryPendingScheduled(now = new Date()): Promise<void> {
  const stale = await prisma.scheduledTeachingClip.findMany({
    where: { textState: 'WAITING', createdAt: { lt: new Date(now.getTime() - 3 * MIN) }, teaching: { status: { not: 'POSTED' } } },
    take: 20,
  });
  for (const clip of stale) {
    if (clip.attempts >= MAX_ATTEMPTS) {
      await prisma.scheduledTeachingClip.update({ where: { id: clip.id }, data: { textState: 'FAILED' } });
      await settle(clip.teachingId);
    } else await transcribeClip(clip.id).catch(() => {});
  }
  const untranslated = await prisma.scheduledTeaching.findMany({ where: { status: 'APPROVED', translatedInto: null, attempts: { lt: MAX_ATTEMPTS }, clips: { none: { position: 1 } } }, include: withClips, take: 20 });
  for (const t of untranslated) if (t.clips.length === 1) await translateScheduled(t.id).catch(() => false);
}

export function startScheduledTeachingLoop(): void {
  const run = () => postDueScheduledTeachings().then(() => retryPendingScheduled()).catch((err) => console.error('[scheduled-teachings] loop failed', { error: err instanceof Error ? err.message : String(err) }));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 60 * 1000).unref();
}
