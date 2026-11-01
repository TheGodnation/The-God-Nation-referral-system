import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface Summary {
  started: boolean;
  startsAt: string | null;
  clinicRate: number | null;
  earnedTotal: number;
  foundationTotal: number;
  members: number;
}

// The central admin starts the King's Token count: one tap to start now, or a
// chosen day. Once the day has arrived it is locked for everyone.
export function TokensCard({ base }: { base: string }) {
  const { t, i18n } = useTranslation();
  const [s, setS] = useState<Summary | null>(null);
  const [date, setDate] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    api.get<Summary>(`${base}/summary`).then(setS).catch(() => {});
  }, [base]);

  async function start(body: { now: true } | { date: string }) {
    setMessage(null);
    try {
      setS(await api.put<Summary>(`${base}/start`, body));
      setMessage({ kind: 'ok', text: 'now' in body ? t('tokensAdmin.started') : t('tokensAdmin.saved') });
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof ApiError ? err.message : t('tokensAdmin.failed') });
    }
  }

  function startNow() {
    if (window.confirm(t('tokensAdmin.confirm_now'))) void start({ now: true });
  }
  function setDay() {
    if (!date) {
      setMessage({ kind: 'error', text: t('tokensAdmin.day_required') });
      return;
    }
    void start({ date });
  }

  if (!s) return null;
  const nf = (n: number) => n.toLocaleString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 });
  const day = (iso: string) => new Date(iso).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="card space-y-2" data-testid="tokens-card">
      <h2 className="font-semibold text-brand-900">👑 {t('tokensAdmin.title')}</h2>
      <p className="text-sm text-slate-600">{t('tokensAdmin.help')}</p>
      <p className="text-sm font-medium text-slate-800">
        {s.started && s.startsAt ? t('tokensAdmin.started_on', { date: day(s.startsAt) }) : s.startsAt ? t('tokensAdmin.starts_on', { date: day(s.startsAt) }) : t('tokensAdmin.not_started')}
      </p>
      {s.started ? (
        <>
          {s.clinicRate !== null && <p className="text-sm text-slate-600">{t('tokensAdmin.rate_now', { rate: nf(s.clinicRate) })}</p>}
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            <div><dt className="text-slate-500">{t('tokensAdmin.earned_total')}</dt><dd className="font-semibold text-slate-900">{nf(s.earnedTotal)}</dd></div>
            <div><dt className="text-slate-500">{t('tokensAdmin.foundation_total')}</dt><dd className="font-semibold text-slate-900">{nf(s.foundationTotal)}</dd></div>
            <div><dt className="text-slate-500">{t('tokensAdmin.members')}</dt><dd className="font-semibold text-slate-900">{s.members}</dd></div>
          </dl>
        </>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <button type="button" className="btn-primary" onClick={startNow}>{t('tokensAdmin.start_now')}</button>
          <div>
            <label className="label" htmlFor={`tokens-day-${base}`}>{t('tokensAdmin.choose_day')}</label>
            <input id={`tokens-day-${base}`} type="date" className="input" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <button type="button" className="btn-secondary" onClick={setDay}>{t('tokensAdmin.set_day')}</button>
        </div>
      )}
      {message && (
        <p role={message.kind === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
