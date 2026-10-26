import { Router } from 'express';
import { Prisma } from '@prisma/client';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { attachmentUploadAuthorizeLimiter, communityMutationLimiter } from '../lib/rateLimit';
import { createUploadUrl, headObject, isStorageConfigured } from '../lib/storage';
import { MAX_GRACE_BOOKS, TRAINING_PASS_MARK, getTrainingBooksFor } from '../lib/examWorld';
import { examSetNumbers } from '../lib/trainingExam';
import { notifyBookPaymentDecision, notifyExamRetakeDecision, notifyTrainingGraceDecision } from '../lib/notifications';
import { activePaymentProvider } from '../lib/payments';
import { coverUrl, newCoverVersion, readCoverDataUrl, sendCover } from '../lib/bookCovers';
import { creditReferralEarning } from '../lib/referralEarnings';

// ---------------------------------------------------------------------------
// /api/admin/library — central admin side of Exam World:
//  - books: leadership-training eBooks (1, 2, 3...) and the monthly
//    devotional's book; upload each PDF (read in the app only), its cover,
//    and its chapters with a short summary each (Leadership School)
//  - weekly exams for a devotional (Week 1, 2, 3...)
//  - trainees: requests, and marking someone as paid (opens Book 1)
//  - free-will offerings: the giving instructions and who gave
// Questions and answers of every exam are still written on the
// Assessments tab (each exam created here is an ordinary assessment).
// ---------------------------------------------------------------------------

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

const MAX_BOOK_BYTES = 50 * 1024 * 1024;
const BOOK_KEY_PATTERN = /^library\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.pdf$/;

function audit(req: any, action: string, targetType: string, targetId: string, metadata?: Record<string, unknown>) {
  return recordAudit({ actorId: req.user!.id, actorEmail: req.user!.email, action, targetType, targetId, metadata });
}

// ----------------------------- Books ---------------------------------------

router.get('/books', asyncHandler(async (_req, res) => {
  const books = await prisma.libraryBook.findMany({
    orderBy: [{ kind: 'asc' }, { trainingOrder: 'asc' }, { createdAt: 'desc' }],
    include: {
      devotional: { select: { id: true, titleEn: true, startDate: true } },
      exam: { select: { id: true, titleEn: true, status: true, passMark: true, _count: { select: { questions: true } } } },
      cover: { select: { source: true } },
      _count: { select: { chapters: true } },
    },
  });
  // Leadership book exams: how many questions each set has (20 per set).
  const examIds = books.map((b) => b.exam?.id).filter((id): id is string => Boolean(id));
  const setCounts = examIds.length
    ? await prisma.question.groupBy({ by: ['assessmentId', 'setNumber'], where: { assessmentId: { in: examIds } }, _count: { _all: true } })
    : [];
  res.json({
    items: books.map((b) => ({
      id: b.id,
      kind: b.kind,
      titleEn: b.titleEn,
      titleFr: b.titleFr,
      descriptionEn: b.descriptionEn,
      descriptionFr: b.descriptionFr,
      trainingOrder: b.trainingOrder,
      devotional: b.devotional,
      hasFile: Boolean(b.storageKey),
      byteSize: b.byteSize,
      pageCount: b.pageCount,
      coverUrl: coverUrl(b, '/api/admin/library/books'),
      coverSource: b.cover?.source ?? null,
      chapterCount: b._count.chapters,
      exam: b.exam
        ? {
            id: b.exam.id,
            titleEn: b.exam.titleEn,
            status: b.exam.status,
            passMark: b.exam.passMark,
            questionCount: b.exam._count.questions,
            sets: setCounts
              .filter((c) => c.assessmentId === b.exam!.id)
              .map((c) => ({ setNumber: c.setNumber, questions: c._count._all }))
              .sort((x, y) => x.setNumber - y.setNumber),
          }
        : null,
    })),
  });
}));

const createBookSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('TRAINING'),
    titleEn: z.string().trim().min(1).max(200),
    titleFr: z.string().trim().max(200).optional(),
    descriptionEn: z.string().trim().max(2000).optional(),
    descriptionFr: z.string().trim().max(2000).optional(),
    trainingOrder: z.number().int().min(1).max(100),
  }),
  z.object({
    kind: z.literal('DEVOTIONAL'),
    titleEn: z.string().trim().min(1).max(200),
    titleFr: z.string().trim().max(200).optional(),
    descriptionEn: z.string().trim().max(2000).optional(),
    descriptionFr: z.string().trim().max(2000).optional(),
    devotionalId: z.string().min(1),
  }),
]);

