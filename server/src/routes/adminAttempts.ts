import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireCsrf } from '../lib/csrf';
import { adminSensitiveLimiter } from '../lib/rateLimit';
import { recordAudit } from '../lib/audit';
import { createAttempt, submitAttempt, AssessmentSubmissionError } from '../lib/assessmentScoring';
import { asyncHandler } from '../lib/asyncHandler';

const router = Router();

router.use(requireAuth, requireRole('ADMIN'));

// POST /api/admin/people/:personId/attempts — Admin selects a Person and an
// Assessment and starts an attempt on the person's behalf (Phase 3B has no
// member-facing authentication; every attempt is Admin-controlled).
const startAttemptSchema = z.object({ assessmentId: z.string().min(1) });

router.post(
  '/people/:personId/attempts',
  adminSensitiveLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const parsed = startAttemptSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'assessmentId is required.' });
    }

    try {
      const attempt = await createAttempt(req.params.personId, parsed.data.assessmentId);

      await recordAudit({
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'ATTEMPT_STARTED',
        targetType: 'Attempt',
        targetId: attempt.id,
        metadata: { personId: req.params.personId, assessmentId: parsed.data.assessmentId, attemptNumber: attempt.attemptNumber },
      });

      res.status(201).json(attempt);
    } catch (err) {
      if (err instanceof AssessmentSubmissionError) {
        return res.status(err.status).json({ error: err.message });
      }
      throw err;
    }
  }),
);

// GET /api/admin/attempts/:id — attempt summary (person, assessment,
// status, and — once submitted — the server-calculated result).
router.get('/attempts/:id', asyncHandler(async (req, res) => {
  const attempt = await prisma.attempt.findUnique({
    where: { id: req.params.id },
    include: {
      person: { select: { id: true, name: true, whatsappNumber: true } },
      assessment: { select: { id: true, titleEn: true, titleFr: true, passMark: true, status: true } },
    },
  });
  if (!attempt) return res.status(404).json({ error: 'Attempt not found.' });
  res.json(attempt);
}));

// GET /api/admin/attempts/:id/questions — the attempt-taking view. While
// IN_PROGRESS, this NEVER includes isCorrect (Section 12/26) — only
// question text, option text, and ordering, exactly as a future
// member-facing client would receive it. Once SUBMITTED, it additionally
// includes isCorrect and the recorded answer per question, since a review
// of a completed attempt is expected to show what was right/wrong.
router.get('/attempts/:id/questions', asyncHandler(async (req, res) => {
  const attempt = await prisma.attempt.findUnique({ where: { id: req.params.id } });
  if (!attempt) return res.status(404).json({ error: 'Attempt not found.' });

  const questions = await prisma.question.findMany({
    where: { assessmentId: attempt.assessmentId },
    orderBy: { order: 'asc' },
    include: { options: { orderBy: { order: 'asc' } } },
  });

  if (attempt.status === 'IN_PROGRESS') {
    return res.json({
      status: attempt.status,
      questions: questions.map((q) => ({
        id: q.id,
        textEn: q.textEn,
        textFr: q.textFr,
        order: q.order,
        points: q.points,
        options: q.options.map((o) => ({ id: o.id, textEn: o.textEn, textFr: o.textFr, order: o.order })),
      })),
    });
  }

  const answers = await prisma.answer.findMany({ where: { attemptId: attempt.id } });
  const answerByQuestion = new Map(answers.map((a) => [a.questionId, a]));

  res.json({
    status: attempt.status,
    questions: questions.map((q) => ({
      id: q.id,
      textEn: q.textEn,
      textFr: q.textFr,
      order: q.order,
      points: q.points,
      options: q.options.map((o) => ({ id: o.id, textEn: o.textEn, textFr: o.textFr, order: o.order, isCorrect: o.isCorrect })),
      selectedOptionId: answerByQuestion.get(q.id)?.selectedOptionId ?? null,
      wasCorrect: answerByQuestion.get(q.id)?.wasCorrect ?? null,
    })),
  });
}));

// POST /api/admin/attempts/:id/submit — the client sends ONLY selected
// option IDs per question; the server computes wasCorrect/score/maxScore/
// percentage/passed and never trusts any client-supplied result value.
const submitSchema = z.object({
  answers: z
    .array(z.object({ questionId: z.string().min(1), selectedOptionId: z.string().min(1) }))
    .max(500),
});

router.post(
  '/attempts/:id/submit',
  adminSensitiveLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'answers must be an array of { questionId, selectedOptionId }.' });
    }

    try {
      const attempt = await submitAttempt(req.params.id, parsed.data.answers);

      await recordAudit({
        actorId: req.user!.id,
        actorEmail: req.user!.email,
        action: 'ATTEMPT_SUBMITTED',
        targetType: 'Attempt',
        targetId: attempt.id,
        metadata: { score: attempt.score, maxScore: attempt.maxScore, passed: attempt.passed },
      });

      res.json(attempt);
    } catch (err) {
      if (err instanceof AssessmentSubmissionError) {
        return res.status(err.status).json({ error: err.message });
      }
      throw err;
    }
  }),
);

export default router;
