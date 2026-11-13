// The introduction of the Leadership Academy page is written by the founder (editable in Admin → Library). It uses the
// app's light formatting plus a few small markers; see server/src/lib/curriculumIntro.ts for the list:
//   [[books]]  on its own line = where the levels and their books are shown
//   @web …     a line shown on the website only (never in the Google Play version, which shows no prices)
//   {{books}} {{levels}} {{price}}  filled in from the real curriculum

export const BOOKS_MARKER = '[[books]]';

export function prepareIntro(text: string, opts: { store: boolean; books: number; levels: number; price: number }): string {
  const price = opts.price.toLocaleString('fr-FR');
  return text
    .split('\n')
    .filter((line) => !(opts.store && /^\s*@web\b/.test(line)))
    .map((line) => line.replace(/^(\s*)@web\s?/, '$1'))
    .join('\n')
    .replace(/\{\{books\}\}/g, String(opts.books))
    .replace(/\{\{levels\}\}/g, String(opts.levels))
    .replace(/\{\{price\}\}/g, price);
}

/** The text before and after the place where the books go. With no marker everything is "before" and the books follow. */
export function splitIntro(text: string): { before: string; after: string } {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() === BOOKS_MARKER);
  if (at < 0) return { before: text.trim(), after: '' };
  return { before: lines.slice(0, at).join('\n').trim(), after: lines.slice(at + 1).join('\n').trim() };
}