// POST /api/admin/library/books — a training book also gets its exam
// created (draft, 70% pass mark); add the questions on the Assessments tab.
router.post('/books', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createBookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid book.' });
  const d = parsed.data;
  try {
    const book = await prisma.$transaction(async (tx) => {
      if (d.kind === 'DEVOTIONAL') {
        const devotional = await tx.monthlyDevotional.findUnique({ where: { id: d.devotionalId } });
        if (!devotional) throw new Error('DEVOTIONAL_NOT_FOUND');
      }
      const created = await tx.libraryBook.create({
        data: {
          kind: d.kind,
          titleEn: d.titleEn,
          titleFr: d.titleFr || null,
          descriptionEn: d.descriptionEn || null,
          descriptionFr: d.descriptionFr || null,
          trainingOrder: d.kind === 'TRAINING' ? d.trainingOrder : null,
          devotionalId: d.kind === 'DEVOTIONAL' ? d.devotionalId : null,
        },
      });
      if (d.kind === 'TRAINING') {
        await tx.assessment.create({
          data: {
            titleEn: `Book ${d.trainingOrder} exam: ${d.titleEn}`,
            titleFr: d.titleFr ? `Examen du livre ${d.trainingOrder} : ${d.titleFr}` : null,
            passMark: TRAINING_PASS_MARK,
            maxAttempts: null,
            trainingBookId: created.id,
          },
        });
      }
      return created;
    });
    await audit(req, 'LIBRARY_BOOK_CREATED', 'LibraryBook', book.id, { kind: book.kind, trainingOrder: book.trainingOrder });
    res.status(201).json({ id: book.id });
  } catch (err) {
    if (err instanceof Error && err.message === 'DEVOTIONAL_NOT_FOUND') return res.status(400).json({ error: 'Devotional not found.' });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({
        error: d.kind === 'TRAINING' ? `There is already a Book ${d.trainingOrder}.` : 'This devotional already has a book.',
        code: 'DUPLICATE',
      });
    }
    throw err;
  }
}));

const patchBookSchema = z.object({
  titleEn: z.string().trim().min(1).max(200).optional(),
  titleFr: z.string().trim().max(200).optional(),
  descriptionEn: z.string().trim().max(2000).optional(),
  descriptionFr: z.string().trim().max(2000).optional(),
});

router.patch('/books/:id', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = patchBookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid book.' });
  const exists = await prisma.libraryBook.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'Book not found.' });
  const d = parsed.data;
  await prisma.libraryBook.update({
    where: { id: req.params.id },
    data: {
      ...(d.titleEn !== undefined ? { titleEn: d.titleEn } : {}),
      ...(d.titleFr !== undefined ? { titleFr: d.titleFr || null } : {}),
      ...(d.descriptionEn !== undefined ? { descriptionEn: d.descriptionEn || null } : {}),
      ...(d.descriptionFr !== undefined ? { descriptionFr: d.descriptionFr || null } : {}),
    },
  });
  await audit(req, 'LIBRARY_BOOK_UPDATED', 'LibraryBook', req.params.id);
  res.json({ ok: true });
}));

const fileAuthorizeSchema = z.object({ mimeType: z.literal('application/pdf'), byteSize: z.number().int().positive() });

// Upload step 1: a short-lived upload link for this book's PDF.
router.post('/books/:id/file/authorize', attachmentUploadAuthorizeLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = fileAuthorizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please choose a PDF file.', code: 'NOT_PDF' });
  if (parsed.data.byteSize > MAX_BOOK_BYTES) return res.status(400).json({ error: 'This PDF is too large (50 MB maximum).', code: 'TOO_LARGE' });
  const book = await prisma.libraryBook.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!book) return res.status(404).json({ error: 'Book not found.' });
  if (!isStorageConfigured()) return res.status(503).json({ error: 'File uploads are not available right now.', code: 'STORAGE_UNAVAILABLE' });
  const storageKey = `library/${book.id}/${crypto.randomUUID()}.pdf`;
  const { url, expiresAt } = await createUploadUrl({ storageKey, mimeType: 'application/pdf' });
  res.json({ storageKey, uploadUrl: url, expiresAt, maxBytes: MAX_BOOK_BYTES });
}));

const fileFinalizeSchema = z.object({
  storageKey: z.string().min(1),
  byteSize: z.number().int().positive(),
  // Read from the PDF in the admin's browser; left out when it couldn't be.
  pageCount: z.number().int().min(1).max(10000).optional(),
});

