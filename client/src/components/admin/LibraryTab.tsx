import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';
import { PaymentsAndGrace, TrainingPaymentSettings } from './TrainingPaymentsAdmin';
import { BookDetailsAdmin } from './BookDetailsAdmin';
import { readPdfCover } from '../../lib/bookCover';

interface BookRow {
  id: string;
  kind: 'DEVOTIONAL' | 'TRAINING';
  titleEn: string;
  titleFr: string | null;
  descriptionEn?: string | null;
  descriptionFr?: string | null;
  trainingOrder: number | null;
  devotional: { id: string; titleEn: string } | null;
  hasFile: boolean;
  byteSize: number | null;
  pageCount?: number | null;
  coverUrl?: string | null;
  coverSource?: 'AUTO' | 'MANUAL' | null;
  chapterCount?: number;
  exam: {
    id: string;
    titleEn: string;
    status: string;
    passMark: number;
    questionCount: number;
    sets?: { setNumber: number; questions: number }[];
  } | null;
}

interface RetakeRow {
  id: string;
  requestedAt: string;
  person: { id: string; name: string; whatsappNumber: string };
  assessmentId: string;
  bookNumber: number | null;
  bookTitleEn: string;
  tries: number;
  lastPercentage: number | null;
  unusedSets: number;
}

interface DevotionalRow {
  id: string;
  titleEn: string;
  status: string;
  startDate: string;
  endDate: string;
  book: { id: string; hasFile: boolean } | null;
  weeklyExams: { id: string; weekNumber: number; status: string; questionCount: number }[];
  offeringCount: number;
}

interface TraineeRow {
  personId: string;
  name: string;
  whatsappNumber: string;
  status: 'REQUESTED' | 'ACTIVE' | 'REVOKED';
  requestedAt: string | null;
  activatedAt: string | null;
  note: string | null;
  graceBooks?: number;
  owedBooks?: number;
}

const MAX_PDF_BYTES = 50 * 1024 * 1024;

/**
 * "Upload PDF" button: authorize → send straight to storage → confirm.
 * Meanwhile this browser reads the PDF's page count and draws page 1 as
 * the book's cover (kept unless the admin chose a cover picture).
 */
function PdfUpload({ bookId, hasFile, onDone }: { bookId: string; hasFile: boolean; onDone: () => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.type !== 'application/pdf') return setError(t('library.pdf_only'));
    if (file.size > MAX_PDF_BYTES) return setError(t('library.pdf_too_large'));
    setBusy(true);
    try {
      const reading = readPdfCover(file);
      const auth = await api.post<{ storageKey: string; uploadUrl: string }>(`/api/admin/library/books/${bookId}/file/authorize`, {
        mimeType: 'application/pdf',
        byteSize: file.size,
      });
      const put = await fetch(auth.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file });
      if (!put.ok) throw new Error('upload');
      const info = await reading;
      await api.post(`/api/admin/library/books/${bookId}/file`, { storageKey: auth.storageKey, byteSize: file.size, pageCount: info?.pageCount });
      if (info?.cover) await api.put(`/api/admin/library/books/${bookId}/cover`, { image: info.cover, source: 'AUTO' }).catch(() => {});
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('library.upload_failed'));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <span className="flex items-center gap-2">
        <span className={hasFile ? 'text-green-700' : 'text-amber-700'}>{hasFile ? `✓ ${t('library.pdf_ready')}` : t('library.no_pdf')}</span>
        <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t('library.uploading') : hasFile ? t('library.replace_pdf') : t('library.upload_pdf')}
        </button>
      </span>
      <input ref={input} type="file" accept="application/pdf" className="hidden" aria-label={t('library.upload_pdf') ?? ''} onChange={(e) => upload(e.target.files?.[0])} />
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

