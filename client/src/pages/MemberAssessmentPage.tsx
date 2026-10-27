import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';

const BACK_AFTER_SECONDS = 8;

interface AssessmentInfo {
  id: string;
  titleEn: string;
  titleFr: string | null;
  passMark: number;
  maxAttempts: number | null;
  // Exam World: weekly devotional exams count only the first try; a
  // weekly exam closes when its devotional ends.
  firstTryCounts?: boolean;
  open?: boolean;
  // A teaching's quiz: back goes to the teaching (and its results list).
  teaching?: { id: string; title: string } | null;
  // Leadership book exams: one try; a retake must be asked for, and gets
  // a different set of questions (server: lib/trainingExam.ts).
  training?: TrainingState | null;
}

type TrainingBlock = 'PASSED' | 'NO_QUESTIONS' | 'NEEDS_RETAKE' | 'RETAKE_REQUESTED' | 'RETAKE_DECLINED' | 'NO_NEW_QUESTIONS';

interface TrainingState {
  inProgressAttemptId: string | null;
  submittedTries: number;
  passed: boolean;
  retakeGranted: boolean;
  canStart: boolean;
  block: TrainingBlock | null;
}

// Answers chosen so far are kept on the phone, so closing the app or
// losing the connection mid-exam doesn't lose them.
const savedKey = (attemptId: string) => `exam-answers:${attemptId}`;
function readSaved(attemptId: string): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(savedKey(attemptId)) || '{}') as Record<string, string>;
  } catch {
    return {};
  }
}
function writeSaved(attemptId: string, value: Record<string, string> | null) {
  try {
    if (value) localStorage.setItem(savedKey(attemptId), JSON.stringify(value));
    else localStorage.removeItem(savedKey(attemptId));
  } catch {
    /* not saved — the exam still works */
  }
}

interface ReviewQuestion {
  id: string;
  textEn: string;
  textFr: string | null;
  options: { id: string; textEn: string; textFr: string | null; isCorrect?: boolean }[];
  selectedOptionId: string | null;
  wasCorrect: boolean | null;
}

interface AttemptSummary {
  id: string;
  attemptNumber: number;
  status: 'IN_PROGRESS' | 'SUBMITTED';
  score: number | null;
  maxScore: number | null;
  percentage: number | null;
  passed: boolean | null;
  submittedAt: string | null;
  /** Present after passing a leadership book while books are still to be paid for. */
  payPrompt?: { bookNumber: number; payableCount: number; nextWaitsForPayment: boolean };
}

interface TakingQuestion {
  id: string;
  textEn: string;
  textFr: string | null;
  points: number;
  options: { id: string; textEn: string; textFr: string | null }[];
}