// Upload step 2: check the PDF really landed, then attach it to the book.
router.post('/books/:id/file', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = fileFinalizeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid file.' });
  const match = BOOK_KEY_PATTERN.exec(parsed.data.storageKey);
  if (!match || match[1] !== req.params.id) return res.status(400).json({ error: 'Invalid file reference.' });
  if (parsed.data.byteSize > MAX_BOOK_BYTES) return res.status(400).json({ error: 'Invalid file.' });
  if (!isStorageConfigured()) return res.status(503).json({ error: 'File uploads are not available right now.', code: 'STORAGE_UNAVAILABLE' });
  const head = await headObject({ storageKey: parsed.data.storageKey });
  if (!head || head.contentLength !== parsed.data.byteSize || (head.contentType && head.contentType !== 'application/pdf')) {
    return res.status(400).json({ error: 'The upload could not be verified. Please try again.' });
  }
  await prisma.libraryBook.update({
    where: { id: req.params.id },
    data: { storageKey: parsed.data.storageKey, byteSize: parsed.data.byteSize, pageCount: parsed.data.pageCount ?? null },
  });
  await audit(req, 'LIBRARY_BOOK_FILE_UPLOADED', 'LibraryBook', req.params.id, { byteSize: parsed.data.byteSize });
  res.json({ ok: true });
}));

// ----------------------------- Covers ---------------------------------------

const coverSchema = z.object({
  image: z.string().max(450_000),
  // AUTO: drawn from page 1 of the PDF just uploaded. MANUAL: chosen by the admin.
  source: z.enum(['AUTO', 'MANUAL']),
});

// PUT /api/admin/library/books/:id/cover — an automatic cover never
// replaces one the admin chose.
router.put('/books/:id/cover', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = coverSchema.safeParse(req.body);
  const picture = parsed.success ? readCoverDataUrl(parsed.data.image) : null;
  if (!parsed.success || !picture) return res.status(400).json({ error: 'Please choose a JPEG, PNG or WebP picture.', code: 'INVALID_COVER' });
  const book = await prisma.libraryBook.findUnique({ where: { id: req.params.id }, select: { id: true, cover: { select: { source: true } } } });
  if (!book) return res.status(404).json({ error: 'Book not found.' });
  if (parsed.data.source === 'AUTO' && book.cover?.source === 'MANUAL') return res.json({ kept: true });
  const coverVersion = newCoverVersion();
  await prisma.$transaction([
    prisma.libraryBookCover.upsert({
      where: { bookId: book.id },
      create: { bookId: book.id, mimeType: picture.mimeType, data: picture.data, source: parsed.data.source },
      update: { mimeType: picture.mimeType, data: picture.data, source: parsed.data.source },
    }),
    prisma.libraryBook.update({ where: { id: book.id }, data: { coverVersion } }),
  ]);
  await audit(req, 'LIBRARY_BOOK_COVER_SET', 'LibraryBook', book.id, { source: parsed.data.source, bytes: picture.data.length });
  res.json({ coverUrl: coverUrl({ id: book.id, coverVersion }, '/api/admin/library/books') });
}));

// DELETE /api/admin/library/books/:id/cover — back to the drawn cover.
router.delete('/books/:id/cover', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const book = await prisma.libraryBook.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!book) return res.status(404).json({ error: 'Book not found.' });
  await prisma.$transaction([
    prisma.libraryBookCover.deleteMany({ where: { bookId: book.id } }),
    prisma.libraryBook.update({ where: { id: book.id }, data: { coverVersion: null } }),
  ]);
  await audit(req, 'LIBRARY_BOOK_COVER_REMOVED', 'LibraryBook', book.id);
  res.json({ ok: true });
}));

router.get('/books/:id/cover', asyncHandler(async (req, res) => {
  await sendCover(res, req.params.id, typeof req.query.v === 'string');
}));

// ----------------------------- Chapters -------------------------------------

const chapterSchema = z.object({
  titleEn: z.string().trim().min(1).max(200),
  titleFr: z.string().trim().max(200).optional(),
  summaryEn: z.string().trim().max(3000).optional(),
  summaryFr: z.string().trim().max(3000).optional(),
});

const chapterView = { id: true, order: true, titleEn: true, titleFr: true, summaryEn: true, summaryFr: true } as const;

router.get('/books/:id/chapters', asyncHandler(async (req, res) => {
  const items = await prisma.bookChapter.findMany({ where: { bookId: req.params.id }, orderBy: { order: 'asc' }, select: chapterView });
  res.json({ items });
}));

