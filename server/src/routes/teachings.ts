import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { teachingDraftLimiter, teachingPostLimiter, teachingProgressLimiter } from '../lib/rateLimit';
import { contextTargetExists } from '../lib/leadership';
import { isCentralAdminPerson } from '../lib/centralAdmin';
import { hasConversationAccess, getOrCreateConversation } from '../lib/communityConversation';
import {
  isAllowedAttachmentMime,
  maxBytesForMime,
  isValidOriginalFilename,
  isStorageKeyForCommunity,
  MAX_ORIGINAL_FILENAME_LENGTH,
  MAX_THUMB_DATA_URL_LENGTH,
  MAX_PDF_PAGE_COUNT,
  THUMB_DATA_URL_PATTERN,
} from '../lib/attachmentPolicy';
import { MAX_MESSAGE_CHARS } from '../lib/textLimits';
import { getObjectStream, headObject, isStorageConfigured } from '../lib/storage';
import { pushToPersons } from '../lib/push';
import { recordAudit } from '../lib/audit';
import { translateAndStoreTeaching } from '../lib/translation';
import { draftQuizQuestions, isQuizDraftingAvailable } from '../lib/teachingQuiz';
import { RetakeError, ensureRetakeQuestions, membersWhoCanRetake, startTeachingRetake } from '../lib/teachingRetake';
import { isCommunityAdministrator } from '../lib/leadership';
import {
  DEFAULT_OPEN_DAYS,
  mediaKindOf,
  minReadSeconds,
  quizStateOf,
  recordProgress,
  teachingResults,
} from '../lib/teachings';

// ---------------------------------------------------------------------------
// Teachings: posted in an assembly by the central admin (their member profile
// = "National Coordinator"); read and listened to by the members, who then
// take the quiz that opens only once the system has seen them finish; the
// results list is open to everyone in the assembly. See lib/teachings.ts.
// ---------------------------------------------------------------------------

const router = Router();
router.use(requireMember);

const DAY = 24 * 60 * 60 * 1000;
// The notification waits this long for the translation before going out in the original language.
const PUSH_WAITS_FOR_TRANSLATION_MS = 60 * 1000;
const MAX_AUDIO_FOR_DRAFT_BYTES = 15 * 1024 * 1024;

const optionSchema = z.object({
  textEn: z.string().trim().min(1).max(300),
  textFr: z.string().trim().max(300).optional(),
  isCorrect: z.boolean(),
});
const questionSchema = z
  .object({
    textEn: z.string().trim().min(1).max(500),
    textFr: z.string().trim().max(500).optional(),
    options: z.array(optionSchema).min(2).max(6),
  })
  .refine((q) => q.options.filter((o) => o.isCorrect).length === 1, { message: 'Each question needs exactly one correct answer.' });

const attachmentSchema = z.object({
  storageKey: z.string().min(1).max(300),
  originalFilename: z.string().trim().min(1).max(MAX_ORIGINAL_FILENAME_LENGTH),
  mimeType: z.string().min(1).max(100),
  byteSize: z.number().int().positive(),
  thumb: z.string().max(MAX_THUMB_DATA_URL_LENGTH).regex(THUMB_DATA_URL_PATTERN).optional(),
  pageCount: z.number().int().min(1).max(MAX_PDF_PAGE_COUNT).optional(),
});

const createSchema = z.object({
  communityId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  text: z.string().max(MAX_MESSAGE_CHARS).optional(),
  attachment: attachmentSchema.optional(),
  questions: z.array(questionSchema).min(1).max(20),
  passMark: z.number().int().min(1).max(100).default(70),
  openDays: z.number().int().min(1).max(60).default(DEFAULT_OPEN_DAYS),
});

