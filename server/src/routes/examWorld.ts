import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { readingProgressLimiter, socialMutationLimiter } from '../lib/rateLimit';
import { getObjectStream, isStorageConfigured } from '../lib/storage';
import crypto from 'crypto';
import { openUnpaidBook } from '../lib/bookPayments';
import { canReadBook, canSeeDevotional, examAccess, getTrainingBooksFor, MAX_GRACE_BOOKS } from '../lib/examWorld';
import { activePaymentProvider } from '../lib/payments';
import { trainingExamState } from '../lib/trainingExam';
import { coverUrl, sendCover } from '../lib/bookCovers';

// ---------------------------------------------------------------------------
// /api/member — Exam World for members: the summary page (this month's
// devotional with its weekly exams, and leadership training books), asking
// to join leadership training, the Leadership School (books, covers,
// chapter summaries), free-will offerings, and reading books inside the app.
// ---------------------------------------------------------------------------

const router = Router();

// GET /api/member/exam-world
router.get('/exam-world', requireMember, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;

  const memberships = await prisma.communityMembership.findMany({ where: { personId, status: 'ACTIVE' }, select: { communityId: true } });
  const devotionals = await prisma.monthlyDevotional.findMany({
    where: { status: 'PUBLISHED', OR: [{ communityId: null }, { communityId: { in: memberships.map((m) => m.communityId) } }] },
    orderBy: { startDate: 'desc' },
    take: 3,
    include: {
      book: { select: { id: true, storageKey: true } },
      assessments: {
        where: { status: { not: 'DRAFT' }, weekNumber: { not: null } },
        orderBy: { weekNumber: 'asc' },
        select: { id: true, weekNumber: true, titleEn: true, titleFr: true, passMark: true },
      },
    },
  });

  const examIds = devotionals.flatMap((d) => d.assessments.map((a) => a.id));
  const attempts = examIds.length
    ? await prisma.attempt.findMany({
        where: { personId, assessmentId: { in: examIds }, status: 'SUBMITTED' },
        orderBy: { attemptNumber: 'asc' },
        select: { assessmentId: true, percentage: true, passed: true, attemptNumber: true },
      })
    : [];

  const [settings, training, myOfferings] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 'singleton' }, select: { offeringInstructionsEn: true, offeringInstructionsFr: true } }),
    trainingSummary(personId),
    prisma.devotionalOffering.findMany({
      where: { personId, devotionalId: { in: devotionals.map((d) => d.id) } },
      select: { devotionalId: true },
    }),
  ]);
  const gaveFor = new Set(myOfferings.map((o) => o.devotionalId));

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  res.json({
    offering: { instructionsEn: settings?.offeringInstructionsEn ?? null, instructionsFr: settings?.offeringInstructionsFr ?? null },
    devotionals: devotionals.map((d) => ({
      id: d.id,
      titleEn: d.titleEn,
      titleFr: d.titleFr,
      descriptionEn: d.descriptionEn,
      descriptionFr: d.descriptionFr,
      startDate: d.startDate,
      endDate: d.endDate,
      bookId: d.book?.storageKey ? d.book.id : null,
      iGaveOffering: gaveFor.has(d.id),
      exams: d.assessments.map((a) => {
        const mine = attempts.filter((t) => t.assessmentId === a.id);
        const first = mine[0] ?? null; // only the first try counts
        return {
          id: a.id,
          weekNumber: a.weekNumber,
          titleEn: a.titleEn,
          titleFr: a.titleFr,
          passMark: a.passMark,
          open: d.endDate.getTime() + DAY >= now,
          firstScore: first?.percentage ?? null,
          firstPassed: first?.passed ?? null,
          tries: mine.length,
        };
      }),
    })),
    training,
  });
}));

// ----------------------------- Leadership School ----------------------------

/**
 * The member's leadership training: where they are, what they owe, and
 * every book in order (cover, pages, open or why not, payment, exam).
 * Shown on the Leadership School page, and in short on the Learn page.
 */
