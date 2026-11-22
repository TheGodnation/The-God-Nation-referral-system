import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface Option {
  textEn: string;
  textFr: string;
  isCorrect: boolean;
}
interface Question {
  key: number;
  textEn: string;
  textFr: string;
  options: Option[];
}
export interface QuizSummary {
  title: string;
  passMark: number;
  openDays: number;
  questions: { textEn: string; textFr?: string; options: { textEn: string; textFr?: string; isCorrect: boolean }[] }[];
  portion: { bookId: string; page: number; label: string | null } | null;
}

let keyCounter = 0;
const blank = (): Question => ({ key: ++keyCounter, textEn: '', textFr: '', options: [{ textEn: '', textFr: '', isCorrect: true }, { textEn: '', textFr: '', isCorrect: false }, { textEn: '', textFr: '', isCorrect: false }] });
const fromSaved = (quiz: QuizSummary): Question[] => quiz.questions.map((q) => ({ key: ++keyCounter, textEn: q.textEn, textFr: q.textFr ?? '', options: q.options.map((o) => ({ textEn: o.textEn, textFr: o.textFr ?? '', isCorrect: o.isCorrect })) }));

// Makes a waiting teaching a counted one: a title, a quiz (written by hand or drafted from the approved text and then checked), how long
// it stays open and the pass mark, and the part of this month's book it is taught from. Then members are followed (read or listened to
// the end, quiz taken) the way every teaching with a quiz is.
export function ScheduledQuizEditor({
  itemId,
  communityId,
  spokenText,
  quiz,
  singleRecording,
  onChanged,
}: {
  itemId: string;
  communityId: string;
  spokenText: string;
  quiz: QuizSummary | null;
  singleRecording: boolean;
  onChanged: (item: any) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(quiz?.title ?? '');
  const [questions, setQuestions] = useState<Question[]>(() => (quiz ? fromSaved(quiz) : []));
  const [passMark, setPassMark] = useState(quiz?.passMark ?? 70);
  const [openDays, setOpenDays] = useState(quiz?.openDays ?? 7);
  const [portionOn, setPortionOn] = useState(Boolean(quiz?.portion));
  const [portionPage, setPortionPage] = useState(quiz?.portion ? String(quiz.portion.page) : '');
  const [portionLabel, setPortionLabel] = useState(quiz?.portion?.label ?? '');
  const [book, setBook] = useState<{ id: string; titleEn: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    api.get<{ book: { id: string; titleEn: string } | null }>('/api/member/central-cells/clinic').then((r) => setBook(r?.book ?? null)).catch(() => {});
  }, [open]);

  const base = `/api/member/scheduled-teachings/${itemId}`;
  const patchQ = (key: number, patch: Partial<Question>) => setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  const patchO = (key: number, i: number, patch: Partial<Option>) => setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, options: q.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) } : q)));
  const setCorrect = (key: number, i: number) => setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, options: q.options.map((o, j) => ({ ...o, isCorrect: j === i })) } : q)));
  const questionsOk = questions.length > 0 && questions.every((q) => q.textEn.trim() && q.options.length >= 2 && q.options.every((o) => o.textEn.trim()) && q.options.filter((o) => o.isCorrect).length === 1);

  async function draft() {
    setBusy(true);
    setNote('');
    setError('');
    try {
      const res = await api.post<{ questions: { textEn: string; textFr: string; options: { textEn: string; textFr: string }[]; correctIndex: number }[] }>('/api/teachings/draft-questions', { communityId, text: spokenText.trim() || undefined, count: 8 });
      setQuestions(res.questions.map((q) => ({ key: ++keyCounter, textEn: q.textEn, textFr: q.textFr, options: q.options.map((o, i) => ({ textEn: o.textEn, textFr: o.textFr, isCorrect: i === q.correctIndex })) })));
      setNote(t('teaching.draft_done'));
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : t('teaching.draft_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const item = await api.put<{ quiz: QuizSummary | null }>(`${base}/quiz`, {
        title: title.trim(),
        passMark,
        openDays,
        portion: portionOn && book && Number(portionPage) >= 1 ? { bookId: book.id, page: Number(portionPage), label: portionLabel.trim() || undefined } : null,
        questions: questions.map((q) => ({ textEn: q.textEn.trim(), textFr: q.textFr.trim() || undefined, options: q.options.map((o) => ({ textEn: o.textEn.trim(), textFr: o.textFr.trim() || undefined, isCorrect: o.isCorrect })) })),
      });
      setOpen(false);
      onChanged(item);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('scheduledTeachings.failed'));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!window.confirm(t('scheduledTeachings.quiz_confirm_remove') ?? '')) return;
    setBusy(true);
    setError('');
    try {
      onChanged(await api.delete(`${base}/quiz`));
      setQuestions([]);
      setTitle('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('scheduledTeachings.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!singleRecording) return <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600" data-testid="quiz-pair-note">{t('scheduledTeachings.quiz_pair_note')}</p>;

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 p-3" data-testid="quiz-editor">
      <p className="text-sm font-semibold text-brand-900">📝 {t('scheduledTeachings.quiz_title')}</p>
      {quiz && !open && (
        <>
          <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" data-testid="quiz-summary">
            ✓ {t('scheduledTeachings.quiz_summary', { title: quiz.title, count: quiz.questions.length, pass: quiz.passMark, days: quiz.openDays })}
            {quiz.portion ? ` · ${t('scheduledTeachings.quiz_from_page', { page: quiz.portion.page })}` : ''}
          </p>
          <div className="flex gap-3 text-sm">
            <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setOpen(true)} data-testid="quiz-edit">{t('scheduledTeachings.quiz_edit')}</button>
            <button type="button" className="font-semibold text-red-700 underline" disabled={busy} onClick={() => void remove()} data-testid="quiz-remove">{t('scheduledTeachings.quiz_remove')}</button>
          </div>
        </>
      )}
      {!quiz && !open && (
        <>
          <p className="text-xs text-slate-600">{t('scheduledTeachings.quiz_explain')}</p>
          <button type="button" className="btn-secondary w-full" onClick={() => { setOpen(true); if (questions.length === 0) setQuestions([blank()]); }} data-testid="quiz-add">{t('scheduledTeachings.quiz_add')}</button>
        </>
      )}
      {open && (
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor={`quiz-title-${itemId}`}>{t('teaching.field_title')}</label>
            <input id={`quiz-title-${itemId}`} className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} data-testid="quiz-title" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-secondary" disabled={busy || !spokenText.trim()} onClick={() => void draft()} data-testid="quiz-draft">{t('scheduledTeachings.quiz_draft')}</button>
            {!spokenText.trim() && <span className="text-xs text-slate-500">{t('scheduledTeachings.quiz_draft_needs_text')}</span>}
          </div>
          {note && <p className="text-xs text-slate-600">{note}</p>}
          {questions.map((q, qi) => (
            <div key={q.key} className="space-y-2 rounded-lg bg-slate-50 p-2" data-testid="quiz-question">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-slate-600">{t('scheduledTeachings.quiz_question_n', { n: qi + 1 })}</p>
                <button type="button" className="text-xs text-red-700 underline" onClick={() => setQuestions((qs) => qs.filter((x) => x.key !== q.key))}>{t('scheduledTeachings.quiz_remove_question')}</button>
              </div>
              <input className="input w-full" value={q.textEn} onChange={(e) => patchQ(q.key, { textEn: e.target.value })} placeholder={t('scheduledTeachings.quiz_question_ph') ?? ''} aria-label={t('scheduledTeachings.quiz_question_n', { n: qi + 1 }) ?? ''} data-testid="quiz-question-text" />
              {q.options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="radio" name={`correct-${q.key}`} checked={o.isCorrect} onChange={() => setCorrect(q.key, i)} aria-label={t('scheduledTeachings.quiz_correct') ?? ''} data-testid="quiz-correct" />
                  <input className="input min-w-0 flex-1" value={o.textEn} onChange={(e) => patchO(q.key, i, { textEn: e.target.value })} placeholder={t('scheduledTeachings.quiz_answer_ph', { n: i + 1 }) ?? ''} aria-label={t('scheduledTeachings.quiz_answer_ph', { n: i + 1 }) ?? ''} data-testid="quiz-option-text" />
                </div>
              ))}
              {q.options.length < 6 && <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={() => patchQ(q.key, { options: [...q.options, { textEn: '', textFr: '', isCorrect: false }] })}>{t('scheduledTeachings.quiz_add_answer')}</button>}
            </div>
          ))}
          {questions.length < 20 && <button type="button" className="text-sm font-semibold text-brand-700 underline" onClick={() => setQuestions((qs) => [...qs, blank()])} data-testid="quiz-add-question">{t('scheduledTeachings.quiz_add_question')}</button>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor={`quiz-pass-${itemId}`}>{t('scheduledTeachings.quiz_pass')}</label>
              <input id={`quiz-pass-${itemId}`} className="input" type="number" min={1} max={100} value={passMark} onChange={(e) => setPassMark(Number(e.target.value))} data-testid="quiz-pass" />
            </div>
            <div>
              <label className="label" htmlFor={`quiz-days-${itemId}`}>{t('scheduledTeachings.quiz_days')}</label>
              <input id={`quiz-days-${itemId}`} className="input" type="number" min={1} max={60} value={openDays} onChange={(e) => setOpenDays(Number(e.target.value))} data-testid="quiz-days" />
            </div>
          </div>
          {book && (
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-slate-800">
                <input type="checkbox" checked={portionOn} onChange={(e) => setPortionOn(e.target.checked)} data-testid="quiz-portion-on" />
                {t('clinic.map_portion', { title: book.titleEn })}
              </label>
              {portionOn && (
                <div className="grid grid-cols-2 gap-2">
                  <input className="input" type="number" min={1} max={10000} value={portionPage} onChange={(e) => setPortionPage(e.target.value)} placeholder={t('clinic.portion_page') ?? ''} aria-label={t('clinic.portion_page') ?? ''} data-testid="quiz-portion-page" />
                  <input className="input" maxLength={200} value={portionLabel} onChange={(e) => setPortionLabel(e.target.value)} placeholder={t('clinic.portion_label') ?? ''} aria-label={t('clinic.portion_label') ?? ''} />
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setOpen(false)}>{t('bilingual.cancel')}</button>
            <button type="button" className="btn-primary" disabled={busy || !title.trim() || !questionsOk} onClick={() => void save()} data-testid="quiz-save">{t('scheduledTeachings.quiz_save')}</button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700" data-testid="quiz-error">{error}</p>}
    </div>
  );
}
