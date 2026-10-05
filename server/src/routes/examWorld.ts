import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { asyncHandler } from '../lib/asyncHandler';
import { recordAudit } from '../lib/audit';
import { socialMutationLimiter } from '../lib/rateLimit';
import { getObjectStream, isStorageConfigured } from '../lib/storage';
import { canReadBook, canSeeDevotional, examAccess, getTrainingBooksFor } from '../lib/examWorld';

// ---------------------------------------------------------------------------
// /api/member — Exam World for members: the summary page (this month's
// devotional with its weekly exams, and leadership training books), asking
// to join leadership training, free-will offerings, and reading books
// inside the app.
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

  const [settings, enrollment, books, myOfferings] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 'singleton' }, select: { offeringInstructionsEn: true, offeringInstructionsFr: true } }),
    prisma.trainingEnrollment.findUnique({ where: { personId }, select: { status: true } }),
    getTrainingBooksFor(personId),
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
    training: {
      enrollment: enrollment?.status ?? 'NONE',
      books: books.map((b) => ({
        id: b.id,
        trainingOrder: b.trainingOrder,
        titleEn: b.titleEn,
        titleFr: b.titleFr,
        descriptionEn: b.descriptionEn,
        descriptionFr: b.descriptionFr,
        unlocked: b.unlocked,
        canRead: b.unlocked && b.hasFile,
        exam: b.exam && b.exam.published ? { id: b.exam.id, passMark: b.exam.passMark, bestPercentage: b.exam.bestPercentage, passed: b.exam.passed } : null,
      })),
    },
  });
}));

// POST /api/member/training/request — "I want to join leadership training".
router.post('/training/request', socialMutationLimiter, requireCsrf, requireMember, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  const existing = await prisma.trainingEnrollment.findUnique({ where: { personId } });
  if (existing && existing.status !== 'REVOKED') return res.json({ enrollment: existing.status });
  const e = await prisma.trainingEnrollment.upsert({
    where: { personId },
    create: { personId, status: 'REQUESTED', requestedAt: new Date() },
    update: { status: 'REQUESTED', requestedAt: new Date() },
  });
  await recordAudit({ action: 'TRAINING_REQUESTED', targetType: 'Person', targetId: personId });
  res.status(201).json({ enrollment: e.status });
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

// GET /api/member/library/books/:id — what the reader needs: title, and the
// reader's own name and phone for the watermark printed across every page.
router.get('/library/books/:id', requireMember, asyncHandler(async (req, res) => {
  const personId = req.member!.personId;
  if (!(await canReadBook(personId, req.params.id))) return res.status(404).json({ error: 'Book not found.' });
  const [book, person] = await Promise.all([
    prisma.libraryBook.findUnique({ where: { id: req.params.id }, select: { id: true, kind: true, titleEn: true, titleFr: true, trainingOrder: true, exam: { select: { id: true, status: true } } } }),
    prisma.person.findUnique({ where: { id: personId }, select: { name: true, whatsappNumber: true } }),
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
  });
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
