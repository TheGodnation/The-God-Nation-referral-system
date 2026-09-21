import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

interface AssessmentRow {
  id: string;
  titleEn: string;
  titleFr: string | null;
  passMark: number;
  maxAttempts: number | null;
  status: 'DRAFT' | 'PUBLISHED' | 'LOCKED';
  devotional: { id: string; titleEn: string } | null;
  _count: { questions: number; attempts: number };
}

interface OptionDetail {
  id: string;
  textEn: string;
  textFr: string | null;
  isCorrect: boolean;
  order: number;
}

interface QuestionDetail {
  id: string;
  textEn: string;
  textFr: string | null;
  order: number;
  points: number;
  options: OptionDetail[];
}

interface AssessmentDetail extends AssessmentRow {
  questions: QuestionDetail[];
}

const EMPTY_CREATE_FORM = { titleEn: '', titleFr: '', passMark: 50, maxAttempts: '' };

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'LOCKED' ? 'bg-red-100 text-red-800' : status === 'PUBLISHED' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>;
}

// ---------------------------------------------------------------------------
// Question/option editor — only rendered when the assessment is not LOCKED.
// ---------------------------------------------------------------------------
function QuestionEditor({ assessmentId, onChanged }: { assessmentId: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const [questionText, setQuestionText] = useState('');
  const [points, setPoints] = useState(1);
  const [error, setError] = useState<string | null>(null);

  async function addQuestion(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/api/admin/assessments/${assessmentId}/questions`, { textEn: questionText, points });
      setQuestionText('');
      setPoints(1);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.assessments.question_failed'));
    }
  }

  return (
    <form onSubmit={addQuestion} className="card mb-4 space-y-3">
      <h3 className="font-semibold text-brand-900">{t('admin.assessments.add_question')}</h3>
      <input
        className="input"
        placeholder={t('admin.assessments.question_text_placeholder') ?? ''}
        value={questionText}
        onChange={(e) => setQuestionText(e.target.value)}
        required
      />
      <div>
        <label className="label">{t('admin.assessments.points_label')}</label>
        <input
          className="input"
          type="number"
          min={1}
          value={points}
          onChange={(e) => setPoints(parseInt(e.target.value, 10) || 1)}
        />
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary" type="submit">
        {t('admin.assessments.add')}
      </button>
    </form>
  );
}

function OptionRow({
  option,
  questionId,
  locked,
  onChanged,
}: {
  option: OptionDetail;
  questionId: string;
  locked: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();

  async function markCorrect() {
    await api.patch(`/api/admin/assessments/options/${option.id}`, { isCorrect: true });
    onChanged();
  }

  async function remove() {
    await api.delete(`/api/admin/assessments/options/${option.id}`);
    onChanged();
  }

  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span className={option.isCorrect ? 'font-semibold text-green-700' : ''}>
        {option.isCorrect ? '✓ ' : ''}
        {option.textEn}
      </span>
      {!locked && (
        <span className="space-x-2 whitespace-nowrap">
          {!option.isCorrect && (
            <button className="text-brand-700 hover:underline" onClick={markCorrect}>
              {t('admin.assessments.mark_correct')}
            </button>
          )}
          <button className="text-red-700 hover:underline" onClick={remove}>
            {t('admin.assessments.delete')}
          </button>
        </span>
      )}
    </li>
  );
}

function QuestionCard({ question, locked, onChanged }: { question: QuestionDetail; locked: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const [newOptionText, setNewOptionText] = useState('');

  async function addOption(e: React.FormEvent) {
    e.preventDefault();
    if (!newOptionText.trim()) return;
    await api.post(`/api/admin/assessments/questions/${question.id}/options`, { textEn: newOptionText });
    setNewOptionText('');
    onChanged();
  }

  async function removeQuestion() {
    await api.delete(`/api/admin/assessments/questions/${question.id}`);
    onChanged();
  }

  return (
    <div className="card mb-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-medium text-brand-900">
          {question.textEn} <span className="text-xs text-slate-400">({question.points} pt{question.points === 1 ? '' : 's'})</span>
        </p>
        {!locked && (
          <button className="text-sm text-red-700 hover:underline" onClick={removeQuestion}>
            {t('admin.assessments.delete')}
          </button>
        )}
      </div>
      <ul className="space-y-1 pl-2">
        {question.options.map((o) => (
          <OptionRow key={o.id} option={o} questionId={question.id} locked={locked} onChanged={onChanged} />
        ))}
        {question.options.length === 0 && <li className="text-sm text-slate-400">{t('admin.assessments.no_options')}</li>}
      </ul>
      {!locked && (
        <form onSubmit={addOption} className="flex gap-2">
          <input
            className="input"
            placeholder={t('admin.assessments.option_text_placeholder') ?? ''}
            value={newOptionText}
            onChange={(e) => setNewOptionText(e.target.value)}
          />
          <button className="btn-secondary" type="submit">
            {t('admin.assessments.add')}
          </button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Attempt-taking — Admin selects a Person, starts an attempt, records
// answers, and submits. The server computes the result; nothing here sends
// a score/percentage/passed value.
// ---------------------------------------------------------------------------
interface TakingQuestion {
  id: string;
  textEn: string;
  points: number;
  options: { id: string; textEn: string }[];
}

function AttemptTaker({ attemptId, onSubmitted }: { attemptId: string; onSubmitted: (result: any) => void }) {
  const { t } = useTranslation();
  const [questions, setQuestions] = useState<TakingQuestion[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<{ status: string; questions: TakingQuestion[] }>(`/api/admin/attempts/${attemptId}/questions`).then((res) => {
      setQuestions(res.questions);
    });
  }, [attemptId]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const answers = Object.entries(selections).map(([questionId, selectedOptionId]) => ({ questionId, selectedOptionId }));
      const result = await api.post(`/api/admin/attempts/${attemptId}/submit`, { answers });
      onSubmitted(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.assessments.submit_failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card space-y-4">
      <h3 className="font-semibold text-brand-900">{t('admin.assessments.recording_attempt')}</h3>
      {questions.map((q) => (
        <div key={q.id}>
          <p className="mb-2 font-medium text-slate-700">{q.textEn}</p>
          <div className="space-y-1">
            {q.options.map((o) => (
              <label key={o.id} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name={q.id}
                  checked={selections[q.id] === o.id}
                  onChange={() => setSelections((s) => ({ ...s, [q.id]: o.id }))}
                />
                {o.textEn}
              </label>
            ))}
          </div>
        </div>
      ))}
      {questions.length === 0 && <p className="text-sm text-slate-400">{t('admin.assessments.no_questions_to_answer')}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      <button className="btn-primary" onClick={submit} disabled={submitting}>
        {submitting ? t('admin.assessments.submitting') : t('admin.assessments.submit_answers')}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results table
// ---------------------------------------------------------------------------
function ResultsTable({ assessmentId }: { assessmentId: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    api
      .get<{ items: any[]; pagination: { totalPages: number } }>(
        `/api/admin/assessments/${assessmentId}/results?page=${page}&pageSize=20`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }, [assessmentId, page]);

  return (
    <div className="card overflow-x-auto">
      <h3 className="mb-3 font-semibold text-brand-900">{t('admin.assessments.results')}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">{t('admin.assessments.no_results')}</p>
      ) : (
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.assessments.table_person')}</th>
              <th className="py-2 pr-4">{t('admin.assessments.table_attempt')}</th>
              <th className="py-2 pr-4">{t('admin.assessments.table_score')}</th>
              <th className="py-2 pr-4">{t('admin.assessments.table_percentage')}</th>
              <th className="py-2 pr-4">{t('admin.assessments.table_result')}</th>
              <th className="py-2 pr-4">{t('admin.assessments.table_submitted')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b border-slate-50">
                <td className="py-2 pr-4">{a.person.name}</td>
                <td className="py-2 pr-4">#{a.attemptNumber}</td>
                <td className="py-2 pr-4">
                  {a.score ?? '—'}/{a.maxScore ?? '—'}
                </td>
                <td className="py-2 pr-4">{a.percentage !== null ? `${Math.round(a.percentage)}%` : '—'}</td>
                <td className="py-2 pr-4">
                  {a.status !== 'SUBMITTED' ? (
                    <span className="text-slate-400">{t('admin.assessments.in_progress')}</span>
                  ) : a.passed ? (
                    <span className="font-medium text-green-700">{t('admin.assessments.passed')}</span>
                  ) : (
                    <span className="font-medium text-red-700">{t('admin.assessments.failed')}</span>
                  )}
                </td>
                <td className="py-2 pr-4">{a.submittedAt ? new Date(a.submittedAt).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('admin.prev')}
          </button>
          <span>{t('admin.page_of', { page, total: totalPages })}</span>
          <button
            className="btn-secondary px-3 py-1.5"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('admin.next')}
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assessment detail / management view
// ---------------------------------------------------------------------------
function AssessmentManager({ assessmentId, onBack }: { assessmentId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const [assessment, setAssessment] = useState<AssessmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeAttemptId, setActiveAttemptId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<any>(null);
  const [resultsKey, setResultsKey] = useState(0);

  function load() {
    api.get<AssessmentDetail>(`/api/admin/assessments/${assessmentId}`).then(setAssessment);
  }

  useEffect(load, [assessmentId]);

  async function publish() {
    setError(null);
    try {
      await api.patch(`/api/admin/assessments/${assessmentId}`, { status: 'PUBLISHED' });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.assessments.publish_failed'));
    }
  }

  async function startAttempt(person: any) {
    setError(null);
    try {
      const attempt = await api.post<{ id: string }>(`/api/admin/people/${person.id}/attempts`, { assessmentId });
      setActiveAttemptId(attempt.id);
      setLastResult(null);
      load(); // reflect LOCKED status immediately if this was the first attempt
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.assessments.start_attempt_failed'));
    }
  }

  if (!assessment) return null;
  const locked = assessment.status === 'LOCKED';

  return (
    <div>
      <button className="mb-4 text-sm text-brand-700 hover:underline" onClick={onBack}>
        {t('admin.assessments.back_to_list')}
      </button>

      <div className="card mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-brand-900">{assessment.titleEn}</h2>
          <StatusBadge status={assessment.status} />
        </div>
        <p className="text-sm text-slate-500">
          {t('admin.assessments.pass_mark_label')}: {assessment.passMark}% ·{' '}
          {assessment.maxAttempts ? t('admin.assessments.max_attempts_value', { count: assessment.maxAttempts }) : t('admin.assessments.unlimited_attempts')}
        </p>
        {locked && <p className="text-sm font-medium text-red-700">{t('admin.assessments.locked_notice')}</p>}
        {!locked && assessment.status === 'DRAFT' && assessment.questions.length > 0 && (
          <button className="btn-primary" onClick={publish}>
            {t('admin.assessments.publish')}
          </button>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </div>

      {!locked && <QuestionEditor assessmentId={assessmentId} onChanged={load} />}

      <div className="mb-4">
        {assessment.questions.map((q) => (
          <QuestionCard key={q.id} question={q} locked={locked} onChanged={load} />
        ))}
        {assessment.questions.length === 0 && (
          <p className="text-sm text-slate-400">{t('admin.assessments.no_questions')}</p>
        )}
      </div>

      {assessment.status !== 'DRAFT' && (
        <div className="card mb-4 space-y-3">
          <h3 className="font-semibold text-brand-900">{t('admin.assessments.record_attempt')}</h3>
          <SearchPicker
            placeholder={t('admin.people.search_placeholder') ?? ''}
            searchPath="/api/admin/people?search="
            renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
            actionLabel={t('admin.assessments.start_attempt')}
            searchButtonLabel={t('admin.people.search_button')}
            onPick={startAttempt}
          />
          {activeAttemptId && !lastResult && (
            <AttemptTaker
              attemptId={activeAttemptId}
              onSubmitted={(result) => {
                setLastResult(result);
                setResultsKey((k) => k + 1);
              }}
            />
          )}
          {lastResult && (
            <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
              <p className="font-medium">
                {t('admin.assessments.result_summary', {
                  score: lastResult.score,
                  maxScore: lastResult.maxScore,
                  percentage: Math.round(lastResult.percentage),
                })}
              </p>
              <p className={lastResult.passed ? 'font-semibold text-green-700' : 'font-semibold text-red-700'}>
                {lastResult.passed ? t('admin.assessments.passed') : t('admin.assessments.failed')}
              </p>
            </div>
          )}
        </div>
      )}

      <ResultsTable key={resultsKey} assessmentId={assessmentId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level tab: list + create
// ---------------------------------------------------------------------------
export function AssessmentsTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<AssessmentRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_CREATE_FORM);
  const [devotionalId, setDevotionalId] = useState<string | null>(null);
  const [devotionalTitle, setDevotionalTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function load() {
    api
      .get<{ items: AssessmentRow[]; pagination: { totalPages: number } }>(
        `/api/admin/assessments?page=${page}&pageSize=20`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }

  useEffect(load, [page]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/admin/assessments', {
        titleEn: form.titleEn,
        titleFr: form.titleFr || undefined,
        passMark: Number(form.passMark),
        maxAttempts: form.maxAttempts ? Number(form.maxAttempts) : undefined,
        devotionalId: devotionalId ?? undefined,
      });
      setForm(EMPTY_CREATE_FORM);
      setDevotionalId(null);
      setDevotionalTitle('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.assessments.create_failed'));
    }
  }

  if (selectedId) {
    return (
      <AssessmentManager
        assessmentId={selectedId}
        onBack={() => {
          setSelectedId(null);
          load();
        }}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-brand-900">{t('admin.assessments.title')}</h2>
        <button className="btn-primary px-4 py-2" onClick={() => setShowForm((v) => !v)}>
          {t('admin.assessments.new_assessment')}
        </button>
      </div>

      {error && !showForm && <p className="mb-4 text-sm text-red-700">{error}</p>}

      {showForm && (
        <form onSubmit={create} className="card mb-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              placeholder={t('admin.assessments.title_en_placeholder') ?? ''}
              value={form.titleEn}
              onChange={(e) => setForm((f) => ({ ...f, titleEn: e.target.value }))}
              required
            />
            <input
              className="input"
              placeholder={t('admin.assessments.title_fr_placeholder') ?? ''}
              value={form.titleFr}
              onChange={(e) => setForm((f) => ({ ...f, titleFr: e.target.value }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">{t('admin.assessments.pass_mark_label')}</label>
              <input
                className="input"
                type="number"
                min={0}
                max={100}
                value={form.passMark}
                onChange={(e) => setForm((f) => ({ ...f, passMark: Number(e.target.value) }))}
                required
              />
            </div>
            <div>
              <label className="label">{t('admin.assessments.max_attempts_label')}</label>
              <input
                className="input"
                type="number"
                min={1}
                placeholder={t('admin.assessments.max_attempts_placeholder') ?? ''}
                value={form.maxAttempts}
                onChange={(e) => setForm((f) => ({ ...f, maxAttempts: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <label className="label">{t('admin.assessments.devotional_label')}</label>
            <p className="mb-2 text-sm text-slate-600">
              {devotionalId ? devotionalTitle : t('admin.assessments.no_devotional_selected')}
            </p>
            <SearchPicker
              placeholder={t('admin.assessments.search_devotional_placeholder') ?? ''}
              searchPath="/api/admin/devotionals?search="
              renderLabel={(d) => d.titleEn}
              actionLabel={t('admin.devotionals.select')}
              searchButtonLabel={t('admin.people.search_button')}
              onPick={(d) => {
                setDevotionalId(d.id);
                setDevotionalTitle(d.titleEn);
              }}
            />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary" type="submit">
            {t('admin.assessments.create')}
          </button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.assessments.table_action')}</th>
              <th className="py-2 pr-4">{t('admin.assessments.table_title')}</th>
              <th className="py-2 pr-4">{t('admin.assessments.table_devotional')}</th>
              <th className="py-2 pr-4">{t('admin.assessments.table_status_col')}</th>
              <th className="py-2 pr-4">{t('admin.assessments.table_questions')}</th>
              <th className="py-2 pr-4">{t('admin.assessments.table_attempts')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id} className="border-b border-slate-50">
                <td className="py-2 pr-4">
                  <button className="text-brand-700 hover:underline" onClick={() => setSelectedId(a.id)}>
                    {t('admin.assessments.manage')}
                  </button>
                </td>
                <td className="py-2 pr-4">{a.titleEn}</td>
                <td className="py-2 pr-4">{a.devotional?.titleEn ?? '—'}</td>
                <td className="py-2 pr-4">
                  <StatusBadge status={a.status} />
                </td>
                <td className="py-2 pr-4">{a._count.questions}</td>
                <td className="py-2 pr-4">{a._count.attempts}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-slate-400">
                  {t('admin.assessments.no_assessments')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3 text-sm">
            <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t('admin.prev')}
            </button>
            <span>{t('admin.page_of', { page, total: totalPages })}</span>
            <button
              className="btn-secondary px-3 py-1.5"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('admin.next')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
