import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { reconcileHolds, spendSettings } from './tokenSpend';

// ---------------------------------------------------------------------------
// King's Token — earning (Phase 5a).
//
// Members earn tokens by answering correctly in a Dominion Clinic exam: 8 per
// correct answer, halving every 4 years from the start day down to 1, and then
// staying at 1 for ever. For every 70 tokens members earn, 30 more are credited
// to the foundation account (locked for 4 years). Tokens only accumulate for
// now: nothing can be spent until the central admin announces it. Every gain is
// an entry in the permanent ledger (TokenEntry), which is only ever added to.
//
// The start day is set once by the central admin ("Start counting"); exams
// taken before it earn nothing. The situation books use the same schedule at
// double the rate (16 down to 2) and arrive in a later phase.
// ---------------------------------------------------------------------------

export const YEARS_PER_HALVING = 4;
export const CLINIC_START_RATE = 8;
export const CLINIC_FLOOR_RATE = 1;
export const BOOK_START_RATE = 16;
export const BOOK_FLOOR_RATE = 2;
/** For every 70 tokens members earn, 30 more go to the foundation. */
export const FOUNDATION_SHARE_NUMERATOR = 30;
export const FOUNDATION_SHARE_DENOMINATOR = 70;
export const FOUNDATION_LOCK_YEARS = 4;

export type RateSource = 'CLINIC' | 'BOOK';

/** The same calendar moment `years` later (UTC); 29 February falls back to 28 February. */
export function addYears(date: Date, years: number): Date {
  const d = new Date(date.getTime());
  const month = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + years);
  if (d.getUTCMonth() !== month) d.setUTCDate(0);
  return d;
}

/** Whole years from `start` to `at`; null when `at` is before the start. */
export function yearsElapsed(start: Date, at: Date): number | null {
  if (at.getTime() < start.getTime()) return null;
  let years = at.getUTCFullYear() - start.getUTCFullYear();
  while (years > 0 && addYears(start, years).getTime() > at.getTime()) years -= 1;
  return years;
}

function rateFor(source: RateSource, halvings: number): number {
  const [startRate, floor] = source === 'CLINIC' ? [CLINIC_START_RATE, CLINIC_FLOOR_RATE] : [BOOK_START_RATE, BOOK_FLOOR_RATE];
  return Math.max(floor, startRate / 2 ** halvings);
}

/** Tokens per correct answer on `at`, or null when tokens had not started yet. */
export function rateAt(source: RateSource, start: Date | null, at: Date): number | null {
  if (!start) return null;
  const years = yearsElapsed(start, at);
  if (years === null) return null;
  return rateFor(source, Math.floor(years / YEARS_PER_HALVING));
}

/** When the reward next halves (null once it reached its floor), and the rate it halves to. */
export function nextHalving(source: RateSource, start: Date | null, at: Date): { at: string; rate: number } | null {
  if (!start) return null;
  const years = yearsElapsed(start, at);
  if (years === null) return null;
  const halvings = Math.floor(years / YEARS_PER_HALVING);
  const current = rateFor(source, halvings);
  const next = rateFor(source, halvings + 1);
  if (next === current) return null;
  return { at: addYears(start, (halvings + 1) * YEARS_PER_HALVING).toISOString(), rate: next };
}

export interface ScheduleRow {
  fromYear: number;
  toYear: number | null;
  clinic: number;
  book: number;
}

/** The published schedule: the rate for each stretch of years, ending with the floor that stays for ever. */
export function rateSchedule(): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  for (let h = 0; ; h += 1) {
    const clinic = rateFor('CLINIC', h);
    const book = rateFor('BOOK', h);
    const last = rateFor('CLINIC', h + 1) === clinic;
    rows.push({ fromYear: h * YEARS_PER_HALVING + 1, toYear: last ? null : (h + 1) * YEARS_PER_HALVING, clinic, book });
    if (last) break;
  }
  return rows;
}

export async function tokensStartAt(): Promise<Date | null> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { tokensStartAt: true } });
  return s?.tokensStartAt ?? null;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export type AwardResult = { awarded: false } | { awarded: true; tokens: number; foundation: number };

/**
 * Credits the tokens for one submitted Dominion Clinic exam try. Idempotent
 * and safe to call again: it credits only the member's FIRST submitted try of
 * an exam, only when it was taken on or after the start day, and never twice.
 */
