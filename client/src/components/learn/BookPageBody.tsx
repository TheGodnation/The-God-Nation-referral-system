import { useTranslation } from 'react-i18next';
import { RichText } from '../../lib/richText';

export interface BookPageChapter {
  id?: string;
  label?: string | null;
  title: string;
  summary: string;
}

/**
 * The book's short description as a small, tidy article: a coloured heading, the promise of the book ("After reading this
 * book, you…", written first and in italics) lifted out as a highlighted line, then the explanation in comfortable
 * reading type. Without a promise line, the whole text is the explanation.
 */
function BookDescription({ text }: { text: string }) {
  const { t } = useTranslation();
  const [first, ...rest] = text.trim().split(/\n\s*\n/);
  const match = first.trim().match(/^_([\s\S]+)_$/);
  const promise = match ? match[1].trim() : null;
  const body = promise ? rest.join('\n\n').trim() : text.trim();
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="book-description">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="h-6 w-1.5 rounded-full bg-gold-400" />
        <h2 className="text-lg font-bold text-brand-800">{t('school.about_book')}</h2>
      </div>
      {promise && (
        <div className="rounded-xl border-l-4 border-gold-400 bg-brand-50 px-4 py-3" data-testid="book-promise">
          <p className="text-[11px] font-bold uppercase tracking-wider text-brand-600">{t('school.book_promise')}</p>
          <RichText text={promise} className="mt-1 text-[16px] font-semibold leading-snug text-brand-900" />
        </div>
      )}
      {body && <RichText text={body} headings comfort className="text-[16px] leading-7 text-slate-700" />}
    </section>
  );
}

// The written part of a book's page, in the order the founder lays it out:
// the pitch, the chapter list (each chapter with its small label above its
// title and its summary under it) and the closing words. The member's book
// page and the admin's "how it will look" preview both use this, so what the
// admin checks is what members see.
export function BookPageBody({
  description,
  chaptersHeading,
  chapters,
  closing,
  hideEmpty = false,
}: {
  description?: string;
  chaptersHeading?: string;
  chapters: BookPageChapter[];
  closing?: string;
  /** Members' view: no "will be added soon" placeholders; a book with nothing written shows nothing here. */
  hideEmpty?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6" data-testid="book-page-body">
      {description && <BookDescription text={description} />}

      {!(hideEmpty && chapters.length === 0) && (
      <section>
        {/* The heading may carry one sentence under it, on a second line ("Inside the Book" / "Here is what you will find..."). */}
        <h2 className="text-lg font-semibold text-brand-900">{(chaptersHeading || t('school.chapters_heading')).split('\n')[0]}</h2>
        {chaptersHeading && chaptersHeading.includes('\n') && <p className="mt-1 text-[15px] leading-relaxed text-slate-700">{chaptersHeading.split('\n').slice(1).join(' ')}</p>}
        <div className="mb-2" />
        {chapters.length === 0 ? (
          <p className="card text-sm text-slate-500">{t('school.chapters_soon')}</p>
        ) : (
          <ol className="card divide-y divide-slate-100 p-0">
            {chapters.map((c, i) => (
              <li key={c.id ?? i}>
                <details open className="group px-4 py-3">
                  <summary className="flex cursor-pointer list-none items-start gap-3">
                    {!c.label && <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">{i + 1}</span>}
                    <span className="flex-1">
                      {c.label && <span className="block text-[11px] font-bold uppercase tracking-wider text-brand-600">{c.label}</span>}
                      <span className="block font-semibold text-slate-800">{c.title}</span>
                    </span>
                    <span aria-hidden="true" className="text-slate-400 transition group-open:rotate-90">
                      ›
                    </span>
                  </summary>
                  <div className={`mt-2 text-sm text-slate-700 ${c.label ? '' : 'pl-9'}`}>
                    {c.summary ? <RichText text={c.summary} /> : <p>{t('school.summary_soon')}</p>}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}
      </section>
      )}

      {closing && <RichText text={closing} headings comfort className="text-[15px] leading-relaxed text-slate-700" data-testid="book-closing" />}
    </div>
  );
}