async function trainingSummary(personId: string) {
  const [settings, enrollment, books, chapterCounts, graceRequest, reading] = await Promise.all([
    prisma.settings.findUnique({
      where: { id: 'singleton' },
      select: { trainingBookPrice: true, trainingPaymentInstructionsEn: true, trainingPaymentInstructionsFr: true },
    }),
    prisma.trainingEnrollment.findUnique({ where: { personId }, select: { status: true, graceBooks: true } }),
    getTrainingBooksFor(personId),
    prisma.bookChapter.groupBy({ by: ['bookId'], _count: { _all: true } }),
    prisma.trainingGraceRequest.findFirst({ where: { personId }, orderBy: { requestedAt: 'desc' }, select: { status: true, books: true } }),
    prisma.readingProgress.findMany({ where: { personId }, select: { bookId: true, page: true } }),
  ]);
  const lastPageOf = new Map(reading.map((r) => [r.bookId, r.page]));
  const price = settings?.trainingBookPrice ?? 1200;
  const owedBooks = books.filter((b) => b.unlocked && b.payment !== 'PAID').length;
  const chaptersOf = new Map(chapterCounts.map((c) => [c.bookId, c._count._all]));

  // Each open book's exam: can it be taken now, or what is it waiting for
  // (a retake request, the admin, new questions)?
  const examStates = new Map(
    await Promise.all(
      books
        .filter((b) => b.unlocked && b.exam?.published)
        .map(async (b) => [b.exam!.id, await trainingExamState(personId, b.exam!.id)] as const),
    ),
  );

  return {
    enrollment: enrollment?.status ?? 'NONE',
    // Payment: 1,200 FCFA a book, paid before the next book opens —
    // unless "study now, pay later" grace allows up to 5 owed.
    price,
    owed: { books: owedBooks, amount: owedBooks * price },
    graceBooks: enrollment?.graceBooks ?? 0,
    maxGraceBooks: MAX_GRACE_BOOKS,
    graceRequest: graceRequest ?? null,
    paymentInstructionsEn: settings?.trainingPaymentInstructionsEn ?? null,
    paymentInstructionsFr: settings?.trainingPaymentInstructionsFr ?? null,
    automaticPayments: activePaymentProvider() !== null,
    books: books.map((b) => ({
      id: b.id,
      trainingOrder: b.trainingOrder,
      titleEn: b.titleEn,
      titleFr: b.titleFr,
      descriptionEn: b.descriptionEn,
      descriptionFr: b.descriptionFr,
      coverUrl: coverUrl(b),
      pageCount: b.pageCount,
      chapterCount: chaptersOf.get(b.id) ?? 0,
      // Where they stopped reading (null = not started).
      lastPage: b.unlocked ? (lastPageOf.get(b.id) ?? null) : null,
      unlocked: b.unlocked,
      canRead: b.unlocked && b.hasFile,
      payment: b.payment,
      lockedBecause: b.lockedBecause,
      exam:
        b.exam && b.exam.published
          ? {
              id: b.exam.id,
              passMark: b.exam.passMark,
              bestPercentage: b.exam.bestPercentage,
              passed: b.exam.passed,
              tries: examStates.get(b.exam.id)?.submittedTries ?? 0,
              canStart: examStates.get(b.exam.id)?.canStart ?? false,
              block: examStates.get(b.exam.id)?.block ?? null,
            }
          : null,
    })),
  };
}

// GET /api/member/school — the Leadership School page.
router.get('/school', requireMember, asyncHandler(async (req, res) => {
  res.json(await trainingSummary(req.member!.personId));
}));

// GET /api/member/school/books/:id — one book's page: everything above,
// plus its chapters with their summaries (shown before the book opens too,
// so members see what each book teaches).
router.get('/school/books/:id', requireMember, asyncHandler(async (req, res) => {
  const summary = await trainingSummary(req.member!.personId);
  const book = summary.books.find((b) => b.id === req.params.id);
  if (!book) return res.status(404).json({ error: 'Book not found.' });
  const chapters = await prisma.bookChapter.findMany({
    where: { bookId: book.id },
    orderBy: { order: 'asc' },
    select: { id: true, order: true, titleEn: true, titleFr: true, summaryEn: true, summaryFr: true },
  });
  res.json({ ...summary, book, chapters });
}));