export async function awardClinicTokens(attemptId: string): Promise<AwardResult> {
  const none: AwardResult = { awarded: false };
  const start = await tokensStartAt();
  if (!start) return none;

  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: { id: true, personId: true, assessmentId: true, status: true, submittedAt: true, assessment: { select: { weekNumber: true, devotionalId: true } } },
  });
  if (!attempt || attempt.status !== 'SUBMITTED' || !attempt.submittedAt) return none;
  // Only a monthly Dominion Clinic exam earns here.
  if (attempt.assessment.weekNumber === null || !attempt.assessment.devotionalId) return none;
  const rate = rateAt('CLINIC', start, attempt.submittedAt);
  if (rate === null) return none;

  // First try only: it must be the earliest submitted try of this exam.
  const first = await prisma.attempt.findFirst({
    where: { personId: attempt.personId, assessmentId: attempt.assessmentId, status: 'SUBMITTED' },
    orderBy: { attemptNumber: 'asc' },
    select: { id: true },
  });
  if (!first || first.id !== attempt.id) return none;

  const correct = await prisma.answer.count({ where: { attemptId: attempt.id, wasCorrect: true } });
  if (correct === 0) return none;

  const already = await prisma.tokenEntry.findFirst({
    where: { personId: attempt.personId, assessmentId: attempt.assessmentId, reason: 'CLINIC_EXAM' },
    select: { id: true },
  });
  if (already) return none;

  const tokens = round6(correct * rate);
  const foundation = round6((tokens * FOUNDATION_SHARE_NUMERATOR) / FOUNDATION_SHARE_DENOMINATOR);
  try {
    await prisma.$transaction(async (tx) => {
      const entry = await tx.tokenEntry.create({
        data: {
          personId: attempt.personId,
          kind: 'EARNED',
          reason: 'CLINIC_EXAM',
          amount: new Prisma.Decimal(tokens),
          assessmentId: attempt.assessmentId,
          attemptId: attempt.id,
          correctAnswers: correct,
          ratePerAnswer: new Prisma.Decimal(rate),
          createdAt: attempt.submittedAt!,
        },
      });
      await tx.tokenEntry.create({
        data: {
          personId: null,
          kind: 'EARNED',
          reason: 'FOUNDATION_SHARE',
          amount: new Prisma.Decimal(foundation),
          assessmentId: attempt.assessmentId,
          sourceEntryId: entry.id,
          lockedUntil: addYears(attempt.submittedAt!, FOUNDATION_LOCK_YEARS),
          createdAt: attempt.submittedAt!,
        },
      });
    });
  } catch (err) {
    // A concurrent twin already credited this exam: nothing to do.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return none;
    throw err;
  }
  return { awarded: true, tokens, foundation };
}

/** Credits any exam tries that were submitted since the start day but never credited (a safety net). */
export async function settleClinicTokens(personId: string): Promise<void> {
  const start = await tokensStartAt();
  if (!start) return;
  const attempts = await prisma.attempt.findMany({
    where: { personId, status: 'SUBMITTED', submittedAt: { gte: start }, assessment: { weekNumber: { not: null }, devotionalId: { not: null } } },
    select: { id: true, assessmentId: true },
    orderBy: { submittedAt: 'asc' },
  });
  if (attempts.length === 0) return;
  const credited = await prisma.tokenEntry.findMany({
    where: { personId, reason: 'CLINIC_EXAM', assessmentId: { in: attempts.map((a) => a.assessmentId) } },
    select: { assessmentId: true },
  });
  const done = new Set(credited.map((c) => c.assessmentId));
  const seen = new Set<string>();
  for (const a of attempts) {
    if (done.has(a.assessmentId) || seen.has(a.assessmentId)) continue;
    seen.add(a.assessmentId);
    await awardClinicTokens(a.id).catch((err) => console.error('[tokens] settle failed', { error: err instanceof Error ? err.message : String(err) }));
  }
}

const num = (d: Prisma.Decimal | null | undefined) => (d ? d.toNumber() : 0);

export interface TokenBalance {
  earned: number;
  bought: number;
  total: number;
}

export async function balanceOf(personId: string | null): Promise<TokenBalance> {
  const rows = await prisma.tokenEntry.groupBy({ by: ['kind'], where: { personId }, _sum: { amount: true } });
  const earned = num(rows.find((r) => r.kind === 'EARNED')?._sum.amount);
  const bought = num(rows.find((r) => r.kind === 'BOUGHT')?._sum.amount);
  return { earned, bought, total: round6(earned + bought) };
}

export interface TokenHistoryItem {
  id: string;
  at: string;
  reason: 'CLINIC_EXAM' | 'FOUNDATION_SHARE' | 'SPEND_HOLD' | 'SPEND_RELEASE' | 'TREASURY_SHARE' | 'SPEND_BURN';
  kind: 'EARNED' | 'BOUGHT' | 'BURNED';
  amount: number;
  correctAnswers: number | null;
  ratePerAnswer: number | null;
  examNumber: number | null;
  monthTitleEn: string | null;
  monthTitleFr: string | null;
  /** A spend or its release: the book it paid toward. */
  bookNumber: number | null;
}

