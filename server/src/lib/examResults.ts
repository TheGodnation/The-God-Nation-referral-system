import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// One row per submitted quiz / exam try, whatever it was (a teaching's quiz,
// a leadership book's exam, a devotional's weekly exam) — for the admin
// Results page, its spreadsheet download, and a member's own list.

export type ResultKind = 'TEACHING' | 'BOOK' | 'DEVOTIONAL' | 'OTHER';
export const RESULT_KINDS: ResultKind[] = ['TEACHING', 'BOOK', 'DEVOTIONAL', 'OTHER'];

export interface ResultFilter {
  personId?: string;
  /** Only these people (a leader's own members). */
  personIds?: string[];
  search?: string;
  kind?: ResultKind;
  communityId?: string;
  from?: Date;
  /** Inclusive: the whole of this day. */
  to?: Date;
  includeTestData?: boolean;
}

const attemptInclude = {
  person: { select: { id: true, name: true, whatsappNumber: true } },
  assessment: {
    select: {
      titleEn: true,
      weekNumber: true,
      teaching: { select: { title: true, community: { select: { name: true } } } },
      trainingBook: { select: { titleEn: true } },
      devotional: { select: { titleEn: true } },
    },
  },
} satisfies Prisma.AttemptInclude;

type AttemptRow = Prisma.AttemptGetPayload<{ include: typeof attemptInclude }>;

export interface ResultRow {
  attemptId: string;
  assessmentId: string;
  personId: string;
  personName: string;
  whatsappNumber: string;
  kind: ResultKind;
  title: string;
  /** Teachings only: the assembly it was posted in. */
  assemblyName: string | null;
  tryNumber: number;
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  passMark: number | null;
  passed: boolean | null;
  submittedAt: string | null;
}

interface Labelled {
  titleEn: string;
  weekNumber: number | null;
  teaching: { title: string } | null;
  trainingBook: { titleEn: string } | null;
  devotional: { titleEn: string } | null;
}

/** What kind of quiz / exam this is and what to call it. */
export function examLabel(s: Labelled): { kind: ResultKind; title: string } {
  const kind: ResultKind = s.teaching ? 'TEACHING' : s.trainingBook ? 'BOOK' : s.devotional ? 'DEVOTIONAL' : 'OTHER';
  const title =
    kind === 'TEACHING'
      ? s.teaching!.title
      : kind === 'BOOK'
        ? s.trainingBook!.titleEn
        : kind === 'DEVOTIONAL'
          ? `${s.devotional!.titleEn}${s.weekNumber ? ` — week ${s.weekNumber}` : ''}`
          : s.titleEn;
  return { kind, title };
}

export function toResultRow(a: AttemptRow): ResultRow {
  const s = a.assessment;
  const { kind, title } = examLabel(s);
  return {
    attemptId: a.id,
    assessmentId: a.assessmentId,
    personId: a.personId,
    personName: a.person.name,
    whatsappNumber: a.person.whatsappNumber,
    kind,
    title,
    assemblyName: s.teaching?.community.name ?? null,
    tryNumber: a.attemptNumber,
    score: a.score,
    maxScore: a.maxScore,
    percentage: a.percentage,
    passMark: a.passMarkAtAttempt,
    passed: a.passed,
    submittedAt: a.submittedAt?.toISOString() ?? null,
  };
}

export function resultWhere(f: ResultFilter): Prisma.AttemptWhereInput {
  const and: Prisma.AttemptWhereInput[] = [];
  if (f.personId) and.push({ personId: f.personId });
  if (f.personIds) and.push({ personId: { in: f.personIds } });
  if (f.search) {
    and.push({
      person: {
        OR: [
          { name: { contains: f.search, mode: 'insensitive' } },
          { whatsappNumber: { contains: f.search } },
          { email: { contains: f.search, mode: 'insensitive' } },
        ],
      },
    });
  }
  if (f.kind === 'TEACHING') and.push({ assessment: { teaching: { isNot: null } } });
  else if (f.kind === 'BOOK') and.push({ assessment: { trainingBookId: { not: null } } });
  else if (f.kind === 'DEVOTIONAL') and.push({ assessment: { devotionalId: { not: null }, trainingBookId: null, teaching: { is: null } } });
  else if (f.kind === 'OTHER') and.push({ assessment: { devotionalId: null, trainingBookId: null, teaching: { is: null } } });
  if (f.communityId) and.push({ person: { communityMemberships: { some: { communityId: f.communityId, status: 'ACTIVE' } } } });
  if (f.from || f.to) {
    and.push({
      submittedAt: {
        ...(f.from ? { gte: f.from } : {}),
        ...(f.to ? { lt: new Date(f.to.getTime() + 24 * 60 * 60 * 1000) } : {}),
      },
    });
  }
  if (!f.includeTestData) and.push({ person: { isTestData: false } });
  return { status: 'SUBMITTED', AND: and };
}

export async function listResults(f: ResultFilter, skip: number, take: number) {
  const where = resultWhere(f);
  const [total, attempts] = await Promise.all([
    prisma.attempt.count({ where }),
    prisma.attempt.findMany({ where, include: attemptInclude, orderBy: { submittedAt: 'desc' }, skip, take }),
  ]);
  return { total, items: attempts.map(toResultRow) };
}

/** Everything matching, capped (a spreadsheet, not a page). */
export const MAX_EXPORT_ROWS = 20000;
export async function allResults(f: ResultFilter): Promise<ResultRow[]> {
  const attempts = await prisma.attempt.findMany({ where: resultWhere(f), include: attemptInclude, orderBy: { submittedAt: 'desc' }, take: MAX_EXPORT_ROWS });
  return attempts.map(toResultRow);
}

