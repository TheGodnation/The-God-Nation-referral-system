import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// One row per submitted quiz / exam try, whatever it was (a teaching's quiz,
// a leadership book's exam, a devotional's weekly exam) — for the admin
// Results page, its spreadsheet download, and a member's own list.

export type ResultKind = 'TEACHING' | 'BOOK' | 'DEVOTIONAL' | 'OTHER';
export const RESULT_KINDS: ResultKind[] = ['TEACHING', 'BOOK', 'DEVOTIONAL', 'OTHER'];

export interface ResultFilter {
  personId?: string;
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

export function toResultRow(a: AttemptRow): ResultRow {
  const s = a.assessment;
  const kind: ResultKind = s.teaching ? 'TEACHING' : s.trainingBook ? 'BOOK' : s.devotional ? 'DEVOTIONAL' : 'OTHER';
  const title =
    kind === 'TEACHING'
      ? s.teaching!.title
      : kind === 'BOOK'
        ? s.trainingBook!.titleEn
        : kind === 'DEVOTIONAL'
          ? `${s.devotional!.titleEn}${s.weekNumber ? ` — week ${s.weekNumber}` : ''}`
          : s.titleEn;
  return {
    attemptId: a.id,
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