/** A member's own ledger, newest first, with the exam each reward came from. */
export async function historyOf(personId: string, take = 100): Promise<TokenHistoryItem[]> {
  const rows = await prisma.tokenEntry.findMany({ where: { personId }, orderBy: { createdAt: 'desc' }, take });
  const ids = [...new Set(rows.map((r) => r.assessmentId).filter((x): x is string => Boolean(x)))];
  const exams = ids.length
    ? await prisma.assessment.findMany({ where: { id: { in: ids } }, select: { id: true, weekNumber: true, devotional: { select: { titleEn: true, titleFr: true } } } })
    : [];
  const byId = new Map(exams.map((e) => [e.id, e]));
  const paymentIds = [...new Set(rows.map((r) => r.bookPaymentId).filter((x): x is string => Boolean(x)))];
  const payments = paymentIds.length ? await prisma.bookPayment.findMany({ where: { id: { in: paymentIds } }, select: { id: true, bookNumber: true } }) : [];
  const bookOf = new Map(payments.map((p) => [p.id, p.bookNumber]));
  return rows.map((r) => {
    const exam = r.assessmentId ? byId.get(r.assessmentId) : undefined;
    return {
      id: r.id,
      at: r.createdAt.toISOString(),
      reason: r.reason,
      kind: r.kind,
      amount: num(r.amount),
      correctAnswers: r.correctAnswers,
      ratePerAnswer: r.ratePerAnswer ? r.ratePerAnswer.toNumber() : null,
      examNumber: exam?.weekNumber ?? null,
      monthTitleEn: exam?.devotional?.titleEn ?? null,
      monthTitleFr: exam?.devotional?.titleFr ?? null,
      bookNumber: r.bookPaymentId ? (bookOf.get(r.bookPaymentId) ?? null) : null,
    };
  });
}

/** What the member sees: their own balance and history, the foundation's balance, the rate now and the next halving. */
export async function memberTokenView(personId: string, now = new Date()) {
  await settleClinicTokens(personId);
  await reconcileHolds(personId);
  const start = await tokensStartAt();
  const [balance, foundation, history, spend] = await Promise.all([balanceOf(personId), balanceOf(null), historyOf(personId), spendSettings()]);
  const started = Boolean(start && start.getTime() <= now.getTime());
  return {
    started,
    startsAt: start ? start.toISOString() : null,
    // Spending is switched on by the central admin when tokens are announced.
    usable: spend.enabled,
    spend,
    balance,
    foundation: { total: foundation.total },
    clinicRate: started ? rateAt('CLINIC', start, now) : null,
    nextHalving: started ? nextHalving('CLINIC', start, now) : null,
    schedule: rateSchedule(),
    history,
  };
}

/** The central admin's picture: the start day, tokens earned and held by the foundation, and the rate now. */
export async function adminTokenSummary(now = new Date()) {
  const start = await tokensStartAt();
  const [earned, foundation, members, entries] = await Promise.all([
    prisma.tokenEntry.aggregate({ where: { personId: { not: null }, reason: 'CLINIC_EXAM' }, _sum: { amount: true } }),
    prisma.tokenEntry.aggregate({ where: { personId: null, kind: { not: 'BURNED' } }, _sum: { amount: true } }),
    prisma.tokenEntry.groupBy({ by: ['personId'], where: { personId: { not: null } } }),
    prisma.tokenEntry.count(),
  ]);
  const [burned, spent, spend] = await Promise.all([
    prisma.tokenEntry.aggregate({ where: { kind: 'BURNED' }, _sum: { amount: true } }),
    prisma.tokenEntry.aggregate({ where: { reason: 'SPEND_HOLD' }, _sum: { amount: true } }),
    spendSettings(),
  ]);
  const started = Boolean(start && start.getTime() <= now.getTime());
  return {
    started,
    startsAt: start ? start.toISOString() : null,
    clinicRate: started ? rateAt('CLINIC', start, now) : null,
    nextHalving: started ? nextHalving('CLINIC', start, now) : null,
    spend,
    burnedTotal: num(burned._sum.amount),
    spentTotal: -num(spent._sum.amount),
    earnedTotal: num(earned._sum.amount),
    foundationTotal: num(foundation._sum.amount),
    members: members.length,
    entries,
    schedule: rateSchedule(),
  };
}

export type SetStartResult = { ok: true; startsAt: string } | { ok: false; status: 400 | 409; error: string };

/**
 * Sets the day tokens start counting. Allowed only while it has not started:
 * once the day has arrived the schedule is fixed for everyone and cannot move.
 */
export async function setTokensStart(at: Date, now = new Date()): Promise<SetStartResult> {
  if (Number.isNaN(at.getTime())) return { ok: false, status: 400, error: 'That date is not valid.' };
  const current = await tokensStartAt();
  if (current && current.getTime() <= now.getTime()) {
    return { ok: false, status: 409, error: 'Tokens have already started counting. The start day can no longer be changed.' };
  }
  if (at.getTime() < now.getTime() - 60 * 1000) return { ok: false, status: 400, error: 'Choose today or a day in the future.' };
  await prisma.settings.upsert({ where: { id: 'singleton' }, create: { id: 'singleton', tokensStartAt: at }, update: { tokensStartAt: at } });
  return { ok: true, startsAt: at.toISOString() };
}
