import { prisma } from './prisma';

// ---------------------------------------------------------------------------
// Exam World rules (see LibraryBook / TrainingEnrollment schema comments).
//
// Monthly devotional: free for every member who can see the devotional
// (network-wide, or one of their groups). Its weekly exams are open while
// published and until the devotional's end date; only the FIRST submitted
// try is the official score (later tries are practice).
//
// Leadership training: only for an ACTIVE (paid) trainee. Book 1 is open;
// each next book opens once the previous book's exam has been passed
// (70% by default) on any try. Once open, always open.
// ---------------------------------------------------------------------------

export const TRAINING_PASS_MARK = 70;

/** Communities whose devotionals this person may see. */
async function memberCommunityIds(personId: string): Promise<string[]> {
  const rows = await prisma.communityMembership.findMany({ where: { personId, status: 'ACTIVE' }, select: { communityId: true } });
  return rows.map((r) => r.communityId);
}

export async function canSeeDevotional(personId: string, devotional: { status: string; communityId: string | null }): Promise<boolean> {
  if (devotional.status !== 'PUBLISHED') return false;
  if (!devotional.communityId) return true;
  return (await memberCommunityIds(personId)).includes(devotional.communityId);
}

export async function isActiveTrainee(personId: string): Promise<boolean> {
  const e = await prisma.trainingEnrollment.findUnique({ where: { personId }, select: { status: true } });
  return e?.status === 'ACTIVE';
}

export interface TrainingBookState {
  id: string;
  trainingOrder: number;
  titleEn: string;
  titleFr: string | null;
  descriptionEn: string | null;
  descriptionFr: string | null;
  hasFile: boolean;
  unlocked: boolean;
  exam: { id: string; published: boolean; passMark: number; bestPercentage: number | null; passed: boolean } | null;
}

/** All training books in order, with which ones are open for this person. */
export async function getTrainingBooksFor(personId: string): Promise<TrainingBookState[]> {
  const [active, books] = await Promise.all([
    isActiveTrainee(personId),
    prisma.libraryBook.findMany({
      where: { kind: 'TRAINING', trainingOrder: { not: null } },
      orderBy: { trainingOrder: 'asc' },
      include: { exam: { select: { id: true, status: true, passMark: true } } },
    }),
  ]);

  const examIds = books.map((b) => b.exam?.id).filter((id): id is string => Boolean(id));
  const attempts = examIds.length
    ? await prisma.attempt.findMany({
        where: { personId, assessmentId: { in: examIds }, status: 'SUBMITTED' },
        select: { assessmentId: true, percentage: true, passed: true },
      })
    : [];

  let previousPassed = true; // Book 1 has no previous book.
  return books.map((b) => {
    const mine = attempts.filter((a) => a.assessmentId === b.exam?.id);
    const best = mine.reduce<number | null>((max, a) => (a.percentage !== null && (max === null || a.percentage > max) ? a.percentage : max), null);
    const passed = mine.some((a) => a.passed === true);
    const unlocked = active && previousPassed;
    previousPassed = previousPassed && passed;
    return {
      id: b.id,
      trainingOrder: b.trainingOrder!,
      titleEn: b.titleEn,
      titleFr: b.titleFr,
      descriptionEn: b.descriptionEn,
      descriptionFr: b.descriptionFr,
      hasFile: Boolean(b.storageKey),
      unlocked,
      exam: b.exam
        ? { id: b.exam.id, published: b.exam.status !== 'DRAFT', passMark: b.exam.passMark, bestPercentage: best, passed }
        : null,
    };
  });
}

/** Whether this person may open (read) this book in the app. */
export async function canReadBook(personId: string, bookId: string): Promise<boolean> {
  const book = await prisma.libraryBook.findUnique({ where: { id: bookId }, include: { devotional: true } });
  if (!book || !book.storageKey) return false;
  if (book.kind === 'DEVOTIONAL') return Boolean(book.devotional && (await canSeeDevotional(personId, book.devotional)));
  const books = await getTrainingBooksFor(personId);
  return books.some((b) => b.id === book.id && b.unlocked);
}

/**
 * Whether this person may take this exam, and if not why. Devotional
 * exams also close after the devotional's end date (reviewing past results
 * stays possible — see `canView`).
 */
export async function examAccess(
  personId: string,
  assessmentId: string,
): Promise<{ canView: boolean; canStart: boolean; closedReason: 'CLOSED' | null }> {
  const assessment = await prisma.assessment.findUnique({ where: { id: assessmentId }, include: { devotional: true } });
  const none = { canView: false, canStart: false, closedReason: null };
  if (!assessment || assessment.status === 'DRAFT') return none;

  if (assessment.trainingBookId) {
    const books = await getTrainingBooksFor(personId);
    const book = books.find((b) => b.id === assessment.trainingBookId);
    return book?.unlocked ? { canView: true, canStart: true, closedReason: null } : none;
  }

  if (assessment.devotional) {
    if (!(await canSeeDevotional(personId, assessment.devotional))) return none;
    // Only Exam World weekly exams close (at the end of the devotional's
    // last day); older devotional exams without a week number never did.
    const DAY = 24 * 60 * 60 * 1000;
    const closed = assessment.weekNumber !== null && assessment.devotional.endDate.getTime() + DAY < Date.now();
    return { canView: true, canStart: !closed, closedReason: closed ? 'CLOSED' : null };
  }

  return none;
}