// POST /api/member/training/request — "Begin my training": starts at once
// and opens Book 1 on trust (paid before Book 2 opens). Training the
// central admin stopped stays stopped until the admin starts it again.
router.post('/training/request', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  const existing = await prisma.trainingEnrollment.findUnique({ where: { personId } });
  if (existing?.status === 'ACTIVE' || existing?.status === 'REVOKED') return res.json({ enrollment: existing.status });
  const now = new Date();
  const e = await prisma.trainingEnrollment.upsert({
    where: { personId },
    create: { personId, status: 'ACTIVE', requestedAt: now, activatedAt: now },
    update: { status: 'ACTIVE', requestedAt: existing?.requestedAt ?? now, activatedAt: now },
  });
  await recordAudit({ action: 'TRAINING_STARTED', targetType: 'Person', targetId: personId });
  res.status(201).json({ enrollment: e.status });
}));

// ----------------------------- Paying for books -----------------------------

const claimSchema = z.object({
  reference: z.string().trim().min(3).max(60),
  payerPhone: z.string().trim().max(30).optional(),
});

// POST /api/member/training/books/:id/payments — "I have paid" by Mobile
// Money: the transaction ID goes to the central admin to confirm.
router.post('/training/books/:id/payments', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please type the Mobile Money transaction ID.', code: 'INVALID' });
  const personId = req.member!.personId;
  const found = await openUnpaidBook(personId, req.params.id);
  if (found.error === 404) return res.status(404).json({ error: 'Book not found.' });
  if (found.error) return res.status(409).json({ error: 'This book is already paid or waiting for confirmation.', code: found.error });
  // One Mobile Money transaction pays for one book: the same transaction ID cannot
  // be claimed again (a rejected claim does not block its ID, in case it was a mistake).
  const reused = await prisma.bookPayment.findFirst({
    where: { reference: { equals: parsed.data.reference, mode: 'insensitive' }, status: { in: ['CLAIMED', 'PENDING', 'CONFIRMED'] } },
    select: { id: true },
  });
  if (reused) return res.status(409).json({ error: 'This transaction ID has already been used for a payment. Please check it and type the ID from your own payment message.', code: 'DUPLICATE_REFERENCE' });
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { trainingBookPrice: true } });
  const payment = await prisma.bookPayment.create({
    data: {
      personId,
      bookId: found.book.id,
      bookNumber: found.book.trainingOrder,
      amount: settings?.trainingBookPrice ?? 1200,
      method: 'MANUAL',
      status: 'CLAIMED',
      reference: parsed.data.reference,
      payerPhone: parsed.data.payerPhone || null,
    },
    select: { id: true, status: true },
  });
  await recordAudit({ action: 'BOOK_PAYMENT_CLAIMED', targetType: 'BookPayment', targetId: payment.id, metadata: { personId, bookNumber: found.book.trainingOrder } });
  res.status(201).json(payment);
}));

const payNowSchema = z.object({ phone: z.string().trim().regex(/^\+?[0-9 ]{8,20}$/) });

