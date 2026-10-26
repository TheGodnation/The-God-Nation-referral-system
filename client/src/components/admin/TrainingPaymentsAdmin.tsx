import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

// Central admin: leadership book payments (1,200 FCFA a book) and
// "study now, pay later" grace. Manual Mobile Money payments arrive as
// "I have paid" claims with a transaction ID; confirming one can open the
// trainee's next book.

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

interface PaymentRow {
  id: string;
  person: { id: string; name: string; whatsappNumber: string } | null;
  bookNumber: number | null;
  amount: number;
  method: 'MANUAL' | 'AUTOMATIC';
  status: string;
  reference: string | null;
  payerPhone: string | null;
  createdAt: string;
}

interface GraceRow {
  id: string;
  person: { id: string; name: string; whatsappNumber: string };
  books: number;
  currentGraceBooks: number;
}

interface Summary {
  confirmed: { count: number; amount: number };
  thisMonth: { count: number; amount: number };
  waiting: number;
}

export function TrainingPaymentSettings() {
  const { t } = useTranslation();
  const [price, setPrice] = useState('1200');
  const [en, setEn] = useState('');
  const [fr, setFr] = useState('');
  const [provider, setProvider] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ price: number; instructionsEn: string; instructionsFr: string; automaticProvider: string | null }>('/api/admin/library/training-settings')
      .then((r) => {
        setPrice(String(r.price));
        setEn(r.instructionsEn);
        setFr(r.instructionsFr);
        setProvider(r.automaticProvider);
      })
      .catch(() => {});
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaved(false);
    setError(null);
    try {
      await api.put('/api/admin/library/training-settings', { price: parseInt(price, 10), instructionsEn: en, instructionsFr: fr });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('library.action_failed'));
    }
  }

  return (
    <form onSubmit={save} className="card space-y-2">
      <h3 className="font-semibold text-brand-900">{t('library.pay_settings_heading')}</h3>
      <label className="label" htmlFor="book-price">
        {t('library.pay_price')}
      </label>
      <input id="book-price" className="input" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ''))} />
      <p className="text-sm text-slate-600">{t('library.pay_instructions_help')}</p>
      <textarea className="input" rows={3} aria-label={t('library.pay_instructions_en') ?? ''} placeholder={t('library.pay_instructions_en') ?? ''} value={en} onChange={(e) => setEn(e.target.value)} />
      <textarea className="input" rows={3} aria-label={t('library.pay_instructions_fr') ?? ''} placeholder={t('library.pay_instructions_fr') ?? ''} value={fr} onChange={(e) => setFr(e.target.value)} />
      <p className="text-xs text-slate-500">{provider ? t('library.pay_automatic_on', { provider }) : t('library.pay_automatic_off')}</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary">
          {t('library.save')}
        </button>
        {saved && <span className="text-sm text-green-700">{t('library.saved')}</span>}
      </div>
    </form>
  );
}

