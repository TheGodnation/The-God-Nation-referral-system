import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Phase 3E — Training Progress Visibility. A read-only derived-data layer
// over the existing Phase 3B/3C tables (MonthlyDevotional, Assessment,
// Attempt) — no new model, column, or persisted "completion" value. Every
// value here is computed fresh from Attempt rows on each call.
// ---------------------------------------------------------------------------

export interface TrainingProgressItem {
  devotionalId: string;
  titleEn: string;
  titleFr: string | null;
  assessmentIds: string[];
  attempted: boolean;
  completed: boolean;
  bestPercentage: number | null;
  lastAttemptAt: Date | null;
}

export interface TrainingProgressSummary {
  totalEligible: number;
  completedCount: number;
  items: TrainingProgressItem[];
}

export interface DevotionalCompletionRow {
  personId: string;
  name: string;
  attempted: boolean;
  completed: boolean;
  bestPercentage: number | null;
  lastAttemptAt: Date | null;
}

/**
 * A devotional is eligible for a Person exactly when it is PUBLISHED, and
 * either global (communityId null) or the Person has an ACTIVE
 * CommunityMembership in that exact Community — identical to the rule
 * already used by GET /api/member/devotionals
 * (memberAssessments.ts:getEligibleAssessmentForMember). Reused here rather
 * than duplicated with different logic. Only devotionals carrying at least
 * one PUBLISHED or LOCKED assessment are returned — Phase 3E has no
 * completion signal for a devotional with no assessment at all, and a DRAFT
 * assessment is never member-visible so it is excluded the same way the
 * existing Member eligibility rule already excludes it.
 */
async function getEligibleDevotionalsForPerson(personId: string) {
  const activeMemberships = await prisma.communityMembership.findMany({
    where: { personId, status: 'ACTIVE' },
    select: { communityId: true },
  });
  const communityIds = activeMemberships.map((m) => m.communityId);

  return prisma.monthlyDevotional.findMany({
    where: {
      status: 'PUBLISHED',
      OR: [{ communityId: null }, { communityId: { in: communityIds } }],
      assessments: { some: { status: { in: ['PUBLISHED', 'LOCKED'] } } },
    },
    select: {
      id: true,
      titleEn: true,
      titleFr: true,
      assessments: { where: { status: { in: ['PUBLISHED', 'LOCKED'] } }, select: { id: true } },
    },
    orderBy: { startDate: 'desc' },
  });
}

/**
 * Reduces a set of Attempts (already filtered to the assessments of one
 * devotional, for one Person) into the four derived values.
 *
 * - completed: at least one SUBMITTED attempt with passed = true, on ANY of
 *   the devotional's assessments — a devotional is never required to have
 *   every one of its assessments passed.
 * - bestPercentage / lastAttemptAt: computed ONLY from SUBMITTED attempts.
 *   An IN_PROGRESS attempt is excluded entirely — never treated as a score
 *   of zero, and never used to derive a "last attempt" date, since it has
 *   no submittedAt yet.
 */
function summarizeAttempts(attempts: { status: string; passed: boolean | null; percentage: number | null; submittedAt: Date | null }[]) {
  const submitted = attempts.filter((a) => a.status === 'SUBMITTED');

  const attempted = attempts.length > 0;
  const completed = submitted.some((a) => a.passed === true);

  let bestPercentage: number | null = null;
  let lastAttemptAt: Date | null = null;
  for (const a of submitted) {
    if (a.percentage !== null && (bestPercentage === null || a.percentage > bestPercentage)) {
      bestPercentage = a.percentage;
    }
    if (a.submittedAt && (lastAttemptAt === null || a.submittedAt > lastAttemptAt)) {
      lastAttemptAt = a.submittedAt;
    }
  }

  return { attempted, completed, bestPercentage, lastAttemptAt };
}

/**
 * One Person's full training-progress summary across every devotional
 * currently eligible for them. Used by:
 *  - GET /api/member/me/training-progress (own progress only)
 *  - GET /api/admin/people/:id/training-progress (any Person)
 *  - GET /api/leader/community-progress (once per member of the exact
 *    Community, to build that endpoint's per-Person rows)
 */
export async function computeTrainingProgressForPerson(personId: string): Promise<TrainingProgressSummary> {
  const devotionals = await getEligibleDevotionalsForPerson(personId);
  if (devotionals.length === 0) {
    return { totalEligible: 0, completedCount: 0, items: [] };
  }

  const allAssessmentIds = devotionals.flatMap((d) => d.assessments.map((a) => a.id));
  const attempts = await prisma.attempt.findMany({
    where: { personId, assessmentId: { in: allAssessmentIds } },
    select: { assessmentId: true, status: true, passed: true, percentage: true, submittedAt: true },
  });

  const items: TrainingProgressItem[] = devotionals.map((d) => {
    const assessmentIds = d.assessments.map((a) => a.id);
    const relevant = attempts.filter((a) => assessmentIds.includes(a.assessmentId));
    const summary = summarizeAttempts(relevant);
    return {
      devotionalId: d.id,
      titleEn: d.titleEn,
      titleFr: d.titleFr,
      assessmentIds,
      ...summary,
    };
  });

  return {
    totalEligible: items.length,
    completedCount: items.filter((i) => i.completed).length,
    items,
  };
}

/**
 * Progress for one specific devotional, across a given set of Persons (the
 * "population" — its exact membership rule is decided by the caller; see
 * routes/adminAssessments-adjacent devotional completion-summary route).
 * Every Person in the given list gets a row, including one with zero
 * attempts (attempted: false), since the population represents everyone
 * eligible, not just those who acted. Returns null if the devotional does
 * not exist or has no assessment suitable for progress calculation.
 */
export async function computeDevotionalCompletionForPersons(
  devotionalId: string,
  personIds: string[],
): Promise<DevotionalCompletionRow[] | null> {
  const devotional = await prisma.monthlyDevotional.findUnique({
    where: { id: devotionalId },
    select: { assessments: { where: { status: { in: ['PUBLISHED', 'LOCKED'] } }, select: { id: true } } },
  });
  if (!devotional) return null;

  const assessmentIds = devotional.assessments.map((a) => a.id);
  if (personIds.length === 0) return [];

  const [persons, attempts] = await Promise.all([
    prisma.person.findMany({ where: { id: { in: personIds } }, select: { id: true, name: true } }),
    assessmentIds.length > 0
      ? prisma.attempt.findMany({
          where: { personId: { in: personIds }, assessmentId: { in: assessmentIds } },
          select: { personId: true, status: true, passed: true, percentage: true, submittedAt: true },
        })
      : Promise.resolve([]),
  ]);

  return persons.map((p) => {
    const relevant = attempts.filter((a) => a.personId === p.id);
    const summary = summarizeAttempts(relevant);
    return { personId: p.id, name: p.name, ...summary };
  });
}
