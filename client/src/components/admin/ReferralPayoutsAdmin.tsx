import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`;

interface PayoutRow {
  id: string;
  amount: number;
  phone: string;
  payeeName: string;
  requestedAt: string;
  person: { id: string; name: string; whatsappNumber: string };
  _count: { earnings: number };
}

interface EarningRow {
  id: string;
  amount: number;
  bookNumber: number | null;
  status: 'ACTIVE' | 'REVERSED';
  availableAt: string;
  createdAt: string;
  referrer: { id: string; name: string };
  buyer: { id: string; name: string } | null;
  payout: { status: string } | null;
}

interface Totals {
  waiting: number;
  available: number;
  inRequest: number;
  paidOut: number;
}

// Central admin: money owed to the people who invited book buyers, the payout
// requests to send by Mobile Money (then mark as paid here), the amounts and
// the latest earnings.
export function ReferralPayoutsAdmin() {
  const { t } = useTranslation();
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [earnings, setEarnings] = useState<EarningRow[]>([]);
  const [settings, setSettings] = useState({ referralCommission: '500', commissionHoldDays: '3', payoutMinimum: '5000' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api.get<{ items: PayoutRow[] }>('/api/admin/payouts').then((r) => setPayouts(r.items)).catch(() => setError(t('admin.referralPayouts.load_failed')));
    api
      .get<{ totals: Totals; items: EarningRow[] }>('/api/admin/referral-earnings')
      .then((r) => {
        setTotals(r.totals);
        setEarnings(r.items);
      })
      .catch(() => {});
    api
      .get<{ referralCommission: number; commissionHoldDays: number; payoutMinimum: number }>('/api/admin/referral-earnings/settings')
      .then((r) => setSettings({ referralCommission: String(r.referralCommission), commissionHoldDays: String(r.commissionHoldDays), payoutMinimum: String(r.payoutMinimum) }))
      .catch(() => {});
  }
  useEffect(load, []);

  async function markPaid(p: PayoutRow) {
    const reference = window.prompt(t('admin.referralPayouts.reference_prompt', { amount: fcfa(p.amount), name: p.person.name }) ?? '', '');
    if (reference === null) return;
    setError(null);
    try {
      await api.patch(`/api/admin/payouts/${p.id}/paid`, { reference: reference.trim() || undefined });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.referralPayouts.action_failed'));
    }
  }

  async function reject(p: PayoutRow) {
    const note = window.prompt(t('admin.referralPayouts.reject_prompt') ?? '', '');
    if (note === null) return;
    setError(null);
    try {
      await api.patch(`/api/admin/payouts/${p.id}/reject`, { note: note.trim() || undefined });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.referralPayouts.action_failed'));
    }
  }

  async function reverse(e: EarningRow) {
    if (!window.confirm(t('admin.referralPayouts.reverse_confirm', { amount: fcfa(e.amount), name: e.referrer.name }) ?? '')) return;
    setError(null);
    try {
      await api.post(`/api/admin/referral-earnings/${e.id}/reverse`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.referralPayouts.action_failed'));
    }
  }

  async function saveSettings(ev: React.FormEvent) {
    ev.preventDefault();
    setSaved(false);
    setError(null);
    try {
      await api.patch('/api/admin/referral-earnings/settings', {
        referralCommission: Number(settings.referralCommission),
        commissionHoldDays: Number(settings.commissionHoldDays),
        payoutMinimum: Number(settings.payoutMinimum),
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.referralPayouts.action_failed'));
    }
  }

  const stateOf = (e: EarningRow) =>
    e.status === 'REVERSED' ? 'reversed' : e.payout?.status === 'PAID' ? 'paid' : e.payout?.status === 'REQUESTED' ? 'requested' : new Date(e.availableAt) > new Date() ? 'waiting' : 'available';

  return (
    <section className="card mt-6 space-y-4">
      <div>
        <h3 className="font-semibold text-brand-900">{t('admin.referralPayouts.title')}</h3>
        <p className="text-sm text-slate-500">{t('admin.referralPayouts.description')}</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}

      {totals && (
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {(['available', 'waiting', 'inRequest', 'paidOut'] as const).map((k) => (
            <div key={k} className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">{t(`admin.referralPayouts.total_${k}`)}</p>
              <p className="font-semibold text-slate-900">{fcfa(totals[k])}</p>
            </div>
          ))}
        </div>
      )}

      <div>
        <h4 className="mb-1 text-sm font-semibold text-slate-800">{t('admin.referralPayouts.requests_title')}</h4>
        {payouts.length === 0 ? (
          <p className="text-sm text-slate-400">{t('admin.referralPayouts.no_requests')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {payouts.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block font-medium text-slate-900">
                    {p.person.name} — {fcfa(p.amount)}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {t('admin.referralPayouts.send_to', { phone: p.phone, name: p.payeeName })} · {new Date(p.requestedAt).toLocaleDateString()} · {t('admin.referralPayouts.earnings_count', { count: p._count.earnings })}
                  </span>
                </span>
                <span className="flex gap-3">
                  <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={() => void markPaid(p)}>
                    {t('admin.referralPayouts.mark_paid')}
                  </button>
                  <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => void reject(p)}>
                    {t('admin.referralPayouts.reject')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form onSubmit={saveSettings} className="space-y-2 border-t border-slate-100 pt-3">
        <h4 className="text-sm font-semibold text-slate-800">{t('admin.referralPayouts.settings_title')}</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="text-xs text-slate-600">
            {t('admin.referralPayouts.commission')}
            <input className="input mt-1" inputMode="numeric" value={settings.referralCommission} onChange={(e) => setSettings((s) => ({ ...s, referralCommission: e.target.value }))} />
          </label>
          <label className="text-xs text-slate-600">
            {t('admin.referralPayouts.hold_days')}
            <input className="input mt-1" inputMode="numeric" value={settings.commissionHoldDays} onChange={(e) => setSettings((s) => ({ ...s, commissionHoldDays: e.target.value }))} />
          </label>
          <label className="text-xs text-slate-600">
            {t('admin.referralPayouts.minimum')}
            <input className="input mt-1" inputMode="numeric" value={settings.payoutMinimum} onChange={(e) => setSettings((s) => ({ ...s, payoutMinimum: e.target.value }))} />
          </label>
        </div>
        <button type="submit" className="btn-secondary px-3 py-1.5 text-sm">
          {t('admin.referralPayouts.save')}
        </button>
        {saved && <span className="ml-3 text-sm text-green-700">{t('admin.referralPayouts.saved')}</span>}
      </form>

      <div className="border-t border-slate-100 pt-3">
        <h4 className="mb-1 text-sm font-semibold text-slate-800">{t('admin.referralPayouts.latest_title')}</h4>
        {earnings.length === 0 ? (
          <p className="text-sm text-slate-400">{t('admin.referralPayouts.no_earnings')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {earnings.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  {e.referrer.name} ← {e.buyer?.name ?? '—'}
                  {e.bookNumber ? ` (${t('earnings.book', { number: e.bookNumber })})` : ''} · {fcfa(e.amount)}
                </span>
                <span className="flex items-center gap-3 text-xs text-slate-500">
                  {t(`earnings.state_${stateOf(e)}`)}
                  {stateOf(e) === 'waiting' || stateOf(e) === 'available' ? (
                    <button type="button" className="text-red-700 hover:underline" onClick={() => void reverse(e)}>
                      {t('admin.referralPayouts.reverse')}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
