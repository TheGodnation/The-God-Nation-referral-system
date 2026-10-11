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
import { TRAINING_PASS_MARK } from '../lib/examWorld';

// ---------------------------------------------------------------------------
// /api/admin/library — central admin side of Exam World:
//  - books: leadership-training eBooks (1, 2, 3...) and the monthly
//    devotional's book; upload each PDF (read in the app only)
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
    },
  });
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
      exam: b.exam ? { id: b.exam.id, titleEn: b.exam.titleEn, status: b.exam.status, passMark: b.exam.passMark, questionCount: b.exam._count.questions } : null,
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

const fileFinalizeSchema = z.object({ storageKey: z.string().min(1), byteSize: z.number().int().positive() });

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
    data: { storageKey: parsed.data.storageKey, byteSize: parsed.data.byteSize },
  });
  await audit(req, 'LIBRARY_BOOK_FILE_UPLOADED', 'LibraryBook', req.params.id, { byteSize: parsed.data.byteSize });
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

router.get('/trainees', asyncHandler(async (req, res) => {
  const status = z.enum(['REQUESTED', 'ACTIVE', 'REVOKED']).safeParse(req.query.status);
  const rows = await prisma.trainingEnrollment.findMany({
    where: status.success ? { status: status.data } : {},
    orderBy: { updatedAt: 'desc' },
    take: 500,
    include: { person: { select: { id: true, name: true, whatsappNumber: true } } },
  });
  res.json({
    items: rows.map((r) => ({
      personId: r.person.id,
      name: r.person.name,
      whatsappNumber: r.person.whatsappNumber,
      status: r.status,
      requestedAt: r.requestedAt,
      activatedAt: r.activatedAt,
      note: r.note,
    })),
  });
}));

const activateSchema = z.object({ personId: z.string().min(1), note: z.string().trim().max(300).optional() });

// POST /api/admin/library/trainees — mark someone as paid: opens Book 1.
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
    items: rows.map((r) => ({ id: r.id, name: r.person.name, amount: r.amount, currency: r.currency, note: r.note, createdAt: r.createdAt })),
  });
}));

export default router;
