import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface Alert {
  personId: string;
  name: string;
  peopleCount: number;
  silentDays: number | null;
}

/** Leaders who have people to look after but have not contacted anyone for a week or more, so the coordinator can act. */
export function LeaderAlerts({ base, onChanged }: { base: string; onChanged: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Alert[] | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => api.get<{ items: Alert[] }>(`${base}/leader-alerts`).then((r) => setItems(r.items)).catch(() => setItems([])), [base]);
  useEffect(() => {
    void load();
  }, [load]);

  async function takeAll(a: Alert) {
    if (!window.confirm(t('needsMe.alert_confirm', { name: a.name, count: a.peopleCount }) ?? '')) return;
    setError(null);
    try {
      const r = await api.post<{ taken: number }>(`${base}/take-over-leader`, { leaderPersonId: a.personId });
      setNote(t('needsMe.alert_taken', { count: r.taken, name: a.name }));
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('needsMe.action_failed'));
    }
  }

  if (!items || items.length === 0) return null;
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-3" data-testid="leader-alerts">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left font-semibold text-amber-900">
        <span>⚠️ {t('needsMe.alerts_title', { count: items.length })}</span>
        <span aria-hidden>{open ? '▲' : '▼'}</span>
      </button>
      {note && <p className="mt-2 text-sm text-green-800" role="status">{note}</p>}
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
      {open && (
        <ul className="mt-2 divide-y divide-amber-200">
          {items.map((a) => (
            <li key={a.personId} className="space-y-1 py-2" data-testid={`alert-${a.personId}`}>
              <p className="font-semibold text-slate-900">{a.name}</p>
              <p className="text-sm text-slate-700">
                {t('needsMe.alert_people', { count: a.peopleCount })} · {a.silentDays === null ? t('needsMe.alert_never') : t('needsMe.alert_days', { count: a.silentDays })}
              </p>
              <div className="flex flex-wrap gap-2">
                <Link to={`/member/people/${a.personId}`} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-brand-800 no-underline">{t('needsMe.alert_message')}</Link>
                <button type="button" onClick={() => void takeAll(a)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-brand-800" data-testid={`alert-take-${a.personId}`}>{t('needsMe.alert_take')}</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
