import { Prisma } from '@prisma/client';
import { prisma } from './prisma';

// Finding people by what an admin types. Every word typed must match somewhere (the name — without caring for
// accents or capitals, the WhatsApp number — even when typed with spaces, or an email), in any order.

const ACCENTED = 'àáâãäåçèéêëìíîïñòóôõöùúûüýÿÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝ';
const PLAIN = 'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY';

/** The same text as the database sees it: no accents, no capitals. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const likePattern = (word: string) => `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** The ids of the people matching every word of `search` (at most `limit`). */
export async function searchPersonIds(search: string, opts: { includeTestData: boolean; limit?: number }): Promise<string[]> {
  const words = search.split(/\s+/).filter(Boolean).slice(0, 6);
  if (words.length === 0) return [];
  const accented = Prisma.raw(`'${ACCENTED}'`);
  const plain = Prisma.raw(`'${PLAIN}'`);
  const foldedName = (col: string) => Prisma.raw(`lower(translate(${col}, ${accented.sql}, ${plain.sql}))`);
  const perWord = words.map((word) => {
    const folded = likePattern(fold(word));
    const digits = word.replace(/\D/g, '');
    const phone = digits.length >= 4 ? Prisma.sql`OR regexp_replace(p."whatsappNumber", '\\D', '', 'g') LIKE ${`%${digits}%`}` : Prisma.empty;
    return Prisma.sql`(
      ${foldedName('p."name"')} LIKE ${folded}
      OR p."whatsappNumber" LIKE ${likePattern(word)}
      ${phone}
      OR lower(p."email") LIKE ${likePattern(word.toLowerCase())}
      OR EXISTS (SELECT 1 FROM "MemberAccount" m WHERE m."personId" = p."id" AND lower(m."email") LIKE ${likePattern(word.toLowerCase())})
      OR EXISTS (SELECT 1 FROM "User" u WHERE u."personId" = p."id" AND (${foldedName('u."name"')} LIKE ${folded} OR lower(u."email") LIKE ${likePattern(word.toLowerCase())}))
    )`;
  });
  const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p."id" FROM "Person" p
    WHERE p."erasedAt" IS NULL
      ${opts.includeTestData ? Prisma.empty : Prisma.sql`AND p."isTestData" = false`}
      AND ${Prisma.join(perWord, ' AND ')}
    LIMIT ${opts.limit ?? 500}
  `);
  return rows.map((r) => r.id);
}
