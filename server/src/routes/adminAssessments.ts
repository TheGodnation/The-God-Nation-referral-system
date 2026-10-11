import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { parsePagination, paginatedResult } from '../lib/pagination';
import { recordAudit } from '../lib/audit';
import { asyncHandler } from '../lib/asyncHandler';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

// Locking is a hard, server-enforced rule: once an Assessment has ever had
// an Attempt created against it (status LOCKED), nothing about its
// questions/options may change — text, order, points, or correct answers.
// This helper is the single place that enforces it for every mutation
// below, so a new edit endpoint can never accidentally bypass it.
async function requireUnlockedAssessment(assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId } });
  if (!assessment) return { assessment: null, error: 'Assessment not found.' as const, status: 404 };
  if (assessment.status === 'LOCKED') {
    return {
      assessment,
      error: 'This assessment is locked because at least one attempt has been made against it, and can no longer be edited. Create a new assessment instead.' as const,
      status: 409,
    };
  }
  return { assessment, error: null, status: 200 };
}

// ---------------------------------------------------------------------------
// Assessments
// ---------------------------------------------------------------------------

const listQuerySchema = z.object({ devotionalId: z.string().optional() });

router.get('/', asyncHandler(async (req, res) => {
  const { page, pageSize, skip, take } = parsePagination(req);
  const q = listQuerySchema.parse(req.query);
  const where = q.devotionalId ? { devotionalId: q.devotionalId } : {};

  const [total, items] = await Promise.all([
    prisma.assessment.count({ where }),
    prisma.assessment.findMany({
      where,
      include: {
        devotional: { select: { id: true, titleEn: true } },
        _count: { select: { questions: true, attempts: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(items, total, page, pageSize));
}));

// GET /:id — the content-management view. Unlike the attempt-taking view
// (adminAttempts.ts), this is only ever shown to an authenticated Admin
// authoring/reviewing the assessment, so it includes isCorrect.
router.get('/:id', asyncHandler(async (req, res) => {
  const assessment = await prisma.assessment.findUnique({
    where: { id: req.params.id },
    include: {
      devotional: { select: { id: true, titleEn: true } },
      questions: {
        orderBy: { order: 'asc' },
        include: { options: { orderBy: { order: 'asc' } } },
      },
      _count: { select: { attempts: true } },
    },
  });
  if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });
  res.json(assessment);
}));

const createSchema = z.object({
  devotionalId: z.string().optional().nullable(),
  titleEn: z.string().trim().min(1).max(300),
  titleFr: z.string().trim().max(300).optional().nullable(),
  passMark: z.number().int().min(0).max(100),
  maxAttempts: z.number().int().min(1).optional().nullable(),
});

router.post('/', requireCsrf, asyncHandler(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid assessment.' });
  }
  const d = parsed.data;

  if (d.devotionalId) {
    const devotional = await prisma.monthlyDevotional.findUnique({ where: { id: d.devotionalId } });
    if (!devotional) return res.status(400).json({ error: 'Devotional not found.' });
  }

  const created = await prisma.assessment.create({
    data: {
      devotionalId: d.devotionalId ?? null,
      titleEn: d.titleEn,
      titleFr: d.titleFr ?? null,
      passMark: d.passMark,
      maxAttempts: d.maxAttempts ?? null,
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'ASSESSMENT_CREATED',
    targetType: 'Assessment',
    targetId: created.id,
    metadata: { devotionalId: created.devotionalId, passMark: created.passMark },
  });

  res.status(201).json(created);
}));

const patchSchema = z.object({
  titleEn: z.string().trim().min(1).max(300).optional(),
  titleFr: z.string().trim().max(300).optional().nullable(),
  passMark: z.number().int().min(0).max(100).optional(),
  maxAttempts: z.number().int().min(1).optional().nullable(),
  status: z.enum(['DRAFT', 'PUBLISHED']).optional(),
});

router.patch('/:id', requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }
  const d = parsed.data;

  const { assessment, error, status } = await requireUnlockedAssessment(id);
  if (error) return res.status(status).json({ error });

  const updated = await prisma.assessment.update({
    where: { id },
    data: {
      ...(d.titleEn !== undefined ? { titleEn: d.titleEn } : {}),
      ...(d.titleFr !== undefined ? { titleFr: d.titleFr } : {}),
      ...(d.passMark !== undefined ? { passMark: d.passMark } : {}),
      ...(d.maxAttempts !== undefined ? { maxAttempts: d.maxAttempts } : {}),
      ...(d.status !== undefined ? { status: d.status } : {}),
    },
  });

  let action = 'ASSESSMENT_UPDATED';
  if (d.status === 'PUBLISHED' && assessment!.status !== 'PUBLISHED') action = 'ASSESSMENT_PUBLISHED';
  if (d.passMark !== undefined && d.passMark !== assessment!.passMark) action = 'ASSESSMENT_PASSMARK_CHANGED';

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action,
    targetType: 'Assessment',
    targetId: id,
    metadata: { changedKeys: Object.keys(req.body ?? {}) },
  });

  res.json(updated);
}));