// POST /api/admin/library/books/:id/chapters — adds the next chapter.
router.post('/books/:id/chapters', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = chapterSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please give the chapter a title.', code: 'INVALID' });
  const book = await prisma.libraryBook.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!book) return res.status(404).json({ error: 'Book not found.' });
  const last = await prisma.bookChapter.aggregate({ where: { bookId: book.id }, _max: { order: true } });
  const d = parsed.data;
  const chapter = await prisma.bookChapter.create({
    data: {
      bookId: book.id,
      order: (last._max.order ?? 0) + 1,
      titleEn: d.titleEn,
      titleFr: d.titleFr || null,
      summaryEn: d.summaryEn || null,
      summaryFr: d.summaryFr || null,
    },
    select: chapterView,
  });
  await audit(req, 'BOOK_CHAPTER_CREATED', 'BookChapter', chapter.id, { bookId: book.id });
  res.status(201).json(chapter);
}));

router.patch('/chapters/:id', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = chapterSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid chapter.', code: 'INVALID' });
  const exists = await prisma.bookChapter.findUnique({ where: { id: req.params.id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'Chapter not found.' });
  const d = parsed.data;
  const chapter = await prisma.bookChapter.update({
    where: { id: req.params.id },
    data: {
      ...(d.titleEn !== undefined ? { titleEn: d.titleEn } : {}),
      ...(d.titleFr !== undefined ? { titleFr: d.titleFr || null } : {}),
      ...(d.summaryEn !== undefined ? { summaryEn: d.summaryEn || null } : {}),
      ...(d.summaryFr !== undefined ? { summaryFr: d.summaryFr || null } : {}),
    },
    select: chapterView,
  });
  await audit(req, 'BOOK_CHAPTER_UPDATED', 'BookChapter', chapter.id);
  res.json(chapter);
}));

// POST /api/admin/library/chapters/:id/move — { direction: 'UP' | 'DOWN' }
// swaps it with the chapter before / after it.
router.post('/chapters/:id/move', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = z.object({ direction: z.enum(['UP', 'DOWN']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid move.', code: 'INVALID' });
  const chapter = await prisma.bookChapter.findUnique({ where: { id: req.params.id } });
  if (!chapter) return res.status(404).json({ error: 'Chapter not found.' });
  const up = parsed.data.direction === 'UP';
  const neighbour = await prisma.bookChapter.findFirst({
    where: { bookId: chapter.bookId, order: up ? { lt: chapter.order } : { gt: chapter.order } },
    orderBy: { order: up ? 'desc' : 'asc' },
  });
  if (neighbour) {
    await prisma.$transaction([
      prisma.bookChapter.update({ where: { id: chapter.id }, data: { order: neighbour.order } }),
      prisma.bookChapter.update({ where: { id: neighbour.id }, data: { order: chapter.order } }),
    ]);
  }
  res.json({ ok: true });
}));

router.delete('/chapters/:id', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const deleted = await prisma.bookChapter.deleteMany({ where: { id: req.params.id } });
  if (deleted.count === 0) return res.status(404).json({ error: 'Chapter not found.' });
  await audit(req, 'BOOK_CHAPTER_DELETED', 'BookChapter', req.params.id);
  res.json({ ok: true });
}));

// ----------------------------- Weekly exams ---------------------------------

const weeklyExamSchema = z.object({ weekNumber: z.number().int().min(1).max(6) });

// POST /api/admin/library/devotionals/:id/weekly-exams — creates "Week N
// exam" (draft). Write its questions on the Assessments tab, then publish
// it there to open it for members.
router.post('/devotionals/:id/weekly-exams', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = weeklyExamSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose a week from 1 to 6.' });
  const devotional = await prisma.monthlyDevotional.findUnique({ where: { id: req.params.id } });
  if (!devotional) return res.status(404).json({ error: 'Devotional not found.' });
  const duplicate = await prisma.assessment.findFirst({ where: { devotionalId: devotional.id, weekNumber: parsed.data.weekNumber } });
  if (duplicate) return res.status(409).json({ error: `Week ${parsed.data.weekNumber} already has an exam.`, code: 'DUPLICATE' });
  const exam = await prisma.assessment.create({
    data: {
      devotionalId: devotional.id,
      weekNumber: parsed.data.weekNumber,
      titleEn: `Week ${parsed.data.weekNumber} exam: ${devotional.titleEn}`,
      titleFr: devotional.titleFr ? `Examen de la semaine ${parsed.data.weekNumber} : ${devotional.titleFr}` : null,
      passMark: 50,
      maxAttempts: null,
    },
  });
  await audit(req, 'WEEKLY_EXAM_CREATED', 'Assessment', exam.id, { devotionalId: devotional.id, weekNumber: parsed.data.weekNumber });
  res.status(201).json({ id: exam.id });
}));

