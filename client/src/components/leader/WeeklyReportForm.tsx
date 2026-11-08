import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface Report { weekStart: string; contacted: number; needHelp: number; prayerNeeds: string | null; note: string | null; late: boolean; submittedAt: string }
interface Current {
  weekStart: string; weekEnd: string; deadline: string; isLate: boolean; canEdit: boolean;
  report: Report | null; hint: { followedUp: number }; colour: 'GREEN' | 'YELLOW' | 'RED' | 'NEW';
}

// A leader's weekly report to the central admin: how many people they contacted, how many need help, prayer needs
// and a free note. It is about one week (Monday to Sunday) and is on time if sent by Monday 23:59 after it ends.
export function WeeklyReportForm() {
  const { t, i18n } = useTranslation();
  const [cur, setCur] = useState<Current | null>(null);
  const [history, setHistory] = useState<Report[]>([]);
  const [contacted, setContacted] = useState('');
  const [needHelp, setNeedHelp] = useState('');
  const [prayer, setPrayer] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  function apply(c: Current) {
    setCur(c);
    setContacted(c.report ? String(c.report.contacted) : '');
    setNeedHelp(c.report ? String(c.report.needHelp) : '');
    setPrayer(c.report?.prayerNeeds ?? '');
    setNote(c.report?.note ?? '');
  }
  const load = () => {
    api.get<Current>('/api/member/weekly-report/current').then(apply).catch((e) => setError(e instanceof ApiError ? e.message : t('weeklyReportForm.load_failed')));
    api.get<{ items: Report[] }>('/api/member/weekly-report/history').then((r) => setHistory(r.items)).catch(() => {});
  };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!cur) return;
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await api.put('/api/member/weekly-report', { weekStart: cur.weekStart, contacted: Number(contacted), needHelp: Number(needHelp), prayerNeeds: prayer, note });
      setMsg(t('weeklyReportForm.saved'));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('weeklyReportForm.save_failed'));
    } finally {
      setBusy(false);
    }
  }

  const valid = contacted !== '' && needHelp !== '' && Number(contacted) >= 0 && Number(needHelp) >= 0;
  const deadlineText = cur ? new Date(cur.deadline).toLocaleString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="space-y-4" data-testid="weekly-report-form">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('weeklyReportForm.title')}</h2>
        <p className="text-sm text-slate-600">{t('weeklyReportForm.help')}</p>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {!cur && !error && <p className="text-sm text-slate-400">{t('weeklyReportForm.loading')}</p>}
      {cur && (
        <form onSubmit={save} className="card space-y-3">
          <p className="font-semibold text-brand-900">{t('weeklyReportForm.week', { from: fmt(cur.weekStart), to: fmt(cur.weekEnd) })}</p>
          <p className={`text-sm ${cur.isLate ? 'text-red-700' : 'text-slate-600'}`}>{cur.isLate ? t('weeklyReportForm.deadline_passed', { when: deadlineText }) : t('weeklyReportForm.deadline', { when: deadlineText })}</p>
          {cur.report && <p className="rounded-lg bg-green-50 p-2 text-sm text-green-800">✔ {cur.report.late ? t('weeklyReportForm.sent_late') : t('weeklyReportForm.sent')}{cur.canEdit ? ' ' + t('weeklyReportForm.can_edit') : ' ' + t('weeklyReportForm.locked')}</p>}
          {cur.hint.followedUp > 0 && (
            <p className="rounded-lg bg-sky-50 p-2 text-sm text-sky-900">
              💡 {t('weeklyReportForm.hint', { count: cur.hint.followedUp })}{' '}
              {!cur.report && <button type="button" className="font-semibold underline" onClick={() => setContacted(String(cur.hint.followedUp))}>{t('weeklyReportForm.use_hint')}</button>}
            </p>
          )}
          <label className="block text-sm font-semibold text-slate-700">
            {t('weeklyReportForm.contacted')}
            <input className="input mt-1" type="number" inputMode="numeric" min={0} value={contacted} onChange={(e) => setContacted(e.target.value)} disabled={!cur.canEdit} />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            {t('weeklyReportForm.need_help')}
            <input className="input mt-1" type="number" inputMode="numeric" min={0} value={needHelp} onChange={(e) => setNeedHelp(e.target.value)} disabled={!cur.canEdit} />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            {t('weeklyReportForm.prayer')}
            <textarea className="input mt-1 min-h-[5rem]" maxLength={2000} value={prayer} onChange={(e) => setPrayer(e.target.value)} disabled={!cur.canEdit} />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            {t('weeklyReportForm.note')}
            <textarea className="input mt-1 min-h-[5rem]" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} disabled={!cur.canEdit} />
          </label>
          {msg && <p className="text-sm text-green-700" role="status">{msg}</p>}
          <button type="submit" className="btn-primary" disabled={busy || !valid || !cur.canEdit}>{busy ? t('weeklyReportForm.sending') : cur.report ? t('weeklyReportForm.update') : t('weeklyReportForm.send')}</button>
        </form>
      )}
      {history.length > 0 && (
        <section className="card">
          <h3 className="mb-2 font-semibold text-brand-900">{t('weeklyReportForm.history')}</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {history.map((r) => (
              <li key={r.weekStart} className="py-2">
                <span className="font-medium">{t('weeklyReportForm.week_of', { date: fmt(r.weekStart) })}</span> · {t('weeklyReportForm.numbers', { contacted: r.contacted, needHelp: r.needHelp })}{r.late ? ` · ${t('weeklyReportForm.was_late')}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