// POST /api/member/training/books/:id/pay-now — automatic Mobile Money
// through the payment company, when one is connected (lib/payments.ts).
// The member approves on their phone; the company's notification then
// confirms the payment (POST /api/payments/webhook).
router.post('/training/books/:id/pay-now', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const provider = activePaymentProvider();
  if (!provider) return res.status(503).json({ error: 'Paying in the app is not available yet. Please pay by Mobile Money and tell us the transaction ID.', code: 'AUTOMATIC_OFF' });
  const parsed = payNowSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please enter your Mobile Money number.', code: 'INVALID' });
  const personId = req.member!.personId;
  const found = await openUnpaidBook(personId, req.params.id);
  if (found.error === 404) return res.status(404).json({ error: 'Book not found.' });
  if (found.error) return res.status(409).json({ error: 'This book is already paid or waiting for confirmation.', code: found.error });
  const settings = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { trainingBookPrice: true } });
  const amount = settings?.trainingBookPrice ?? 1200;
  const reference = `book-${crypto.randomUUID()}`;
  let started;
  try {
    started = await provider.requestPayment({
      reference,
      amount,
      currency: 'XAF',
      phone: parsed.data.phone.replace(/\s/g, ''),
      description: `The God Nation Leadership School — Book ${found.book.trainingOrder}`,
    });
  } catch (err) {
    console.error('[payments] request failed', { provider: provider.name, error: err instanceof Error ? err.message : String(err) });
    return res.status(502).json({ error: 'The payment could not be started. Please try again, or pay by Mobile Money.', code: 'PROVIDER_FAILED' });
  }
  const payment = await prisma.bookPayment.create({
    data: {
      personId,
      bookId: found.book.id,
      bookNumber: found.book.trainingOrder,
      amount,
      method: 'AUTOMATIC',
      status: 'PENDING',
      reference,
      payerPhone: parsed.data.phone,
      provider: provider.name,
      providerRef: started.providerRef,
    },
    select: { id: true, status: true },
  });
  res.status(201).json(payment);
}));

const graceSchema = z.object({ books: z.number().int().min(1).max(MAX_GRACE_BOOKS) });

// POST /api/member/training/grace — "study now, pay later" for up to 5
// books; only the central admin grants it.
router.post('/training/grace', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = graceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: `Choose between 1 and ${MAX_GRACE_BOOKS} books.`, code: 'INVALID' });
  const personId = req.member!.personId;
  const enrollment = await prisma.trainingEnrollment.findUnique({ where: { personId }, select: { status: true } });
  if (enrollment?.status !== 'ACTIVE') return res.status(409).json({ error: 'Begin your training first.', code: 'NOT_STARTED' });
  const open = await prisma.trainingGraceRequest.findFirst({ where: { personId, status: 'REQUESTED' } });
  if (open) return res.json({ status: open.status, books: open.books });
  const created = await prisma.trainingGraceRequest.create({ data: { personId, books: parsed.data.books }, select: { id: true, status: true, books: true } });
  await recordAudit({ action: 'TRAINING_GRACE_REQUESTED', targetType: 'TrainingGraceRequest', targetId: created.id, metadata: { personId, books: parsed.data.books } });
  res.status(201).json({ status: created.status, books: created.books });
}));

// POST /api/member/devotionals/:id/offering — "I have given" (optional amount).
const offeringSchema = z.object({
  amount: z.number().int().positive().max(100_000_000).optional(),
  note: z.string().trim().max(300).optional(),
});

router.post('/devotionals/:id/offering', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = offeringSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Please enter a whole amount, or leave it empty.' });
  const devotional = await prisma.monthlyDevotional.findUnique({ where: { id: req.params.id } });
  if (!devotional || !(await canSeeDevotional(req.member!.personId, devotional))) return res.status(404).json({ error: 'Not found.' });
  const o = await prisma.devotionalOffering.create({
    data: { personId: req.member!.personId, devotionalId: devotional.id, amount: parsed.data.amount ?? null, note: parsed.data.note || null },
    select: { id: true },
  });
  res.status(201).json({ id: o.id });
}));

// ----------------------------- Reading books --------------------------------

// GET /api/member/library/books/:id — what the reader needs: title, the
// reader's own name and phone for the watermark printed across every page,
// where they stopped reading, and which version of the PDF this is (the
// phone keeps a downloaded copy and fetches it again when it changes).
router.get('/library/books/:id', requireMember, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  if (!(await canReadBook(personId, req.params.id))) return res.status(404).json({ error: 'Book not found.' });
  const [book, person, progress] = await Promise.all([
    prisma.libraryBook.findUnique({
      where: { id: req.params.id },
      select: { id: true, kind: true, titleEn: true, titleFr: true, trainingOrder: true, storageKey: true, byteSize: true, pageCount: true, exam: { select: { id: true, status: true } } },
    }),
    prisma.person.findUnique({ where: { id: personId }, select: { name: true, whatsappNumber: true } }),
    prisma.readingProgress.findUnique({ where: { personId_bookId: { personId, bookId: req.params.id } }, select: { page: true, updatedAt: true } }),
  ]);
  const examId = book!.exam && book!.exam.status !== 'DRAFT' && (await examAccess(personId, book!.exam.id)).canView ? book!.exam.id : null;
  res.json({
    id: book!.id,
    kind: book!.kind,
    titleEn: book!.titleEn,
    titleFr: book!.titleFr,
    trainingOrder: book!.trainingOrder,
    examId,
    watermark: `${person?.name ?? ''} · ${person?.whatsappNumber ?? ''}`,
    fileVersion: crypto.createHash('sha256').update(book!.storageKey ?? '').digest('hex').slice(0, 16),
    byteSize: book!.byteSize,
    pageCount: book!.pageCount,
    progress: progress ? { page: progress.page, at: progress.updatedAt } : null,
  });
}));

