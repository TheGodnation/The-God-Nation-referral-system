import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { LengthNote } from '../components/LengthNote';
import { api, ApiError } from '../lib/api';
import { ChatUploadError, uploadChatFile } from '../lib/chatMedia';
import { formatBytes } from '../lib/attachmentLimits';
import { MAX_MESSAGE_CHARS, isTooLong } from '../lib/textLimits';
import { FormattedTextarea } from '../components/FormattedTextarea';

// The central admin's screen for a new teaching: title, text, an audio /
// video / PDF, the quiz questions (written by hand or drafted by the AI and
// then confirmed here), how long the quiz stays open — then post.

interface Option {
  textEn: string;
  textFr: string;
  isCorrect: boolean;
}
interface QuestionDraft {
  key: number;
  textEn: string;
  textFr: string;
  options: Option[];
}
interface Uploaded {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
}

let keyCounter = 0;
const blankQuestion = (): QuestionDraft => ({
  key: ++keyCounter,
  textEn: '',
  textFr: '',
  options: [
    { textEn: '', textFr: '', isCorrect: true },
    { textEn: '', textFr: '', isCorrect: false },
    { textEn: '', textFr: '', isCorrect: false },
  ],
});

export function MemberTeachingComposePage() {
  const { t } = useTranslation();
  const { communityId = '' } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ name: string; size: number; progress: number; uploaded: Uploaded | null } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [passMark, setPassMark] = useState(70);
  const [openDays, setOpenDays] = useState(7);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function pickFile(f: File | undefined) {
    if (!f) return;
    setFileError(null);
    setFile({ name: f.name, size: f.size, progress: 0, uploaded: null });
    try {
      const uploaded = await uploadChatFile(`/api/communities/${communityId}/attachments/authorize`, f, f.name, {
        onProgress: (p) => setFile((cur) => (cur ? { ...cur, progress: p } : cur)),
      });
      if (!/^(audio|video)\//.test(uploaded.mimeType) && uploaded.mimeType !== 'application/pdf') throw new ChatUploadError('type');
      setFile((cur) => (cur ? { ...cur, progress: 1, uploaded } : cur));
    } catch (err) {
      setFile(null);
      const reason = err instanceof ChatUploadError ? err.reason : 'failed';
      setFileError(t(`teaching.file_${reason}`));
    }
  }

  async function draft() {
    setDraftNote(null);
    setDrafting(true);
    try {
      const audio = file?.uploaded && file.uploaded.mimeType.startsWith('audio/') ? file.uploaded : null;
      const res = await api.post<{ questions: { textEn: string; textFr: string; options: { textEn: string; textFr: string }[]; correctIndex: number }[] }>(
        '/api/teachings/draft-questions',
        { communityId, text: text.trim() || undefined, audioStorageKey: audio?.storageKey, audioMimeType: audio?.mimeType, count: 5 },
      );
      setQuestions(
        res.questions.map((q) => ({
          key: ++keyCounter,
          textEn: q.textEn,
          textFr: q.textFr,
          options: q.options.map((o, i) => ({ textEn: o.textEn, textFr: o.textFr, isCorrect: i === q.correctIndex })),
        })),
      );
      setDraftNote(t('teaching.draft_done'));
    } catch (err) {
      setDraftNote(err instanceof ApiError ? err.message : t('teaching.draft_failed'));
    } finally {
      setDrafting(false);
    }
  }

  function patchQuestion(key: number, patch: Partial<QuestionDraft>) {
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...patch } : q)));
  }
  function patchOption(key: number, index: number, patch: Partial<Option>) {
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, options: q.options.map((o, i) => (i === index ? { ...o, ...patch } : o)) } : q)));
  }
  function setCorrect(key: number, index: number) {
    setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, options: q.options.map((o, i) => ({ ...o, isCorrect: i === index })) } : q)));
  }

  const uploading = Boolean(file && !file.uploaded);
  const tooLong = isTooLong(text, MAX_MESSAGE_CHARS);
  const questionsOk = questions.length > 0 && questions.every((q) => q.textEn.trim() && q.options.length >= 2 && q.options.every((o) => o.textEn.trim()) && q.options.filter((o) => o.isCorrect).length === 1);
  const canPost = title.trim() && (text.trim() || file?.uploaded) && questionsOk && !uploading && !tooLong && !posting;

  async function post(e: React.FormEvent) {
    e.preventDefault();
    if (!canPost) return;
    setError(null);
    setPosting(true);
    try {
      const res = await api.post<{ id: string }>('/api/teachings', {
        communityId,
        title: title.trim(),
        text: text.trim() || undefined,
        attachment: file?.uploaded ?? undefined,
        passMark,
        openDays,
        questions: questions.map((q) => ({
          textEn: q.textEn.trim(),
          textFr: q.textFr.trim() || undefined,
          options: q.options.map((o) => ({ textEn: o.textEn.trim(), textFr: o.textFr.trim() || undefined, isCorrect: o.isCorrect })),
        })),
      });
      navigate(`/member/teachings/${res.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('teaching.post_failed'));
      setPosting(false);
    }
  }

  return (
    <PageShell minimal>
      <form onSubmit={post} className="mx-auto max-w-lg space-y-4 px-4 py-6">
        <Link to={`/member/chats/group/${communityId}`} className="text-sm text-brand-700 hover:underline">
          ← {t('teaching.cancel')}
        </Link>
        <h1 className="text-2xl font-bold text-brand-900">📖 {t('teaching.new_title')}</h1>
        <p className="text-sm text-slate-600">{t('teaching.new_intro')}</p>

        <div>
          <label className="label" htmlFor="teaching-title">
            {t('teaching.field_title')}
          </label>
          <input id="teaching-title" className="input" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
        </div>

        <div>
          <label className="label" htmlFor="teaching-text">
            {t('teaching.field_text')}
          </label>
          <FormattedTextarea id="teaching-text" className="input min-h-[10rem]" headings value={text} onValueChange={setText} />
          <LengthNote value={text} max={MAX_MESSAGE_CHARS} />
        </div>

        <div className="space-y-2">
          <p className="label">{t('teaching.field_file')}</p>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,video/*,application/pdf"
            className="hidden"
            data-testid="teaching-file-input"
            onChange={(e) => {
              void pickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {file ? (
            <div className="rounded-lg bg-slate-100 px-3 py-2 text-sm">
              <p className="break-all font-medium text-slate-800">
                {file.name} <span className="font-normal text-slate-500">({formatBytes(file.size)})</span>
              </p>
              <p className="text-xs text-slate-500">{file.uploaded ? `✓ ${t('teaching.file_ready')}` : t('teaching.file_uploading', { percent: Math.round(file.progress * 100) })}</p>
              {file.uploaded && (
                <button type="button" className="mt-1 text-xs text-red-700 underline" onClick={() => setFile(null)}>
                  {t('teaching.file_remove')}
                </button>
              )}
            </div>
          ) : (
            <button type="button" className="btn-secondary w-full" onClick={() => fileInput.current?.click()}>
              🎧 {t('teaching.file_add')}
            </button>
          )}
          <p className="text-xs text-slate-500">{t('teaching.file_hint')}</p>
          {fileError && <p className="text-sm text-red-700">{fileError}</p>}
        </div>

        <div className="space-y-3 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-slate-900">{t('teaching.questions_title')}</h2>
          <p className="text-xs text-slate-500">{t('teaching.questions_intro')}</p>
          <button type="button" className="btn-primary w-full" onClick={draft} disabled={drafting || uploading || (!text.trim() && !file?.uploaded)}>
            {drafting ? t('teaching.drafting') : `✨ ${t('teaching.draft_button')}`}
          </button>
          {draftNote && (
            <p className="text-sm text-slate-700" role="status">
              {draftNote}
            </p>
          )}

          {questions.map((q, qi) => (
            <fieldset key={q.key} className="space-y-2 rounded-lg border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold text-slate-500">{t('teaching.question_n', { n: qi + 1 })}</legend>
              <input className="input" aria-label={t('teaching.question_text') ?? ''} placeholder={t('teaching.question_text') ?? ''} value={q.textEn} onChange={(e) => patchQuestion(q.key, { textEn: e.target.value })} />
              <input className="input text-sm" aria-label={t('teaching.question_text_fr') ?? ''} placeholder={t('teaching.question_text_fr') ?? ''} value={q.textFr} onChange={(e) => patchQuestion(q.key, { textFr: e.target.value })} />
              {q.options.map((o, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <input type="radio" name={`correct-${q.key}`} checked={o.isCorrect} onChange={() => setCorrect(q.key, oi)} aria-label={t('teaching.mark_correct') ?? ''} />
                  <div className="min-w-0 flex-1 space-y-1">
                    <input className="input py-1.5 text-sm" aria-label={t('teaching.option_text') ?? ''} placeholder={t('teaching.option_text') ?? ''} value={o.textEn} onChange={(e) => patchOption(q.key, oi, { textEn: e.target.value })} />
                    <input className="input py-1 text-xs" aria-label={t('teaching.option_text_fr') ?? ''} placeholder={t('teaching.option_text_fr') ?? ''} value={o.textFr} onChange={(e) => patchOption(q.key, oi, { textFr: e.target.value })} />
                  </div>
                </div>
              ))}
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">{t('teaching.correct_hint')}</span>
                <button type="button" className="text-red-700 underline" onClick={() => setQuestions((qs) => qs.filter((x) => x.key !== q.key))}>
                  {t('teaching.remove_question')}
                </button>
              </div>
            </fieldset>
          ))}
          <button type="button" className="btn-secondary w-full" onClick={() => setQuestions((qs) => [...qs, blankQuestion()])}>
            ＋ {t('teaching.add_question')}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="teaching-pass">
              {t('teaching.pass_mark')}
            </label>
            <input id="teaching-pass" className="input" type="number" min={1} max={100} value={passMark} onChange={(e) => setPassMark(Math.max(1, Math.min(100, Number(e.target.value) || 70)))} />
          </div>
          <div>
            <label className="label" htmlFor="teaching-days">
              {t('teaching.open_days')}
            </label>
            <input id="teaching-days" className="input" type="number" min={1} max={60} value={openDays} onChange={(e) => setOpenDays(Math.max(1, Math.min(60, Number(e.target.value) || 7)))} />
          </div>
        </div>
        <p className="text-xs text-slate-500">{t('teaching.rules_note')}</p>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={!canPost}>
          {posting ? t('teaching.posting') : t('teaching.post')}
        </button>
        {!questionsOk && <p className="text-center text-xs text-slate-500">{t('teaching.need_questions')}</p>}
      </form>
    </PageShell>
  );
}