// POST /api/teachings — post a teaching (central admin only).
router.post('/', teachingPostLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid teaching.' });
  const d = parsed.data;
  const personId = req.member!.personId;

  if (!(await contextTargetExists('COMMUNITY', d.communityId))) return res.status(404).json({ error: 'Assembly not found.' });
  if (!(await isCentralAdminPerson(personId))) {
    return res.status(403).json({ error: 'Only the central admin can post a teaching.', code: 'NOT_ALLOWED' });
  }
  const text = d.text?.trim() ? d.text.trim() : null;
  if (!text && !d.attachment) return res.status(400).json({ error: 'A teaching needs some text, or an audio, video or PDF.' });

  let mediaKind: ReturnType<typeof mediaKindOf> = null;
  if (d.attachment) {
    const a = d.attachment;
    mediaKind = mediaKindOf(a.mimeType);
    if (!mediaKind) return res.status(400).json({ error: 'A teaching can have an audio, a video or a PDF.' });
    if (!isStorageKeyForCommunity(a.storageKey, d.communityId)) return res.status(400).json({ error: 'Invalid attachment reference.' });
    if (!isAllowedAttachmentMime(a.mimeType)) return res.status(400).json({ error: 'Unsupported attachment type.' });
    if (a.byteSize > maxBytesForMime(a.mimeType)!) return res.status(400).json({ error: 'Attachment is too large.' });
    if (!isValidOriginalFilename(a.originalFilename)) return res.status(400).json({ error: 'Invalid attachment filename.' });
    if (!isStorageConfigured()) return res.status(503).json({ error: 'Attachments are not available right now.' });
    const head = await headObject({ storageKey: a.storageKey });
    if (!head || head.contentLength !== a.byteSize || (head.contentType && head.contentType !== a.mimeType)) {
      return res.status(400).json({ error: 'Attachment upload could not be verified.' });
    }
  }

  const conversation = await getOrCreateConversation(d.communityId);
  const closesAt = new Date(Date.now() + d.openDays * DAY);

  const teaching = await prisma.$transaction(async (tx) => {
    const assessment = await tx.assessment.create({
      data: {
        titleEn: `Teaching quiz: ${d.title}`.slice(0, 250),
        passMark: d.passMark,
        maxAttempts: 1,
        status: 'PUBLISHED',
        questions: {
          create: d.questions.map((q, qi) => ({
            textEn: q.textEn,
            textFr: q.textFr || null,
            order: qi,
            options: { create: q.options.map((o, oi) => ({ textEn: o.textEn, textFr: o.textFr || null, isCorrect: o.isCorrect, order: oi })) },
          })),
        },
      },
    });
    // The teaching sits in the assembly's chat like any message (its file is
    // the message's attachment), shown there as a card.
    const message = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderPersonId: personId,
        body: d.title,
        attachments: d.attachment
          ? {
              create: [
                {
                  storageKey: d.attachment.storageKey,
                  originalFilename: d.attachment.originalFilename,
                  mimeType: d.attachment.mimeType,
                  byteSize: d.attachment.byteSize,
                  thumbDataUrl: d.attachment.thumb ?? null,
                  pageCount: d.attachment.pageCount ?? null,
                  uploadedByPersonId: personId,
                },
              ],
            }
          : undefined,
      },
    });
    return tx.teaching.create({
      data: {
        communityId: d.communityId,
        messageId: message.id,
        assessmentId: assessment.id,
        authorPersonId: personId,
        title: d.title,
        text,
        mediaKind,
        closesAt,
      },
    });
  });

  await recordAudit({ action: 'TEACHING_POSTED', targetType: 'Teaching', targetId: teaching.id, metadata: { communityId: d.communityId, questions: d.questions.length } });

  // English <-> French in the background (members see it as soon as it lands).
  // Everyone else in the assembly hears about it, even with the app closed —
  // once the translation is ready, so each person's notification is in their
  // own language (the original title if it isn't ready in time).
  void (async () => {
    const translating = translateAndStoreTeaching(teaching.id).catch(() => {});
    let giveUp: NodeJS.Timeout | undefined;
    await Promise.race([translating, new Promise((resolve) => { giveUp = setTimeout(resolve, PUSH_WAITS_FOR_TRANSLATION_MS); })]);
    clearTimeout(giveUp);
    const [community, recipients, translated] = await Promise.all([
      prisma.community.findUnique({ where: { id: d.communityId }, select: { name: true } }),
      prisma.communityMembership.findMany({
        where: { communityId: d.communityId, status: 'ACTIVE', personId: { not: personId } },
        select: { personId: true, person: { select: { preferredLanguage: true } } },
      }),
      prisma.teaching.findUnique({ where: { id: teaching.id }, select: { detectedLanguage: true, titleTranslated: true } }),
    ]);
    for (const language of ['en', 'fr'] as const) {
      const ids = recipients.filter((r) => r.person.preferredLanguage === language).map((r) => r.personId);
      const title = translated?.titleTranslated && translated.detectedLanguage && translated.detectedLanguage !== language ? translated.titleTranslated : d.title;
      await pushToPersons(ids, {
        title: `${language === 'fr' ? '📖 Nouvel enseignement' : '📖 New teaching'} • ${community?.name ?? ''}`.trim(),
        body: title.length > 120 ? `${title.slice(0, 120)}…` : title,
        url: `/member/teachings/${teaching.id}`,
      });
    }
  })().catch(() => {});

  res.status(201).json({ id: teaching.id, messageId: teaching.messageId, closesAt: teaching.closesAt });
}));

