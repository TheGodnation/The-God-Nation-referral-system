import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

// Mutes and removal requests. Used by leaders (their own assemblies), by the central admin's own profile and
// by the admin dashboard. What a person may do is decided by the server from who they are in each assembly.
interface Sanction {
  id: string; personName: string; assemblyName: string; reason: string; endsAt: string; byRole: string; byName: string;
  status: 'ACTIVE' | 'LIFTED' | 'ENDED'; excuseMessage: string | null; canLift: boolean;
}
interface RemovalRequest {
  id: string; personName: string; assemblyName: string; reason: string; requestedByName: string;
  status: 'PENDING' | 'APPROVED' | 'DECLINED'; decisionNote: string | null;
}
interface Overview { durations: number[]; isCentralAdmin: boolean; sanctions: Sanction[]; removalRequests: RemovalRequest[] }
interface Pick { id: string; name: string }

export function SanctionsPanel({ base }: { base: string }) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<Overview | null>(null);
  const [assembly, setAssembly] = useState<Pick | null>(null);
  const [led, setLed] = useState<Pick[]>([]);
  const [people, setPeople] = useState<{ id: string; name: string; whatsappNumber: string | null }[]>([]);
  const [personId, setPersonId] = useState('');
  const [personSearch, setPersonSearch] = useState('');
  const [days, setDays] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = () => api.get<Overview>(`${base}/overview`).then(setData).catch((e) => setError(e instanceof ApiError ? e.message : t('sanctions.load_failed')));
  useEffect(() => {
    void load();
    api.get<{ items: Pick[] }>(`${base}/assemblies?search=`).then((r) => setLed(r.items)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  function loadPeople(communityId: string, q: string) {
    api.get<{ items: typeof people }>(`${base}/members?communityId=${encodeURIComponent(communityId)}&search=${encodeURIComponent(q)}`).then((r) => setPeople(r.items)).catch(() => setPeople([]));
  }
  function chooseAssembly(a: Pick) {
    setAssembly(a);
    setPersonId('');
    setPersonSearch('');
    loadPeople(a.id, '');
  }

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await action();
      setNote(done);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('sanctions.action_failed'));
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(assembly && personId && days && reason.trim().length >= 3);
  const date = (iso: string) => new Date(iso).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const who = (s: Sanction) => (s.byRole === 'ADMIN' ? t('sanctions.by_central') : s.byName);
  const isAdmin = Boolean(data?.isCentralAdmin);

  return (
    <div className="space-y-5" data-testid="sanctions-panel">
      <p className="text-sm text-slate-600">{t('sanctions.help')}</p>
      {isAdmin && <p className="text-sm text-slate-600">{t('sanctions.admin_help')}</p>}
      {note && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">{note}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      <section className="card space-y-3">
        <h3 className="font-semibold text-brand-900">{t('sanctions.new_mute')}</h3>
        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">1. {t('sanctions.assembly')} {assembly && <strong>✔ {assembly.name}</strong>}</p>
          {isAdmin ? (
            <SearchPicker placeholder={t('sanctions.assembly_search')} searchPath={`${base}/assemblies?search=`} renderLabel={(a) => a.name} actionLabel={t('sanctions.choose')} searchButtonLabel={t('sanctions.search')} onPick={chooseAssembly} />
          ) : (
            <select className="input" value={assembly?.id ?? ''} onChange={(e) => { const a = led.find((x) => x.id === e.target.value); if (a) chooseAssembly(a); }} aria-label={t('sanctions.pick_assembly') ?? ''}>
              <option value="">{t('sanctions.pick_assembly')}</option>
              {led.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
        </div>
        {assembly && (
          <div>
            <p className="mb-1 text-sm font-medium text-slate-700">2. {t('sanctions.person')}</p>
            <div className="mb-2 flex gap-2">
              <input className="input" value={personSearch} placeholder={t('sanctions.person_search') ?? ''} onChange={(e) => setPersonSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); loadPeople(assembly.id, personSearch); } }} />
              <button type="button" className="btn-secondary px-3" onClick={() => loadPeople(assembly.id, personSearch)}>{t('sanctions.search')}</button>
            </div>
            <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)} aria-label={t('sanctions.pick_person') ?? ''}>
              <option value="">{t('sanctions.pick_person')}</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.whatsappNumber ? ` · ${p.whatsappNumber}` : ''}</option>)}
            </select>
          </div>
        )}
        {personId && (
          <>
            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">3. {t('sanctions.days')}</p>
              <div className="flex flex-wrap gap-2">
                {(data?.durations ?? [3, 7, 15, 30]).map((d) => (
                  <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`rounded-full border px-3 py-2 text-sm font-semibold ${days === d ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}>
                    {t('sanctions.days_n', { count: d })}
                  </button>
                ))}
              </div>
            </div>
            <label className="block text-sm">
              <span className="font-medium text-slate-700">4. {t('sanctions.reason')}</span>
              <textarea className="input mt-1 w-full" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primary" disabled={!ready || busy} onClick={() => void run(() => api.post(`${base}/mute`, { communityId: assembly!.id, personId, days, reason }).then(() => { setReason(''); setDays(null); setPersonId(''); }), t('sanctions.muted_done'))}>
                🔇 {t('sanctions.mute_button')}
              </button>
              {!isAdmin && (
                <button type="button" className="btn-secondary" disabled={reason.trim().length < 3 || busy} onClick={() => void run(() => api.post(`${base}/removal-requests`, { communityId: assembly!.id, personId, reason }).then(() => { setReason(''); setPersonId(''); }), t('sanctions.removal_sent'))}>
                  {t('sanctions.removal_button')}
                </button>
              )}
              {isAdmin && (
                <button type="button" className="rounded-lg border border-red-300 px-4 py-2 text-sm font-semibold text-red-700" disabled={busy} onClick={() => { if (window.confirm(t('sanctions.remove_now_confirm'))) void run(() => api.post(`${base}/remove`, { communityId: assembly!.id, personId }).then(() => setPersonId('')), t('sanctions.removed_done')); }}>
                  {t('sanctions.remove_now')}
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h3 className="mb-2 font-semibold text-brand-900">{t('sanctions.current')}</h3>
        {!data && !error && <p className="text-sm text-slate-400">{t('sanctions.loading')}</p>}
        {data && data.sanctions.length === 0 && <p className="text-sm text-slate-500">{t('sanctions.none')}</p>}
        <ul className="divide-y divide-slate-100">
          {data?.sanctions.map((s) => (
            <li key={s.id} className="py-3 text-sm" data-testid="sanction-row">
              <p className="font-semibold text-slate-900">{s.personName} <span className="font-normal text-slate-500">· {s.assemblyName}</span></p>
              <p className="text-slate-600">{t(`sanctions.status_${s.status}`)} · {t('sanctions.until', { date: date(s.endsAt) })} · {t('sanctions.by', { name: who(s) })}</p>
              <p className="text-slate-700">{t('sanctions.reason_label')} {s.reason}</p>
              {s.excuseMessage && <p className="mt-1 rounded bg-amber-50 p-2 text-amber-900">🙏 {t('sanctions.excuse_label')} {s.excuseMessage}</p>}
              {s.status === 'ACTIVE' && (s.canLift ? (
                <button type="button" className="mt-2 font-semibold text-brand-700 underline" disabled={busy} onClick={() => { if (window.confirm(t('sanctions.lift_confirm'))) void run(() => api.post(`${base}/${s.id}/lift`, {}), t('sanctions.lift')); }}>
                  {t('sanctions.lift')}
                </button>
              ) : (
                <p className="mt-2 text-xs text-slate-500">{t('sanctions.admin_only')}</p>
              ))}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h3 className="mb-2 font-semibold text-brand-900">{t('sanctions.requests')}</h3>
        {data && data.removalRequests.length === 0 && <p className="text-sm text-slate-500">{t('sanctions.requests_none')}</p>}
        <ul className="divide-y divide-slate-100">
          {data?.removalRequests.map((r) => (
            <li key={r.id} className="py-3 text-sm" data-testid="removal-row">
              <p className="font-semibold text-slate-900">{r.personName} <span className="font-normal text-slate-500">· {r.assemblyName}</span></p>
              <p className="text-slate-600">{t(`sanctions.req_${r.status}`)} · {t('sanctions.requested_by', { name: r.requestedByName })}</p>
              <p className="text-slate-700">{t('sanctions.reason_label')} {r.reason}</p>
              {r.decisionNote && <p className="text-slate-500">“{r.decisionNote}”</p>}
              {isAdmin && r.status === 'PENDING' && (
                <div className="mt-2 space-y-2">
                  <input className="input w-full" placeholder={t('sanctions.note_placeholder') ?? ''} value={notes[r.id] ?? ''} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} />
                  <div className="flex gap-2">
                    <button type="button" className="rounded-lg bg-red-600 px-3 py-2 font-semibold text-white" disabled={busy} onClick={() => void run(() => api.post(`${base}/removal-requests/${r.id}/decide`, { approve: true, note: notes[r.id] }), t('sanctions.removed_done'))}>{t('sanctions.approve')}</button>
                    <button type="button" className="btn-secondary px-3 py-2" disabled={busy} onClick={() => void run(() => api.post(`${base}/removal-requests/${r.id}/decide`, { approve: false, note: notes[r.id] }), t('sanctions.decline'))}>{t('sanctions.decline')}</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
