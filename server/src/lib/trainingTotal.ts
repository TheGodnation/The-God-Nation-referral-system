import { prisma } from './prisma';

// The programme has 16 books. While the last ones are still to be put on the site, students are still told 16 (and the
// certificate needs all 16): the number shown is the larger of the books really on the site and this total, which the
// admin sets in Admin → Library → Arrange the curriculum.
export const DEFAULT_BOOKS_TOTAL = 16;
export const MAX_BOOKS_TOTAL = 100;

export async function configuredBooksTotal(): Promise<number> {
  const s = await prisma.settings.findUnique({ where: { id: 'singleton' }, select: { trainingBooksTotal: true } });
  return s?.trainingBooksTotal ?? DEFAULT_BOOKS_TOTAL;
}

/** The number of books to tell students: never fewer than the books really on the site. */
export async function programmeBookTotal(actualBooks: number): Promise<number> {
  return Math.max(actualBooks, await configuredBooksTotal());
}
