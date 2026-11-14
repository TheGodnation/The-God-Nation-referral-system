import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { BookCover } from '../components/learn/BookCover';
import { BookCoverViewer } from '../components/learn/BookCoverViewer';
import { BookPageBody } from '../components/learn/BookPageBody';
import { PayBookPanel, PayManyPanel } from '../components/learn/TrainingPayments';
import { WaitingOrderLink } from '../components/learn/PayWithAgent';
import { BookStatusLines, SchoolBook, SchoolSummary, TrainingStatusCard, useTr } from '../components/learn/schoolBits';
import { ApiError } from '../lib/api';
import { cachedGet } from '../lib/cachedGet';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { bookKey, getInfo } from '../lib/offlineStore';
import { useStoreApp } from '../lib/storeApp';

interface Chapter {
  id: string;
  order: number;
  labelEn: string | null;
  labelFr: string | null;
  titleEn: string;
  titleFr: string | null;
  summaryEn: string | null;
  summaryFr: string | null;
}

type BookPage = SchoolSummary & {
  book: SchoolBook & { closingEn?: string | null; closingFr?: string | null; chaptersHeadingEn?: string | null; chaptersHeadingFr?: string | null };
  chapters: Chapter[];
};

// One Leadership Academy book: its cover, what it teaches chapter by
// chapter (shown before it opens too), and — once open — Read, the exam
// (one try) and paying for it.
export function MemberSchoolBookPage() {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const store = useStoreApp();
  const { bookId = '' } = useParams();
  const [data, setData] = useState<BookPage | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'notFound' | 'failed'>('loading');
  const [fromCache, setFromCache] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
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
  // The cover picture in the app's language (the French one when the app is in French), if the book has one.
  const coverUrl = b ? (b.coverUrlFr && i18n.language?.startsWith('fr') ? b.coverUrlFr : b.coverUrl) ?? null : null;

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

        {data && b && coverOpen && coverUrl && (
          <BookCoverViewer
            url={coverUrl}
            alt={t('school.cover_alt', { number: b.trainingOrder, title })}
            onClose={() => setCoverOpen(false)}
            readHref={b.unlocked && b.canRead ? `/member/read/${b.id}` : undefined}
            readLabel={b.unlocked && b.canRead ? (b.lastPage && b.lastPage > 1 ? t('school.continue_reading', { page: b.lastPage }) : t('school.read_book')) : undefined}
          />
        )}

        {data && b && (
          <div className="space-y-5">
            <div className="flex gap-4">
              <div className="w-28 shrink-0 sm:w-36">
                {coverUrl ? (
                  // Tap the cover to see it big, like a profile photo.
                  <button type="button" onClick={() => setCoverOpen(true)} aria-label={t('school.cover_enlarge') ?? ''} className="block w-full text-left" data-testid="open-cover">
                    <BookCover number={b.trainingOrder} title={title} coverUrl={b.coverUrl ?? null} coverUrlFr={b.coverUrlFr ?? null} />
                    <span className="mt-1 block text-center text-[11px] text-slate-500">🔍 {t('school.cover_enlarge')}</span>
                  </button>
                ) : (
                  <BookCover number={b.trainingOrder} title={title} coverUrl={null} />
                )}
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{t('learn.book', { number: b.trainingOrder })}</p>
                <h1 className="text-xl font-bold leading-snug text-brand-900">{title}</h1>
                <p className="text-sm text-slate-500">
                  {[
                    b.pageCount ? t('school.pages', { count: b.pageCount }) : null,
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
                {!store && b.payment === 'CLAIMED' && !fromCache && <WaitingOrderLink bookId={b.id} />}
                {!store && !b.payment && !fromCache && (data.payableCount ?? 0) > 1 && (
                  <PayManyPanel
                    price={data.price ?? 1200}
                    owedBooks={data.owed?.books ?? 0}
                    payable={data.payableCount ?? 0}
                    instructions={tr(data.paymentInstructionsEn ?? '', data.paymentInstructionsFr) || null}
                    onDone={load}
                  />
                )}
                {!store && !b.payment && !fromCache && (
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

            {/* What the student becomes after reading this book: one short description per book (the Academy page carries the introduction). */}
            {description && <BookPageBody hideEmpty description={description} chapters={[]} />}
          </div>
        )}
        <MemberNav />
      </section>
    </PageShell>
  );
}
