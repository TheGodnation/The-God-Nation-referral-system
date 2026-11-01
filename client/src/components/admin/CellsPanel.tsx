import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

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
}
interface Overview {
  capacity: number;
  requiredBooks: number;
  items: Row[];
}
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
                  <span className="font-medium text-slate-800">{r.name}</span>
                  {r.autoCreated && <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">{t('cells.opened_automatically')}</span>}
                  {r.parentName && <span className="block text-xs text-slate-500">{t('cells.under', { name: r.parentName })}</span>}
                </span>
                <span className="text-sm text-slate-600">
                  {t('cells.counts', { members: r.members, capacity: data.capacity, leaders: r.leaders })}
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
        </section>
      )}
    </div>
  );
}
