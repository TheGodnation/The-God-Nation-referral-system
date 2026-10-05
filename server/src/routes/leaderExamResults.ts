import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, requireRole } from '../lib/auth';
import { requireLinkedPerson } from '../lib/leadership';
import { asyncHandler } from '../lib/asyncHandler';
import { getLeaderExactCommunityIds } from '../lib/privateMessaging';

// GET /api/leader/exam-results — how the members of the leader's groups are
// doing in Exam World: their first-try score on each weekly exam of the
// latest published devotional, and how many leadership-training books they
// have passed. Lets a leader see who is active and who needs support.
const router = Router();
router.use(requireAuth, requireRole('LEADER'), requireLinkedPerson);

router.get('/exam-results', asyncHandler(async (req, res) => {
  const communityIds = await getLeaderExactCommunityIds(req.leaderPersonId!);
  if (communityIds.length === 0) return res.json({ devotional: null, weeks: [], items: [] });

  const memberships = await prisma.communityMembership.findMany({
    where: { status: 'ACTIVE', communityId: { in: communityIds }, personId: { not: req.leaderPersonId! } },
    select: { person: { select: { id: true, name: true } } },
    distinct: ['personId'],
  });
  const people = memberships.map((m) => m.person);
  const personIds = people.map((p) => p.id);

  const devotional = await prisma.monthlyDevotional.findFirst({
    where: { status: 'PUBLISHED', OR: [{ communityId: null }, { communityId: { in: communityIds } }] },
    orderBy: { startDate: 'desc' },
    include: {
      assessments: { where: { weekNumber: { not: null }, status: { not: 'DRAFT' } }, orderBy: { weekNumber: 'asc' }, select: { id: true, weekNumber: true } },
    },
  });
  const weeklyIds = devotional?.assessments.map((a) => a.id) ?? [];

  const [weeklyAttempts, trainingPasses, enrollments] = await Promise.all([
    weeklyIds.length && personIds.length
      ? prisma.attempt.findMany({
          where: { personId: { in: personIds }, assessmentId: { in: weeklyIds }, status: 'SUBMITTED' },
          orderBy: { attemptNumber: 'asc' },
          select: { personId: true, assessmentId: true, percentage: true },
        })
      : Promise.resolve([] as { personId: string; assessmentId: string; percentage: number | null }[]),
    personIds.length
      ? prisma.attempt.findMany({
          where: { personId: { in: personIds }, status: 'SUBMITTED', passed: true, assessment: { trainingBookId: { not: null } } },
          select: { personId: true, assessmentId: true },
          distinct: ['personId', 'assessmentId'],
        })
      : Promise.resolve([] as { personId: string; assessmentId: string }[]),
    prisma.trainingEnrollment.findMany({ where: { personId: { in: personIds } }, select: { personId: true, status: true } }),
  ]);

  const enrollmentBy = new Map(enrollments.map((e) => [e.personId, e.status]));
  res.json({
    devotional: devotional ? { id: devotional.id, titleEn: devotional.titleEn, titleFr: devotional.titleFr } : null,
    weeks: devotional?.assessments.map((a) => a.weekNumber) ?? [],
    items: people
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((p) => ({
        personId: p.id,
        name: p.name,
        // First try only, per week (null = not taken yet).
        weekly: (devotional?.assessments ?? []).map((a) => weeklyAttempts.find((t) => t.personId === p.id && t.assessmentId === a.id)?.percentage ?? null),
        training: enrollmentBy.get(p.id) ?? 'NONE',
        booksPassed: trainingPasses.filter((t) => t.personId === p.id).length,
      })),
  });
}));

export default router;