router.get('/devotionals', asyncHandler(async (_req, res) => {
  const devotionals = await prisma.monthlyDevotional.findMany({
    orderBy: { startDate: 'desc' },
    take: 24,
    include: {
      book: { select: { id: true, storageKey: true } },
      assessments: { where: { weekNumber: { not: null } }, orderBy: { weekNumber: 'asc' }, select: { id: true, weekNumber: true, status: true, _count: { select: { questions: true } } } },
      _count: { select: { offerings: true } },
    },
  });
  res.json({
    items: devotionals.map((d) => ({
      id: d.id,
      titleEn: d.titleEn,
      status: d.status,
      startDate: d.startDate,
      endDate: d.endDate,
      book: d.book ? { id: d.book.id, hasFile: Boolean(d.book.storageKey) } : null,
      weeklyExams: d.assessments.map((a) => ({ id: a.id, weekNumber: a.weekNumber, status: a.status, questionCount: a._count.questions })),
      offeringCount: d._count.offerings,
    })),
  });
}));

// ----------------------------- Trainees -------------------------------------

// ----------------------------- Exam retakes --------------------------------
// A member who failed a leadership book's exam asks for another try; only
// the central admin grants it. The list shows how many unused question
// sets are left for that person, so the admin knows when a new set must
// be written first.

router.get('/retakes', asyncHandler(async (req, res) => {
  const status = req.query.status === 'GRANTED' || req.query.status === 'DECLINED' ? req.query.status : 'REQUESTED';
  const rows = await prisma.examRetakeRequest.findMany({
    where: { status },
    orderBy: { requestedAt: status === 'REQUESTED' ? 'asc' : 'desc' },
    take: 200,
    include: {
      person: { select: { id: true, name: true, whatsappNumber: true } },
      assessment: { select: { id: true, trainingBook: { select: { trainingOrder: true, titleEn: true } } } },
    },
  });
  const items = await Promise.all(
    rows.map(async (r) => {
      const [sets, attempts] = await Promise.all([
        examSetNumbers(r.assessmentId),
        prisma.attempt.findMany({
          where: { personId: r.personId, assessmentId: r.assessmentId },
          select: { setNumber: true, status: true, percentage: true },
          orderBy: { attemptNumber: 'asc' },
        }),
      ]);
      const used = new Set(attempts.map((a) => a.setNumber));
      const submitted = attempts.filter((a) => a.status === 'SUBMITTED');
      return {
        id: r.id,
        status: r.status,
        requestedAt: r.requestedAt,
        decidedAt: r.decidedAt,
        used: Boolean(r.usedByAttemptId),
        person: r.person,
        assessmentId: r.assessmentId,
        bookNumber: r.assessment.trainingBook?.trainingOrder ?? null,
        bookTitleEn: r.assessment.trainingBook?.titleEn ?? '',
        tries: submitted.length,
        lastPercentage: submitted[submitted.length - 1]?.percentage ?? null,
        unusedSets: sets.filter((s) => !used.has(s)).length,
      };
    }),
  );
  res.json({ items });
}));

const retakeDecisionSchema = z.object({ decision: z.enum(['GRANT', 'DECLINE']) });

router.post('/retakes/:id', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = retakeDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose grant or decline.' });
  const granted = parsed.data.decision === 'GRANT';
  const changed = await prisma.examRetakeRequest.updateMany({
    where: { id: req.params.id, status: 'REQUESTED' },
    data: { status: granted ? 'GRANTED' : 'DECLINED', decidedAt: new Date(), decidedByUserId: req.user!.id },
  });
  const request = await prisma.examRetakeRequest.findUnique({ where: { id: req.params.id } });
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  if (changed.count === 0) return res.status(409).json({ error: 'This request was already answered.', status: request.status });
  await audit(req, granted ? 'EXAM_RETAKE_GRANTED' : 'EXAM_RETAKE_DECLINED', 'ExamRetakeRequest', request.id, { personId: request.personId });
  await notifyExamRetakeDecision(request, granted).catch(() => {});
  res.json({ id: request.id, status: request.status });
}));

router.get('/trainees', asyncHandler(async (req, res) => {
  const status = z.enum(['REQUESTED', 'ACTIVE', 'REVOKED']).safeParse(req.query.status);
  const rows = await prisma.trainingEnrollment.findMany({
    where: status.success ? { status: status.data } : {},
    orderBy: { updatedAt: 'desc' },
    take: 500,
    include: { person: { select: { id: true, name: true, whatsappNumber: true } } },
  });
  // Books opened and not yet paid, per trainee.
  const personIds = rows.map((r) => r.personId);
  const [opens, paid] = await Promise.all([
    prisma.trainingBookOpen.findMany({ where: { personId: { in: personIds } }, select: { personId: true, bookId: true } }),
    prisma.bookPayment.findMany({ where: { personId: { in: personIds }, status: 'CONFIRMED' }, select: { personId: true, bookId: true } }),
  ]);
  const paidKeys = new Set(paid.map((p) => `${p.personId}:${p.bookId}`));
  const owedOf = (personId: string) => opens.filter((o) => o.personId === personId && !paidKeys.has(`${o.personId}:${o.bookId}`)).length;
  res.json({
    items: rows.map((r) => ({
      personId: r.person.id,
      name: r.person.name,
      whatsappNumber: r.person.whatsappNumber,
      status: r.status,
      requestedAt: r.requestedAt,
      activatedAt: r.activatedAt,
      note: r.note,
      graceBooks: r.graceBooks,
      owedBooks: owedOf(r.personId),
    })),
  });
}));

