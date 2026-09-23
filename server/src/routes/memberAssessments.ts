import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireMember } from '../lib/memberAuth';
import { requireCsrf } from '../lib/csrf';
import { memberAssessmentLimiter, memberProfileUpdateLimiter } from '../lib/rateLimit';
import { createAttempt, submitAttempt, AssessmentSubmissionError } from '../lib/assessmentScoring';
import { computeTrainingProgressForPerson } from '../lib/trainingProgress';
import { recordAudit } from '../lib/audit';
import { asyncHandler } from '../lib/asyncHandler';

const router = Router();

router.use(requireMember);

// Section 14: deliberately simple eligibility — global (no community) or a
// Community the Person has an ACTIVE membership in. No geography, no
// multi-community assignment, no new eligibility engine. An assessment with
// no devotional link has no defined member-eligibility path in Phase 3C —
// it remains Admin-only (e.g. a future training exam), never member-visible.
async function getEligibleAssessmentForMember(personId: string, assessmentId: string) {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    include: { devotional: true },
  });
  if (!assessment || assessment.status === 'DRAFT') return null;
  if (!assessment.devotional || assessment.devotional.status !== 'PUBLISHED') return null;

  if (assessment.devotional.communityId) {
    const membership = await prisma.communityMembership.findUnique({
      where: { personId_communityId: { personId, communityId: assessment.devotional.communityId } },
    });
    if (membership?.status !== 'ACTIVE') return null;
  }

  return assessment;
}

// GET /api/member/devotionals — eligible, published devotionals with their
// eligible (published/locked, never draft) assessments.
router.get('/devotionals', asyncHandler(async (req, res) => {
  const personId = req.member!.personId;

  const activeMemberships = await prisma.communityMembership.findMany({
    where: { personId, status: 'ACTIVE' },
    select: { communityId: true },
  });
  const communityIds = activeMemberships.map((m) => m.communityId);

  const devotionals = await prisma.monthlyDevotional.findMany({
    where: {
      status: 'PUBLISHED',
      OR: [{ communityId: null }, { communityId: { in: communityIds } }],
    },
    include: {
      community: { select: { id: true, name: true } },
      assessments: {
        where: { status: { in: ['PUBLISHED', 'LOCKED'] } },
        select: { id: true, titleEn: true, titleFr: true, passMark: true, maxAttempts: true, status: true },
      },
    },
    orderBy: { startDate: 'desc' },
  });

  res.json({ items: devotionals });
}));

// GET /api/member/assessments/:id — detail, only if eligible.
router.get('/assessments/:id', asyncHandler(async (req, res) => {
  const assessment = await getEligibleAssessmentForMember(req.member!.personId, req.params.id);
  if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });

  res.json({
    id: assessment.id,
    titleEn: assessment.titleEn,
    titleFr: assessment.titleFr,
    passMark: assessment.passMark,
    maxAttempts: assessment.maxAttempts,
    status: assessment.status,
    devotional: { id: assessment.devotional!.id, titleEn: assessment.devotional!.titleEn, titleFr: assessment.devotional!.titleFr },
  });
}));

// GET /api/member/assessments/:id/my-attempts — the member's OWN attempt
// history for this assessment only.
router.get('/assessments/:id/my-attempts', asyncHandler(async (req, res) => {
  const assessment = await getEligibleAssessmentForMember(req.member!.personId, req.params.id);
  if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });

  const attempts = await prisma.attempt.findMany({
    where: { personId: req.member!.personId, assessmentId: assessment.id },
    orderBy: { attemptNumber: 'asc' },
  });

  res.json({ items: attempts });
}));

// POST /api/member/assessments/:id/attempts — start (or resume) the
// member's OWN attempt. The authenticated Person is the only identity ever
// used here; nothing from the request body can override it.
router.post(
  '/assessments/:id/attempts',
  memberAssessmentLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const personId = req.member!.personId;
    const assessment = await getEligibleAssessmentForMember(personId, req.params.id);
    if (!assessment) return res.status(404).json({ error: 'Assessment not found.' });

    // Section 17: resume an existing in-progress attempt instead of
    // creating a new one (which would otherwise consume another slot of a
    // limited maxAttempts, or race with the assessment's own attemptNumber
    // uniqueness for no reason).
    const inProgress = await prisma.attempt.findFirst({
      where: { personId, assessmentId: assessment.id, status: 'IN_PROGRESS' },
    });
    if (inProgress) return res.json(inProgress);

    try {
      const attempt = await createAttempt(personId, assessment.id);
      res.status(201).json(attempt);
    } catch (err) {
      if (err instanceof AssessmentSubmissionError) {
        return res.status(err.status).json({ error: err.message });
      }
      throw err;
    }
  }),
);

// GET /api/member/attempts/:id — own attempt only.
router.get('/attempts/:id', asyncHandler(async (req, res) => {
  const attempt = await prisma.attempt.findUnique({ where: { id: req.params.id } });
  // A foreign attempt is reported identically to a missing one — never
  // confirm that another member's attempt exists.
  if (!attempt || attempt.personId !== req.member!.personId) {
    return res.status(404).json({ error: 'Attempt not found.' });
  }
  res.json(attempt);
}));

