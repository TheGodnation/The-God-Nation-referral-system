import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

// One quiz / exam at a glance: how many took it, how they did, and which
// questions most people got wrong (hardest first) — what people did not
// understand. The admin also sees the right answer and the wrong answer
// chosen most; a leader sees the percentages only.

interface Summary {
  assessmentId: string;
  title: string;
  assemblyName: string | null;
  passMark: number;
  taken: number;
  passed: number;
  averagePercentage: number | null;
  lowestPercentage: number | null;
  highestPercentage: number | null;
  questions: {
    questionId: string;
    textEn: string;
    textFr: string | null;
    answered: number;
    correct: number;
    correctPercentage: number;
    correctAnswerEn?: string | null;
    mostChosenWrongEn?: { text: string; count: number } | null;
  }[];
}

export function QuizSummary({ base, assessmentId, detail, onClose }: { base: string; assessmentId: string; detail: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const isFr = i18n.language.startsWith('fr');

  useEffect(() => {
    setData(null);
    setFailed(false);
    api
      .get<Summary>(`${base}/quiz/${assessmentId}`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [base, assessmentId]);

  const questionText = (q: Summary['questions'][number]) => (isFr ? q.textFr || q.textEn : q.textEn);

  async function copy() {
    if (!data) return;
    const lines = [
      `${data.title}${data.assemblyName ? ` (${data.assemblyName})` : ''}`,
      t('admin.results.summary_taken', { taken: data.taken, passed: data.passed }),
      ...(data.averagePercentage !== null ? [t('admin.results.summary_average', { avg: data.averagePercentage, low: data.lowestPercentage, high: data.highestPercentage })] : []),
      '',
      ...data.questions.map((q, i) => `${i + 1}. ${questionText(q)} — ${t('admin.results.summary_correct', { percent: q.correctPercentage, correct: q.correct, answered: q.answered })}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard not available */
    }
  }

  return (
    <div className="card space-y-3 border-2 border-brand-200" data-testid="quiz-summary">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-semibold text-brand-900">{data ? data.title : t('admin.results.quiz_summary')}</h3>
        <button type="button" className="shrink-0 text-sm text-slate-500 underline" onClick={onClose}>
          {t('admin.results.summary_close')}
        </button>
      </div>
      {failed && <p className="text-sm text-red-700">{t('admin.results.summary_failed')}</p>}
      {!data && !failed && <p className="text-sm text-slate-400">{t('admin.results.loading')}</p>}
      {data && (
        <>
          <p className="text-sm text-slate-700">
            {t('admin.results.summary_taken', { taken: data.taken, passed: data.passed })}
            {data.averagePercentage !== null && (
              <>
                <br />
                {t('admin.results.summary_average', { avg: data.averagePercentage, low: data.lowestPercentage, high: data.highestPercentage })}
              </>
            )}
          </p>
          <p className="text-xs text-slate-500">{t('admin.results.summary_hardest')}</p>
          <ol className="space-y-3">
            {data.questions.map((q, i) => (
              <li key={q.questionId} data-testid="summary-question">
                <p className="break-words text-sm font-medium text-slate-900">
                  {i + 1}. {questionText(q)}
                </p>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-red-100">
                  <div className={`h-full rounded-full ${q.correctPercentage >= 70 ? 'bg-green-500' : q.correctPercentage >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${q.correctPercentage}%` }} />
                </div>
                <p className="mt-0.5 text-xs text-slate-600">{t('admin.results.summary_correct', { percent: q.correctPercentage, correct: q.correct, answered: q.answered })}</p>
                {detail && q.correctAnswerEn && <p className="text-xs text-green-700">✓ {t('admin.results.summary_right_answer', { text: q.correctAnswerEn })}</p>}
                {detail && q.mostChosenWrongEn && (
                  <p className="text-xs text-red-700">✗ {t('admin.results.summary_wrong_answer', { text: q.mostChosenWrongEn.text, count: q.mostChosenWrongEn.count })}</p>
                )}
              </li>
            ))}
          </ol>
          <button type="button" className="btn-secondary" onClick={copy}>
            {copied ? `✓ ${t('admin.results.copied')}` : `📋 ${t('admin.results.summary_copy')}`}
          </button>
        </>
      )}
    </div>
  );
}
