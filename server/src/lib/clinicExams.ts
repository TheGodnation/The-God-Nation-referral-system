import { prisma } from './prisma';
import { startAdaptiveLoop } from './activity';
import { canSeeDevotional, clinicExamOpensAt, clinicRhythm } from './examWorld';
import { notifyClinicExamOpen } from './notifications';
import { settleClinicTokens } from './tokens';

// ---------------------------------------------------------------------------
// Dominion Clinic exams: the rhythm (an exam every N days, N questions drawn
// from the month's book), telling members when one opens, and each member's
// results: every exam's score (the first try is the official one) and the total.
// ---------------------------------------------------------------------------

/** Tell members once that a monthly exam has opened. Returns how many exams were announced. */
export async function processClinicExamReminders(now = new Date()): Promise<number> {
  const rhythm = await clinicRhythm();
  const candidates = await prisma.assessment.findMany({
    where: { weekNumber: { not: null }, status: { not: 'DRAFT' }, openReminderSentAt: null, devotional: { is: { status: 'PUBLISHED', startDate: { lte: now }, endDate: { gte: now } } } },
    include: { devotional: true, _count: { select: { questions: { where: { setNumber: 1 } } } } },
  });
  let announced = 0;
  for (const a of candidates) {
    if ((await clinicExamOpensAt(a, rhythm.examEveryDays)).getTime() > now.getTime()) continue;
    // Claim it first, so a slow send is never repeated by the next tick.
    const claimed = await prisma.assessment.updateMany({ where: { id: a.id, openReminderSentAt: null }, data: { openReminderSentAt: now } });
    if (claimed.count === 0) continue;
    const members = await prisma.communityMembership.findMany({
      where: { status: 'ACTIVE', ...(a.devotional!.communityId ? { communityId: a.devotional!.communityId } : {}) },
      select: { personId: true },
    });
    const people = [...new Set(members.map((m) => m.personId))];
    await notifyClinicExamOpen(people, { assessmentId: a.id, number: a.weekNumber!, questions: Math.min(a._count.questions || rhythm.examQuestions, rhythm.examQuestions) }).catch(() => {});
    announced += 1;
  }
  return announced;
}

export function startClinicExamLoop(): void {
  startAdaptiveLoop(processClinicExamReminders, (err) => console.error('[clinic] exam reminder failed', { error: err instanceof Error ? err.message : String(err) }));
}

export interface ClinicExamResult {
  assessmentId: string;
  number: number;
  monthTitleEn: string;
  monthTitleFr: string | null;
  opensAt: string;
  open: boolean;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  passed: boolean | null;
  takenAt: string | null;
  /** King's Tokens this exam earned (null = none credited). */
  tokens: number | null;
}

/** Every monthly exam this member can see, newest month first, with the official (first) score. */
export async function clinicResultsFor(personId: string, now = new Date()) {
  const [rhythm, memberships] = await Promise.all([clinicRhythm(), prisma.communityMembership.findMany({ where: { personId, status: 'ACTIVE' }, select: { communityId: true } })]);
  const devotionals = await prisma.monthlyDevotional.findMany({
    where: { status: 'PUBLISHED', startDate: { lte: now }, OR: [{ communityId: null }, { communityId: { in: memberships.map((m) => m.communityId) } }] },
    orderBy: { startDate: 'desc' },
    take: 6,
    include: { assessments: { where: { weekNumber: { not: null }, status: { not: 'DRAFT' } }, orderBy: { weekNumber: 'asc' } } },
  });
  const visible = [];
  for (const d of devotionals) if (await canSeeDevotional(personId, d)) visible.push(d);
  const examIds = visible.flatMap((d) => d.assessments.map((a) => a.id));
  const attempts = examIds.length
    ? await prisma.attempt.findMany({ where: { personId, assessmentId: { in: examIds }, status: 'SUBMITTED' }, orderBy: { attemptNumber: 'asc' } })
    : [];
  await settleClinicTokens(personId);
  const rewards = examIds.length ? await prisma.tokenEntry.findMany({ where: { personId, reason: 'CLINIC_EXAM', assessmentId: { in: examIds } }, select: { assessmentId: true, amount: true } }) : [];
  const tokensOf = new Map(rewards.map((r) => [r.assessmentId, r.amount.toNumber()]));
  const exams: ClinicExamResult[] = [];
  for (const d of visible) {
    for (const a of d.assessments) {
      const first = attempts.find((t) => t.assessmentId === a.id) ?? null;
      const opensAt = await clinicExamOpensAt({ weekNumber: a.weekNumber, devotional: d }, rhythm.examEveryDays);
      exams.push({
        assessmentId: a.id,
        number: a.weekNumber!,
        monthTitleEn: d.titleEn,
        monthTitleFr: d.titleFr,
        opensAt: opensAt.toISOString(),
        open: opensAt <= now && d.endDate.getTime() + 24 * 3600 * 1000 >= now.getTime(),
        score: first?.score ?? null,
        maxScore: first?.maxScore ?? null,
        percentage: first?.percentage ?? null,
        passed: first?.passed ?? null,
        takenAt: first?.submittedAt?.toISOString() ?? null,
        tokens: tokensOf.get(a.id) ?? null,
      });
    }
  }
  const taken = exams.filter((e) => e.score !== null);
  const total = {
    exams: taken.length,
    score: taken.reduce((n, e) => n + (e.score ?? 0), 0),
    maxScore: taken.reduce((n, e) => n + (e.maxScore ?? 0), 0),
  };
  return { rhythm, exams, total };
}
