import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Leadership-training book exams: one try, then retakes only when the
// central admin grants them, each with a set of questions the person has
// never had.
//
//  - An exam holds several sets (Question.setNumber 1, 2, 3...). The first
//    try draws one set at random, so friends rarely get the same questions;
//    each retake draws from the sets this person hasn't had yet.
//  - Questions and their answer choices are shuffled per try.
//  - After a try, the member only sees the score and passed / not passed,
//    never the correct answers (see memberAssessments.ts).
//  - Passing (70%) is final: no more tries.
// Monthly devotional exams don't use any of this.
// ---------------------------------------------------------------------------

export type TrainingExamBlock =
  | 'PASSED' // already passed — nothing more to take
  | 'NO_QUESTIONS' // the exam has no questions yet
  | 'NEEDS_RETAKE' // failed: ask the admin for a retake
  | 'RETAKE_REQUESTED' // asked; waiting for the admin
  | 'RETAKE_DECLINED' // the admin said no to the last request (may ask again)
  | 'NO_NEW_QUESTIONS'; // retake granted, but every set has been used

export interface TrainingExamState {
  /** An unfinished try to continue, if any. */
  inProgressAttemptId: string | null;
  submittedTries: number;
  passed: boolean;
  lastPercentage: number | null;
  /** Retake granted and not yet used. */
  retakeGranted: boolean;
  unusedSets: number;
  canStart: boolean;
  block: TrainingExamBlock | null;
}

type Db = Prisma.TransactionClient | typeof prisma;

export async function examSetNumbers(assessmentId: string, db: Db = prisma): Promise<number[]> {
  const rows = await db.question.findMany({ where: { assessmentId }, select: { setNumber: true }, distinct: ['setNumber'] });
  return rows.map((r) => r.setNumber).sort((a, b) => a - b);
}

/** Sets this person has never had on this exam. */
async function unusedSetNumbers(personId: string, assessmentId: string, db: Db = prisma): Promise<number[]> {
  const [sets, used] = await Promise.all([
    examSetNumbers(assessmentId, db),
    db.attempt.findMany({ where: { personId, assessmentId, setNumber: { not: null } }, select: { setNumber: true } }),
  ]);
  const usedSet = new Set(used.map((u) => u.setNumber));
  return sets.filter((s) => !usedSet.has(s));
}

export async function trainingExamState(personId: string, assessmentId: string): Promise<TrainingExamState> {
  const [attempts, unused, sets] = await Promise.all([
    prisma.attempt.findMany({ where: { personId, assessmentId }, orderBy: { attemptNumber: 'asc' } }),
    unusedSetNumbers(personId, assessmentId),
    examSetNumbers(assessmentId),
  ]);
  const inProgress = attempts.find((a) => a.status === 'IN_PROGRESS') ?? null;
  const submitted = attempts.filter((a) => a.status === 'SUBMITTED');
  const passed = submitted.some((a) => a.passed === true);
  const last = submitted[submitted.length - 1] ?? null;
  const latestRequest = last
    ? await prisma.examRetakeRequest.findFirst({ where: { personId, assessmentId, afterAttemptId: last.id }, orderBy: { requestedAt: 'desc' } })
    : null;
  const retakeGranted = Boolean(latestRequest && latestRequest.status === 'GRANTED' && !latestRequest.usedByAttemptId);

  const base = {
    inProgressAttemptId: inProgress?.id ?? null,
    submittedTries: submitted.length,
    passed,
    lastPercentage: last?.percentage ?? null,
    retakeGranted,
    unusedSets: unused.length,
  };
  const blocked = (block: TrainingExamBlock): TrainingExamState => ({ ...base, canStart: false, block });

  if (inProgress) return { ...base, canStart: true, block: null };
  if (passed) return blocked('PASSED');
  if (sets.length === 0) return blocked('NO_QUESTIONS');
  if (submitted.length === 0) return { ...base, canStart: true, block: null };
  if (retakeGranted) return unused.length > 0 ? { ...base, canStart: true, block: null } : blocked('NO_NEW_QUESTIONS');
  if (latestRequest?.status === 'REQUESTED') return blocked('RETAKE_REQUESTED');
  if (latestRequest?.status === 'DECLINED') return blocked('RETAKE_DECLINED');
  return blocked('NEEDS_RETAKE');
}

export class TrainingExamError extends Error {
  constructor(
    public status: number,
    public code: TrainingExamBlock | 'RACE',
    message: string,
  ) {
    super(message);
  }
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Starts a try: picks the question set (random among the sets this person
 * hasn't had), shuffles its questions, and uses up a granted retake — all
 * in one transaction, so two taps at once can't start two tries or use one
 * retake twice.
 */
export async function startTrainingAttempt(personId: string, assessmentId: string) {
  const state = await trainingExamState(personId, assessmentId);
  if (state.inProgressAttemptId) {
    return { attempt: await prisma.attempt.findUniqueOrThrow({ where: { id: state.inProgressAttemptId } }), resumed: true };
  }
  if (!state.canStart) throw new TrainingExamError(409, state.block!, 'This exam cannot be started now.');

  const attempt = await prisma.$transaction(async (tx) => {
    const unused = await unusedSetNumbers(personId, assessmentId, tx);
    if (unused.length === 0) throw new TrainingExamError(409, 'NO_NEW_QUESTIONS', 'There is no new set of questions yet.');
    const setNumber = unused[crypto.randomInt(unused.length)];
    const questions = await tx.question.findMany({ where: { assessmentId, setNumber }, select: { id: true } });
    const count = await tx.attempt.count({ where: { personId, assessmentId } });

    const attempt = await tx.attempt.create({
      data: { personId, assessmentId, attemptNumber: count + 1, setNumber, questionOrder: shuffled(questions.map((q) => q.id)) },
    });

    if (state.submittedTries > 0) {
      const used = await tx.examRetakeRequest.updateMany({
        where: { personId, assessmentId, status: 'GRANTED', usedByAttemptId: null },
        data: { usedByAttemptId: attempt.id },
      });
      if (used.count !== 1) throw new TrainingExamError(409, 'RACE', 'This retake was already used.');
    }

    await tx.assessment.updateMany({ where: { id: assessmentId, status: 'PUBLISHED' }, data: { status: 'LOCKED' } });
    return attempt;
  });
  return { attempt, resumed: false };
}

/** The same shuffled answer order every time this try is opened. */
export function shuffleOptionsFor<T extends { id: string }>(attemptId: string, questionId: string, options: T[]): T[] {
  const key = (o: T) => crypto.createHash('sha256').update(`${attemptId}:${questionId}:${o.id}`).digest('hex');
  return [...options].sort((a, b) => (key(a) < key(b) ? -1 : 1));
}

/** Whether any real try has used this set — its questions can then no longer change. */
export async function isSetUsed(assessmentId: string, setNumber: number): Promise<boolean> {
  return Boolean(await prisma.attempt.findFirst({ where: { assessmentId, setNumber }, select: { id: true } }));
}
