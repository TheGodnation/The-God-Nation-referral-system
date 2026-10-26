import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { BookCover } from '../components/learn/BookCover';
import { PayPromptCard, SCHOOL_BOOK_COUNT, SchoolSummary } from '../components/learn/schoolBits';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { api, ApiError } from '../lib/api';

interface WeeklyExam {
  id: string;
  weekNumber: number;
  titleEn: string;
  titleFr: string | null;
  passMark: number;
  open: boolean;
  firstScore: number | null;
  firstPassed: boolean | null;
  tries: number;
}

interface DevotionalRow {
  id: string;
  titleEn: string;
  titleFr: string | null;
  descriptionEn: string | null;
  descriptionFr: string | null;
  startDate: string;
  endDate: string;
  bookId: string | null;
  iGaveOffering: boolean;
  exams: WeeklyExam[];
}

interface ExamWorld {
  offering: { instructionsEn: string | null; instructionsFr: string | null };
  devotionals: DevotionalRow[];
  training: SchoolSummary;
}

function OfferingBox({ devotional, instructions, onGiven }: { devotional: DevotionalRow; instructions: string | null; onGiven: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(devotional.iGaveOffering);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = amount.trim() ? Number(amount.replace(/\s/g, '')) : undefined;
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      setError(t('learn.offering_bad_amount'));
      return;
    }
    try {
      await api.post(`/api/member/devotionals/${devotional.id}/offering`, value !== undefined ? { amount: value } : {});
      setDone(true);
      setOpen(false);
      onGiven();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('learn.failed'));
    }
  }

  if (!instructions) return null;
  return (
    <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">🙏 {t('learn.offering_title')}</p>
      <p className="mt-1 whitespace-pre-wrap">{instructions}</p>
      <p className="mt-1 text-xs text-amber-800">{t('learn.offering_optional')}</p>
      {done && !open ? (
        <p className="mt-2 font-medium text-green-800">✓ {t('learn.offering_thanks')}</p>
      ) : null}
      {!open ? (
        <button type="button" className="mt-2 underline" onClick={() => setOpen(true)}>
          {done ? t('learn.offering_again') : t('learn.offering_i_gave')}
        </button>
      ) : (
        <form onSubmit={submit} className="mt-2 flex flex-wrap items-center gap-2">
          <input
            className="input w-40"
            inputMode="numeric"
            aria-label={t('learn.offering_amount_label') ?? ''}
            placeholder={t('learn.offering_amount_placeholder') ?? ''}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <button type="submit" className="btn-primary px-3 py-1.5 text-sm">
            {t('learn.offering_confirm')}
          </button>
        </form>
      )}
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}

// "Learn" for members: Exam World. This month's devotional (read it in the
// app, free-will offering, Week 1-4 exams with the first-try score), and
// the way into the Leadership School (15 books opened one after another,
// see MemberSchoolPage).
export function MemberLearnPage() {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const [data, setData] = useState<ExamWorld | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<ExamWorld>('/api/member/exam-world')
      .then(setData)
      .catch(() => setError(t('learn.load_failed')));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  const tr = (en: string, fr: string | null) => (isFr ? fr || en : en);
  const instructions = data ? (isFr ? data.offering.instructionsFr || data.offering.instructionsEn : data.offering.instructionsEn) : null;

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-brand-900">{t('learn.title')}</h1>
          <NotificationBell />
        </div>
        {error && <p className="mb-4 text-sm text-red-700">{error}</p>}
        {!data && !error && <p className="text-center text-slate-400">{t('learn.loading')}</p>}

        {data && (
          <div className="space-y-6">
            <section className="space-y-4">
              <h2 className="text-lg font-semibold text-brand-900">📖 {t('learn.devotional_heading')}</h2>
              {data.devotionals.length === 0 && <p className="card text-sm text-slate-500">{t('learn.no_devotional')}</p>}
              {data.devotionals.map((d, index) => (
                <article key={d.id} className="card space-y-3" aria-label={tr(d.titleEn, d.titleFr)}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-800">{tr(d.titleEn, d.titleFr)}</h3>
                      {(isFr ? d.descriptionFr || d.descriptionEn : d.descriptionEn) && (
                        <p className="text-sm text-slate-600">{tr(d.descriptionEn ?? '', d.descriptionFr)}</p>
                      )}
                    </div>
                    {d.bookId && (
                      <Link to={`/member/read/${d.bookId}`} className="btn-primary px-3 py-1.5 text-sm">
                        {t('learn.read')}
                      </Link>
                    )}
                  </div>

                  {index === 0 && <OfferingBox devotional={d} instructions={instructions} onGiven={() => {}} />}

                  <div>
                    <h4 className="mb-2 text-sm font-semibold text-slate-700">{t('learn.weekly_exams')}</h4>
                    {d.exams.length === 0 ? (
                      <p className="text-sm text-slate-500">{t('learn.no_exams_yet')}</p>
                    ) : (
                      <ul className="divide-y divide-slate-100">
                        {d.exams.map((e) => (
                          <li key={e.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                            <span>{t('learn.week', { number: e.weekNumber })}</span>
                            <span className="flex items-center gap-3">
                              {e.firstScore !== null ? (
                                <span className={e.firstPassed ? 'font-semibold text-green-700' : 'font-semibold text-red-700'}>
                                  {Math.round(e.firstScore)}%
                                </span>
                              ) : !e.open ? (
                                <span className="text-slate-400">{t('learn.closed')}</span>
                              ) : null}
                              <Link to={`/member/assessments/${e.id}`} className="text-brand-700 underline">
                                {e.firstScore !== null ? t('learn.see_results') : e.open ? t('learn.take_exam') : t('learn.view')}
                              </Link>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </article>
              ))}
            </section>

            <PayPromptCard summary={data.training} />
            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-brand-900">🎓 {t('learn.training_heading')}</h2>
              <Link to="/member/school" className="card block space-y-3 hover:bg-brand-50">
                <span className="flex gap-2" aria-hidden="true">
                  {data.training.books.slice(0, 5).map((b) => (
                    <span key={b.id} className="w-12">
                      <BookCover compact number={b.trainingOrder} title={tr(b.titleEn, b.titleFr)} coverUrl={b.coverUrl ?? null} />
                    </span>
                  ))}
                </span>
                <span className="block font-semibold text-brand-900">{t('school.title')}</span>
                <span className="block text-sm text-slate-700">
                  {data.training.enrollment === 'ACTIVE'
                    ? t('school.progress', { passed: data.training.books.filter((b) => b.exam?.passed).length, total: Math.max(SCHOOL_BOOK_COUNT, data.training.books.length) })
                    : data.training.enrollment === 'REVOKED'
                      ? t('learn.training_stopped')
                      : t('school.teaser', { count: Math.max(SCHOOL_BOOK_COUNT, data.training.books.length) })}
                </span>
                <span className="btn-primary inline-block">{t('school.open')}</span>
              </Link>
            </section>
          </div>
        )}
        <MemberNav />
      </section>
    </PageShell>
  );
}
