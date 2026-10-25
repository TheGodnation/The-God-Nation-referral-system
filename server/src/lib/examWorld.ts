import { prisma } from './prisma';
import { hasConversationAccess } from './communityConversation';

// ---------------------------------------------------------------------------
// Exam World rules (see LibraryBook / TrainingEnrollment schema comments).
//
// Monthly devotional: free for every member who can see the devotional
// (network-wide, or one of their groups). Its weekly exams are open while
// published and until the devotional's end date; only the FIRST submitted
// try is the official score (later tries are practice).
//
// Leadership training: "Begin my training" makes the member an ACTIVE
// trainee and opens Book 1 on trust. Each next book opens once the
// previous book's exam is passed (70%) AND the books opened so far are paid
// (1,100 FCFA each) — or, with "study now, pay later" grace granted by the
// central admin, while fewer than `graceBooks` (at most 5) are still owed,
// so no one ever owes more than 5 books. Once open, always open
// (TrainingBookOpen), unless the training itself is stopped.
// ---------------------------------------------------------------------------

export const TRAINING_PASS_MARK = 70;
export const MAX_GRACE_BOOKS = 5;

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
  pageCount: number | null;
  coverVersion: string | null;
  unlocked: boolean;
  /** Payment for this book: confirmed, or waiting (claimed / automatic in progress). */
  payment: 'PAID' | 'CLAIMED' | 'PENDING' | null;
  /** Why a closed book is closed: the previous exam, or payment still owed. */
  lockedBecause: 'NOT_STARTED' | 'PREVIOUS_EXAM' | 'PAYMENT' | null;
  exam: { id: string; published: boolean; passMark: number; bestPercentage: number | null; passed: boolean } | null;
}

/** All training books in order, with which ones are open for this person. */
export async function getTrainingBooksFor(personId: string): Promise<TrainingBookState[]> {
  const [enrollment, books, opens, payments] = await Promise.all([
    prisma.trainingEnrollment.findUnique({ where: { personId }, select: { status: true, graceBooks: true } }),
    prisma.libraryBook.findMany({
      where: { kind: 'TRAINING', trainingOrder: { not: null } },
      orderBy: { trainingOrder: 'asc' },
      include: { exam: { select: { id: true, status: true, passMark: true } } },
    }),
    prisma.trainingBookOpen.findMany({ where: { personId }, select: { bookId: true } }),
    prisma.bookPayment.findMany({
      where: { personId, status: { in: ['CONFIRMED', 'CLAIMED', 'PENDING'] } },
      select: { bookId: true, status: true },
    }),
  ]);
  const active = enrollment?.status === 'ACTIVE';
  const owedAllowed = Math.max(1, Math.min(MAX_GRACE_BOOKS, enrollment?.graceBooks ?? 0));
  const openedBefore = new Set(opens.map((o) => o.bookId));
  const paymentOf = (bookId: string): TrainingBookState['payment'] => {
    const mine = payments.filter((p) => p.bookId === bookId);
    if (mine.some((p) => p.status === 'CONFIRMED')) return 'PAID';
    if (mine.some((p) => p.status === 'CLAIMED')) return 'CLAIMED';
    if (mine.some((p) => p.status === 'PENDING')) return 'PENDING';
    return null;
  };

  const examIds = books.map((b) => b.exam?.id).filter((id): id is string => Boolean(id));
  const attempts = examIds.length
    ? await prisma.attempt.findMany({
        where: { personId, assessmentId: { in: examIds }, status: 'SUBMITTED' },
        select: { assessmentId: true, percentage: true, passed: true },
      })
    : [];

  let previousOpen = true; // Book 1 has no previous book.
  let previousPassed = true;
  let owed = 0; // opened books not paid yet
  const newlyOpened: string[] = [];
  const result = books.map((b, i) => {
    const mine = attempts.filter((a) => a.assessmentId === b.exam?.id);
    const best = mine.reduce<number | null>((max, a) => (a.percentage !== null && (max === null || a.percentage > max) ? a.percentage : max), null);
    const passed = mine.some((a) => a.passed === true);
    const payment = paymentOf(b.id);
    const byRule = i === 0 || (previousOpen && previousPassed && owed < owedAllowed);
    const unlocked = active && (openedBefore.has(b.id) || byRule);
    if (unlocked && !openedBefore.has(b.id)) newlyOpened.push(b.id);
    const lockedBecause: TrainingBookState['lockedBecause'] = unlocked
      ? null
      : !active
        ? 'NOT_STARTED'
        : !(previousOpen && previousPassed)
          ? 'PREVIOUS_EXAM'
          : 'PAYMENT';
    if (unlocked && payment !== 'PAID') owed += 1;
    previousOpen = unlocked;
    previousPassed = passed;
    return {
      id: b.id,
      trainingOrder: b.trainingOrder!,
      titleEn: b.titleEn,
      titleFr: b.titleFr,
      descriptionEn: b.descriptionEn,
      descriptionFr: b.descriptionFr,
      hasFile: Boolean(b.storageKey),
      pageCount: b.pageCount,
      coverVersion: b.coverVersion,
      unlocked,
      payment,
      lockedBecause,
      exam: b.exam
        ? { id: b.exam.id, published: b.exam.status !== 'DRAFT', passMark: b.exam.passMark, bestPercentage: best, passed }
        : null,
    };
  });
  if (newlyOpened.length) {
    await prisma.trainingBookOpen.createMany({ data: newlyOpened.map((bookId) => ({ personId, bookId })), skipDuplicates: true });
  }
  return result;
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

  // A teaching's quiz: anyone in the assembly may see it; it can be started
  // only once the system has approved the member as having read / listened
  // (TeachingProgress.completedAt), and until the teaching closes.
  const teaching = await prisma.teaching.findUnique({
    where: { assessmentId },
    select: { id: true, communityId: true, closesAt: true, message: { select: { deletedAt: true } } },
  });
  if (teaching) {
    if (teaching.message.deletedAt || !(await hasConversationAccess(personId, teaching.communityId))) return none;
    const progress = await prisma.teachingProgress.findUnique({
      where: { teachingId_personId: { teachingId: teaching.id, personId } },
      select: { completedAt: true },
    });
    const closed = teaching.closesAt.getTime() < Date.now();
    return { canView: true, canStart: Boolean(progress?.completedAt) && !closed, closedReason: closed ? 'CLOSED' : null };
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
