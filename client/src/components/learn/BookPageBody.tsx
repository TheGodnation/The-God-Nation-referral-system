import { useTranslation } from 'react-i18next';
import { RichText } from '../../lib/richText';

export interface BookPageChapter {
  id?: string;
  label?: string | null;
  title: string;
  summary: string;
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
}: {
  description?: string;
  chaptersHeading?: string;
  chapters: BookPageChapter[];
  closing?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6" data-testid="book-page-body">
      {description && <RichText text={description} headings comfort className="text-[15px] leading-relaxed text-slate-700 [&_em]:text-slate-500" data-testid="book-description" />}

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

      {closing && <RichText text={closing} headings comfort className="text-[15px] leading-relaxed text-slate-700" data-testid="book-closing" />}
    </div>
  );
}
