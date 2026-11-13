import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { BookCover } from '../components/learn/BookCover';
import { SchoolBook, SchoolSummary, TrainingStatusCard, currentBook, useTr } from '../components/learn/schoolBits';
import { cachedGet } from '../lib/cachedGet';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { useStoreApp } from '../lib/storeApp';
import { RichText } from '../lib/richText';
import { prepareIntro, splitIntro } from '../lib/curriculumText';

// The God Nation Leadership Academy: the introduction to the diploma, then the books level by level, each
// showing whether it is passed, open or still closed. Someone who has not begun reads everything first and begins at
// the end; someone studying sees their progress and the book to carry on with first, and the introduction folded below.
// Tapping a book opens its page (Read, Exam, payment). The levels and the order of the books are arranged by the admin.
export function MemberSchoolPage() {
  const { t } = useTranslation();
  const store = useStoreApp();
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

  const books = data?.books ?? [];
  const total = books.length;
  const passed = books.filter((b) => b.exam?.passed).length;
  const studying = data?.enrollment === 'ACTIVE';
  const current = studying ? currentBook(books) : null;

  // The books grouped by level, in order; books with no level come last, under no heading.
  const levels = data?.levels ?? [];
  const groups: { id: string; level: (typeof levels)[number] | null; books: SchoolBook[] }[] = levels
    .map((l) => ({ id: l.id, level: l, books: books.filter((b) => b.levelId === l.id) }))
    .filter((g) => g.books.length > 0);
  const known = new Set(levels.map((l) => l.id));
  const loose = books.filter((b) => !b.levelId || !known.has(b.levelId));
  if (loose.length > 0) groups.push({ id: 'none', level: null, books: loose });

  const introRaw = data?.intro ? tr(data.intro.en, data.intro.fr) : '';
  const introText = introRaw ? prepareIntro(introRaw, { store, books: total, levels: levels.length, price: data?.price ?? 1200 }) : '';
  const { before, after } = splitIntro(introText);

  const booksSection = (
    <div className="space-y-6" data-testid="academy-levels">
      {groups.map((g) => (
        <section key={g.id} data-testid="academy-level">
          {g.level && (
            <div className="mb-3">
              <h2 className="text-lg font-semibold text-brand-900">{tr(g.level.titleEn, g.level.titleFr)}</h2>
              {(g.level.summaryEn || g.level.summaryFr) && <p className="text-sm text-slate-600">{tr(g.level.summaryEn ?? '', g.level.summaryFr)}</p>}
            </div>
          )}
          <ul className="grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-4">
            {g.books.map((b) => {
              const number = b.trainingOrder;
              const title = tr(b.titleEn, b.titleFr);
              const badge = b.exam?.passed
                ? { text: `✓ ${t('school.badge_passed')}`, cls: 'bg-green-600 text-white' }
                : b.unlocked
                  ? { text: t('school.badge_open'), cls: 'bg-amber-400 text-amber-950' }
                  : { text: `🔒 ${t('school.badge_locked')}`, cls: 'bg-slate-200 text-slate-700' };
              return (
                <li key={b.id}>
                  <Link to={`/member/school/${b.id}`} className="group block" aria-label={`${t('learn.book', { number })}: ${title} — ${badge.text}`}>
                    {/* Every book shows in its own colours; the badge below says whether it is open or locked. */}
                    <BookCover number={number} title={title} coverUrl={b.coverUrl ?? null} coverUrlFr={b.coverUrlFr ?? null} className="transition group-hover:-translate-y-0.5" />
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
      ))}
    </div>
  );

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
          <p className="mt-2 text-sm text-brand-100">{t('school.subtitle')}</p>
          {studying && <p className="mt-3 text-sm font-semibold">{t('school.progress', { passed, total })}</p>}
        </div>

        {fromCache && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">📶 {t('school.offline_saved')}</p>}
        {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
        {!data && !error && <p className="text-center text-slate-400">{t('learn.loading')}</p>}

        {data && studying && (
          <div className="space-y-5">
            <TrainingStatusCard summary={data} onChanged={load} />

            {current && (
              <Link to={`/member/school/${current.id}`} className="card flex items-center gap-3 hover:bg-brand-50">
                <span className="w-12 shrink-0" aria-hidden="true">
                  <BookCover compact number={current.trainingOrder} title={tr(current.titleEn, current.titleFr)} coverUrl={current.coverUrl ?? null} coverUrlFr={current.coverUrlFr ?? null} />
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

            {booksSection}

            {introText && (
              <details className="card" data-testid="academy-intro-folded">
                <summary className="cursor-pointer font-semibold text-brand-900">{t('school.read_intro')}</summary>
                <RichText text={introText.replace(/^\s*\[\[books\]\]\s*$/m, '')} headings comfort className="mt-3 text-sm text-slate-800" />
              </details>
            )}
          </div>
        )}

        {data && !studying && (
          <div className="space-y-6">
            {before && <RichText text={before} headings comfort className="text-sm text-slate-800" data-testid="academy-intro-before" />}
            {booksSection}
            {after && <RichText text={after} headings comfort className="text-sm text-slate-800" data-testid="academy-intro-after" />}
            <TrainingStatusCard summary={data} onChanged={load} />
          </div>
        )}
        <MemberNav />
      </section>
    </PageShell>
  );
}
