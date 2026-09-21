import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { api, ApiError } from '../lib/api';

interface AssessmentInfo {
  id: string;
  titleEn: string;
  titleFr: string | null;
  passMark: number;
  maxAttempts: number | null;
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

  async function startAttempt() {
    if (!id) return;
    setError(null);
    setStarting(true);
    try {
      const attempt = await api.post<{ id: string }>(`/api/member/assessments/${id}/attempts`);
      setActiveAttemptId(attempt.id);
      setLastResult(null);
      const q = await api.get<{ questions: TakingQuestion[] }>(`/api/member/attempts/${attempt.id}/questions`);
      setQuestions(q.questions);
      setSelections({});
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
      const result = await api.post<AttemptSummary>(`/api/member/attempts/${activeAttemptId}/submit`, { answers });
      setLastResult(result);
      setActiveAttemptId(null);
      setQuestions([]);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('memberAssessment.submit_failed'));
    } finally {
      setSubmitting(false);
    }
  }

  if (notFound) {
    return (
      <PageShell minimal>
        <div className="mx-auto max-w-sm px-4 py-16 text-center">
          <p className="text-slate-500">{t('memberAssessment.not_found')}</p>
          <Link to="/member/dashboard" className="mt-4 inline-block text-brand-700 hover:underline">
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
        <Link to="/member/dashboard" className="text-sm text-brand-700 hover:underline">
          {t('memberAssessment.back_to_dashboard')}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-brand-900">{title}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t('memberAssessment.pass_mark', { passMark: assessment.passMark })}
        </p>

        {lastResult && (
          <div className="mt-4 rounded-lg bg-slate-50 px-4 py-3 text-sm">
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
                            onChange={() => setSelections((s) => ({ ...s, [q.id]: o.id }))}
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
            {limitReached ? (
              <p className="text-sm text-slate-500">{t('memberAssessment.limit_reached')}</p>
            ) : (
              <button className="btn-primary w-full" onClick={startAttempt} disabled={starting}>
                {starting
                  ? t('memberAssessment.starting')
                  : hasInProgressAttempt
                    ? t('memberAssessment.continue')
                    : t('memberAssessment.start')}
              </button>
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
