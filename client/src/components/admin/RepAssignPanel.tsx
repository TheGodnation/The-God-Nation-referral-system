import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { AssignPeople } from './CellsPanel';

interface Row { id: string; name: string; members: number; leaders: number; unassigned: number }

const BASE = '/api/member/rep-cells';

// The representative of a generation gives the people nobody follows yet to the leaders of one of the assemblies of
// their generation: choose the assembly, choose the leaders, how many each (or share evenly), preview, then assign.
export function RepAssignPanel() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [generation, setGeneration] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api
      .get<{ generation: number; items: Row[] }>(`${BASE}/overview`)
      .then((r) => {
        setRows(r.items);
        setGeneration(r.generation);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : t('repAssign.load_failed')));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4" data-testid="rep-assign">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('repAssign.title')}</h2>
        <p className="text-sm text-slate-600">{generation !== null ? t('repAssign.help', { n: generation }) : ''}</p>
      </div>
      {message && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">{message}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {!rows && !error && <p className="text-sm text-slate-400">{t('repAssign.loading')}</p>}
      {rows && rows.length === 0 && <p className="card text-sm text-slate-600">{t('repAssign.none')}</p>}
      <ul className="space-y-3">
        {rows?.map((r) => (
          <li key={r.id} className="card space-y-2" data-testid="rep-assign-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="block font-semibold text-brand-900">{r.name}</span>
                <span className="block text-xs text-slate-600">{t('repAssign.counts', { members: r.members, leaders: r.leaders, unassigned: r.unassigned })}</span>
              </span>
              {r.unassigned > 0 && (
                <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                  {openId === r.id ? t('repAssign.close') : t('repAssign.open')}
                </button>
              )}
            </div>
            {openId === r.id && (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <AssignPeople
                  base={BASE}
                  communityId={r.id}
                  onDone={(text) => {
                    setMessage(text);
                    void load();
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
