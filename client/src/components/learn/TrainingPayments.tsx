import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { otherFees } from '../../lib/bookPrice';

// Paying for leadership books (1,200 FCFA each, before the next book opens)
// and "study now, pay later" grace. Manual Mobile Money is the normal way:
// pay to the ministry's number, then send the transaction ID for the
// central admin to confirm. "Pay now" appears only once a payment company
// is connected on the server.

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

export function PayBookPanel({
  bookId,
  bookNumber,
  price,
  instructions,
  automatic,
  onDone,
}: {
  bookId: string;
  bookNumber: number;
  price: number;
  instructions: string | null;
  automatic: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedAutomatic, setStartedAutomatic] = useState(false);

  async function send(path: string, body: Record<string, unknown>) {
    setError(null);
    setBusy(true);
    try {
      await api.post(path, body);
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('payments.failed'));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (reference.trim().length < 3) return setError(t('payments.need_reference'));
    if (await send(`/api/member/training/books/${bookId}/payments`, { reference: reference.trim(), payerPhone: phone.trim() || undefined })) onDone();
  }

  async function payNow() {
    if (!phone.trim()) return setError(t('payments.need_phone'));
    if (await send(`/api/member/training/books/${bookId}/pay-now`, { phone: phone.trim() })) {
      setStartedAutomatic(true);
      onDone();
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => setOpen(true)}>
        {t('payments.pay_book', { price: fcfa(price) })}
      </button>
    );
  }

  return (
    <div className="mt-2 w-full space-y-3 rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm" data-testid={`pay-book-${bookNumber}`}>
      <p className="font-semibold text-brand-900">{t('payments.title', { number: bookNumber, price: fcfa(price) })}</p>
      {otherFees(price) > 0 && <p className="text-xs text-slate-500">{t('payments.fees_note', { fees: fcfa(otherFees(price)) })}</p>}
      {instructions ? <p className="whitespace-pre-wrap text-slate-700">{instructions}</p> : <p className="text-slate-600">{t('payments.no_instructions')}</p>}
      {startedAutomatic && <p className="font-medium text-green-700">{t('payments.approve_on_phone')}</p>}
      <form onSubmit={claim} className="space-y-2" noValidate>
        <label className="label" htmlFor={`ref-${bookId}`}>
          {t('payments.reference_label')}
        </label>
        <input id={`ref-${bookId}`} className="input" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="MP241021.1234.A56789" />
        <label className="label" htmlFor={`phone-${bookId}`}>
          {t('payments.phone_label')}
        </label>
        <input id={`phone-${bookId}`} className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+237 6XX XXX XXX" />
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={busy}>
            {t('payments.i_have_paid')}
          </button>
          {automatic && (
            <button type="button" className="btn-secondary" disabled={busy} onClick={payNow}>
              {t('payments.pay_now')}
            </button>
          )}
          <button type="button" className="text-slate-500 underline" onClick={() => setOpen(false)}>
            {t('payments.cancel')}
          </button>
        </div>
      </form>
    </div>
  );
}

export function GraceBox({
  graceBooks,
  maxGraceBooks,
  request,
  onDone,
}: {
  graceBooks: number;
  maxGraceBooks: number;
  request: { status: 'REQUESTED' | 'GRANTED' | 'DECLINED'; books: number } | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [books, setBooks] = useState(Math.min(2, maxGraceBooks));
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setError(null);
    try {
      await api.post('/api/member/training/grace', { books });
      setOpen(false);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('payments.failed'));
    }
  }

  return (
    <div className="space-y-2 text-sm">
      {graceBooks > 0 && <p className="font-medium text-green-700">{t('payments.grace_active', { count: graceBooks })}</p>}
      {request?.status === 'REQUESTED' ? (
        <p className="text-amber-800">{t('payments.grace_requested', { count: request.books })}</p>
      ) : open ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-slate-700">{t('payments.grace_explain', { max: maxGraceBooks })}</p>
          <label className="label" htmlFor="grace-books">
            {t('payments.grace_how_many')}
          </label>
          <select id="grace-books" className="input" value={books} onChange={(e) => setBooks(parseInt(e.target.value, 10))}>
            {Array.from({ length: maxGraceBooks }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {t('payments.grace_books', { count: n })}
              </option>
            ))}
          </select>
          {error && (
            <p role="alert" className="text-red-700">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={ask}>
              {t('payments.grace_send')}
            </button>
            <button type="button" className="text-slate-500 underline" onClick={() => setOpen(false)}>
              {t('payments.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {request?.status === 'DECLINED' && <p className="text-slate-600">{t('payments.grace_declined')}</p>}
          <button type="button" className="text-brand-700 underline" onClick={() => setOpen(true)}>
            {graceBooks > 0 ? t('payments.grace_change') : t('payments.grace_ask')}
          </button>
        </>
      )}
    </div>
  );
}