export function PaymentsAndGrace({ books, onChanged }: { books: { id: string; trainingOrder: number | null; titleEn: string }[]; onChanged: () => void }) {
  const { t } = useTranslation();
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [grace, setGrace] = useState<GraceRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [graceBooks, setGraceBooks] = useState<Record<string, number>>({});
  const [recordFor, setRecordFor] = useState<{ id: string; name: string } | null>(null);
  const [recordBook, setRecordBook] = useState('');
  const [recordRef, setRecordRef] = useState('');
  const [error, setError] = useState<string | null>(null);

  function load() {
    Promise.all([
      api.get<{ items: PaymentRow[] }>('/api/admin/library/payments'),
      api.get<{ items: GraceRow[] }>('/api/admin/library/grace'),
      api.get<Summary>('/api/admin/library/payments/summary'),
    ])
      .then(([p, g, s]) => {
        setPayments(p.items);
        setGrace(g.items);
        setSummary(s);
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
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('library.action_failed'));
    }
  }

  async function record(e: React.FormEvent) {
    e.preventDefault();
    if (!recordFor || !recordBook) return;
    await act(() => api.post('/api/admin/library/payments', { personId: recordFor.id, bookId: recordBook, reference: recordRef.trim() || undefined }));
    setRecordFor(null);
    setRecordBook('');
    setRecordRef('');
  }

  return (
    <>
      <section className="card space-y-3">
        <h3 className="font-semibold text-brand-900">
          {t('library.payments_heading')}{' '}
          {payments.length > 0 && <span className="ml-1 rounded-full bg-amber-100 px-2 text-sm text-amber-800">{payments.length}</span>}
        </h3>
        {summary && (
          <p className="text-sm text-slate-700">
            {t('library.payments_summary', {
              month: fcfa(summary.thisMonth.amount),
              monthCount: summary.thisMonth.count,
              total: fcfa(summary.confirmed.amount),
              count: summary.confirmed.count,
            })}
          </p>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
        {payments.length === 0 ? (
          <p className="text-sm text-slate-400">{t('library.payments_none')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-semibold">{p.person?.name ?? '—'}</span> <span className="text-slate-500">{p.person?.whatsappNumber}</span>
                  <span className="block text-xs text-slate-600">
                    {t('library.book', { number: p.bookNumber ?? '' })} · {fcfa(p.amount)} · {t('library.payment_ref', { ref: p.reference ?? '—' })}
                    {p.payerPhone ? ` · ${p.payerPhone}` : ''} · {new Date(p.createdAt).toLocaleString()}
                  </span>
                </span>
                <span className="flex gap-2">
                  <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => act(() => api.post(`/api/admin/library/payments/${p.id}`, { decision: 'CONFIRM' }))}>
                    {t('library.payment_confirm')}
                  </button>
                  <button type="button" className="text-xs text-slate-500 underline" onClick={() => act(() => api.post(`/api/admin/library/payments/${p.id}`, { decision: 'REJECT' }))}>
                    {t('library.payment_reject')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={record} className="space-y-2 border-t border-slate-100 pt-3">
          <p className="text-sm font-medium text-slate-700">{t('library.payment_record_heading')}</p>
          {recordFor ? (
            <p className="text-sm">
              {recordFor.name}{' '}
              <button type="button" className="text-xs text-slate-500 underline" onClick={() => setRecordFor(null)}>
                {t('library.change')}
              </button>
            </p>
          ) : (
            <SearchPicker
              placeholder={t('library.search_person') ?? ''}
              searchPath="/api/admin/people?search="
              renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
              actionLabel={t('library.choose')}
              searchButtonLabel={t('library.search')}
              onPick={(p) => setRecordFor({ id: p.id, name: p.name })}
            />
          )}
          <select className="input" aria-label={t('library.payment_book') ?? ''} value={recordBook} onChange={(e) => setRecordBook(e.target.value)}>
            <option value="">{t('library.payment_book')}</option>
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {t('library.book', { number: b.trainingOrder ?? '' })}: {b.titleEn}
              </option>
            ))}
          </select>
          <input className="input" aria-label={t('library.payment_record_ref') ?? ''} placeholder={t('library.payment_record_ref') ?? ''} value={recordRef} onChange={(e) => setRecordRef(e.target.value)} />
          <button type="submit" className="btn-secondary" disabled={!recordFor || !recordBook}>
            {t('library.payment_record')}
          </button>
        </form>
      </section>

      <section className="card space-y-3">
        <h3 className="font-semibold text-brand-900">
          {t('library.grace_heading')} {grace.length > 0 && <span className="ml-1 rounded-full bg-amber-100 px-2 text-sm text-amber-800">{grace.length}</span>}
        </h3>
        <p className="text-sm text-slate-600">{t('library.grace_help')}</p>
        {grace.length === 0 ? (
          <p className="text-sm text-slate-400">{t('library.grace_none')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {grace.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>
                  <span className="font-semibold">{g.person.name}</span> <span className="text-slate-500">{g.person.whatsappNumber}</span>
                  <span className="block text-xs text-slate-600">{t('library.grace_asks', { count: g.books })}</span>
                </span>
                <span className="flex items-center gap-2">
                  <select
                    className="input w-auto py-1 text-xs"
                    aria-label={t('library.grace_grant_books') ?? ''}
                    value={graceBooks[g.id] ?? g.books}
                    onChange={(e) => setGraceBooks((prev) => ({ ...prev, [g.id]: parseInt(e.target.value, 10) }))}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => act(() => api.post(`/api/admin/library/grace/${g.id}`, { decision: 'GRANT', books: graceBooks[g.id] ?? g.books }))}>
                    {t('library.grace_grant')}
                  </button>
                  <button type="button" className="text-xs text-slate-500 underline" onClick={() => act(() => api.post(`/api/admin/library/grace/${g.id}`, { decision: 'DECLINE' }))}>
                    {t('library.retake_decline')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