const activateSchema = z.object({ personId: z.string().min(1), note: z.string().trim().max(300).optional() });

// POST /api/admin/library/trainees — start (or restart) someone's training
// for them: opens Book 1. Members normally start it themselves.
router.post('/trainees', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request.' });
  const person = await prisma.person.findUnique({ where: { id: parsed.data.personId }, select: { id: true } });
  if (!person) return res.status(404).json({ error: 'Person not found.' });
  const data = { status: 'ACTIVE' as const, activatedAt: new Date(), activatedByUserId: req.user!.id, note: parsed.data.note || null };
  await prisma.trainingEnrollment.upsert({ where: { personId: person.id }, create: { personId: person.id, ...data }, update: data });
  await audit(req, 'TRAINING_ACTIVATED', 'Person', person.id);
  res.json({ status: 'ACTIVE' });
}));

router.post('/trainees/:personId/revoke', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const updated = await prisma.trainingEnrollment.updateMany({ where: { personId: req.params.personId }, data: { status: 'REVOKED' } });
  if (updated.count === 0) return res.status(404).json({ error: 'Not found.' });
  await audit(req, 'TRAINING_REVOKED', 'Person', req.params.personId);
  res.json({ status: 'REVOKED' });
}));

// ----------------------------- Book payments --------------------------------
// 1,200 FCFA a book (Settings.trainingBookPrice). Manual payments are
// "I have paid" claims with a Mobile Money transaction ID, confirmed or
// rejected here; the admin can also record a payment received another way.
// Confirming a payment can open the trainee's next book (lib/examWorld.ts).

const trainingSettingsSchema = z.object({
  price: z.number().int().min(0).max(1_000_000),
  instructionsEn: z.string().trim().max(2000).optional(),
  instructionsFr: z.string().trim().max(2000).optional(),
});

router.get('/training-settings', asyncHandler(async (_req, res) => {
  const s = await prisma.settings.findUnique({
    where: { id: 'singleton' },
    select: { trainingBookPrice: true, trainingPaymentInstructionsEn: true, trainingPaymentInstructionsFr: true },
  });
  res.json({
    price: s?.trainingBookPrice ?? 1200,
    instructionsEn: s?.trainingPaymentInstructionsEn ?? '',
    instructionsFr: s?.trainingPaymentInstructionsFr ?? '',
    maxGraceBooks: MAX_GRACE_BOOKS,
    automaticProvider: activePaymentProvider()?.name ?? null,
  });
}));

router.put('/training-settings', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = trainingSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please enter the price in FCFA (numbers only).' });
  const data = {
    trainingBookPrice: parsed.data.price,
    trainingPaymentInstructionsEn: parsed.data.instructionsEn || null,
    trainingPaymentInstructionsFr: parsed.data.instructionsFr || null,
  };
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
  await audit(req, 'TRAINING_SETTINGS_UPDATED', 'Settings', 'singleton', { price: parsed.data.price });
  res.json({ ok: true });
}));

const paymentStatusSchema = z.enum(['CLAIMED', 'PENDING', 'CONFIRMED', 'REJECTED', 'FAILED']);

router.get('/payments', asyncHandler(async (req, res) => {
  const status = paymentStatusSchema.safeParse(req.query.status);
  const rows = await prisma.bookPayment.findMany({
    where: { status: status.success ? status.data : 'CLAIMED' },
    orderBy: { createdAt: status.success && status.data !== 'CLAIMED' ? 'desc' : 'asc' },
    take: 300,
    include: { person: { select: { id: true, name: true, whatsappNumber: true } } },
  });
  res.json({
    items: rows.map((p) => ({
      id: p.id,
      person: p.person,
      bookNumber: p.bookNumber,
      amount: p.amount,
      method: p.method,
      status: p.status,
      reference: p.reference,
      payerPhone: p.payerPhone,
      note: p.note,
      createdAt: p.createdAt,
      decidedAt: p.decidedAt,
    })),
  });
}));

