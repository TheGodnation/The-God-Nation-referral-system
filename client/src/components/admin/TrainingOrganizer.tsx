import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

// The curriculum of the Leadership Academy, as the admin arranges it: levels, and the books inside them in order. A
// book's number is its place across all the levels, so there are no numbers to type: move a book up or down, move it
// into another level, add a level, reorder the levels, and every number follows. Nothing else about a book changes.

interface OrgBook {
  id: string;
  titleEn: string;
  titleFr: string | null;
  trainingOrder: number;
  hasFile: boolean;
  examStatus: string | null;
}
interface OrgLevel {
  id: string;
  position: number;
  titleEn: string;
  titleFr: string | null;
  summaryEn: string | null;
  summaryFr: string | null;
  books: OrgBook[];
}
interface Structure {
  levels: OrgLevel[];
  unplaced: OrgBook[];
  /** The number of books told to students (16), even while the last ones are not on the site yet. */
  programTotal?: number;
}

interface IntroData {
  en: string;
  fr: string;
  customEn: boolean;
  customFr: boolean;
}

// The introduction at the top of the Academy page: the standard text until the admin writes their own. One text for
// English, one for French; emptying a box puts the standard text back.
function IntroEditor() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [en, setEn] = useState('');
  const [fr, setFr] = useState('');
  const [custom, setCustom] = useState({ en: false, fr: false });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .get<IntroData>('/api/admin/library/training/intro')
      .then((r) => {
        setEn(r.en);
        setFr(r.fr);
        setCustom({ en: r.customEn, fr: r.customFr });
      })
      .catch(() => setMsg(t('organizer.load_failed')));
  }, [open, t]);

  async function save(body: { en?: string; fr?: string }) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.put<IntroData>('/api/admin/library/training/intro', body);
      setEn(r.en);
      setFr(r.fr);
      setCustom({ en: r.customEn, fr: r.customFr });
      setMsg(t('organizer.intro_saved'));
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : t('organizer.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 p-3" data-testid="intro-editor">
      <button type="button" className="font-semibold text-brand-900 underline" onClick={() => setOpen(!open)} data-testid="intro-toggle">
        {open ? t('organizer.intro_hide') : t('organizer.intro_edit')}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-slate-600">{t('organizer.intro_help')}</p>
          <label className="block text-sm font-medium text-slate-700">
            {t('organizer.intro_en')} {custom.en ? '' : `(${t('organizer.intro_standard')})`}
            <textarea className="input mt-1 font-mono text-xs" rows={14} value={en} onChange={(e) => setEn(e.target.value)} data-testid="intro-en" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            {t('organizer.intro_fr')} {custom.fr ? '' : `(${t('organizer.intro_standard')})`}
            <textarea className="input mt-1 font-mono text-xs" rows={14} value={fr} onChange={(e) => setFr(e.target.value)} data-testid="intro-fr" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => save({ en, fr })} data-testid="intro-save">
              {t('organizer.save')}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => save({ en: '', fr: '' })} data-testid="intro-reset">
              {t('organizer.intro_reset')}
            </button>
          </div>
          {msg && <p role="status" className="text-sm text-slate-700">{msg}</p>}
        </div>
      )}
    </section>
  );
}

// How many books the whole programme has. Students are told this number (and the certificate needs all of them) even
// while the last books are not on the site yet.
function ProgrammeTotal({ value, onSaved }: { value: number; onSaved: () => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(String(value));
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setText(String(value)), [value]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await api.put('/api/admin/library/training/total', { total: Number(text) });
      setMsg(t('organizer.total_saved'));
      onSaved();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : t('organizer.failed'));
    }
  }

  return (
    <form onSubmit={save} className="space-y-1 rounded-lg border border-slate-200 p-3" data-testid="programme-total">
      <label className="block text-sm font-semibold text-slate-800" htmlFor="programme-total-input">
        {t('organizer.total_label')}
      </label>
      <p className="text-xs text-slate-600">{t('organizer.total_help')}</p>
      <div className="flex gap-2">
        <input id="programme-total-input" className="input w-24" inputMode="numeric" value={text} onChange={(e) => setText(e.target.value.replace(/\D/g, ''))} data-testid="programme-total-input" />
        <button type="submit" className="btn-secondary" data-testid="programme-total-save">
          {t('organizer.save')}
        </button>
      </div>
      {msg && <p role="status" className="text-sm text-slate-700">{msg}</p>}
    </form>
  );
}