const draftSchema = z.object({
  communityId: z.string().min(1),
  text: z.string().max(MAX_MESSAGE_CHARS).optional(),
  audioStorageKey: z.string().max(300).optional(),
  audioMimeType: z.string().max(100).optional(),
  count: z.number().int().min(1).max(10).default(5),
});

async function readAudioBase64(storageKey: string): Promise<string | null> {
  const obj = await getObjectStream({ storageKey });
  if (!obj) return null;
  if (obj.contentLength && obj.contentLength > MAX_AUDIO_FOR_DRAFT_BYTES) return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of obj.body as AsyncIterable<Buffer | string>) {
    const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > MAX_AUDIO_FOR_DRAFT_BYTES) return null;
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('base64');
}

// POST /api/teachings/draft-questions — the AI proposes questions from the
// teaching's text and/or audio. Only a draft: nothing is saved.
router.post('/draft-questions', teachingDraftLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const d = parsed.data;
  const personId = req.member!.personId;
  if (!(await contextTargetExists('COMMUNITY', d.communityId))) return res.status(404).json({ error: 'Assembly not found.' });
  if (!(await isCentralAdminPerson(personId))) return res.status(403).json({ error: 'Only the central admin can do this.', code: 'NOT_ALLOWED' });
  if (!isQuizDraftingAvailable()) {
    return res.status(503).json({ error: 'The question assistant is not set up. Please write the questions yourself.', code: 'AI_OFF' });
  }

  let audio: { base64: string; mimeType: string } | null = null;
  if (d.audioStorageKey && d.audioMimeType?.startsWith('audio/')) {
    if (!isStorageKeyForCommunity(d.audioStorageKey, d.communityId)) return res.status(400).json({ error: 'Invalid attachment reference.' });
    const base64 = await readAudioBase64(d.audioStorageKey);
    if (base64) audio = { base64, mimeType: d.audioMimeType };
  }
  if (!d.text?.trim() && !audio) {
    return res.status(400).json({ error: 'Write the teaching text or add an audio (up to 15 MB) first, so there is something to ask about.', code: 'NOTHING_TO_READ' });
  }

  const questions = await draftQuizQuestions({ text: d.text, audio, count: d.count });
  if (!questions) {
    return res.status(502).json({ error: 'The assistant could not write questions just now. Please try again, or write them yourself.', code: 'AI_FAILED' });
  }
  res.json({ questions });
}));

// ---------------------------------------------------------------------------
// One teaching
// ---------------------------------------------------------------------------