// GET /:id/results — paginated Attempts against this assessment, with a
// light Person summary per row. Never exposes other Persons' data beyond
// what the results table needs.
router.get('/:id/results', asyncHandler(async (req, res) => {
  const assessment = await prisma.assessment.findUnique({ where: { id: req.params.id } });
  if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });

  const { page, pageSize, skip, take } = parsePagination(req);
  const [total, attempts] = await Promise.all([
    prisma.attempt.count({ where: { assessmentId: req.params.id } }),
    prisma.attempt.findMany({
      where: { assessmentId: req.params.id },
      include: { person: { select: { id: true, name: true, whatsappNumber: true } } },
      orderBy: { startedAt: 'desc' },
      skip,
      take,
    }),
  ]);

  res.json(paginatedResult(attempts, total, page, pageSize));
}));

// ---------------------------------------------------------------------------
// Questions (belong directly to one Assessment — no reusable question bank)
// ---------------------------------------------------------------------------

const questionSchema = z.object({
  textEn: z.string().trim().min(1).max(2000),
  textFr: z.string().trim().max(2000).optional().nullable(),
  order: z.number().int().min(0).optional(),
  points: z.number().int().min(1).optional(),
});

router.post('/:assessmentId/questions', requireCsrf, asyncHandler(async (req, res) => {
  const { assessmentId } = req.params;
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid question.' });
  }

  const { error, status } = await requireUnlockedAssessment(assessmentId);
  if (error) return res.status(status).json({ error });

  const d = parsed.data;
  const created = await prisma.question.create({
    data: {
      assessmentId,
      textEn: d.textEn,
      textFr: d.textFr ?? null,
      order: d.order ?? 0,
      points: d.points ?? 1,
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'QUESTION_CREATED',
    targetType: 'Question',
    targetId: created.id,
    metadata: { assessmentId },
  });

  res.status(201).json(created);
}));

const questionPatchSchema = questionSchema.partial();

router.patch('/questions/:id', requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = questionPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }

  const question = await prisma.question.findUnique({ where: { id } });
  if (!question) return res.status(404).json({ error: 'Question not found.' });

  const { error, status } = await requireUnlockedAssessment(question.assessmentId);
  if (error) return res.status(status).json({ error });

  const d = parsed.data;
  const updated = await prisma.question.update({
    where: { id },
    data: {
      ...(d.textEn !== undefined ? { textEn: d.textEn } : {}),
      ...(d.textFr !== undefined ? { textFr: d.textFr } : {}),
      ...(d.order !== undefined ? { order: d.order } : {}),
      ...(d.points !== undefined ? { points: d.points } : {}),
    },
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'QUESTION_UPDATED',
    targetType: 'Question',
    targetId: id,
    metadata: { changedKeys: Object.keys(req.body ?? {}) },
  });

  res.json(updated);
}));