export function TrainingOrganizer({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Structure | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ titleEn: '', titleFr: '', summaryEn: '', summaryFr: '' });
  const [newLevel, setNewLevel] = useState('');
  const [bookEn, setBookEn] = useState('');
  const [bookFr, setBookFr] = useState('');
  const [bookLevel, setBookLevel] = useState('');
  const [bookNumber, setBookNumber] = useState('');

  const load = useCallback(() => {
    api
      .get<Structure>('/api/admin/library/training/structure')
      .then(setData)
      .catch(() => setError(t('organizer.load_failed')));
  }, [t]);
  useEffect(load, [load]);

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('organizer.failed'));
    }
  }

  const base = '/api/admin/library/training';
  const moveBook = (id: string, direction: 'up' | 'down') => run(() => api.post(`${base}/books/${id}/move`, { direction }));
  const moveToLevel = (id: string, levelId: string) => levelId && run(() => api.post(`${base}/books/${id}/level`, { levelId }));
  const moveLevel = (id: string, direction: 'up' | 'down') => run(() => api.post(`${base}/levels/${id}/move`, { direction }));
  const removeLevel = (id: string) => window.confirm(t('organizer.confirm_delete_level') ?? '') && run(() => api.delete(`${base}/levels/${id}`));
  const addLevel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLevel.trim()) return;
    await run(() => api.post(`${base}/levels`, { titleEn: newLevel.trim() }));
    setNewLevel('');
  };
  const addBook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookEn.trim()) return setError(t('library.need_title'));
    const number = Number(bookNumber);
    await run(() =>
      api.post('/api/admin/library/books', {
        kind: 'TRAINING',
        titleEn: bookEn.trim(),
        titleFr: bookFr.trim() || undefined,
        ...(bookNumber.trim() && Number.isInteger(number) && number > 0 ? { trainingOrder: number } : bookLevel ? { levelId: bookLevel } : {}),
      }),
    );
    setBookEn('');
    setBookFr('');
    setBookNumber('');
  };
  const startEdit = (l: OrgLevel) => {
    setEditing(l.id);
    setDraft({ titleEn: l.titleEn, titleFr: l.titleFr ?? '', summaryEn: l.summaryEn ?? '', summaryFr: l.summaryFr ?? '' });
  };
  const saveEdit = async (id: string) => {
    await run(() => api.patch(`${base}/levels/${id}`, draft));
    setEditing(null);
  };

  if (!data) return error ? <p className="text-sm text-red-700">{error}</p> : null;

  const arrow = 'rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-30';
  const levelOptions = data.levels;
  const allBooks = data.levels.flatMap((l) => l.books);

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3" data-testid="training-organizer">
      <div>
        <h4 className="font-semibold text-brand-900">{t('organizer.title')}</h4>
        <p className="text-xs text-slate-600">{t('organizer.help')}</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {data.levels.map((l, li) => (
        <section key={l.id} className="rounded-lg bg-slate-50 p-3" data-testid={`org-level-${l.id}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold text-slate-800">{l.titleEn}</p>
            <span className="flex items-center gap-1">
              <button type="button" className={arrow} disabled={li === 0} onClick={() => moveLevel(l.id, 'up')} aria-label={t('organizer.level_up') ?? ''} data-testid={`level-up-${l.id}`}>▲</button>
              <button type="button" className={arrow} disabled={li === data.levels.length - 1} onClick={() => moveLevel(l.id, 'down')} aria-label={t('organizer.level_down') ?? ''} data-testid={`level-down-${l.id}`}>▼</button>
              <button type="button" className="text-xs text-brand-700 underline" onClick={() => (editing === l.id ? setEditing(null) : startEdit(l))} data-testid={`level-edit-${l.id}`}>
                {editing === l.id ? t('organizer.close') : t('organizer.edit')}
              </button>
              <button type="button" className="text-xs text-red-700 underline disabled:opacity-30" disabled={l.books.length > 0} onClick={() => removeLevel(l.id)} data-testid={`level-delete-${l.id}`}>
                {t('organizer.delete_level')}
              </button>
            </span>
          </div>
          {editing === l.id && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input className="input" aria-label={t('organizer.title_en') ?? ''} placeholder={t('organizer.title_en') ?? ''} value={draft.titleEn} onChange={(e) => setDraft({ ...draft, titleEn: e.target.value })} />
              <input className="input" aria-label={t('organizer.title_fr') ?? ''} placeholder={t('organizer.title_fr') ?? ''} value={draft.titleFr} onChange={(e) => setDraft({ ...draft, titleFr: e.target.value })} />
              <textarea className="input sm:col-span-1" rows={3} aria-label={t('organizer.summary_en') ?? ''} placeholder={t('organizer.summary_en') ?? ''} value={draft.summaryEn} onChange={(e) => setDraft({ ...draft, summaryEn: e.target.value })} />
              <textarea className="input sm:col-span-1" rows={3} aria-label={t('organizer.summary_fr') ?? ''} placeholder={t('organizer.summary_fr') ?? ''} value={draft.summaryFr} onChange={(e) => setDraft({ ...draft, summaryFr: e.target.value })} />
              <button type="button" className="btn-primary sm:col-span-2" onClick={() => saveEdit(l.id)} data-testid={`level-save-${l.id}`}>
                {t('organizer.save')}
              </button>
            </div>
          )}
          {l.books.length === 0 ? (
            <p className="mt-2 text-xs text-slate-400">{t('organizer.empty_level')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-200">
              {l.books.map((b, bi) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm" data-testid={`org-book-${b.id}`}>
                  <span className="min-w-0 truncate">
                    <span className="font-semibold text-brand-800">{t('library.book', { number: b.trainingOrder })}</span> · {b.titleEn}
                  </span>
                  <span className="flex items-center gap-1">
                    <button type="button" className={arrow} disabled={li === 0 && bi === 0} onClick={() => moveBook(b.id, 'up')} aria-label={t('organizer.book_up') ?? ''} data-testid={`book-up-${b.id}`}>▲</button>
                    <button type="button" className={arrow} disabled={li === data.levels.length - 1 && bi === l.books.length - 1} onClick={() => moveBook(b.id, 'down')} aria-label={t('organizer.book_down') ?? ''} data-testid={`book-down-${b.id}`}>▼</button>
                    <select
                      className="rounded border border-slate-300 px-1 py-0.5 text-xs"
                      aria-label={t('organizer.move_to_level') ?? ''}
                      value=""
                      onChange={(e) => moveToLevel(b.id, e.target.value)}
                      data-testid={`book-level-${b.id}`}
                    >
                      <option value="">{t('organizer.move_to_level')}</option>
                      {levelOptions.filter((o) => o.id !== l.id).map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.titleEn}
                        </option>
                      ))}
                    </select>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {data.unplaced.length > 0 && (
        <section className="rounded-lg bg-amber-50 p-3" data-testid="org-unplaced">
          <p className="text-sm font-semibold text-amber-900">{t('organizer.unplaced')}</p>
          <ul className="mt-1 space-y-1">
            {data.unplaced.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>
                  {t('library.book', { number: b.trainingOrder ?? '' })} · {b.titleEn}
                </span>
                <select className="rounded border border-slate-300 px-1 py-0.5 text-xs" aria-label={t('organizer.move_to_level') ?? ''} value="" onChange={(e) => moveToLevel(b.id, e.target.value)} data-testid={`book-level-${b.id}`}>
                  <option value="">{t('organizer.move_to_level')}</option>
                  {levelOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.titleEn}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form onSubmit={addBook} className="space-y-2 rounded-lg border border-slate-200 p-3" data-testid="new-book-form">
        <p className="text-sm font-semibold text-slate-800">{t('organizer.add_book')}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className="input" aria-label={t('library.title_en') ?? ''} placeholder={t('library.title_en') ?? ''} value={bookEn} onChange={(e) => setBookEn(e.target.value)} data-testid="new-book-title-en" />
          <input className="input" aria-label={t('library.title_fr') ?? ''} placeholder={t('library.title_fr') ?? ''} value={bookFr} onChange={(e) => setBookFr(e.target.value)} />
          <select className="input" aria-label={t('organizer.level_label') ?? ''} value={bookLevel} onChange={(e) => setBookLevel(e.target.value)} data-testid="new-book-level">
            <option value="">{t('organizer.last_level')}</option>
            {levelOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.titleEn}
              </option>
            ))}
          </select>
          <input className="input" inputMode="numeric" aria-label={t('organizer.place_label') ?? ''} placeholder={t('organizer.place_label') ?? ''} value={bookNumber} onChange={(e) => setBookNumber(e.target.value.replace(/\D/g, ''))} data-testid="new-book-number" />
        </div>
        <p className="text-xs text-slate-500">{t('organizer.place_hint')}</p>
        <button type="submit" className="btn-primary" data-testid="new-book-add">
          ＋ {t('organizer.add_book_button')}
        </button>
      </form>

      <form onSubmit={addLevel} className="flex flex-col gap-2 sm:flex-row">
        <input className="input" aria-label={t('organizer.new_level') ?? ''} placeholder={t('organizer.new_level') ?? ''} value={newLevel} onChange={(e) => setNewLevel(e.target.value)} data-testid="new-level-title" />
        <button type="submit" className="btn-secondary whitespace-nowrap" data-testid="new-level-add">
          ＋ {t('organizer.add_level')}
        </button>
      </form>
      <p className="text-xs text-slate-500">{t('organizer.total', { count: allBooks.length })}</p>
      <ProgrammeTotal value={data.programTotal ?? allBooks.length} onSaved={load} />
      <IntroEditor />
    </div>
  );
}