function OfferingSettings() {
  const { t } = useTranslation();
  const [en, setEn] = useState('');
  const [fr, setFr] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api
      .get<{ instructionsEn: string; instructionsFr: string }>('/api/admin/library/offering-settings')
      .then((r) => {
        setEn(r.instructionsEn);
        setFr(r.instructionsFr);
      })
      .catch(() => {});
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    await api.put('/api/admin/library/offering-settings', { instructionsEn: en, instructionsFr: fr });
    setSaved(true);
  }
  return (
    <form onSubmit={save} className="card space-y-2">
      <h3 className="font-semibold text-brand-900">{t('library.offering_heading')}</h3>
      <p className="text-sm text-slate-600">{t('library.offering_help')}</p>
      <textarea className="input" rows={3} aria-label={t('library.offering_en') ?? ''} placeholder={t('library.offering_en') ?? ''} value={en} onChange={(e) => setEn(e.target.value)} />
      <textarea className="input" rows={3} aria-label={t('library.offering_fr') ?? ''} placeholder={t('library.offering_fr') ?? ''} value={fr} onChange={(e) => setFr(e.target.value)} />
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary">
          {t('library.save')}
        </button>
        {saved && <span className="text-sm text-green-700">{t('library.saved')}</span>}
      </div>
    </form>
  );
}

