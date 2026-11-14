import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

// Leaders who studied on WhatsApp before the app: the central admin searches one person (name or WhatsApp number),
// then says how many books they completed there. Those books open for them, owe nothing and count as passed.
interface CreditView {
  personId: string;
  name: string;
  whatsappNumber: string;
  enrolled: boolean;
  booksCredited: number;
  totalBooks: number;
  booksOnSite: number;
  passedByExam: number;
}

export function WhatsAppCredit({ onChanged }: { onChanged?: () => void }) {
  const { t } = useTranslation();
  const [view, setView] = useState<CreditView | null>(null);
  const [books, setBooks] = useState('0');
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function pick(person: { id: string }) {
    setNote(null);
    try {
      const v = await api.get<CreditView>(`/api/admin/library/trainees/${person.id}/credit`);
      setView(v);
      setBooks(String(v.booksCredited));
      setNotify(true);
    } catch {
      setView(null);
      setNote({ ok: false, text: t('whatsappCredit.load_failed') });
    }
  }

  async function save() {
    if (!view) return;
    const count = parseInt(books, 10);
    if (!Number.isInteger(count) || count < 0 || count > view.totalBooks) {
      setNote({ ok: false, text: t('whatsappCredit.bad_number', { total: view.totalBooks }) });
      return;
    }
    // Lowering the number takes books away from the person: ask first.
    if (count < view.booksCredited && !window.confirm(t('whatsappCredit.confirm_lower', { name: view.name, from: view.booksCredited, to: count }) ?? '')) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await api.post<{ booksCredited: number; notified: boolean }>(`/api/admin/library/trainees/${view.personId}/credit`, { books: count, notify });
      setView({ ...view, booksCredited: res.booksCredited, enrolled: true });
      setNote({ ok: true, text: t('whatsappCredit.saved', { name: view.name, count: res.booksCredited }) + (res.notified ? ` ${t('whatsappCredit.told')}` : '') });
      onChanged?.();
    } catch (err) {
      setNote({ ok: false, text: err instanceof ApiError ? err.message : t('whatsappCredit.save_failed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card space-y-3" data-testid="whatsapp-credit">
      <h3 className="font-semibold text-brand-900">{t('whatsappCredit.title')}</h3>
      <p className="text-sm text-slate-600">{t('whatsappCredit.help')}</p>
      <SearchPicker
        placeholder={t('library.search_person') ?? ''}
        searchPath="/api/admin/people?search="
        renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
        actionLabel={t('whatsappCredit.choose')}
        searchButtonLabel={t('library.search')}
        onPick={(p) => void pick(p)}
      />
      {view && (
        <div className="space-y-3 rounded-lg bg-slate-50 p-3">
          <p className="text-sm">
            <span className="font-semibold">{view.name}</span> <span className="text-slate-500">{view.whatsappNumber}</span>
          </p>
          <p className="text-xs text-slate-600" data-testid="credit-now">
            {view.booksCredited > 0 ? t('whatsappCredit.now', { count: view.booksCredited }) : t('whatsappCredit.none_yet')}
            {view.passedByExam > 0 && ` · ${t('whatsappCredit.by_exam', { count: view.passedByExam })}`}
            {!view.enrolled && ` · ${t('whatsappCredit.not_started')}`}
          </p>
          <label className="block text-sm font-medium text-slate-800">
            {t('whatsappCredit.label', { total: view.totalBooks })}
            <input
              type="number"
              min={0}
              max={view.totalBooks}
              inputMode="numeric"
              className="input mt-1 w-28"
              value={books}
              onChange={(e) => setBooks(e.target.value)}
              data-testid="credit-input"
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            {t('whatsappCredit.tell_them')}
          </label>
          <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={busy} onClick={() => void save()} data-testid="credit-save">
            {t('whatsappCredit.save')}
          </button>
        </div>
      )}
      {note && (
        <p className={`text-sm ${note.ok ? 'text-green-700' : 'text-red-700'}`} role="status">
          {note.text}
        </p>
      )}
    </section>
  );
}