async function loadTeaching(req: any, res: any) {
  const personId = req.member!.personId as string;
  const teaching = await prisma.teaching.findUnique({
    where: { id: req.params.id },
    include: {
      message: { select: { deletedAt: true, attachments: { select: { id: true, originalFilename: true, mimeType: true, byteSize: true, pageCount: true } } } },
      community: { select: { name: true } },
      author: { select: { name: true } },
      // The quiz's own questions (the first set); a retake's fresh set is not counted here.
      assessment: { select: { passMark: true, _count: { select: { questions: { where: { setNumber: 1 } } } } } },
    },
  });
  // Not found, deleted, or not yours to see: all the same answer.
  if (!teaching || teaching.message.deletedAt || !(await hasConversationAccess(personId, teaching.communityId))) {
    res.status(404).json({ error: 'Teaching not found.' });
    return null;
  }
  return { teaching, personId };
}

function myProgress(p: { textReadAt: Date | null; mediaFraction: number; mediaDoneAt: Date | null; completedAt: Date | null } | null) {
  return {
    textRead: Boolean(p?.textReadAt),
    mediaFraction: p?.mediaFraction ?? 0,
    mediaDone: Boolean(p?.mediaDoneAt),
    completed: Boolean(p?.completedAt),
  };
}

/** The quiz block shown on the teaching page: its facts plus where this member is. */
function quizPayload(
  teaching: { assessmentId: string; assessment: { passMark: number; _count: { questions: number } } },
  quiz: ReturnType<typeof quizStateOf>,
) {
  return { assessmentId: teaching.assessmentId, passMark: teaching.assessment.passMark, questionCount: teaching.assessment._count.questions, ...quiz };
}

async function myQuiz(teaching: { id: string; assessmentId: string; closesAt: Date }, personId: string) {
  const [progress, attempts] = await Promise.all([
    prisma.teachingProgress.findUnique({ where: { teachingId_personId: { teachingId: teaching.id, personId } } }),
    prisma.attempt.findMany({
      where: { personId, assessmentId: teaching.assessmentId },
      orderBy: { attemptNumber: 'asc' },
      select: { status: true, percentage: true, passed: true },
    }),
  ]);
  return { progress, quiz: quizStateOf(teaching, progress, attempts) };
}

// GET /api/teachings/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const found = await loadTeaching(req, res);
  if (!found) return;
  const { teaching, personId } = found;
  const [{ progress, quiz }, canManage, canInvite] = await Promise.all([
    myQuiz(teaching, personId),
    isCentralAdminPerson(personId),
    // The central admin and this assembly's leaders can remind everyone who failed to retake.
    isCommunityAdministrator(personId, teaching.communityId),
  ]);
  res.json({
    id: teaching.id,
    title: teaching.title,
    text: teaching.text,
    detectedLanguage: teaching.detectedLanguage,
    titleTranslated: teaching.titleTranslated,
    textTranslated: teaching.textTranslated,
    communityId: teaching.communityId,
    communityName: teaching.community.name,
    messageId: teaching.messageId,
    authorName: teaching.author?.name ?? null,
    isAuthor: teaching.authorPersonId === personId,
    createdAt: teaching.createdAt,
    closesAt: teaching.closesAt,
    mediaKind: teaching.mediaKind,
    attachments: teaching.message.attachments,
    minReadSeconds: minReadSeconds(teaching.text),
    canManage,
    canInvite,
    quiz: quizPayload(teaching, quiz),
    me: myProgress(progress),
  });
}));

const progressSchema = z.object({
  textRead: z.boolean().optional(),
  mediaFraction: z.number().min(0).max(1).optional(),
});

// POST /api/teachings/:id/progress — what the app saw this member do. An
// empty body just records that they opened it.
router.post('/:id/progress', teachingProgressLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const found = await loadTeaching(req, res);
  if (!found) return;
  const { teaching, personId } = found;
  const parsed = progressSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const row = await recordProgress(teaching, personId, parsed.data);
  const { quiz } = await myQuiz(teaching, personId);
  res.json({ me: myProgress(row), quiz: quizPayload(teaching, quiz) });
}));

