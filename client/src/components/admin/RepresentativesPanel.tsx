import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

// The central admin appoints one representative per generation, chosen from the leaders, and can end it.
interface GenerationRow {
  generation: number;
  assemblies: number;
  representative: { id: string; personId: string; name: string; appointedAt: string } | null;
}
interface LeaderPick { id: string; name: string; generations: number[]; assemblies: string[] }

export function RepresentativesPanel({ base }: { base: string }) {
  const { t, i18n } = useTranslation();
  const [rows, setRows] = useState<GenerationRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [leaders, setLeaders] = useState<LeaderPick[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<{ generations: GenerationRow[] }>(`${base}/overview`).then((r) => setRows(r.generations)).catch(() => setError(t('repAdmin.load_failed')));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const find = (q: string) => api.get<{ items: LeaderPick[] }>(`${base}/leaders?search=${encodeURIComponent(q)}`).then((r) => setLeaders(r.items)).catch(() => setLeaders([]));

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await action();
      setNote(done);
      setOpen(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('repAdmin.action_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="representatives-panel">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('repAdmin.title')}</h2>
        <p className="text-sm text-slate-600">{t('repAdmin.help')}</p>
      </div>
      {note && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">{note}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {rows === null && !error && <p className="text-sm text-slate-400">{t('repAdmin.loading')}</p>}
      {rows && rows.length === 0 && <p className="card text-sm text-slate-600">{t('repAdmin.no_generations')}</p>}
      <ul className="space-y-3">
        {rows?.map((g) => (
          <li key={g.generation} className="card space-y-2" data-testid={`rep-gen-${g.generation}`}>
            <p className="font-semibold text-brand-900">{t('repAdmin.generation', { n: g.generation })} <span className="text-sm font-normal text-slate-500">· {t('repAdmin.assemblies', { count: g.assemblies })}</span></p>
            {g.representative ? (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span>🧭 <strong>{g.representative.name}</strong> · {t('repAdmin.since', { date: new Date(g.representative.appointedAt).toLocaleDateString(i18n.language) })}</span>
                <button type="button" className="font-semibold text-red-700 underline" disabled={busy} onClick={() => { if (window.confirm(t('repAdmin.remove_confirm', { name: g.representative!.name }))) void run(() => api.post(`${base}/${g.representative!.id}/remove`, {}), t('repAdmin.removed')); }}>
                  {t('repAdmin.remove')}
                </button>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-500">{t('repAdmin.none')}</p>
                {open === g.generation ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input className="input" placeholder={t('repAdmin.search_leader') ?? ''} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void find(search); } }} />
                      <button type="button" className="btn-secondary px-3" onClick={() => void find(search)}>{t('repAdmin.search')}</button>
                    </div>
                    <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
                      {leaders.map((l) => (
                        <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                          <span><span className="font-medium">{l.name}</span><span className="block text-xs text-slate-500">{l.assemblies.join(', ')}</span></span>
                          <button type="button" className="btn-primary px-3 py-1.5" disabled={busy} onClick={() => void run(() => api.post(`${base}/appoint`, { personId: l.id, generation: g.generation }), t('repAdmin.appointed', { name: l.name }))}>
                            {t('repAdmin.appoint')}
                          </button>
                        </li>
                      ))}
                      {leaders.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">{t('repAdmin.no_leaders')}</li>}
                    </ul>
                  </div>
                ) : (
                  <button type="button" className="btn-secondary px-3 py-1.5" onClick={() => { setOpen(g.generation); setSearch(''); void find(''); }}>
                    + {t('repAdmin.choose')}
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
