import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

type Colour = 'GREEN' | 'YELLOW' | 'RED' | 'NEW';
interface LeaderRow { personId: string; name: string; generations: number[]; assemblies: string[]; colour: Colour; missedOfLast4: number; lastReportWeek: string | null; lastReportLate: boolean }
interface Overview { dueWeek: string; deadline: string; counts: Record<Colour, number>; leaders: LeaderRow[] }
interface Report { weekStart: string; contacted: number; needHelp: number; prayerNeeds: string | null; note: string | null; late: boolean }
interface History { name: string; assemblies: string[]; reports: Report[] }
interface Summary { generation: number; weekStart: string; summary: string; representativeName: string }
interface MySummary { generation: number; weekStart: string; weekEnd: string; summary: string; sent: boolean }

const DOT: Record<Colour, string> = { GREEN: 'bg-green-500', YELLOW: 'bg-amber-400', RED: 'bg-red-500', NEW: 'bg-slate-300' };

// "My leaders": every leader with a colour for the report now due — green sent on time, yellow open or sent late,
// red missed, grey not due yet. The central admin sees all leaders (and the representatives' summaries); a
// representative sees only their own generation and writes one summary a week for the central admin.
export function LeadersReportPanel({ base, mode }: { base: string; mode: 'admin' | 'rep' }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Overview | null>(null);
  const [generation, setGeneration] = useState<string>('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [history, setHistory] = useState<History | null>(null);
  const [summaries, setSummaries] = useState<Summary[]>([]);
  const [mine, setMine] = useState<MySummary | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const load = () =>
    api.get<Overview>(`${base}/overview${mode === 'admin' && generation !== '' ? `?generation=${generation}` : ''}`).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : t('myLeaders.load_failed')));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, generation]);
  useEffect(() => {
    if (mode === 'admin') api.get<{ items: Summary[] }>(`${base}/summaries`).then((r) => setSummaries(r.items)).catch(() => {});
    else api.get<MySummary>(`${base}/summary`).then((r) => { setMine(r); setText(r.summary); }).catch(() => {});
  }, [base, mode]);

  const generations = useMemo(() => Array.from(new Set((data?.leaders ?? []).flatMap((l) => l.generations))).sort((a, b) => a - b), [data]);

  async function open(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setHistory(null);
    api.get<History>(`${base}/leaders/${id}`).then(setHistory).catch(() => setHistory({ name: '', assemblies: [], reports: [] }));
  }

  async function remind(body: { personIds?: string[]; allLate?: boolean }) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.post<{ reminded: number }>(`${base}/remind`, body);
      setNote(t('myLeaders.reminded', { count: r.reminded }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('myLeaders.action_failed'));
    } finally {
      setBusy(false);
    }
  }

  async function saveSummary(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await api.put<MySummary>(`${base}/summary`, { summary: text });
      setMine(r);
      setNote(t('myLeaders.summary_saved'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('myLeaders.action_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="leaders-report-panel">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('myLeaders.title')}</h2>
        <p className="text-sm text-slate-600">{mode === 'admin' ? t('myLeaders.help_admin') : t('myLeaders.help_rep')}</p>
        {data && <p className="mt-1 text-xs text-slate-500">{t('myLeaders.due', { week: fmt(data.dueWeek), deadline: new Date(data.deadline).toLocaleString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })}</p>}
      </div>
      {note && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">{note}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      {mode === 'rep' && mine && (
        <form onSubmit={saveSummary} className="card space-y-2" data-testid="rep-summary">
          <h3 className="font-semibold text-brand-900">{t('myLeaders.summary_title', { from: fmt(mine.weekStart), to: fmt(mine.weekEnd) })}</h3>
          <p className="text-sm text-slate-600">{t('myLeaders.summary_help')}</p>
          <textarea className="input min-h-[6rem] w-full" maxLength={3000} value={text} onChange={(e) => setText(e.target.value)} aria-label={t('myLeaders.summary_title', { from: fmt(mine.weekStart), to: fmt(mine.weekEnd) }) ?? ''} />
          <button type="submit" className="btn-primary" disabled={busy || text.trim().length < 3}>{mine.sent ? t('myLeaders.summary_update') : t('myLeaders.summary_send')}</button>
        </form>
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="report-counts">
          <span className="rounded-full bg-green-100 px-3 py-1 font-semibold text-green-800">{t('myLeaders.count_green', { count: data.counts.GREEN })}</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-800">{t('myLeaders.count_yellow', { count: data.counts.YELLOW })}</span>
          <span className="rounded-full bg-red-100 px-3 py-1 font-semibold text-red-800">{t('myLeaders.count_red', { count: data.counts.RED })}</span>
          {data.counts.NEW > 0 && <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">{t('myLeaders.count_new', { count: data.counts.NEW })}</span>}
          {data.counts.RED > 0 && <button type="button" className="btn-secondary px-3 py-1" disabled={busy} onClick={() => void remind({ allLate: true })}>{t('myLeaders.remind_all_late')}</button>}
        </div>
      )}

      {mode === 'admin' && generations.length > 0 && (
        <label className="block text-sm">
          <span className="mr-2 font-medium text-slate-700">{t('myLeaders.filter')}</span>
          <select className="input inline-block w-auto" value={generation} onChange={(e) => setGeneration(e.target.value)}>
            <option value="">{t('myLeaders.all_generations')}</option>
            {generations.map((g) => <option key={g} value={g}>{g === 0 ? t('myLeaders.headquarters') : t('myLeaders.generation', { n: g })}</option>)}
          </select>
        </label>
      )}

      {!data && !error && <p className="text-sm text-slate-400">{t('myLeaders.loading')}</p>}
      {data && data.leaders.length === 0 && <p className="card text-sm text-slate-600">{t('myLeaders.none')}</p>}
      <ul className="space-y-2">
        {data?.leaders.map((l) => (
          <li key={l.personId} className="card space-y-2" data-testid="leader-row">
            <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => void open(l.personId)}>
              <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${DOT[l.colour]}`} role="img" aria-label={t(`myLeaders.colour_${l.colour}`) ?? ''} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-brand-900">{l.name}</span>
                <span className="block text-xs text-slate-500">{l.assemblies.join(', ')}</span>
                <span className="block text-xs text-slate-600">
                  {t(`myLeaders.colour_${l.colour}`)}
                  {l.missedOfLast4 > 0 ? ` · ${t('myLeaders.missed', { count: l.missedOfLast4 })}` : ''}
                  {l.lastReportWeek ? ` · ${t('myLeaders.last', { date: fmt(l.lastReportWeek) })}` : ''}
                </span>
              </span>
            </button>
            {openId === l.personId && (
              <div className="space-y-2 border-t border-slate-100 pt-2 text-sm">
                {!history && <p className="text-slate-400">{t('myLeaders.loading')}</p>}
                {history && history.reports.length === 0 && <p className="text-slate-500">{t('myLeaders.no_reports')}</p>}
                {history?.reports.map((r) => (
                  <div key={r.weekStart} className="rounded-lg bg-slate-50 p-2" data-testid="report-entry">
                    <p className="font-medium">{t('myLeaders.week_of', { date: fmt(r.weekStart) })}{r.late ? ` · ${t('myLeaders.was_late')}` : ''}</p>
                    <p>{t('myLeaders.numbers', { contacted: r.contacted, needHelp: r.needHelp })}</p>
                    {r.prayerNeeds && <p>🙏 {r.prayerNeeds}</p>}
                    {r.note && <p className="text-slate-600">“{r.note}”</p>}
                  </div>
                ))}
                {l.colour !== 'GREEN' && <button type="button" className="font-semibold text-brand-700 underline" disabled={busy} onClick={() => void remind({ personIds: [l.personId] })}>{t('myLeaders.remind')}</button>}
              </div>
            )}
          </li>
        ))}
      </ul>

      {mode === 'admin' && summaries.length > 0 && (
        <section className="card" data-testid="rep-summaries">
          <h3 className="mb-2 font-semibold text-brand-900">{t('myLeaders.summaries')}</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {summaries.map((s) => (
              <li key={`${s.generation}-${s.weekStart}`} className="py-2">
                <p className="font-medium">{t('myLeaders.generation', { n: s.generation })} · {t('myLeaders.week_of', { date: fmt(s.weekStart) })} · {s.representativeName}</p>
                <p className="whitespace-pre-wrap text-slate-700">{s.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