router.get('/payments/summary', asyncHandler(async (_req, res) => {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const [all, month, waiting] = await Promise.all([
    prisma.bookPayment.aggregate({ where: { status: 'CONFIRMED' }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.bookPayment.aggregate({ where: { status: 'CONFIRMED', decidedAt: { gte: startOfMonth } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.bookPayment.count({ where: { status: 'CLAIMED' } }),
  ]);
  res.json({
    confirmed: { count: all._count._all, amount: all._sum.amount ?? 0 },
    thisMonth: { count: month._count._all, amount: month._sum.amount ?? 0 },
    waiting,
  });
}));

const paymentDecisionSchema = z.object({ decision: z.enum(['CONFIRM', 'REJECT']), note: z.string().trim().max(300).optional() });

router.post('/payments/:id', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = paymentDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose confirm or reject.' });
  const confirmed = parsed.data.decision === 'CONFIRM';
  const existing = await prisma.bookPayment.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Payment not found.' });
  if (confirmed && existing.personId && existing.bookId) {
    const already = await prisma.bookPayment.findFirst({ where: { personId: existing.personId, bookId: existing.bookId, status: 'CONFIRMED' } });
    if (already) return res.status(409).json({ error: 'This book is already paid.', code: 'ALREADY_PAID' });
  }
  const changed = await prisma.bookPayment.updateMany({
    where: { id: existing.id, status: { in: ['CLAIMED', 'PENDING'] } },
    data: { status: confirmed ? 'CONFIRMED' : 'REJECTED', decidedAt: new Date(), decidedByUserId: req.user!.id, note: parsed.data.note || existing.note },
  });
  if (changed.count === 0) return res.status(409).json({ error: 'This payment was already decided.', status: existing.status });
  await audit(req, confirmed ? 'BOOK_PAYMENT_CONFIRMED' : 'BOOK_PAYMENT_REJECTED', 'BookPayment', existing.id, { personId: existing.personId, bookNumber: existing.bookNumber });
  await notifyBookPaymentDecision(existing, confirmed).catch(() => {});
  if (confirmed) await creditReferralEarning({ ...existing, status: 'CONFIRMED' });
  if (confirmed && existing.personId) await getTrainingBooksFor(existing.personId); // records any book this opens
  res.json({ id: existing.id, status: confirmed ? 'CONFIRMED' : 'REJECTED' });
}));

const recordPaymentSchema = z.object({
  personId: z.string().min(1),
  bookId: z.string().min(1),
  reference: z.string().trim().max(60).optional(),
  note: z.string().trim().max(300).optional(),
});

// POST /api/admin/library/payments — record a payment received another way
// (cash, a transfer seen on the ministry's phone...): confirmed at once.
router.post('/payments', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = recordPaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Choose the person and the book.' });
  const { personId, bookId } = parsed.data;
  const [person, book, settings, already] = await Promise.all([
    prisma.person.findUnique({ where: { id: personId }, select: { id: true } }),
    prisma.libraryBook.findUnique({ where: { id: bookId }, select: { id: true, kind: true, trainingOrder: true } }),
    prisma.settings.findUnique({ where: { id: 'singleton' }, select: { trainingBookPrice: true } }),
    prisma.bookPayment.findFirst({ where: { personId, bookId, status: 'CONFIRMED' } }),
  ]);
  if (!person || !book || book.kind !== 'TRAINING') return res.status(404).json({ error: 'Person or book not found.' });
  if (already) return res.status(409).json({ error: 'This book is already paid.', code: 'ALREADY_PAID' });
  // A waiting claim for the same book is settled by this payment.
  await prisma.bookPayment.updateMany({
    where: { personId, bookId, status: 'CLAIMED' },
    data: { status: 'REJECTED', decidedAt: new Date(), decidedByUserId: req.user!.id, note: 'Replaced by a payment recorded by the admin.' },
  });
  const payment = await prisma.bookPayment.create({
    data: {
      personId,
      bookId,
      bookNumber: book.trainingOrder,
      amount: settings?.trainingBookPrice ?? 1200,
      method: 'MANUAL',
      status: 'CONFIRMED',
      reference: parsed.data.reference || null,
      note: parsed.data.note || null,
      decidedAt: new Date(),
      decidedByUserId: req.user!.id,
    },
  });
  await audit(req, 'BOOK_PAYMENT_RECORDED', 'BookPayment', payment.id, { personId, bookNumber: book.trainingOrder });
  await notifyBookPaymentDecision(payment, true).catch(() => {});
  await creditReferralEarning(payment);
  await getTrainingBooksFor(personId);
  res.status(201).json({ id: payment.id, status: payment.status });
}));

// ----------------------------- Grace ("study now, pay later") ----------------

router.get('/grace', asyncHandler(async (req, res) => {
  const status = z.enum(['REQUESTED', 'GRANTED', 'DECLINED']).safeParse(req.query.status);
  const rows = await prisma.trainingGraceRequest.findMany({
    where: { status: status.success ? status.data : 'REQUESTED' },
    orderBy: { requestedAt: 'asc' },
    take: 300,
    include: { person: { select: { id: true, name: true, whatsappNumber: true, trainingEnrollment: { select: { graceBooks: true } } } } },
  });
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      person: { id: r.person.id, name: r.person.name, whatsappNumber: r.person.whatsappNumber },
      books: r.books,
      currentGraceBooks: r.person.trainingEnrollment?.graceBooks ?? 0,
      status: r.status,
      requestedAt: r.requestedAt,
    })),
  });
}));

