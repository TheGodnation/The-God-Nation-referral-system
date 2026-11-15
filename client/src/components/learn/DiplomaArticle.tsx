import { useTranslation } from 'react-i18next';
import { RichText } from '../../lib/richText';

interface Section {
  title: string | null;
  body: string;
}

/** The introduction split at its big headings ("# …" and "## …"): the words before the first heading, then one part per heading. */
function sectionsOf(text: string): Section[] {
  const sections: Section[] = [];
  let current: { title: string | null; lines: string[] } = { title: null, lines: [] };
  const close = () => {
    const body = current.lines.join('\n').trim();
    if (current.title || body) sections.push({ title: current.title, body });
  };
  for (const line of text.split('\n')) {
    const m = line.match(/^#{1,2}\s+(.*)$/);
    if (m && m[1].trim()) {
      close();
      current = { title: m[1].trim(), lines: [] };
    } else current.lines.push(line);
  }
  close();
  return sections;
}

/**
 * The introduction to the diploma, always open: a handsome heading band, then each part of the text as its own tidy card
 * with a coloured heading, in comfortable reading type. Someone already studying reads it whole, below the books; someone who
 * has not begun reads its first half above the books and the rest below them.
 */
export function DiplomaArticle({ text, banner = true, testId = 'academy-intro' }: { text: string; /** The heading band above the parts (left out for the second half of an introduction that is split around the books). */ banner?: boolean; testId?: string }) {
  const { t } = useTranslation();
  const sections = sectionsOf(text.replace(/^\s*\[\[books\]\]\s*$/m, ''));
  if (sections.length === 0) return null;
  return (
    <section className="space-y-3" data-testid={testId} {...(banner ? { 'aria-labelledby': 'diploma-title' } : {})}>
      {banner && <div className="rounded-2xl bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 p-5 text-white shadow">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">🎓 {t('school.diploma_label')}</p>
        <h2 id="diploma-title" className="mt-1 text-xl font-bold leading-tight">
          {t('school.about_diploma')}
        </h2>
      </div>}
      {sections.map((s, i) => (
        <article key={i} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="diploma-section">
          {s.title && (
            <div className="flex items-start gap-2.5">
              <span aria-hidden className="mt-0.5 h-6 w-1.5 shrink-0 rounded-full bg-gold-400" />
              <RichText text={s.title} className="text-lg font-bold leading-snug text-brand-800" />
            </div>
          )}
          {s.body && <RichText text={s.body} headings comfort className="text-[16px] leading-7 text-slate-700" />}
        </article>
      ))}
    </section>
  );
}
