import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

type Mode = 'OFF' | 'TEST' | 'ON';
interface Row { id: string; at: string; to: string; kind: string; status: 'SENT' | 'FAILED' | 'SKIPPED'; reason: string | null }
interface Summary { mode: Mode; configured: boolean; today: { sent: number; failed: number; skipped: number }; recent: Row[] }

const MODES: Mode[] = ['OFF', 'TEST', 'ON'];

// The central admin's switch for the automatic WhatsApp messages (Meta's WhatsApp Business Platform): Off, Test (only the central
// admin's own number) or On (every member who agreed to WhatsApp messages), a button that sends Meta's sample message, and the list
// of what went out lately. It can only be switched on once the access token and the number are set up on the server.
export function WhatsAppCloudCard({ base }: { base: string }) {
  const { t } = useTranslation();
  const [s, setS] = useState<Summary | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState('');

  useEffect(() => {
    api.get<Summary>(base).then(setS).catch(() => {});
  }, [base]);

  async function choose(mode: Mode) {
    setMsg(null);
    try {
      setS(await api.put<Summary>(base, { mode }));
      setMsg({ ok: true, text: t('whatsappCloud.saved') });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError && err.code === 'NOT_CONFIGURED' ? t('whatsappCloud.not_configured') : t('whatsappCloud.failed') });
    }
  }

  async function sendTest() {
    setMsg(null);
    setBusy(true);
    try {
      setS(await api.post<Summary>(`${base}/test`, testTo.trim() ? { to: testTo.trim() } : {}));
      setMsg({ ok: true, text: t('whatsappCloud.test_sent') });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError && err.code === 'NOT_CONFIGURED' ? t('whatsappCloud.not_configured') : t('whatsappCloud.test_failed', { why: err instanceof ApiError ? err.message : '' }) });
    } finally {
      setBusy(false);
    }
  }

  if (!s) return null;
  return (
    <div className="card space-y-3" data-testid="whatsapp-cloud-card">
      <h2 className="font-semibold text-brand-900">💬 {t('whatsappCloud.title')}</h2>
      <p className="text-xs text-slate-500">{t('whatsappCloud.help')}</p>
      <p className={`rounded-lg px-3 py-2 text-xs ${s.configured ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`} role="note" data-testid="whatsapp-cloud-config">
        {s.configured ? t('whatsappCloud.configured') : t('whatsappCloud.not_configured')}
      </p>
      <div role="radiogroup" aria-label={t('whatsappCloud.title') ?? ''} className="space-y-1.5">
        {MODES.map((m) => (
          <label key={m} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${s.mode === m ? 'border-brand-600 bg-brand-50' : 'border-slate-200'}`}>
            <input type="radio" name="wa-mode" className="mt-1 h-4 w-4" checked={s.mode === m} onChange={() => void choose(m)} />
            <span>
              <span className="font-semibold text-slate-900">{t(`whatsappCloud.mode_${m}`)}</span>
              <span className="block text-xs text-slate-600">{t(`whatsappCloud.mode_${m}_help`)}</span>
            </span>
          </label>
        ))}
      </div>
      <div>
        <label className="label" htmlFor="wa-test-to">{t('whatsappCloud.test_number_label')}</label>
        <input id="wa-test-to" type="tel" inputMode="tel" className="input" placeholder="+237…" value={testTo} onChange={(e) => setTestTo(e.target.value)} data-testid="whatsapp-cloud-test-to" />
        <p className="mt-1 text-xs text-slate-500">{t('whatsappCloud.test_number_hint')}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary px-3 py-2 text-sm" disabled={busy || !s.configured} onClick={() => void sendTest()} data-testid="whatsapp-cloud-test">
          {busy ? t('whatsappCloud.sending') : t('whatsappCloud.send_test')}
        </button>
        <span className="text-xs text-slate-500">{t('whatsappCloud.today', { sent: s.today.sent, failed: s.today.failed, skipped: s.today.skipped })}</span>
      </div>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>
      )}
      {s.recent.length > 0 && (
        <ul className="divide-y divide-slate-100 text-xs" data-testid="whatsapp-cloud-recent">
          {s.recent.map((r) => (
            <li key={r.id} className="flex items-baseline justify-between gap-2 py-1.5">
              <span className="min-w-0">
                <span className="font-medium text-slate-800">{t(`whatsappCloud.kind_${r.kind}`, { defaultValue: r.kind })}</span>
                <span className="text-slate-500"> · {r.to}</span>
                {r.reason && <span className="block truncate text-slate-500">{r.reason}</span>}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${r.status === 'SENT' ? 'bg-green-50 text-green-700' : r.status === 'FAILED' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'}`}>
                {t(`whatsappCloud.status_${r.status}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
