import type { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// The Leadership Academy curriculum is a list of LEVELS, each holding BOOKS in order. A book's number is just its
// place across the whole list (1, 2, 3...), so the admin never types numbers: they move a book up or down, move it to
// another level, add a book in between, or reorder the levels, and every number (and the number in each exam's title)
// follows. Books are tied to everything else (exam, cover, payments, "already opened", saved copies on phones) by
// their own id, never by their number, so rearranging loses nothing.
//
// A student's next book opens when the book before it in this list is passed (lib/examWorld.ts), and a book that was
// already opened stays open, so rearranging never closes a book someone is reading.
// ---------------------------------------------------------------------------

type Tx = Prisma.TransactionClient;

export interface StructBook {
  id: string;
  titleEn: string;
  titleFr: string | null;
  trainingOrder: number | null;
}

export interface StructGroup {
  /** null = books not placed in a level (always the last group). */
  levelId: string | null;
  books: StructBook[];
}

export interface StructLevel {
  id: string;
  position: number;
  titleEn: string;
  titleFr: string | null;
  summaryEn: string | null;
  summaryFr: string | null;
}

/** The levels in order, each with its books in order (and the books without a level last). */
export async function loadStructure(tx: Tx): Promise<{ levels: StructLevel[]; groups: StructGroup[] }> {
  const levels = await tx.trainingLevel.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  const books = await tx.libraryBook.findMany({
    where: { kind: 'TRAINING' },
    select: { id: true, titleEn: true, titleFr: true, trainingOrder: true, trainingLevelId: true, createdAt: true },
  });
  const byOrder = (a: { trainingOrder: number | null; createdAt: Date }, b: { trainingOrder: number | null; createdAt: Date }) =>
    (a.trainingOrder ?? Number.MAX_SAFE_INTEGER) - (b.trainingOrder ?? Number.MAX_SAFE_INTEGER) || a.createdAt.getTime() - b.createdAt.getTime();
  const strip = ({ id, titleEn, titleFr, trainingOrder }: (typeof books)[number]): StructBook => ({ id, titleEn, titleFr, trainingOrder });
  const groups: StructGroup[] = levels.map((l) => ({ levelId: l.id, books: books.filter((b) => b.trainingLevelId === l.id).sort(byOrder).map(strip) }));
  const known = new Set(levels.map((l) => l.id));
  groups.push({ levelId: null, books: books.filter((b) => !b.trainingLevelId || !known.has(b.trainingLevelId)).sort(byOrder).map(strip) });
  return { levels: levels.map(({ id, position, titleEn, titleFr, summaryEn, summaryFr }) => ({ id, position, titleEn, titleFr, summaryEn, summaryFr })), groups };
}

/** Writes an arrangement: level places, each book's level, every book's number, and the numbers in the exam titles. */
export async function saveStructure(tx: Tx, groups: StructGroup[]): Promise<void> {
  const levelGroups = groups.filter((g) => g.levelId !== null);
  for (let i = 0; i < levelGroups.length; i += 1) {
    await tx.trainingLevel.update({ where: { id: levelGroups[i].levelId! }, data: { position: i + 1 } });
  }
  const sequence: { id: string; levelId: string | null }[] = [];
  for (const g of groups) for (const b of g.books) sequence.push({ id: b.id, levelId: g.levelId });
  // Numbers are unique, so first park every book on a negative number, then give the final ones.
  for (let i = 0; i < sequence.length; i += 1) {
    await tx.libraryBook.update({ where: { id: sequence[i].id }, data: { trainingOrder: -(i + 1), trainingLevelId: sequence[i].levelId } });
  }
  for (let i = 0; i < sequence.length; i += 1) {
    await tx.libraryBook.update({ where: { id: sequence[i].id }, data: { trainingOrder: i + 1 } });
  }
  // The exams made with a book carry its number in their title ("Book 12 exam: …"): keep them in step.
  const exams = await tx.assessment.findMany({ where: { trainingBookId: { in: sequence.map((s) => s.id) } }, select: { id: true, titleEn: true, titleFr: true, trainingBookId: true } });
  for (const e of exams) {
    const n = sequence.findIndex((s) => s.id === e.trainingBookId) + 1;
    const titleEn = e.titleEn.replace(/^Book \d+ exam:/, `Book ${n} exam:`);
    const titleFr = e.titleFr ? e.titleFr.replace(/^Examen du livre \d+ :/, `Examen du livre ${n} :`) : e.titleFr;
    if (titleEn !== e.titleEn || titleFr !== e.titleFr) await tx.assessment.update({ where: { id: e.id }, data: { titleEn, titleFr } });
  }
}

const find = (groups: StructGroup[], bookId: string) => {
  for (let gi = 0; gi < groups.length; gi += 1) {
    const bi = groups[gi].books.findIndex((b) => b.id === bookId);
    if (bi >= 0) return { gi, bi };
  }
  return null;
};

/** One step earlier or later in the whole list. At the edge of a level the book crosses into the neighbouring level. */
export function moveBook(groups: StructGroup[], bookId: string, direction: 'up' | 'down'): StructGroup[] {
  const next = groups.map((g) => ({ ...g, books: [...g.books] }));
  const at = find(next, bookId);
  if (!at) return groups;
  const { gi, bi } = at;
  const g = next[gi];
  if (direction === 'up') {
    if (bi > 0) [g.books[bi - 1], g.books[bi]] = [g.books[bi], g.books[bi - 1]];
    else if (gi > 0) {
      const [b] = g.books.splice(bi, 1);
      next[gi - 1].books.push(b);
    }
  } else if (bi < g.books.length - 1) {
    [g.books[bi + 1], g.books[bi]] = [g.books[bi], g.books[bi + 1]];
  } else if (gi < next.length - 1) {
    const [b] = g.books.splice(bi, 1);
    next[gi + 1].books.unshift(b);
  }
  return next;
}

/** Puts a book into a level at a place (1 = first in that level; omitted = last). */
export function moveBookToLevel(groups: StructGroup[], bookId: string, levelId: string | null, position?: number): StructGroup[] {
  const next = groups.map((g) => ({ ...g, books: [...g.books] }));
  const at = find(next, bookId);
  const target = next.find((g) => g.levelId === levelId);
  if (!at || !target) return groups;
  const [book] = next[at.gi].books.splice(at.bi, 1);
  const place = position === undefined ? target.books.length : Math.max(0, Math.min(target.books.length, position - 1));
  target.books.splice(place, 0, book);
  return next;
}

/** A level one place earlier or later (its books go with it). */
export function moveLevel(groups: StructGroup[], levelId: string, direction: 'up' | 'down'): StructGroup[] {
  const levelGroups = groups.filter((g) => g.levelId !== null).map((g) => ({ ...g, books: [...g.books] }));
  const rest = groups.filter((g) => g.levelId === null).map((g) => ({ ...g, books: [...g.books] }));
  const i = levelGroups.findIndex((g) => g.levelId === levelId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= levelGroups.length) return groups;
  [levelGroups[i], levelGroups[j]] = [levelGroups[j], levelGroups[i]];
  return [...levelGroups, ...rest];
}

/**
 * Where a new book goes. `number` = the number it should get (the book now there, and all after it, move down one); with
 * `levelId` and no number it goes last in that level; with neither it goes last in the last level.
 */
export function insertBook(groups: StructGroup[], book: StructBook, opts: { number?: number; levelId?: string | null }): StructGroup[] {
  const next = groups.map((g) => ({ ...g, books: [...g.books] }));
  if (opts.number !== undefined) {
    let seen = 0;
    for (const g of next) {
      if (opts.number <= seen + g.books.length) {
        g.books.splice(opts.number - 1 - seen, 0, book);
        return next;
      }
      seen += g.books.length;
    }
  }
  const levelGroups = next.filter((g) => g.levelId !== null);
  const target = (opts.levelId ? next.find((g) => g.levelId === opts.levelId) : undefined) ?? levelGroups[levelGroups.length - 1] ?? next[next.length - 1];
  target.books.push(book);
  return next;
}

/** Takes a book out of the arrangement (it keeps no number). */
export function removeBook(groups: StructGroup[], bookId: string): StructGroup[] {
  return groups.map((g) => ({ ...g, books: g.books.filter((b) => b.id !== bookId) }));
}