router.delete('/questions/:id', requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const question = await prisma.question.findUnique({ where: { id } });
  if (!question) return res.status(404).json({ error: 'Question not found.' });

  const { error, status } = await requireUnlockedAssessment(question.assessmentId);
  if (error) return res.status(status).json({ error });

  await prisma.question.delete({ where: { id } });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'QUESTION_DELETED',
    targetType: 'Question',
    targetId: id,
    metadata: { assessmentId: question.assessmentId },
  });

  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Options — isCorrect is server-truth. Exactly one correct option per
// question is enforced here (Phase 3B does not support multiple-correct
// scoring): setting isCorrect=true on one option clears it on its siblings
// in the same transaction, so ambiguous scoring can never be configured.
// ---------------------------------------------------------------------------

const optionSchema = z.object({
  textEn: z.string().trim().min(1).max(1000),
  textFr: z.string().trim().max(1000).optional().nullable(),
  isCorrect: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
});

router.post('/questions/:questionId/options', requireCsrf, asyncHandler(async (req, res) => {
  const { questionId } = req.params;
  const parsed = optionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid option.' });
  }

  const question = await prisma.question.findUnique({ where: { id: questionId } });
  if (!question) return res.status(404).json({ error: 'Question not found.' });

  const { error, status } = await requireUnlockedAssessment(question.assessmentId);
  if (error) return res.status(status).json({ error });

  const d = parsed.data;
  const created = await prisma.$transaction(async (tx) => {
    if (d.isCorrect) {
      await tx.option.updateMany({ where: { questionId }, data: { isCorrect: false } });
    }
    return tx.option.create({
      data: {
        questionId,
        textEn: d.textEn,
        textFr: d.textFr ?? null,
        isCorrect: d.isCorrect ?? false,
        order: d.order ?? 0,
      },
    });
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'OPTION_CREATED',
    targetType: 'Option',
    targetId: created.id,
    metadata: { questionId },
  });

  res.status(201).json(created);
}));

const optionPatchSchema = optionSchema.partial();

router.patch('/options/:id', requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const parsed = optionPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid request.' });
  }

  const option = await prisma.option.findUnique({ where: { id }, include: { question: true } });
  if (!option) return res.status(404).json({ error: 'Option not found.' });

  const { error, status } = await requireUnlockedAssessment(option.question.assessmentId);
  if (error) return res.status(status).json({ error });

  const d = parsed.data;
  const updated = await prisma.$transaction(async (tx) => {
    if (d.isCorrect) {
      await tx.option.updateMany({
        where: { questionId: option.questionId, NOT: { id } },
        data: { isCorrect: false },
      });
    }
    return tx.option.update({
      where: { id },
      data: {
        ...(d.textEn !== undefined ? { textEn: d.textEn } : {}),
        ...(d.textFr !== undefined ? { textFr: d.textFr } : {}),
        ...(d.isCorrect !== undefined ? { isCorrect: d.isCorrect } : {}),
        ...(d.order !== undefined ? { order: d.order } : {}),
      },
    });
  });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'OPTION_UPDATED',
    targetType: 'Option',
    targetId: id,
    metadata: { changedKeys: Object.keys(req.body ?? {}) },
  });

  res.json(updated);
}));

router.delete('/options/:id', requireCsrf, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const option = await prisma.option.findUnique({ where: { id }, include: { question: true } });
  if (!option) return res.status(404).json({ error: 'Option not found.' });

  const { error, status } = await requireUnlockedAssessment(option.question.assessmentId);
  if (error) return res.status(status).json({ error });

  await prisma.option.delete({ where: { id } });

  await recordAudit({
    actorId: req.user!.id,
    actorEmail: req.user!.email,
    action: 'OPTION_DELETED',
    targetType: 'Option',
    targetId: id,
    metadata: { questionId: option.questionId },
  });

  res.status(204).end();
}));

export default router;
