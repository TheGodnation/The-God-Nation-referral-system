import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { FaithJourneyView, StatusChip } from './FaithJourneyView';

// "Faith journeys": every person who has finished the Book 1 / Book 2 exam, with
// where they stand, so the central admin can talk with those who need it. The
// central admin also decides here whether leaders may read the journeys of their
// own people. A leader sees this same list, only for his own assemblies, and only
// when that is switched on.

interface Row {
  personId: string;
  name: string;
  status: 'BORN_AGAIN' | 'NEEDS_CONVERSATION';
  lastAnsweredAt: string;
  confirmedAt: string | null;
  confirmedByName: string | null;
  /** Answers of the latest try that call for a conversation. */
  flagged: number;
}

type Filter = 'NEEDS' | 'FOLLOW_UP' | 'BORN_AGAIN' | 'CONFIRMED' | 'ALL';
const FILTERS: Filter[] = ['NEEDS', 'FOLLOW_UP', 'BORN_AGAIN', 'CONFIRMED', 'ALL'];

export function FaithJourneysPanel({ base, initialPersonId }: { base: string; initialPersonId?: string }) {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const [filter, setFilter] = useState<Filter>('NEEDS');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<string | null>(initialPersonId ?? null);
  const [role, setRole] = useState<'ADMIN' | 'LEADER' | null>(null);
  const [leadersSee, setLeadersSee] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ role: 'ADMIN' | 'LEADER'; leadersSee: boolean }>(`${base}/access`)
      .then((a) => {
        setRole(a.role);
        setLeadersSee(a.leadersSee);
      })
      .catch(() => {});
  }, [base]);

  useEffect(() => {
    const q = new URLSearchParams({ filter });
    if (search.trim()) q.set('search', search.trim());
    const timer = window.setTimeout(
      () =>
        api
          .get<{ items: Row[] }>(`${base}?${q.toString()}`)
          .then((r) => setRows(r.items))
          .catch(() => setRows([])),
      search ? 250 : 0,
    );
    return () => window.clearTimeout(timer);
  }, [base, filter, search, open]);

  async function switchLeaders(on: boolean) {
    setSaving(true);
    try {
      const r = await api.put<{ leadersSeeFaithJourney: boolean }>(`${base}/settings`, { leadersSeeFaithJourney: on });
      setLeadersSee(r.leadersSeeFaithJourney);
    } finally {
      setSaving(false);
    }
  }

  if (open) return <FaithJourneyView base={base} personId={open} onBack={() => setOpen(null)} />;

  const when = (iso: string) => new Date(iso).toLocaleDateString(isFr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className="space-y-4" data-testid="faith-panel">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('faith.title')}</h2>
        <p className="text-sm text-slate-600">{t(role === 'LEADER' ? 'faith.intro_leader' : 'faith.intro')}</p>
      </div>

      {role === 'ADMIN' && (
        <label className="card flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1" checked={leadersSee} disabled={saving} onChange={(e) => switchLeaders(e.target.checked)} />
          <span>
            <span className="block font-semibold text-slate-800">{t('faith.leaders_switch')}</span>
            <span className="block text-xs text-slate-500">{t('faith.leaders_switch_help')}</span>
          </span>
        </label>
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('faith.title') ?? ''}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${filter === f ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
          >
            {t(`faith.filter_${f}`)}
          </button>
        ))}
      </div>
      <input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('faith.search') ?? ''} aria-label={t('faith.search') ?? ''} />

      {rows === null && <p className="text-sm text-slate-400">{t('faith.loading')}</p>}
      {rows && rows.length === 0 && <p className="card text-sm text-slate-500">{t(`faith.empty_${filter}`)}</p>}
      <ul className="space-y-2">
        {rows?.map((r) => (
          <li key={r.personId}>
            <button type="button" onClick={() => setOpen(r.personId)} className="card flex w-full items-center justify-between gap-3 text-left" data-testid="faith-row">
              <span className="min-w-0">
                <span className="block truncate font-semibold text-slate-900">{r.name}</span>
                <span className="block text-xs text-slate-500">{t('faith.answered_on', { date: when(r.lastAnsweredAt) })}</span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <StatusChip status={r.status} confirmed={Boolean(r.confirmedAt)} />
                {r.flagged > 0 && !r.confirmedAt && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900" data-testid="faith-flagged">
                    ⚑ {t('faith.flagged_chip', { count: r.flagged })}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