const graceDecisionSchema = z.object({ decision: z.enum(['GRANT', 'DECLINE']), books: z.number().int().min(1).max(MAX_GRACE_BOOKS).optional() });

router.post('/grace/:id', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = graceDecisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: `Choose grant (1 to ${MAX_GRACE_BOOKS} books) or decline.` });
  const request = await prisma.trainingGraceRequest.findUnique({ where: { id: req.params.id } });
  if (!request) return res.status(404).json({ error: 'Request not found.' });
  const granted = parsed.data.decision === 'GRANT';
  const books = granted ? (parsed.data.books ?? request.books) : null;
  const changed = await prisma.trainingGraceRequest.updateMany({
    where: { id: request.id, status: 'REQUESTED' },
    data: { status: granted ? 'GRANTED' : 'DECLINED', grantedBooks: books, decidedAt: new Date(), decidedByUserId: req.user!.id },
  });
  if (changed.count === 0) return res.status(409).json({ error: 'This request was already answered.', status: request.status });
  if (granted) await prisma.trainingEnrollment.updateMany({ where: { personId: request.personId }, data: { graceBooks: books! } });
  await audit(req, granted ? 'TRAINING_GRACE_GRANTED' : 'TRAINING_GRACE_DECLINED', 'TrainingGraceRequest', request.id, { personId: request.personId, books });
  await notifyTrainingGraceDecision({ id: request.id, personId: request.personId, grantedBooks: books }, granted).catch(() => {});
  if (granted) await getTrainingBooksFor(request.personId);
  res.json({ id: request.id, status: granted ? 'GRANTED' : 'DECLINED', books });
}));

// POST /api/admin/library/trainees/:personId/grace — change (or end, with 0)
// how many books this trainee may owe at once. Books already open stay open.
router.post('/trainees/:personId/grace', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = z.object({ books: z.number().int().min(0).max(MAX_GRACE_BOOKS) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: `Choose 0 to ${MAX_GRACE_BOOKS} books.` });
  const updated = await prisma.trainingEnrollment.updateMany({ where: { personId: req.params.personId }, data: { graceBooks: parsed.data.books } });
  if (updated.count === 0) return res.status(404).json({ error: 'Not found.' });
  await audit(req, 'TRAINING_GRACE_SET', 'Person', req.params.personId, { books: parsed.data.books });
  if (parsed.data.books > 0) await getTrainingBooksFor(req.params.personId);
  res.json({ graceBooks: parsed.data.books });
}));

// ----------------------------- Offerings ------------------------------------

router.get('/offering-settings', asyncHandler(async (_req, res) => {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { offeringInstructionsEn: true, offeringInstructionsFr: true } });
  res.json({ instructionsEn: s?.offeringInstructionsEn ?? '', instructionsFr: s?.offeringInstructionsFr ?? '' });
}));

const offeringSettingsSchema = z.object({
  instructionsEn: z.string().trim().max(1000),
  instructionsFr: z.string().trim().max(1000),
});

router.put('/offering-settings', communityMutationLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = offeringSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid text.' });
  const data = { offeringInstructionsEn: parsed.data.instructionsEn || null, offeringInstructionsFr: parsed.data.instructionsFr || null };
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', ...data }, update: data });
  await audit(req, 'OFFERING_SETTINGS_UPDATED', 'Settings', 'singleton');
  res.json(parsed.data);
}));

router.get('/devotionals/:id/offerings', asyncHandler(async (req, res) => {
  const rows = await prisma.devotionalOffering.findMany({
    where: { devotionalId: req.params.id },
    orderBy: { createdAt: 'desc' },
    take: 1000,
    include: { person: { select: { id: true, name: true } } },
  });
  const total = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  res.json({
    total,
    count: rows.length,
    items: rows.map((r) => ({ id: r.id, name: r.person?.name ?? null, amount: r.amount, currency: r.currency, note: r.note, createdAt: r.createdAt })),
  });
}));

export default router;