export function MemberAssessmentPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const isFr = i18n.language.startsWith('fr');

  const [assessment, setAssessment] = useState<AssessmentInfo | null>(null);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<TakingQuestion[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [lastResult, setLastResult] = useState<AttemptSummary | null>(null);
  const navigate = useNavigate();
  // After a teaching's quiz, the member is taken back to the teaching (where the
  // list of who has finished is) after a few seconds, unless they choose to stay
  // and read the correct answers first.
  const [backIn, setBackIn] = useState<number | null>(null);
  const [review, setReview] = useState<ReviewQuestion[] | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [requesting, setRequesting] = useState(false);

  function load() {
    if (!id) return;
    Promise.all([
      api.get<AssessmentInfo>(`/api/member/assessments/${id}`),
      api.get<{ items: AttemptSummary[] }>(`/api/member/assessments/${id}/my-attempts`),
    ])
      .then(([a, hist]) => {
        setAssessment(a);
        setAttempts(hist.items);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
      })
      .finally(() => setLoaded(true));
  }

  useEffect(load, [id]);

  // An IN_PROGRESS attempt already counts toward maxAttempts on the server,
  // but it must always be resumable regardless of the limit — only a fully
  // SUBMITTED count at the limit should block starting something new.
  const hasInProgressAttempt = attempts.some((a) => a.status === 'IN_PROGRESS');
  const submittedCount = attempts.filter((a) => a.status === 'SUBMITTED').length;
  const limitReached = !hasInProgressAttempt && assessment?.maxAttempts != null && submittedCount >= assessment.maxAttempts;

  const training = assessment?.training ?? null;

  async function requestRetake() {
    if (!id) return;
    setError(null);
    setRequesting(true);
    try {
      await api.post(`/api/member/assessments/${id}/retake-request`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('memberAssessment.submit_failed'));
    } finally {
      setRequesting(false);
    }
  }

  async function startAttempt() {
    if (!id) return;
    // A leadership book exam first explains the one-try rule.
    if (training && !training.inProgressAttemptId && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    setError(null);
    setStarting(true);
    try {
      const attempt = await api.post<{ id: string }>(`/api/member/assessments/${id}/attempts`);
      setActiveAttemptId(attempt.id);
      setLastResult(null);
      setReview(null);
      const q = await api.get<{ questions: TakingQuestion[] }>(`/api/member/attempts/${attempt.id}/questions`);
      setQuestions(q.questions);
      setSelections(readSaved(attempt.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('memberAssessment.start_failed'));
    } finally {
      setStarting(false);
    }
  }

  async function submit() {
    if (!activeAttemptId) return;
    setSubmitting(true);
    setError(null);
    try {
      const answers = Object.entries(selections).map(([questionId, selectedOptionId]) => ({ questionId, selectedOptionId }));
      const submittedId = activeAttemptId;
      const result = await api.post<AttemptSummary>(`/api/member/attempts/${submittedId}/submit`, { answers });
      writeSaved(submittedId, null);
      setLastResult(result);
      if (assessment?.teaching) setBackIn(BACK_AFTER_SECONDS);
      setActiveAttemptId(null);
      setQuestions([]);
      load();
      // Show the right answers so the member can correct themselves —
      // except on leadership book exams, which never show them.
      if (!training) {
        api
          .get<{ questions: ReviewQuestion[] }>(`/api/member/attempts/${submittedId}/questions`)
          .then((r) => setReview(r.questions))
          .catch(() => setReview(null));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('memberAssessment.submit_failed'));
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (backIn === null || !assessment?.teaching) return;
    if (backIn <= 0) {
      navigate(`/member/teachings/${assessment.teaching.id}`);
      return;
    }
    const timer = window.setTimeout(() => setBackIn((n) => (n === null ? null : n - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [backIn, assessment?.teaching, navigate]);

  if (notFound) {
    return (
      <PageShell minimal>
        <div className="mx-auto max-w-sm px-4 py-16 text-center">
          <p className="text-slate-500">{t('memberAssessment.not_found')}</p>
          <Link to="/member/learn" className="mt-4 inline-block text-brand-700 hover:underline">
            {t('memberAssessment.back_to_dashboard')}
          </Link>
        </div>
      </PageShell>
    );
  }

  if (!loaded || !assessment) {
    return (
      <PageShell minimal>
        <div className="mx-auto max-w-sm px-4 py-16 text-center text-slate-400">{t('memberAssessment.loading')}</div>
      </PageShell>
    );
  }

  const title = isFr ? assessment.titleFr || assessment.titleEn : assessment.titleEn;

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-lg px-4 py-8">
        {assessment.teaching ? (
          <Link to={`/member/teachings/${assessment.teaching.id}`} className="text-sm text-brand-700 hover:underline">
            ← {t('teaching.back_to_teaching')}
          </Link>
        ) : (
          <Link to="/member/learn" className="text-sm text-brand-700 hover:underline">
            {t('memberAssessment.back_to_learn')}
          </Link>
        )}
        <h1 className="mt-2 text-2xl font-bold text-brand-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t('memberAssessment.pass_mark', { passMark: assessment.passMark })}
        </p>

        {assessment.firstTryCounts && (
          <p className="mt-1 text-xs text-slate-500">{t('memberAssessment.first_try_counts')}</p>
        )}
        {training && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{t('memberAssessment.training_one_try')}</p>}

        {lastResult && (
          <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <p className="mb-1 text-base font-semibold text-brand-900">{t('memberAssessment.thank_you')}</p>
            <p className="font-medium">
              {t('memberAssessment.result_summary', {
                score: lastResult.score,
                maxScore: lastResult.maxScore,
                percentage: Math.round(lastResult.percentage ?? 0),
              })}
            </p>
            <p className={lastResult.passed ? 'font-semibold text-green-700' : 'font-semibold text-red-700'}>
              {lastResult.passed ? t('memberAssessment.passed') : t('memberAssessment.failed')}
            </p>
            {assessment.firstTryCounts && attempts.filter((a) => a.status === 'SUBMITTED').length > 1 && (
              <p className="mt-1 text-xs text-slate-500">{t('memberAssessment.practice_note')}</p>
            )}
            {assessment.teaching && backIn !== null && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sky-900" role="status" data-testid="back-to-teaching">
                <span>{t('teaching.back_to_teaching_soon')} ({backIn})</span>
                <Link to={`/member/teachings/${assessment.teaching.id}`} className="font-semibold underline">
                  {t('teaching.back_now')}
                </Link>
                <button type="button" className="underline" onClick={() => setBackIn(null)}>
                  {t('teaching.stay_here')}
                </button>
              </div>
            )}
            {lastResult.payPrompt && (
              <div className="mt-3 space-y-2 rounded-lg bg-amber-50 px-3 py-3 text-amber-900" data-testid="pay-prompt">
                <p className="font-semibold">{t('memberAssessment.pay_prompt_title', { number: lastResult.payPrompt.bookNumber })}</p>
                <p>{t(lastResult.payPrompt.nextWaitsForPayment ? 'memberAssessment.pay_prompt_next' : 'memberAssessment.pay_prompt_owed')}</p>
                <p className="text-xs">{t('payMany.hint')}</p>
                <Link to="/member/school" className="btn-primary inline-block">
                  {t('memberAssessment.pay_prompt_button')}
                </Link>
              </div>
            )}
          </div>
        )}

        {review && review.length > 0 && (
          <div className="card mt-4 space-y-4">
            <h2 className="font-semibold text-brand-900">{t('memberAssessment.right_answers')}</h2>
            {review.map((q, i) => (
              <div key={q.id}>
                <p className="mb-1 font-medium text-slate-700">
                  {i + 1}. {isFr ? q.textFr || q.textEn : q.textEn}
                </p>
                <ul className="space-y-1 text-sm">
                  {q.options.map((o) => {
                    const chosen = q.selectedOptionId === o.id;
                    const cls = o.isCorrect ? 'font-semibold text-green-700' : chosen ? 'text-red-700 line-through' : 'text-slate-600';
                    return (
                      <li key={o.id} className={cls}>
                        {o.isCorrect ? '✓ ' : chosen ? '✗ ' : '• '}
                        {isFr ? o.textFr || o.textEn : o.textEn}
                        {chosen && <span className="ml-1 text-xs text-slate-500">({t('memberAssessment.your_answer')})</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}

        {activeAttemptId && questions.length > 0 && (
          <div className="card mt-4 space-y-4">
            {questions.map((q) => {
              const qText = isFr ? q.textFr || q.textEn : q.textEn;
              return (
                <div key={q.id}>
                  <p className="mb-2 font-medium text-slate-700">{qText}</p>
                  <div className="space-y-1">
                    {q.options.map((o) => {
                      const oText = isFr ? o.textFr || o.textEn : o.textEn;
                      return (
                        <label key={o.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="radio"
                            name={q.id}
                            checked={selections[q.id] === o.id}
                            onChange={() =>
                              setSelections((s) => {
                                const next = { ...s, [q.id]: o.id };
                                if (activeAttemptId) writeSaved(activeAttemptId, next);
                                return next;
                              })
                            }
                          />
                          {oText}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            {error && <p className="text-sm text-red-700">{error}</p>}
            <button className="btn-primary w-full" onClick={submit} disabled={submitting}>
              {submitting ? t('memberAssessment.submitting') : t('memberAssessment.submit')}
            </button>
          </div>
        )}

        {!activeAttemptId && (
          <div className="mt-4">
            {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
            {training && confirming ? (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p className="font-semibold">{t('memberAssessment.training_rules_title')}</p>
                <p>{t('memberAssessment.training_rules')}</p>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary" onClick={startAttempt} disabled={starting}>
                    {starting ? t('memberAssessment.starting') : t('memberAssessment.training_start_confirm')}
                  </button>
                  <button className="btn-secondary" onClick={() => setConfirming(false)}>
                    {t('memberAssessment.training_not_yet')}
                  </button>
                </div>
              </div>
            ) : training && training.block ? (
              <div className="space-y-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className={training.block === 'PASSED' ? 'font-semibold text-green-700' : ''}>{t(`memberAssessment.training_block_${training.block}`)}</p>
                {(training.block === 'NEEDS_RETAKE' || training.block === 'RETAKE_DECLINED') && (
                  <button className="btn-primary" onClick={requestRetake} disabled={requesting}>
                    {t('memberAssessment.training_request_retake')}
                  </button>
                )}
              </div>
            ) : limitReached ? (
              <p className="text-sm text-slate-500">{t('memberAssessment.limit_reached')}</p>
            ) : assessment.open === false && !hasInProgressAttempt ? (
              <p className="text-sm text-slate-500">{t('memberAssessment.closed')}</p>
            ) : (
              <>
                {training?.retakeGranted && !hasInProgressAttempt && (
                  <p className="mb-2 text-sm font-medium text-green-700">{t('memberAssessment.training_retake_granted')}</p>
                )}
                <button className="btn-primary w-full" onClick={startAttempt} disabled={starting}>
                  {starting
                    ? t('memberAssessment.starting')
                    : hasInProgressAttempt
                      ? t('memberAssessment.continue')
                      : t('memberAssessment.start')}
                </button>
              </>
            )}
          </div>
        )}

        {attempts.length > 0 && (
          <div className="card mt-6">
            <h2 className="mb-3 font-semibold text-brand-900">{t('memberAssessment.your_history')}</h2>
            <ul className="space-y-2 text-sm">
              {attempts.map((a) => (
                <li key={a.id} className="flex items-center justify-between border-b border-slate-50 pb-2 last:border-0">
                  <span>{t('memberAssessment.attempt_number', { number: a.attemptNumber })}</span>
                  {a.status === 'SUBMITTED' ? (
                    <span className={a.passed ? 'font-medium text-green-700' : 'font-medium text-red-700'}>
                      {a.score}/{a.maxScore} ({Math.round(a.percentage ?? 0)}%) —{' '}
                      {a.passed ? t('memberAssessment.passed') : t('memberAssessment.failed')}
                    </span>
                  ) : (
                    <span className="text-slate-400">{t('memberAssessment.in_progress')}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </PageShell>
  );
}
