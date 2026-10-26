import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { NotificationBell } from '../components/NotificationBell';
import { MemberNav } from '../components/member/MemberNav';
import { api, ApiError } from '../lib/api';

interface EarningsData {
  settings: { commission: number; holdDays: number; minimum: number };
  summary: { waiting: number; available: number; paidOut: number; inRequest: number; total: number };
  canRequestPayout: boolean;
  items: { id: string; buyerFirstName: string | null; bookNumber: number | null; amount: number; createdAt: string; availableAt: string; state: 'WAITING' | 'AVAILABLE' | 'REQUESTED' | 'PAID' | 'REVERSED' }[];
  payouts: { id: string; amount: number; phone: string; status: 'REQUESTED' | 'PAID' | 'REJECTED' | 'CANCELLED'; requestedAt: string; decidedAt: string | null; reference: string | null }[];
}

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

// "My earnings": what the member has earned from the books bought by the
// people they invited, when it counts, and asking to be paid out once the
// balance reaches the minimum. Only first names of buyers are shown.
export function MemberEarningsPage() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<EarningsData | null>(null);
  const [failed, setFailed] = useState(false);
  const [phone, setPhone] = useState('');
  const [payee, setPayee] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function load() {
    api
      .get<EarningsData>('/api/member/earnings')
      .then((r) => {
        setData(r);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }
  useEffect(load, []);

  async function requestPayout(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await api.post('/api/member/earnings/payout', { phone: phone.trim(), payeeName: payee.trim() });
      setMessage({ kind: 'ok', text: t('earnings.requested') });
      setPhone('');
      setPayee('');
      load();
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t('earnings.failed') });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    if (!window.confirm(t('earnings.cancel_confirm') ?? '')) return;
    try {
      await api.delete(`/api/member/earnings/payout/${id}`);
      load();
    } catch {
      setMessage({ kind: 'error', text: t('earnings.failed') });
    }
  }

  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language);
  const open = data?.payouts.find((p) => p.status === 'REQUESTED') ?? null;
  const toGo = data ? Math.max(0, data.settings.minimum - data.summary.available) : 0;
  const progress = data ? Math.min(100, Math.round((data.summary.available / data.settings.minimum) * 100)) : 0;

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/member/me" aria-label={t('wall.back') ?? ''} className="text-2xl leading-none text-slate-600">
              ←
            </Link>
            <h1 className="text-2xl font-bold text-brand-900">{t('earnings.title')}</h1>
          </div>
          <NotificationBell />
        </div>

        {failed && !data && <p className="text-sm text-red-700">{t('earnings.load_failed')}</p>}
        {!data && !failed && <p className="text-sm text-slate-400">{t('memberDashboard.loading')}</p>}

        {data && (
          <>
            <p className="card text-sm text-slate-700">
              {t('earnings.how', { commission: fcfa(data.settings.commission), days: data.settings.holdDays, minimum: fcfa(data.settings.minimum) })}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-emerald-50 p-4" data-testid="balance-available">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">{t('earnings.available')}</p>
                <p className="text-2xl font-bold text-emerald-900">{fcfa(data.summary.available)}</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-4" data-testid="balance-waiting">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">{t('earnings.waiting')}</p>
                <p className="text-2xl font-bold text-amber-900">{fcfa(data.summary.waiting)}</p>
              </div>
              <div className="rounded-xl bg-sky-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">{t('earnings.in_request')}</p>
                <p className="text-xl font-bold text-sky-900">{fcfa(data.summary.inRequest)}</p>
              </div>
              <div className="rounded-xl bg-slate-100 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{t('earnings.paid_out')}</p>
                <p className="text-xl font-bold text-slate-800">{fcfa(data.summary.paidOut)}</p>
              </div>
            </div>

            <section className="card space-y-3">
              <h2 className="font-semibold text-brand-900">{t('earnings.payout_title')}</h2>
              {open ? (
                <div className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
                  <p className="font-medium">{t('earnings.open_request', { amount: fcfa(open.amount) })}</p>
                  <p className="text-xs text-sky-800">
                    {open.phone} · {date(open.requestedAt)}
                  </p>
                  <button type="button" className="mt-2 text-xs text-red-700 underline" onClick={() => void cancel(open.id)}>
                    {t('earnings.cancel')}
                  </button>
                </div>
              ) : data.canRequestPayout ? (
                <form onSubmit={requestPayout} className="space-y-2">
                  <p className="text-sm text-slate-600">{t('earnings.ready', { amount: fcfa(data.summary.available) })}</p>
                  <div>
                    <label className="label" htmlFor="payout-phone">
                      {t('earnings.phone_label')}
                    </label>
                    <input id="payout-phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+237 6XX XX XX XX" />
                  </div>
                  <div>
                    <label className="label" htmlFor="payout-name">
                      {t('earnings.name_label')}
                    </label>
                    <input id="payout-name" className="input" maxLength={80} value={payee} onChange={(e) => setPayee(e.target.value)} />
                  </div>
                  <button type="submit" className="btn-primary px-4 py-2" disabled={busy || phone.trim().length < 8 || payee.trim().length < 2}>
                    {t('earnings.request_button')}
                  </button>
                </form>
              ) : (
                <div className="space-y-1">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-sm text-slate-600">{t('earnings.to_go', { amount: fcfa(toGo), minimum: fcfa(data.settings.minimum) })}</p>
                </div>
              )}
              {message && (
                <p role={message.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${message.kind === 'error' ? 'text-red-700' : 'text-green-700'}`}>
                  {message.text}
                </p>
              )}
            </section>

            <section className="card">
              <h2 className="mb-2 font-semibold text-brand-900">{t('earnings.list_title')}</h2>
              {data.items.length === 0 ? (
                <p className="text-sm text-slate-500">{t('earnings.empty')}</p>
              ) : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.items.map((e) => (
                    <li key={e.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900">
                          {e.buyerFirstName ?? t('earnings.someone')}
                          {e.bookNumber ? ` · ${t('earnings.book', { number: e.bookNumber })}` : ''}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {date(e.createdAt)}
                          {e.state === 'WAITING' ? ` · ${t('earnings.counts_from', { date: date(e.availableAt) })}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold text-slate-900">+{fcfa(e.amount)}</span>
                        <span className="block text-xs text-slate-500">{t(`earnings.state_${e.state.toLowerCase()}`)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {data.payouts.length > 0 && (
              <section className="card">
                <h2 className="mb-2 font-semibold text-brand-900">{t('earnings.payouts_title')}</h2>
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.payouts.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <span>
                        <span className="block font-medium text-slate-900">{fcfa(p.amount)}</span>
                        <span className="block text-xs text-slate-500">
                          {p.phone} · {date(p.decidedAt ?? p.requestedAt)}
                          {p.reference ? ` · ${p.reference}` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-slate-600">{t(`earnings.payout_${p.status.toLowerCase()}`)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <MemberNav />
      </section>
    </PageShell>
  );
}
