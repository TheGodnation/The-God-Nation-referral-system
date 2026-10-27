import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { BookCover } from '../components/learn/BookCover';
import { SCHOOL_BOOK_COUNT, SchoolSummary, TrainingStatusCard, currentBook, useTr } from '../components/learn/schoolBits';
import { cachedGet } from '../lib/cachedGet';
import { useMemberAuth } from '../lib/MemberAuthContext';

// The God Nation Leadership School: the 15 leadership books as covers, in
// order, each showing whether it is passed, open or still closed. Tapping a
// book opens its page (chapter summaries, Read, Exam, payment). Numbers the
// admin hasn't added yet show as "Coming soon".
export function MemberSchoolPage() {
  const { t } = useTranslation();
  const tr = useTr();
  const [data, setData] = useState<SchoolSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const { member } = useMemberAuth();

  function load() {
    cachedGet<SchoolSummary>('/api/member/school', `school:${member?.personId ?? ''}`)
      .then((r) => {
        setData(r.data);
        setFromCache(r.fromCache);
      })
      .catch(() => setError(t('learn.load_failed')));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const total = Math.max(SCHOOL_BOOK_COUNT, data?.books.length ?? 0);
  const byNumber = new Map((data?.books ?? []).map((b) => [b.trainingOrder, b]));
  const numbers = Array.from({ length: Math.max(total, ...(data?.books ?? []).map((b) => b.trainingOrder)) }, (_, i) => i + 1);
  const passed = (data?.books ?? []).filter((b) => b.exam?.passed).length;
  const current = data?.enrollment === 'ACTIVE' ? currentBook(data.books) : null;

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <Link to="/member/learn" className="text-sm text-brand-700 hover:underline">
            ← {t('school.back_to_learn')}
          </Link>
          <span className="flex items-center gap-3">
            <Link to="/member/downloads" className="text-sm text-brand-700 hover:underline">
              📥 {t('downloads.title')}
            </Link>
            <NotificationBell />
          </span>
        </div>

        <div className="mb-5 rounded-2xl bg-gradient-to-br from-brand-700 via-brand-800 to-brand-950 p-5 text-white shadow">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">🎓 {t('learn.training_heading')}</p>
          <h1 className="mt-1 text-2xl font-bold leading-tight">{t('school.title')}</h1>
          <p className="mt-2 text-sm text-brand-100">{t('school.intro', { count: total })}</p>
          {data?.enrollment === 'ACTIVE' && <p className="mt-3 text-sm font-semibold">{t('school.progress', { passed, total })}</p>}
        </div>

        {fromCache && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">📶 {t('school.offline_saved')}</p>}
        {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
        {!data && !error && <p className="text-center text-slate-400">{t('learn.loading')}</p>}

        {data && (
          <div className="space-y-5">
            <ol className="grid gap-2 text-sm sm:grid-cols-3" aria-label={t('school.how_heading') ?? ''}>
              {[t('school.step_read'), t('school.step_exam'), t('school.step_pay', { price: (data.price ?? 1200).toLocaleString('fr-FR') })].map((text, i) => (
                <li key={i} className="flex gap-2 rounded-lg bg-white p-3 shadow-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-800">{i + 1}</span>
                  <span className="text-slate-700">{text}</span>
                </li>
              ))}
            </ol>

            <TrainingStatusCard summary={data} onChanged={load} />

            {current && (
              <Link to={`/member/school/${current.id}`} className="card flex items-center gap-3 hover:bg-brand-50">
                <span className="w-12 shrink-0" aria-hidden="true">
                  <BookCover compact number={current.trainingOrder} title={tr(current.titleEn, current.titleFr)} coverUrl={current.coverUrl ?? null} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold uppercase tracking-wide text-brand-700">{t('school.continue')}</span>
                  <span className="block truncate font-semibold text-slate-800">
                    {t('learn.book', { number: current.trainingOrder })}: {tr(current.titleEn, current.titleFr)}
                  </span>
                </span>
                <span aria-hidden="true" className="text-xl text-brand-700">
                  ›
                </span>
              </Link>
            )}

            <section>
              <h2 className="mb-3 text-lg font-semibold text-brand-900">{t('school.books_heading')}</h2>
              <ul className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4">
                {numbers.map((number) => {
                  const b = byNumber.get(number);
                  if (!b) {
                    return (
                      <li key={`soon-${number}`} className="opacity-60">
                        <BookCover number={number} title={t('school.coming_soon')} coverUrl={null} />
                        <p className="mt-1 text-xs font-semibold text-slate-600">{t('learn.book', { number })}</p>
                      </li>
                    );
                  }
                  const title = tr(b.titleEn, b.titleFr);
                  const badge = b.exam?.passed
                    ? { text: `✓ ${t('school.badge_passed')}`, cls: 'bg-green-600 text-white' }
                    : b.unlocked
                      ? { text: t('school.badge_open'), cls: 'bg-amber-400 text-amber-950' }
                      : { text: `🔒 ${t('school.badge_locked')}`, cls: 'bg-slate-200 text-slate-700' };
                  return (
                    <li key={b.id}>
                      <Link to={`/member/school/${b.id}`} className="group block" aria-label={`${t('learn.book', { number })}: ${title} — ${badge.text}`}>
                        <span className={`block ${b.unlocked ? '' : 'grayscale-[60%]'}`}>
                          <BookCover number={number} title={title} coverUrl={b.coverUrl ?? null} className="transition group-hover:-translate-y-0.5" />
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1">
                          <span className="text-xs font-semibold text-brand-800">{t('learn.book', { number })}</span>
                          <span className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${badge.cls}`}>{badge.text}</span>
                        </span>
                        <span className="line-clamp-2 block text-xs text-slate-700">{title}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          </div>
        )}
        <MemberNav />
      </section>
    </PageShell>
  );
}