function Offerings({ devotionalId }: { devotionalId: string }) {
  const { t } = useTranslation();
  const [data, setData] = useState<{ total: number; count: number; items: { id: string; name: string; amount: number | null; createdAt: string }[] } | null>(null);
  useEffect(() => {
    api.get<typeof data>(`/api/admin/library/devotionals/${devotionalId}/offerings`).then(setData).catch(() => {});
  }, [devotionalId]);
  if (!data) return <p className="text-xs text-slate-400">{t('library.loading')}</p>;
  return (
    <div className="mt-2 rounded bg-slate-50 p-2 text-xs">
      <p className="font-semibold">{t('library.offerings_total', { count: data.count, total: data.total.toLocaleString() })}</p>
      <ul className="mt-1 space-y-0.5">
        {data.items.map((o) => (
          <li key={o.id}>
            {o.name}: {o.amount !== null ? `${o.amount.toLocaleString()} XAF` : t('library.amount_not_given')} · {new Date(o.createdAt).toLocaleDateString()}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Admin "Library & training" tab for Exam World.
export function LibraryTab() {
  const { t } = useTranslation();
  const [books, setBooks] = useState<BookRow[]>([]);
  const [devotionals, setDevotionals] = useState<DevotionalRow[]>([]);
  const [trainees, setTrainees] = useState<TraineeRow[]>([]);
  const [retakes, setRetakes] = useState<RetakeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openOfferings, setOpenOfferings] = useState<string | null>(null);
  const [openDetails, setOpenDetails] = useState<string | null>(null);

  const trainingBooks = books.filter((b) => b.kind === 'TRAINING');
  const nextOrder = trainingBooks.reduce((max, b) => Math.max(max, b.trainingOrder ?? 0), 0) + 1;
  const [newTitleEn, setNewTitleEn] = useState('');
  const [newTitleFr, setNewTitleFr] = useState('');

  function load() {
    Promise.all([
      api.get<{ items: BookRow[] }>('/api/admin/library/books'),
      api.get<{ items: DevotionalRow[] }>('/api/admin/library/devotionals'),
      api.get<{ items: TraineeRow[] }>('/api/admin/library/trainees'),
      api.get<{ items: RetakeRow[] }>('/api/admin/library/retakes'),
    ])
      .then(([b, d, tr, rt]) => {
        setBooks(b.items);
        setDevotionals(d.items);
        setTrainees(tr.items);
        setRetakes(rt.items);
      })
      .catch(() => setError(t('library.load_failed')));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('library.action_failed'));
    }
  }

  async function addTrainingBook(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitleEn.trim()) return setError(t('library.need_title'));
    await act(() =>
      api.post('/api/admin/library/books', { kind: 'TRAINING', titleEn: newTitleEn.trim(), titleFr: newTitleFr.trim() || undefined, trainingOrder: nextOrder }),
    );
    setNewTitleEn('');
    setNewTitleFr('');
  }

  const examLabel = (exam: { status: string; questionCount: number }) =>
    exam.status === 'DRAFT' ? t('library.exam_draft', { count: exam.questionCount }) : t('library.exam_open', { count: exam.questionCount });

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">{t('library.intro')}</p>
      {error && <p className="text-sm text-red-700">{error}</p>}

      <section className="card space-y-3">
        <h3 className="font-semibold text-brand-900">📖 {t('library.devotionals_heading')}</h3>
        {devotionals.length === 0 && <p className="text-sm text-slate-500">{t('library.no_devotionals')}</p>}
        <ul className="divide-y divide-slate-100">
          {devotionals.map((d) => {
            const nextWeek = d.weeklyExams.reduce((max, w) => Math.max(max, w.weekNumber), 0) + 1;
            return (
              <li key={d.id} className="space-y-2 py-3 text-sm">
                <p className="font-semibold text-slate-800">
                  {d.titleEn} <span className="font-normal text-slate-400">({d.status})</span>
                </p>
                <div>
                  {d.book ? (
                    <PdfUpload bookId={d.book.id} hasFile={d.book.hasFile} onDone={load} />
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary px-2 py-1 text-xs"
                      onClick={() => act(() => api.post('/api/admin/library/books', { kind: 'DEVOTIONAL', titleEn: d.titleEn, devotionalId: d.id }))}
                    >
                      ＋ {t('library.add_devotional_book')}
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {d.weeklyExams.map((w) => (
                    <span key={w.id} className="rounded bg-slate-100 px-2 py-1 text-xs">
                      {t('library.week', { number: w.weekNumber })}: {examLabel(w)}
                    </span>
                  ))}
                  {nextWeek <= 6 && (
                    <button
                      type="button"
                      className="btn-secondary px-2 py-1 text-xs"
                      onClick={() => act(() => api.post(`/api/admin/library/devotionals/${d.id}/weekly-exams`, { weekNumber: nextWeek }))}
                    >
                      ＋ {t('library.add_week_exam', { number: nextWeek })}
                    </button>
                  )}
                </div>
                <button type="button" className="text-xs text-brand-700 underline" onClick={() => setOpenOfferings(openOfferings === d.id ? null : d.id)}>
                  {t('library.offerings_link', { count: d.offeringCount })}
                </button>
                {openOfferings === d.id && <Offerings devotionalId={d.id} />}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-slate-500">{t('library.questions_hint')}</p>
      </section>

      <OfferingSettings />

      <section className="card space-y-3">
        <h3 className="font-semibold text-brand-900">🎓 {t('library.training_heading')}</h3>
        <ul className="divide-y divide-slate-100">
          {trainingBooks.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <span className="block font-semibold text-slate-800">
                  {t('library.book', { number: b.trainingOrder })}: {b.titleEn}
                </span>
                <span className="block text-xs text-slate-500">
                  {[b.pageCount ? t('school.pages', { count: b.pageCount }) : null, t('school.chapters', { count: b.chapterCount ?? 0 }), b.coverUrl ? t('library.has_cover') : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <button type="button" className="text-xs text-brand-700 underline" onClick={() => setOpenDetails(openDetails === b.id ? null : b.id)}>
                  {openDetails === b.id ? t('library.details_close') : t('library.details_open')}
                </button>
              </span>
              <span className="flex flex-wrap items-center gap-3">
                <PdfUpload bookId={b.id} hasFile={b.hasFile} onDone={load} />
                {b.exam && (
                  <span className="text-xs text-slate-600">
                    {examLabel(b.exam)} · {t('library.pass_mark', { mark: b.exam.passMark })}
                    {b.exam.sets && b.exam.sets.length > 0 && (
                      <> · {b.exam.sets.map((x) => t('library.set_short', { number: x.setNumber, count: x.questions })).join(', ')}</>
                    )}
                  </span>
                )}
              </span>
              {openDetails === b.id && <BookDetailsAdmin book={b} onChanged={load} />}
            </li>
          ))}
        </ul>
        <form onSubmit={addTrainingBook} className="flex flex-col gap-2 sm:flex-row">
          <input className="input" aria-label={t('library.title_en') ?? ''} placeholder={t('library.new_book_placeholder', { number: nextOrder }) ?? ''} value={newTitleEn} onChange={(e) => setNewTitleEn(e.target.value)} />
          <input className="input" aria-label={t('library.title_fr') ?? ''} placeholder={t('library.title_fr') ?? ''} value={newTitleFr} onChange={(e) => setNewTitleFr(e.target.value)} />
          <button type="submit" className="btn-primary whitespace-nowrap">
            ＋ {t('library.add_book', { number: nextOrder })}
          </button>
        </form>
        <p className="text-xs text-slate-500">{t('library.questions_hint')}</p>
      </section>

      <section className="card space-y-3">
        <h3 className="font-semibold text-brand-900">
          {t('library.retakes_heading')} {retakes.length > 0 && <span className="ml-1 rounded-full bg-amber-100 px-2 text-sm text-amber-800">{retakes.length}</span>}
        </h3>
        <p className="text-sm text-slate-600">{t('library.retakes_help')}</p>
        {retakes.length === 0 ? (
          <p className="text-sm text-slate-400">{t('library.retakes_none')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {retakes.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold">{r.person.name}</span> <span className="text-slate-500">{r.person.whatsappNumber}</span>
                  <span className="block text-xs text-slate-600">
                    {t('library.book', { number: r.bookNumber ?? '' })}: {r.bookTitleEn} ·{' '}
                    {t('library.retake_tries', { count: r.tries, score: Math.round(r.lastPercentage ?? 0) })}
                  </span>
                  {r.unusedSets === 0 && <span className="block text-xs font-medium text-red-700">{t('library.retake_no_sets')}</span>}
                </span>
                <span className="flex gap-2">
                  <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => act(() => api.post(`/api/admin/library/retakes/${r.id}`, { decision: 'GRANT' }))}>
                    {t('library.retake_grant')}
                  </button>
                  <button type="button" className="text-xs text-slate-500 underline" onClick={() => act(() => api.post(`/api/admin/library/retakes/${r.id}`, { decision: 'DECLINE' }))}>
                    {t('library.retake_decline')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TrainingPaymentSettings />
      <PaymentsAndGrace books={trainingBooks} onChanged={load} />

      <section className="card space-y-3">
        <h3 className="font-semibold text-brand-900">{t('library.trainees_heading')}</h3>
        <p className="text-sm text-slate-600">{t('library.trainees_help')}</p>
        <SearchPicker
          placeholder={t('library.search_person') ?? ''}
          searchPath="/api/admin/people?search="
          renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
          actionLabel={t('library.mark_paid')}
          searchButtonLabel={t('library.search')}
          onPick={(p) => act(() => api.post('/api/admin/library/trainees', { personId: p.id }))}
        />
        <ul className="divide-y divide-slate-100">
          {trainees.map((tr) => (
            <li key={tr.personId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-semibold">{tr.name}</span> <span className="text-slate-500">{tr.whatsappNumber}</span>
                <span className={`ml-2 rounded px-2 py-0.5 text-xs ${tr.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : tr.status === 'REQUESTED' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                  {t(`library.status_${tr.status.toLowerCase()}`)}
                </span>
                {tr.status === 'ACTIVE' && (
                  <span className="block text-xs text-slate-600">
                    {t('library.trainee_owed', { count: tr.owedBooks ?? 0 })}
                    {(tr.graceBooks ?? 0) > 0 && ` · ${t('library.trainee_grace', { count: tr.graceBooks })}`}
                  </span>
                )}
              </span>
              {tr.status === 'ACTIVE' ? (
                <span className="flex items-center gap-3">
                  <select
                    className="input w-auto py-1 text-xs"
                    aria-label={t('library.grace_set', { name: tr.name }) ?? ''}
                    value={tr.graceBooks ?? 0}
                    onChange={(e) => act(() => api.post(`/api/admin/library/trainees/${tr.personId}/grace`, { books: parseInt(e.target.value, 10) }))}
                  >
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? t('library.grace_none_option') : t('library.grace_option', { count: n })}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="text-xs text-slate-500 underline" onClick={() => window.confirm(t('library.confirm_revoke') ?? '') && act(() => api.post(`/api/admin/library/trainees/${tr.personId}/revoke`))}>
                    {t('library.revoke')}
                  </button>
                </span>
              ) : (
                <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => act(() => api.post('/api/admin/library/trainees', { personId: tr.personId }))}>
                  {t('library.mark_paid')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
