import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { BookCover } from '../components/learn/BookCover';
import { PayBookPanel } from '../components/learn/TrainingPayments';
import { WaitingOrderLink } from '../components/learn/PayWithAgent';
import { BookStatusLines, SchoolBook, SchoolSummary, TrainingStatusCard, useTr } from '../components/learn/schoolBits';
import { ApiError } from '../lib/api';
import { cachedGet } from '../lib/cachedGet';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { bookKey, getInfo } from '../lib/offlineStore';

interface Chapter {
  id: string;
  order: number;
  titleEn: string;
  titleFr: string | null;
  summaryEn: string | null;
  summaryFr: string | null;
}

type BookPage = SchoolSummary & { book: SchoolBook; chapters: Chapter[] };

// One Leadership School book: its cover, what it teaches chapter by
// chapter (shown before it opens too), and — once open — Read, the exam
// (one try) and paying for it.
export function MemberSchoolBookPage() {
  const { t } = useTranslation();
  const tr = useTr();
  const { bookId = '' } = useParams();
  const [data, setData] = useState<BookPage | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notFound' | 'failed'>('loading');
  const [fromCache, setFromCache] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const { member } = useMemberAuth();
  const ownerId = member?.personId ?? '';

  function load() {
    cachedGet<BookPage>(`/api/member/school/books/${bookId}`, `school-book:${ownerId}:${bookId}`)
      .then((r) => {
        setData(r.data);
        setFromCache(r.fromCache);
        setStatus('ready');
      })
      .catch((err) => setStatus(err instanceof ApiError && err.status === 404 ? 'notFound' : 'failed'));
    if (ownerId) getInfo(bookKey(ownerId, bookId)).then((i) => setDownloaded(Boolean(i)));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [bookId]);

  const b = data?.book;
  const title = b ? tr(b.titleEn, b.titleFr) : '';
  const description = b ? tr(b.descriptionEn ?? '', b.descriptionFr) : '';

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <Link to="/member/school" className="text-sm text-brand-700 hover:underline">
            ← {t('school.title')}
          </Link>
          <NotificationBell />
        </div>
        {fromCache && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">📶 {t('school.offline_saved')}</p>}
        {status === 'loading' && <p className="text-center text-slate-400">{t('learn.loading')}</p>}
        {status === 'notFound' && <p className="card text-center text-slate-600">{t('school.not_found')}</p>}
        {status === 'failed' && <p className="text-sm text-red-700">{t('learn.load_failed')}</p>}

        {data && b && (
          <div className="space-y-5">
            <div className="flex gap-4">
              <div className="w-28 shrink-0 sm:w-36">
                <BookCover number={b.trainingOrder} title={title} coverUrl={b.coverUrl ?? null} />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{t('learn.book', { number: b.trainingOrder })}</p>
                <h1 className="text-xl font-bold leading-snug text-brand-900">{title}</h1>
                <p className="text-sm text-slate-500">
                  {[
                    b.pageCount ? t('school.pages', { count: b.pageCount }) : null,
                    b.chapterCount ? t('school.chapters', { count: b.chapterCount }) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="text-sm">
                  {b.unlocked ? <span className="block font-medium text-green-700">{t('school.open_for_you')}</span> : <span className="block font-medium text-slate-600">🔒 {t('school.badge_locked')}</span>}
                  <BookStatusLines book={b} />
                </p>
              </div>
            </div>

            {description && <p className="whitespace-pre-wrap text-slate-700">{description}</p>}

            {b.unlocked ? (
              <div className="card space-y-3">
                <div className="flex flex-wrap gap-2">
                  {b.canRead ? (
                    <Link to={`/member/read/${b.id}`} className="btn-primary">
                      📖 {b.lastPage && b.lastPage > 1 ? t('school.continue_reading', { page: b.lastPage }) : t('school.read_book')}
                    </Link>
                  ) : (
                    <p className="text-sm text-slate-600">{t('school.book_coming')}</p>
                  )}
                  {b.exam && (
                    <Link to={`/member/assessments/${b.exam.id}`} className="btn-secondary">
                      {b.exam.passed ? t('learn.see_results') : t('reader.take_exam')}
                    </Link>
                  )}
                </div>
                {b.canRead && <p className="text-xs text-slate-500">{downloaded ? `✓ ${t('school.downloaded')}` : t('school.downloads_first_time')}</p>}
                {b.payment === 'CLAIMED' && !fromCache && <WaitingOrderLink bookId={b.id} />}
                {!b.payment && !fromCache && (
                  <PayBookPanel
                    bookId={b.id}
                    bookNumber={b.trainingOrder}
                    price={data.price ?? 1200}
                    instructions={tr(data.paymentInstructionsEn ?? '', data.paymentInstructionsFr) || null}
                    automatic={Boolean(data.automaticPayments)}
                    onDone={load}
                  />
                )}
              </div>
            ) : (
              b.lockedBecause === 'NOT_STARTED' && <TrainingStatusCard summary={data} onChanged={load} />
            )}

            <section>
              <h2 className="mb-2 text-lg font-semibold text-brand-900">{t('school.chapters_heading')}</h2>
              {data.chapters.length === 0 ? (
                <p className="card text-sm text-slate-500">{t('school.chapters_soon')}</p>
              ) : (
                <ol className="card divide-y divide-slate-100 p-0">
                  {data.chapters.map((c, i) => {
                    const summary = tr(c.summaryEn ?? '', c.summaryFr);
                    return (
                      <li key={c.id}>
                        <details open={i === 0} className="group px-4 py-3">
                          <summary className="flex cursor-pointer list-none items-start gap-3">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">{i + 1}</span>
                            <span className="flex-1 font-semibold text-slate-800">{tr(c.titleEn, c.titleFr)}</span>
                            <span aria-hidden="true" className="text-slate-400 transition group-open:rotate-90">
                              ›
                            </span>
                          </summary>
                          <p className="mt-2 whitespace-pre-wrap pl-9 text-sm text-slate-700">{summary || t('school.summary_soon')}</p>
                        </details>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        )}
        <MemberNav />
      </section>
    </PageShell>
  );
}