// GET /api/teachings/:id/results — the live list everyone in the assembly sees.
router.get('/:id/results', asyncHandler(async (req, res) => {
  const found = await loadTeaching(req, res);
  if (!found) return;
  const { teaching, personId } = found;
  const canManage = await isCentralAdminPerson(personId);
  // The central admin and this assembly's leaders can invite everyone who failed to retake.
  const canInvite = canManage || (await isCommunityAdministrator(personId, teaching.communityId));
  const retake = canInvite ? { waiting: (await membersWhoCanRetake(teaching.assessmentId, teaching.authorPersonId)).length } : undefined;
  res.json({ ...(await teachingResults(teaching, canManage)), passMark: teaching.assessment.passMark, closesAt: teaching.closesAt, canInvite, retake });
}));

function retakeFailure(res: any, err: unknown) {
  if (err instanceof RetakeError) return res.status(err.status).json({ error: err.message, code: err.code });
  throw err;
}

// POST /api/teachings/:id/retake — the member's one retake after failing the quiz:
// starts a new try with fresh questions (never the ones already seen). No approval needed.
router.post('/:id/retake', teachingProgressLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const found = await loadTeaching(req, res);
  if (!found) return;
  const { teaching, personId } = found;
  try {
    const attempt = await startTeachingRetake(personId, teaching);
    res.status(201).json({ assessmentId: teaching.assessmentId, attemptId: attempt.id });
  } catch (err) {
    return retakeFailure(res, err);
  }
}));

// POST /api/teachings/:id/retake-invite — the central admin or a leader of this assembly:
// prepares the fresh questions and tells everyone who failed that they can try again.
router.post('/:id/retake-invite', teachingPostLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const found = await loadTeaching(req, res);
  if (!found) return;
  const { teaching, personId } = found;
  if (!(await isCentralAdminPerson(personId)) && !(await isCommunityAdministrator(personId, teaching.communityId))) {
    return res.status(403).json({ error: 'Only the central admin or a leader of this assembly can do this.', code: 'NOT_ALLOWED' });
  }
  const ids = await membersWhoCanRetake(teaching.assessmentId, teaching.authorPersonId);
  if (ids.length === 0) return res.json({ invited: 0 });
  try {
    await ensureRetakeQuestions(teaching);
  } catch (err) {
    return retakeFailure(res, err);
  }
  await pushToPersons(ids, {
    title: `📖 ${teaching.title}`,
    body: 'You can try the quiz again with new questions. Read the teaching carefully first — this is your last try.',
    url: `/member/teachings/${teaching.id}`,
  }).catch(() => {});
  await recordAudit({ action: 'TEACHING_RETAKE_INVITED', targetType: 'Teaching', targetId: teaching.id, metadata: { recipients: ids.length } });
  res.json({ invited: ids.length });
}));

const REMIND_EVERY_MS = 3 * 60 * 60 * 1000;

// POST /api/teachings/:id/remind — central admin: a push to everyone who
// hasn't finished yet (at most once every 3 hours).
router.post('/:id/remind', teachingPostLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const found = await loadTeaching(req, res);
  if (!found) return;
  const { teaching, personId } = found;
  if (!(await isCentralAdminPerson(personId))) return res.status(403).json({ error: 'Only the central admin can do this.', code: 'NOT_ALLOWED' });
  if (teaching.closesAt < new Date()) return res.status(409).json({ error: 'This teaching is closed.', code: 'CLOSED' });
  if (teaching.lastRemindedAt && Date.now() - teaching.lastRemindedAt.getTime() < REMIND_EVERY_MS) {
    return res.status(429).json({ error: 'A reminder was just sent. Please wait a few hours before the next one.', code: 'TOO_SOON' });
  }
  const results = await teachingResults(teaching, true);
  const ids = (results.notFinished ?? []).map((m) => m.personId);
  await prisma.teaching.update({ where: { id: teaching.id }, data: { lastRemindedAt: new Date() } });
  await pushToPersons(ids, {
    title: `📖 ${teaching.title}`,
    body: 'You have not finished this teaching yet. Read or listen, then take the quiz.',
    url: `/member/teachings/${teaching.id}`,
  }).catch(() => {});
  await recordAudit({ action: 'TEACHING_REMINDER_SENT', targetType: 'Teaching', targetId: teaching.id, metadata: { recipients: ids.length } });
  res.json({ sent: ids.length });
}));

export default router;
