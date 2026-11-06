import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { Escalations } from '../leader/Escalations';
import { ClinicBookCard } from '../leader/ClinicBookCard';
import { ClinicRhythmCard } from './ClinicRhythmCard';
import { TokensCard } from './TokensCard';
import { LeadersOversight } from './LeadersOversight';

interface Row {
  id: string;
  name: string;
  parentId: string | null;
  parentName: string | null;
  autoCreated: boolean;
  createdAt: string;
  members: number;
  leaders: number;
  readyToLead: number;
  unassigned: number;
}
interface Overview {
  capacity: number;
  requiredBooks: number;
  items: Row[];
}
type HealthColor = 'GREEN' | 'YELLOW' | 'RED' | 'GREY';
interface HealthRow {
  id: string;
  own: { color: HealthColor; weeklyRate: number | null };
  tree: { color: HealthColor };
}
const DOT: Record<HealthColor, string> = { GREEN: 'bg-green-500', YELLOW: 'bg-amber-400', RED: 'bg-red-500', GREY: 'bg-slate-300' };

interface Ready {
  requiredBooks: number;
  items: { personId: string; name: string; whatsappNumber: string; finishedAt: string }[];
}

// The central admin's assemblies view: how full each assembly is, how many
// leaders it has, who is ready to lead (finished the whole Leadership
// School), one-tap appointment, and the assembly size. The same panel is
// shown in the admin dashboard and in the central admin's own member
// profile; only the address it talks to differs (`base`).
export function CellsPanel({ base }: { base: '/api/admin/cells' | '/api/member/central-cells' }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Overview | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Row | null>(null);
  const [ready, setReady] = useState<Ready | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sizeDraft, setSizeDraft] = useState('');
  const [onlyWithReady, setOnlyWithReady] = useState(false);
  const [health, setHealth] = useState<Map<string, HealthRow>>(new Map());
  const [assigning, setAssigning] = useState(false);

  function load() {
    api
      .get<Overview>(`${base}/overview`)
      .then((r) => {
        setData(r);
        setSizeDraft((d) => d || String(r.capacity));
      })
      .catch(() => setFailed(true));
  }
  useEffect(load, [base]);
  useEffect(() => {
    api
      .get<{ items: HealthRow[] }>(`${base}/health`)
      .then((r) => setHealth(new Map(r.items.map((h) => [h.id, h]))))
      .catch(() => {});
  }, [base]);

  function openAssembly(row: Row) {
    setOpen(row);
    setReady(null);
    setMessage(null);
    setError(null);
    api
      .get<Ready>(`${base}/ready-to-lead?communityId=${encodeURIComponent(row.id)}`)
      .then(setReady)
      .catch(() => setError(t('cells.load_failed')));
  }

  async function appoint(personId: string) {
    if (!open) return;
    setBusyId(personId);
    setError(null);
    setMessage(null);
    try {
      await api.post(`${base}/appoint`, { personId, communityId: open.id });
      openAssembly(open);
      load();
      setMessage(t('cells.appointed'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('cells.appoint_failed'));
    } finally {
      setBusyId(null);
    }
  }

  async function saveSize() {
    const value = Number(sizeDraft);
    if (!Number.isInteger(value) || value < 10 || value > 5000) {
      setError(t('cells.size_invalid'));
      return;
    }
    setError(null);
    setMessage(null);
    try {
      await api.put(`${base}/capacity`, { assemblyCapacity: value });
      setMessage(t('cells.size_saved'));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('cells.size_failed'));
    }
  }

  if (failed) return <p className="card text-sm text-red-700">{t('cells.load_failed')}</p>;
  if (!data) return <p className="py-6 text-center text-sm text-slate-400">{t('cells.loading')}</p>;

  const rows = data.items.filter((r) => !onlyWithReady || r.readyToLead > 0);

  return (
    <div className="space-y-4" data-testid="cells-panel">
      <section className="card space-y-2">
        <h2 className="font-semibold text-brand-900">{t('cells.title')}</h2>
        <p className="text-sm text-slate-600">{t('cells.intro')}</p>
        <div className="flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
          <div>
            <label className="label" htmlFor={`cells-size-${base}`}>{t('cells.size_label')}</label>
            <input
              id={`cells-size-${base}`}
              type="number"
              min={10}
              max={5000}
              className="input w-28"
              value={sizeDraft}
              onChange={(e) => setSizeDraft(e.target.value)}
            />
          </div>
          <button type="button" className="btn-secondary" disabled={Number(sizeDraft) === data.capacity} onClick={saveSize}>
            {t('cells.size_save')}
          </button>
        </div>
        <p className="text-xs text-slate-500">{t('cells.size_help')}</p>
      </section>

      <ClinicBookCard mode="central" statusUrl={`${base}/clinic`} sendUrl={`${base}/clinic/send-all`} />

      <ClinicRhythmCard base={base} />

      <TokensCard base={base === '/api/admin/cells' ? '/api/admin/tokens' : '/api/member/central-tokens'} />

      <Escalations
        hideWhenEmpty
        messagesBase={`${base}/escalations`}
        lists={[{ key: 'all', title: t('escalations.all_title'), url: `${base}/escalations`, empty: t('escalations.none') }]}
      />

      {(message || error) && (
        <p role={error ? 'alert' : 'status'} className={`rounded-lg px-3 py-2 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {error ?? message}
        </p>
      )}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-brand-900">{t('cells.assemblies')}</h3>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={onlyWithReady} onChange={(e) => setOnlyWithReady(e.target.checked)} />
            {t('cells.only_ready')}
          </label>
        </div>
        {data.requiredBooks === 0 && <p className="text-sm text-slate-500">{t('cells.no_school_yet')}</p>}
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="py-2">
              <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => openAssembly(r)}>
                <span>
                  {health.get(r.id) && (
                    <span
                      className={`mr-2 inline-block h-3 w-3 rounded-full align-middle ${DOT[health.get(r.id)!.own.color]}`}
                      title={t(`oversight.health_${health.get(r.id)!.own.color.toLowerCase()}`)}
                      aria-label={t(`oversight.health_${health.get(r.id)!.own.color.toLowerCase()}`)}
                    />
                  )}
                  <span className="font-medium text-slate-800">{r.name}</span>
                  {r.autoCreated && <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">{t('cells.opened_automatically')}</span>}
                  {r.parentName && <span className="block text-xs text-slate-500">{t('cells.under', { name: r.parentName })}</span>}
                </span>
                <span className="text-sm text-slate-600">
                  {t('cells.counts', { members: r.members, capacity: data.capacity, leaders: r.leaders })}
                  {r.unassigned > 0 && r.leaders > 0 && (
                    <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{t('cells.unassigned_count', { count: r.unassigned })}</span>
                  )}
                  {r.readyToLead > 0 && (
                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                      {t('cells.ready_count', { count: r.readyToLead })}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
          {rows.length === 0 && <li className="py-3 text-sm text-slate-500">{t('cells.none')}</li>}
        </ul>
      </section>

      {open && (
        <section className="card space-y-3" aria-label={t('cells.ready_title', { name: open.name })}>
          <h3 className="font-semibold text-brand-900">{t('cells.ready_title', { name: open.name })}</h3>
          {(() => {
            const row = data.items.find((r) => r.id === open.id);
            if (!row || row.unassigned === 0) return null;
            return (
              <div className="space-y-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>{t('cells.unassigned_help', { count: row.unassigned })}</span>
                  <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setAssigning((v) => !v)} data-testid="assign-toggle">
                    {assigning ? t('cells.assign_close') : t('cells.assign_open')}
                  </button>
                </div>
                {assigning && (
                  <AssignPeople
                    base={base}
                    communityId={open.id}
                    onDone={(text) => {
                      setMessage(text);
                      load();
                    }}
                  />
                )}
              </div>
            );
          })()}
          {(() => {
            const h = health.get(open.id);
            if (!h) return null;
            return (
              <p className="text-sm text-slate-600">
                <span className={`mr-2 inline-block h-3 w-3 rounded-full align-middle ${DOT[h.own.color]}`} />
                {t(`oversight.health_${h.own.color.toLowerCase()}`)}
                {h.own.weeklyRate !== null && ` · ${t('oversight.health_rate', { percent: Math.round(h.own.weeklyRate * 100) })}`}
                {h.tree.color !== h.own.color && ` · ${t('oversight.health_tree', { label: t(`oversight.health_${h.tree.color.toLowerCase()}`) })}`}
              </p>
            );
          })()}
          <p className="text-sm text-slate-600">{t('cells.ready_help')}</p>
          {!ready && <p className="text-sm text-slate-400">{t('cells.loading')}</p>}
          {ready && ready.items.length === 0 && <p className="text-sm text-slate-500">{t('cells.ready_none')}</p>}
          <ul className="divide-y divide-slate-100">
            {ready?.items.map((p) => (
              <li key={p.personId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium text-slate-800">{p.name}</span>
                  <span className="block text-xs text-slate-500">{t('cells.finished_on', { date: new Date(p.finishedAt).toLocaleDateString() })}</span>
                </span>
                <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={busyId === p.personId} onClick={() => appoint(p.personId)}>
                  {t('cells.appoint')}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-slate-200 pt-3">
            <LeadersOversight base={base} communityId={open.id} />
          </div>
        </section>
      )}
    </div>
  );
}

interface LeaderLoad {
  personId: string;
  name: string;
  away: boolean;
  headcount: number;
}
interface SharePlan {
  assigned: number;
  remaining: number;
  noLeaders: boolean;
  perLeader: { personId: string; name: string; added: number }[];
}

// Give the people nobody follows to the leaders: choose which leaders, and how many people each (leave the number
// empty to share evenly). "Preview" shows who would get how many, and changes nothing; "Assign" does it.
function AssignPeople({ base, communityId, onDone }: { base: string; communityId: string; onDone: (message: string) => void }) {
  const { t } = useTranslation();
  const [leaders, setLeaders] = useState<LeaderLoad[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [perLeader, setPerLeader] = useState('');
  const [plan, setPlan] = useState<SharePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: LeaderLoad[] }>(`${base}/leaders?communityId=${encodeURIComponent(communityId)}`)
      .then((r) => {
        setLeaders(r.items);
        setChosen(r.items.filter((l) => !l.away).map((l) => l.personId));
      })
      .catch(() => setError(t('cells.load_failed')));
  }, [base, communityId]);

  const number = perLeader.trim() === '' ? undefined : Number(perLeader);
  const numberOk = number === undefined || (Number.isInteger(number) && number >= 1 && number <= 2000);
  const body = (dryRun: boolean) => ({ communityId, leaderPersonIds: chosen, ...(number ? { perLeader: number } : {}), dryRun });

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<SharePlan>(`${base}/share`, body(dryRun));
      if (dryRun) {
        setPlan(r);
      } else {
        setPlan(null);
        onDone(r.noLeaders ? t('cells.share_no_leaders') : t('cells.assign_done', { count: r.assigned, left: r.remaining }));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('cells.share_failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!leaders) return <p className="text-slate-500">{error ?? t('cells.loading')}</p>;
  if (leaders.length === 0) return <p className="text-slate-600">{t('cells.share_no_leaders')}</p>;
  const toggle = (id: string) => {
    setPlan(null);
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };
  return (
    <div className="space-y-3" data-testid="assign-people">
      <p className="font-semibold text-slate-800">{t('cells.assign_which')}</p>
      <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2">
        {leaders.map((l) => (
          <li key={l.personId}>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={chosen.includes(l.personId)} onChange={() => toggle(l.personId)} />
              <span>
                <span className="font-medium">{l.name}</span>
                <span className="block text-xs text-slate-500">
                  {t('cells.assign_follows', { count: l.headcount })}
                  {l.away ? ` · ${t('cells.assign_away')}` : ''}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <label className="block">
        <span className="font-semibold text-slate-800">{t('cells.assign_each')}</span>
        <input
          className="input mt-1 w-40"
          inputMode="numeric"
          value={perLeader}
          placeholder={t('cells.assign_even') ?? ''}
          onChange={(e) => {
            setPlan(null);
            setPerLeader(e.target.value.replace(/\D/g, ''));
          }}
          data-testid="assign-each"
        />
        <span className="block text-xs text-slate-500">{t('cells.assign_each_help')}</span>
      </label>
      {error && <p className="text-red-700">{error}</p>}
      {!numberOk && <p className="text-red-700">{t('cells.assign_number_invalid')}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary px-3 py-1.5" disabled={busy || chosen.length === 0 || !numberOk} onClick={() => void run(true)} data-testid="assign-preview">
          {t('cells.assign_preview')}
        </button>
        {plan && plan.assigned > 0 && (
          <button type="button" className="btn-primary px-3 py-1.5" disabled={busy} onClick={() => void run(false)} data-testid="assign-confirm">
            {t('cells.assign_confirm', { count: plan.assigned })}
          </button>
        )}
      </div>
      {plan && (
        <div className="rounded-lg border border-slate-200 bg-white p-2" data-testid="assign-plan">
          <p className="font-semibold text-slate-800">{t('cells.assign_plan', { count: plan.assigned })}</p>
          <ul className="mt-1 space-y-0.5 text-slate-700">
            {plan.perLeader.filter((l) => l.added > 0).map((l) => (
              <li key={l.personId}>{l.name}: +{l.added}</li>
            ))}
          </ul>
          {plan.remaining > 0 && <p className="mt-1 text-xs text-amber-800">{t('cells.assign_left', { count: plan.remaining })}</p>}
        </div>
      )}
    </div>
  );
}
