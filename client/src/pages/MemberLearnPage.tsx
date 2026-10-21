import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { GraceBox, PayBookPanel } from '../components/learn/TrainingPayments';
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

interface TrainingBook {
  id: string;
  trainingOrder: number;
  titleEn: string;
  titleFr: string | null;
  descriptionEn: string | null;
  descriptionFr: string | null;
  unlocked: boolean;
  canRead: boolean;
  payment?: 'PAID' | 'CLAIMED' | 'PENDING' | null;
  lockedBecause?: 'NOT_STARTED' | 'PREVIOUS_EXAM' | 'PAYMENT' | null;
  exam: {
    id: string;
    passMark: number;
    bestPercentage: number | null;
    passed: boolean;
    tries?: number;
    canStart?: boolean;
    block?: 'PASSED' | 'NO_QUESTIONS' | 'NEEDS_RETAKE' | 'RETAKE_REQUESTED' | 'RETAKE_DECLINED' | 'NO_NEW_QUESTIONS' | null;
  } | null;
}

interface ExamWorld {
  offering: { instructionsEn: string | null; instructionsFr: string | null };
  devotionals: DevotionalRow[];
  training: {
    enrollment: 'NONE' | 'REQUESTED' | 'ACTIVE' | 'REVOKED';
    books: TrainingBook[];
    price?: number;
    owed?: { books: number; amount: number };
    graceBooks?: number;
    maxGraceBooks?: number;
    graceRequest?: { status: 'REQUESTED' | 'GRANTED' | 'DECLINED'; books: number } | null;
    paymentInstructionsEn?: string | null;
    paymentInstructionsFr?: string | null;
    automaticPayments?: boolean;
  };
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
// leadership training (15 books opened one after another).
export function MemberLearnPage() {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const [data, setData] = useState<ExamWorld | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  function load() {
    api
      .get<ExamWorld>('/api/member/exam-world')
      .then(setData)
      .catch(() => setError(t('learn.load_failed')));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  async function requestTraining() {
    setRequesting(true);
    try {
      await api.post('/api/member/training/request');
      load();
    } catch {
      setError(t('learn.failed'));
    } finally {
      setRequesting(false);
    }
  }

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

            <section className="space-y-3">
              <h2 className="text-lg font-semibold text-brand-900">🎓 {t('learn.training_heading')}</h2>
              {data.training.enrollment !== 'ACTIVE' && (
                <div className="card space-y-2 text-sm">
                  <p className="text-slate-700">{t('learn.training_intro', { count: data.training.books.length || 15 })}</p>
                  <p className="text-slate-700">{t('learn.training_payment_rule', { price: (data.training.price ?? 1100).toLocaleString('fr-FR') })}</p>
                  {data.training.enrollment === 'REVOKED' ? (
                    <p className="font-medium text-amber-800">{t('learn.training_stopped')}</p>
                  ) : (
                    <button type="button" className="btn-primary" disabled={requesting} onClick={requestTraining}>
                      {t('learn.training_begin')}
                    </button>
                  )}
                </div>
              )}
              {data.training.enrollment === 'ACTIVE' && (
                <div className="card space-y-2 text-sm">
                  {(data.training.owed?.books ?? 0) > 0 ? (
                    <p className="font-medium text-slate-800">
                      {t('learn.owed', { count: data.training.owed!.books, amount: data.training.owed!.amount.toLocaleString('fr-FR') })}
                    </p>
                  ) : (
                    <p className="font-medium text-green-700">{t('learn.all_paid')}</p>
                  )}
                  <GraceBox
                    graceBooks={data.training.graceBooks ?? 0}
                    maxGraceBooks={data.training.maxGraceBooks ?? 5}
                    request={data.training.graceRequest ?? null}
                    onDone={load}
                  />
                </div>
              )}
              {data.training.books.length > 0 && (
                <ul className="card divide-y divide-slate-100 p-0">
                  {data.training.books.map((b) => (
                    <li key={b.id} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm ${b.unlocked ? '' : 'opacity-60'}`}>
                      <span className="min-w-0">
                        <span className="block font-semibold text-slate-800">
                          {b.unlocked ? '' : '🔒 '}
                          {t('learn.book', { number: b.trainingOrder })}: {tr(b.titleEn, b.titleFr)}
                        </span>
                        {b.exam?.passed && <span className="text-green-700">✓ {t('learn.passed_with', { score: Math.round(b.exam.bestPercentage ?? 0) })}</span>}
                        {b.exam && !b.exam.passed && b.exam.bestPercentage !== null && (
                          <span className="text-red-700">{t('learn.best_score', { score: Math.round(b.exam.bestPercentage), passMark: b.exam.passMark })}</span>
                        )}
                        {b.exam && (b.exam.block === 'NEEDS_RETAKE' || b.exam.block === 'RETAKE_DECLINED') && (
                          <span className="text-amber-800">{t('learn.exam_retake_needed')}</span>
                        )}
                        {b.exam?.block === 'RETAKE_REQUESTED' && <span className="text-amber-800">{t('learn.exam_retake_requested')}</span>}
                        {b.exam && !b.exam.passed && (b.exam.tries ?? 0) > 0 && b.exam.canStart && (
                          <span className="text-green-700">{t('learn.exam_retake_granted')}</span>
                        )}
                        {b.unlocked && b.payment === 'PAID' && <span className="block text-green-700">✓ {t('learn.paid')}</span>}
                        {b.unlocked && (b.payment === 'CLAIMED' || b.payment === 'PENDING') && (
                          <span className="block text-amber-800">{t('learn.payment_waiting')}</span>
                        )}
                        {!b.unlocked && b.lockedBecause === 'PREVIOUS_EXAM' && (
                          <span className="block text-slate-600">{t('learn.locked_exam', { number: b.trainingOrder - 1 })}</span>
                        )}
                        {!b.unlocked && b.lockedBecause === 'PAYMENT' && (
                          <span className="block text-slate-600">{t('learn.locked_payment', { number: b.trainingOrder - 1 })}</span>
                        )}
                      </span>
                      {b.unlocked && (
                        <span className="flex shrink-0 gap-2">
                          {b.canRead && (
                            <Link to={`/member/read/${b.id}`} className="btn-secondary px-3 py-1.5">
                              {t('learn.read')}
                            </Link>
                          )}
                          {b.exam && (
                            <Link to={`/member/assessments/${b.exam.id}`} className="btn-primary px-3 py-1.5">
                              {t('learn.exam')}
                            </Link>
                          )}
                        </span>
                      )}
                      {b.unlocked && !b.payment && (
                        <PayBookPanel
                          bookId={b.id}
                          bookNumber={b.trainingOrder}
                          price={data.training.price ?? 1100}
                          instructions={tr(data.training.paymentInstructionsEn ?? '', data.training.paymentInstructionsFr ?? null) || null}
                          automatic={Boolean(data.training.automaticPayments)}
                          onDone={load}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
        <MemberNav />
      </section>
    </PageShell>
  );
}