// GET /api/member/attempts/:id/questions — the attempt-taking view. Same
// isCorrect-hiding rule as the Admin path (Phase 3B): never exposed while
// IN_PROGRESS, only visible on the member's own SUBMITTED attempt for review.
router.get('/attempts/:id/questions', asyncHandler(async (req, res) => {
  const attempt = await prisma.attempt.findUnique({ where: { id: req.params.id } });
  if (!attempt || attempt.personId !== req.member!.personId) {
    return res.status(404).json({ error: 'Attempt not found.' });
  }

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

const submitSchema = z.object({
  answers: z
    .array(z.object({ questionId: z.string().min(1), selectedOptionId: z.string().min(1) }))
    .max(500),
});

// POST /api/member/attempts/:id/submit — own attempt only. The same
// server-authoritative scoring library used by the Admin path (Phase 3B)
// computes everything; client-supplied score/percentage/passed/wasCorrect
// values do not exist in this request shape at all.
router.post(
  '/attempts/:id/submit',
  memberAssessmentLimiter,
  requireCsrf,
  asyncHandler(async (req, res) => {
    const attempt = await prisma.attempt.findUnique({ where: { id: req.params.id } });
    if (!attempt || attempt.personId !== req.member!.personId) {
      return res.status(404).json({ error: 'Attempt not found.' });
    }

    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'answers must be an array of { questionId, selectedOptionId }.' });
    }

    try {
      const result = await submitAttempt(attempt.id, parsed.data.answers);
      res.json(result);
    } catch (err) {
      if (err instanceof AssessmentSubmissionError) {
        return res.status(err.status).json({ error: err.message });
      }
      throw err;
    }
  }),
);

// GET /api/member/me/training-progress — Phase 3E. Read-only, derived
// entirely from existing Attempt data (see lib/trainingProgress.ts); the
// Person is always the authenticated member's own — never accepted from a
// query/body param, exactly like every other route in this file.
router.get('/me/training-progress', asyncHandler(async (req, res) => {
  const progress = await computeTrainingProgressForPerson(req.member!.personId);
  res.json(progress);
}));

// ---------------------------------------------------------------------------
// Read-only own Community/Geography (Section 20) — no editing, minimal
// fields, own data only.
// ---------------------------------------------------------------------------

router.get('/me/community-memberships', asyncHandler(async (req, res) => {
  const memberships = await prisma.communityMembership.findMany({
    where: { personId: req.member!.personId },
    include: { community: { select: { id: true, name: true } } },
    orderBy: { joinedAt: 'desc' },
  });
  res.json({
    items: memberships.map((m) => ({
      // Phase 3M.1: communityId is additive — needed so the client can
      // address this Community's conversation. Every existing field is
      // unchanged.
      communityId: m.community.id,
      communityName: m.community.name,
      status: m.status,
      joinedAt: m.joinedAt,
    })),
  });
}));

router.get('/me/geographic-assignment', asyncHandler(async (req, res) => {
  const assignment = await prisma.geographicAssignment.findUnique({
    where: { personId: req.member!.personId },
    include: { geography: { select: { name: true, type: true } } },
  });
  if (!assignment) return res.json({ assignment: null });
  res.json({
    assignment: {
      geographyName: assignment.geography.name,
      geographyType: assignment.geography.type,
      assignedAt: assignment.assignedAt,
    },
  });
}));

// ---------------------------------------------------------------------------
// Profile self-service (Phase 3F) — a Member may edit only their own
// Person.name and Person.preferredLanguage. Everything else (WhatsApp
// number, Person.email, MemberAccount.email, membership/geography/role/
// follow-up data) is explicitly out of scope and never touched here: the
// schema below is a closed allowlist, not a partial/loose object, so a
// client sending extra fields (whatsappNumber, email, personId, etc.) has
// them silently dropped by Zod before this handler ever sees them, and the
// Prisma `data` object below only ever assembles from these two named
// fields — never a spread of the request body.
// ---------------------------------------------------------------------------

const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  preferredLanguage: z.enum(['en', 'fr']).optional(),
});

router.patch('/me/profile', memberProfileUpdateLimiter, requireCsrf, asyncHandler(async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid profile update.' });
  }
  const { name, preferredLanguage } = parsed.data;

  // Identity is always the authenticated member's own Person — never
  // accepted from the request body, so a client-supplied personId (or any
  // other id-shaped field) can never redirect this update to someone else.
  const updated = await prisma.person.update({
    where: { id: req.member!.personId },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(preferredLanguage !== undefined ? { preferredLanguage } : {}),
    },
    select: { name: true, preferredLanguage: true },
  });

  await recordAudit({
    action: 'MEMBER_PROFILE_UPDATED',
    targetType: 'Person',
    targetId: req.member!.personId,
    metadata: { changedKeys: Object.keys(parsed.data) },
  });

  res.json({ name: updated.name, preferredLanguage: updated.preferredLanguage });
}));

export default router;