/** A spreadsheet cell: quoted, and never read as a formula. */
function csvCell(v: string | number | boolean | null): string {
  if (v === null) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_HEADER = ['Name', 'WhatsApp', 'Type', 'Quiz / exam', 'Assembly', 'Try', 'Score', 'Out of', 'Percent', 'Pass mark', 'Result', 'Date'];

export function resultsCsv(rows: ResultRow[]): string {
  const lines = rows.map((r) =>
    [
      r.personName,
      r.whatsappNumber,
      r.kind === 'TEACHING' ? 'Teaching quiz' : r.kind === 'BOOK' ? 'Book exam' : r.kind === 'DEVOTIONAL' ? 'Devotional exam' : 'Exam',
      r.title,
      r.assemblyName,
      r.tryNumber,
      r.score,
      r.maxScore,
      r.percentage === null ? null : Math.round(r.percentage),
      r.passMark,
      r.passed === null ? null : r.passed ? 'Passed' : 'Failed',
      r.submittedAt ? r.submittedAt.slice(0, 10) : null,
    ]
      .map(csvCell)
      .join(','),
  );
  // The byte-order mark makes Excel read the accents (é, è…) correctly.
  return '﻿' + [CSV_HEADER.map(csvCell).join(','), ...lines].join('\r\n');
}

// ---------------------------------------------------------------------------
// One quiz / exam at a glance: how many took it, how many passed, the average
// and how well each question was answered (hardest first) — so the teacher
// sees what people did not understand. Only a person's first try counts.
// ---------------------------------------------------------------------------

export interface QuizSummary {
  assessmentId: string;
  kind: ResultKind;
  title: string;
  assemblyName: string | null;
  passMark: number;
  taken: number;
  passed: number;
  averagePercentage: number | null;
  lowestPercentage: number | null;
  highestPercentage: number | null;
  questions: {
    questionId: string;
    textEn: string;
    textFr: string | null;
    answered: number;
    correct: number;
    correctPercentage: number;
    /** Admin only: the right answer and the wrong answer chosen most. */
    correctAnswerEn?: string | null;
    mostChosenWrongEn?: { text: string; count: number } | null;
  }[];
}

export async function quizSummary(assessmentId: string, opts: { personIds?: string[]; detail: boolean }): Promise<QuizSummary | null> {
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: {
      titleEn: true,
      weekNumber: true,
      passMark: true,
      teaching: { select: { title: true, community: { select: { name: true } } } },
      trainingBook: { select: { titleEn: true } },
      devotional: { select: { titleEn: true } },
      questions: {
        orderBy: [{ setNumber: 'asc' }, { order: 'asc' }],
        select: { id: true, setNumber: true, textEn: true, textFr: true, options: { select: { id: true, textEn: true, isCorrect: true } } },
      },
    },
  });
  if (!assessment) return null;
  // A teaching's retake questions (set 2) are not part of this first-try summary.
  if (assessment.teaching) assessment.questions = assessment.questions.filter((q) => q.setNumber === 1);

  const attempts = await prisma.attempt.findMany({
    where: {
      assessmentId,
      status: 'SUBMITTED',
      person: { isTestData: false },
      ...(opts.personIds ? { personId: { in: opts.personIds } } : {}),
    },
    orderBy: { attemptNumber: 'asc' },
    select: { personId: true, percentage: true, passed: true, answers: { select: { questionId: true, selectedOptionId: true, wasCorrect: true } } },
  });
  const firstTry = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) if (!firstTry.has(a.personId)) firstTry.set(a.personId, a);
  const tries = [...firstTry.values()];
  const scores = tries.map((a) => a.percentage).filter((v): v is number => v !== null);

  const { kind, title } = examLabel(assessment);
  return {
    assessmentId,
    kind,
    title,
    assemblyName: assessment.teaching?.community.name ?? null,
    passMark: assessment.passMark,
    taken: tries.length,
    passed: tries.filter((a) => a.passed).length,
    averagePercentage: scores.length ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length) : null,
    lowestPercentage: scores.length ? Math.round(Math.min(...scores)) : null,
    highestPercentage: scores.length ? Math.round(Math.max(...scores)) : null,
    questions: assessment.questions
      .map((q) => {
        const answers = tries.flatMap((a) => a.answers.filter((x) => x.questionId === q.id));
        const correct = answers.filter((x) => x.wasCorrect).length;
        const wrongCounts = new Map<string, number>();
        for (const x of answers) if (!x.wasCorrect) wrongCounts.set(x.selectedOptionId, (wrongCounts.get(x.selectedOptionId) ?? 0) + 1);
        const worst = [...wrongCounts.entries()].sort((x, y) => y[1] - x[1])[0];
        const base = {
          questionId: q.id,
          textEn: q.textEn,
          textFr: q.textFr,
          answered: answers.length,
          correct,
          correctPercentage: answers.length ? Math.round((correct / answers.length) * 100) : 0,
        };
        return opts.detail
          ? {
              ...base,
              correctAnswerEn: q.options.find((o) => o.isCorrect)?.textEn ?? null,
              mostChosenWrongEn: worst ? { text: q.options.find((o) => o.id === worst[0])?.textEn ?? '', count: worst[1] } : null,
            }
          : base;
      })
      .filter((q) => q.answered > 0)
      // The questions most people got wrong first.
      .sort((x, y) => x.correctPercentage - y.correctPercentage),
  };
}
