import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { pictureToCover } from '../../lib/bookCover';
import { BookCover } from '../learn/BookCover';

// Central admin, per leadership book: its cover, title and description,
// and its chapters with a short summary each — what members see on the
// book's page in the Leadership School.

export interface AdminBook {
  id: string;
  trainingOrder: number | null;
  titleEn: string;
  titleFr: string | null;
  descriptionEn?: string | null;
  descriptionFr?: string | null;
  coverUrl?: string | null;
  coverSource?: 'AUTO' | 'MANUAL' | null;
  coverUrlFr?: string | null;
  coverSourceFr?: 'AUTO' | 'MANUAL' | null;
  pageCount?: number | null;
  chapterCount?: number;
}

interface Chapter {
  id: string;
  order: number;
  titleEn: string;
  titleFr: string | null;
  summaryEn: string | null;
  summaryFr: string | null;
}

function useAct(onError: (message: string) => void) {
  const { t } = useTranslation();
  return async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return true;
    } catch (err) {
      onError(err instanceof ApiError ? err.message : t('library.action_failed'));
      return false;
    }
  };
}

function CoverControl({ book, language = 'en', onChanged }: { book: AdminBook; language?: 'en' | 'fr'; onChanged: () => void }) {
  const { t } = useTranslation();
  const french = language === 'fr';
  const url = (french ? book.coverUrlFr : book.coverUrl) ?? null;
  const source = french ? book.coverSourceFr : book.coverSource;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = useAct(setError);

  async function choose(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    const image = file.type.startsWith('image/') ? await pictureToCover(file) : null;
    if (!image) {
      setBusy(false);
      setError(t('library.cover_bad'));
      return;
    }
    if (await act(() => api.put(`/api/admin/library/books/${book.id}/cover`, { image, source: 'MANUAL', language }))) onChanged();
    setBusy(false);
    if (input.current) input.current.value = '';
  }

  return (
    <div className="flex gap-3">
      <div className="w-20 shrink-0">
        <BookCover number={book.trainingOrder ?? 0} title={book.titleEn} coverUrl={url} />
      </div>
      <div className="space-y-1 text-sm">
        <p className="font-medium text-slate-700">{t(`library.cover_title_${language}`)}</p>
        <p className="text-slate-600">
          {source === 'MANUAL' ? t('library.cover_manual') : source === 'AUTO' ? t('library.cover_auto') : t(french ? 'library.cover_none_fr' : 'library.cover_none')}
        </p>
        <button type="button" className="btn-secondary px-2 py-1 text-xs" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t('library.uploading') : t('library.cover_choose')}
        </button>
        {url && (
          <button
            type="button"
            className="ml-2 text-xs text-slate-500 underline"
            onClick={async () => (await act(() => api.delete(`/api/admin/library/books/${book.id}/cover${french ? '?language=fr' : ''}`))) && onChanged()}
          >
            {t('library.cover_remove')}
          </button>
        )}
        <input ref={input} type="file" accept="image/*" className="hidden" aria-label={french ? `${t('library.cover_choose')} (${t('library.language_fr')})` : (t('library.cover_choose') ?? '')} onChange={(e) => choose(e.target.files?.[0])} />
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );
}

function DetailsForm({ book, onChanged }: { book: AdminBook; onChanged: () => void }) {
  const { t } = useTranslation();
  const [titleEn, setTitleEn] = useState(book.titleEn);
  const [titleFr, setTitleFr] = useState(book.titleFr ?? '');
  const [descriptionEn, setDescriptionEn] = useState(book.descriptionEn ?? '');
  const [descriptionFr, setDescriptionFr] = useState(book.descriptionFr ?? '');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = useAct(setError);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    if (!titleEn.trim()) return setError(t('library.need_title'));
    if (await act(() => api.patch(`/api/admin/library/books/${book.id}`, { titleEn: titleEn.trim(), titleFr: titleFr.trim(), descriptionEn: descriptionEn.trim(), descriptionFr: descriptionFr.trim() }))) {
      setSaved(true);
      onChanged();
    }
  }

  return (
    <form onSubmit={save} className="space-y-2">
      <input className="input" aria-label={t('library.title_en') ?? ''} placeholder={t('library.title_en') ?? ''} value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
      <input className="input" aria-label={t('library.title_fr') ?? ''} placeholder={t('library.title_fr') ?? ''} value={titleFr} onChange={(e) => setTitleFr(e.target.value)} />
      <textarea className="input" rows={3} aria-label={t('library.description_en') ?? ''} placeholder={t('library.description_en') ?? ''} value={descriptionEn} onChange={(e) => setDescriptionEn(e.target.value)} />
      <textarea className="input" rows={3} aria-label={t('library.description_fr') ?? ''} placeholder={t('library.description_fr') ?? ''} value={descriptionFr} onChange={(e) => setDescriptionFr(e.target.value)} />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary px-3 py-1 text-sm">
          {t('library.save')}
        </button>
        {saved && <span className="text-sm text-green-700">{t('library.saved')}</span>}
      </div>
    </form>
  );
}

function ChapterForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: Chapter;
  submitLabel: string;
  onSubmit: (values: { titleEn: string; titleFr: string; summaryEn: string; summaryFr: string }) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [titleEn, setTitleEn] = useState(initial?.titleEn ?? '');
  const [titleFr, setTitleFr] = useState(initial?.titleFr ?? '');
  const [summaryEn, setSummaryEn] = useState(initial?.summaryEn ?? '');
  const [summaryFr, setSummaryFr] = useState(initial?.summaryFr ?? '');
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!titleEn.trim()) return setError(t('library.chapter_need_title'));
    setError(null);
    const ok = await onSubmit({ titleEn: titleEn.trim(), titleFr: titleFr.trim(), summaryEn: summaryEn.trim(), summaryFr: summaryFr.trim() });
    if (ok && !initial) {
      setTitleEn('');
      setTitleFr('');
      setSummaryEn('');
      setSummaryFr('');
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2 rounded-lg bg-slate-50 p-3">
      <input className="input" aria-label={t('library.chapter_title_en') ?? ''} placeholder={t('library.chapter_title_en') ?? ''} value={titleEn} onChange={(e) => setTitleEn(e.target.value)} />
      <input className="input" aria-label={t('library.chapter_title_fr') ?? ''} placeholder={t('library.chapter_title_fr') ?? ''} value={titleFr} onChange={(e) => setTitleFr(e.target.value)} />
      <textarea className="input" rows={3} aria-label={t('library.chapter_summary_en') ?? ''} placeholder={t('library.chapter_summary_en') ?? ''} value={summaryEn} onChange={(e) => setSummaryEn(e.target.value)} />
      <textarea className="input" rows={3} aria-label={t('library.chapter_summary_fr') ?? ''} placeholder={t('library.chapter_summary_fr') ?? ''} value={summaryFr} onChange={(e) => setSummaryFr(e.target.value)} />
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-3">
        <button type="submit" className="btn-primary px-3 py-1 text-sm">
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="text-sm text-slate-500 underline" onClick={onCancel}>
            {t('payments.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}

function Chapters({ bookId, onChanged }: { bookId: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Chapter[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = useAct(setError);

  function load() {
    api
      .get<{ items: Chapter[] }>(`/api/admin/library/books/${bookId}/chapters`)
      .then((r) => setItems(r.items))
      .catch(() => setError(t('library.load_failed')));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [bookId]);

  async function change(fn: () => Promise<unknown>) {
    setError(null);
    const ok = await act(fn);
    if (ok) {
      load();
      onChanged();
    }
    return ok;
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-semibold text-slate-700">{t('library.chapters_heading')}</p>
      <p className="text-xs text-slate-500">{t('library.chapters_help')}</p>
      {error && <p className="text-xs text-red-700">{error}</p>}
      {items && items.length === 0 && <p className="text-sm text-slate-400">{t('library.chapters_none')}</p>}
      <ol className="space-y-2">
        {items?.map((c, i) =>
          editing === c.id ? (
            <li key={c.id}>
              <ChapterForm
                initial={c}
                submitLabel={t('library.save')}
                onCancel={() => setEditing(null)}
                onSubmit={async (v) => {
                  const ok = await change(() => api.patch(`/api/admin/library/chapters/${c.id}`, v));
                  if (ok) setEditing(null);
                  return ok;
                }}
              />
            </li>
          ) : (
            <li key={c.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 p-2 text-sm">
              <span className="min-w-0">
                <span className="font-semibold text-slate-800">
                  {t('library.chapter_number', { number: i + 1 })}: {c.titleEn}
                </span>
                <span className={`block text-xs ${c.summaryEn ? 'text-slate-600' : 'text-amber-700'}`}>{c.summaryEn ? c.summaryEn.slice(0, 140) + (c.summaryEn.length > 140 ? '…' : '') : t('library.chapter_no_summary')}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs">
                <button type="button" aria-label={t('library.chapter_up') ?? ''} disabled={i === 0} className="disabled:opacity-30" onClick={() => change(() => api.post(`/api/admin/library/chapters/${c.id}/move`, { direction: 'UP' }))}>
                  ▲
                </button>
                <button type="button" aria-label={t('library.chapter_down') ?? ''} disabled={i === items.length - 1} className="disabled:opacity-30" onClick={() => change(() => api.post(`/api/admin/library/chapters/${c.id}/move`, { direction: 'DOWN' }))}>
                  ▼
                </button>
                <button type="button" className="text-brand-700 underline" onClick={() => setEditing(c.id)}>
                  {t('library.chapter_edit')}
                </button>
                <button
                  type="button"
                  className="text-slate-500 underline"
                  onClick={() => window.confirm(t('library.chapter_confirm_delete') ?? '') && change(() => api.delete(`/api/admin/library/chapters/${c.id}`))}
                >
                  {t('library.chapter_delete')}
                </button>
              </span>
            </li>
          ),
        )}
      </ol>
      <ChapterForm submitLabel={`＋ ${t('library.chapter_add')}`} onSubmit={(v) => change(() => api.post(`/api/admin/library/books/${bookId}/chapters`, v))} />
    </div>
  );
}

/** "Cover & chapters" for one leadership book, opened from the Library tab. */
export function BookDetailsAdmin({ book, onChanged }: { book: AdminBook; onChanged: () => void }) {
  return (
    <div className="mt-2 w-full space-y-4 rounded-lg border border-brand-100 p-3">
      <CoverControl book={book} onChanged={onChanged} />
      <CoverControl book={book} language="fr" onChanged={onChanged} />
      <DetailsForm book={book} onChanged={onChanged} />
      <Chapters bookId={book.id} onChanged={onChanged} />
    </div>
  );
}