const progressSchema = z.object({
  page: z.number().int().min(1).max(10000),
  pageCount: z.number().int().min(1).max(10000).optional(),
  // When the phone saved it (it may have been offline); defaults to now.
  at: z.string().datetime().optional(),
});

// PUT /api/member/library/books/:id/progress — the reader's bookmark. A
// save that is older than the one already kept (sent late from another
// phone that was offline) is ignored.
router.put('/library/books/:id/progress', readingProgressLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const parsed = progressSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid page.', code: 'INVALID' });
  const personId = req.member!.personId;
  if (!(await canReadBook(personId, req.params.id))) return res.status(404).json({ error: 'Book not found.' });
  const now = new Date();
  const sent = parsed.data.at ? new Date(parsed.data.at) : now;
  const at = sent > now ? now : sent;
  const key = { personId_bookId: { personId, bookId: req.params.id } };
  const existing = await prisma.readingProgress.findUnique({ where: key, select: { updatedAt: true, page: true } });
  if (existing && existing.updatedAt > at) return res.json({ page: existing.page, at: existing.updatedAt, kept: true });
  const saved = await prisma.readingProgress.upsert({
    where: key,
    create: { personId, bookId: req.params.id, page: parsed.data.page, pageCount: parsed.data.pageCount ?? null, updatedAt: at },
    update: { page: parsed.data.page, pageCount: parsed.data.pageCount ?? undefined, updatedAt: at },
    select: { page: true, updatedAt: true },
  });
  res.json({ page: saved.page, at: saved.updatedAt });
}));

// GET /api/member/library/books/:id/cover — any leadership book's cover
// (the school shows all of them, also before they open), or a devotional
// book's cover for those who can see that devotional.
router.get('/library/books/:id/cover', requireMember, asyncHandler(async (req, res) => {
  const book = await prisma.libraryBook.findUnique({ where: { id: req.params.id }, include: { devotional: true } });
  if (!book) return res.status(404).json({ error: 'Book not found.' });
  if (book.kind === 'DEVOTIONAL' && !(book.devotional && (await canSeeDevotional(req.member!.personId, book.devotional)))) {
    return res.status(404).json({ error: 'Book not found.' });
  }
  await sendCover(res, book.id, typeof req.query.v === 'string');
}));

// GET /api/member/library/books/:id/content — the PDF bytes, streamed by
// the server to the app's own reader. No storage link, not cached, shown
// inline (never offered as a download).
router.get('/library/books/:id/content', requireMember, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  if (!(await canReadBook(personId, req.params.id))) return res.status(404).json({ error: 'Book not found.' });
  const book = await prisma.libraryBook.findUnique({ where: { id: req.params.id }, select: { storageKey: true } });
  if (!book?.storageKey || !isStorageConfigured()) return res.status(404).json({ error: 'Book not found.' });
  const object = await getObjectStream({ storageKey: book.storageKey });
  if (!object) return res.status(404).json({ error: 'Book not found.' });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (object.contentLength) res.setHeader('Content-Length', String(object.contentLength));
  object.body.on('error', (err) => {
    console.error('[library] stream failed', { bookId: req.params.id, error: err instanceof Error ? err.message : String(err) });
    res.destroy();
  });
  object.body.pipe(res);
}));

export default router;
