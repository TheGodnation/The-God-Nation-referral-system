import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

type Kind = 'FINISH_SIGNUP_1' | 'FINISH_SIGNUP_2' | 'FINISH_PROFILE' | 'WINBACK';
const KINDS: Kind[] = ['FINISH_SIGNUP_1', 'FINISH_SIGNUP_2', 'FINISH_PROFILE', 'WINBACK'];
type NudgeKind = 'NUDGE_DAY3' | 'NUDGE_DAY7';
const NUDGES: NudgeKind[] = ['NUDGE_DAY3', 'NUDGE_DAY7'];

interface Summary {
  enabled: boolean;
  quietDays: number;
  dailyCap: number;
  emailConfigured: boolean;
  sentToday: number;
  last7: Record<Kind, number>;
  pending: Record<Kind, number>;
  // Phone and in-app nudges at 3 and 7 days (not email). Absent on an older server.
  nudges?: { enabled: boolean; pending: Record<NudgeKind, number>; last7: Record<NudgeKind, number>; sentToday: number };
}

// The central admin's switch for reminder emails: on or off, how many quiet
// days before "we miss you", the most emails in one day, and what is waiting
// to go out and what went out lately. Off until switched on.
export function RemindersCard({ base }: { base: string }) {
  const { t } = useTranslation();
  const [s, setS] = useState<Summary | null>(null);
  const [form, setForm] = useState({ enabled: false, quietDays: '7', dailyCap: '40', nudgesEnabled: false });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function load(r: Summary) {
    setS(r);
    setForm({ enabled: r.enabled, quietDays: String(r.quietDays), dailyCap: String(r.dailyCap), nudgesEnabled: r.nudges?.enabled ?? false });
  }

  useEffect(() => {
    api.get<Summary>(base).then(load).catch(() => {});
  }, [base]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      load(await api.put<Summary>(base, { enabled: form.enabled, quietDays: Number(form.quietDays), dailyCap: Number(form.dailyCap), ...(s?.nudges ? { nudgesEnabled: form.nudgesEnabled } : {}) }));
      setMsg({ ok: true, text: t('reminders.saved') });
    } catch {
      setMsg({ ok: false, text: t('reminders.failed') });
    }
  }

  if (!s) return null;
  return (
    <form onSubmit={save} className="card space-y-3" data-testid="reminders-card">
      <h2 className="font-semibold text-brand-900">{t('reminders.title')}</h2>
      <p className="text-xs text-slate-500">{t('reminders.help')}</p>
      {!s.emailConfigured && <p role="note" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{t('reminders.email_off')}</p>}
      <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <input type="checkbox" className="h-4 w-4" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
        {t('reminders.enabled')}
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="rem-quiet">{t('reminders.quiet_days')}</label>
          <input id="rem-quiet" className="input" inputMode="numeric" value={form.quietDays} onChange={(e) => setForm({ ...form, quietDays: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="rem-cap">{t('reminders.daily_cap')}</label>
          <input id="rem-cap" className="input" inputMode="numeric" value={form.dailyCap} onChange={(e) => setForm({ ...form, dailyCap: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="font-medium text-brand-900">{t('reminders.pending_title')}</p>
          <ul className="mt-1 space-y-0.5 text-slate-600">
            {KINDS.map((k) => <li key={k} data-testid={`pending-${k}`}>{t(`reminders.kind_${k}`)}: <strong>{s.pending[k]}</strong></li>)}
          </ul>
        </div>
        <div>
          <p className="font-medium text-brand-900">{t('reminders.sent_title')}</p>
          <ul className="mt-1 space-y-0.5 text-slate-600">
            {KINDS.map((k) => <li key={k}>{t(`reminders.kind_${k}`)}: <strong>{s.last7[k]}</strong></li>)}
          </ul>
          <p className="mt-1 text-xs text-slate-500">{t('reminders.sent_today', { count: s.sentToday })}</p>
        </div>
      </div>
      {s.nudges && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3" data-testid="nudges-section">
          <p className="font-medium text-brand-900">{t('reminders.nudges_title')}</p>
          <p className="text-xs text-slate-500">{t('reminders.nudges_help')}</p>
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
            <input type="checkbox" className="h-4 w-4" checked={form.nudgesEnabled} onChange={(e) => setForm({ ...form, nudgesEnabled: e.target.checked })} data-testid="nudges-enabled" />
            {t('reminders.nudges_enabled')}
          </label>
          <ul className="space-y-0.5 text-sm text-slate-600">
            {NUDGES.map((k) => (
              <li key={k} data-testid={`nudge-pending-${k}`}>
                {t(`reminders.kind_${k}`)}: {t('reminders.nudges_counts', { pending: s.nudges?.pending?.[k] ?? 0, sent: s.nudges?.last7?.[k] ?? 0 })}
              </li>
            ))}
          </ul>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500">
            {[1, 2, 3, 4, 5].map((n) => <li key={n}>{t(`reminders.nudges_rule${n}`)}</li>)}
          </ul>
        </div>
      )}
      {msg && <p role="status" className={`text-sm ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</p>}
      <button type="submit" className="btn-primary">{t('reminders.save')}</button>
    </form>
  );
}
