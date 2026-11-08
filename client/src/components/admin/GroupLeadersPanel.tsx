import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface Group { id: string; name: string; assemblyName: string | null; generation: number | null; leaders: { id: string; name: string }[] }
interface Person { id: string; name: string; whatsappNumber: string | null }

// Groups (women, youth, prayer, leadership team…) and who leads them. The central admin sees every group; a
// representative sees the groups of their own generation. A leader of a group is chosen among the members of the
// group or of its assembly. Groups are not where people are followed up: that stays with the assembly's leaders.
export function GroupLeadersPanel({ base }: { base: string }) {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<{ items: Group[] }>(`${base}/groups`).then((r) => setGroups(r.items)).catch((e) => setError(e instanceof ApiError ? e.message : t('groupLeaders.load_failed')));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);

  const find = (groupId: string, q: string) =>
    api.get<{ items: Person[] }>(`${base}/candidates?communityId=${encodeURIComponent(groupId)}&search=${encodeURIComponent(q)}`).then((r) => setPeople(r.items)).catch(() => setPeople([]));

  async function appoint(group: Group, person: Person) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api.post(`${base}/leader`, { communityId: group.id, personId: person.id });
      setNote(t('groupLeaders.appointed', { name: person.name, group: group.name }));
      await load();
      await find(group.id, search);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('groupLeaders.action_failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="group-leaders">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('groupLeaders.title')}</h2>
        <p className="text-sm text-slate-600">{t('groupLeaders.help')}</p>
      </div>
      {note && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">{note}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {!groups && !error && <p className="text-sm text-slate-400">{t('groupLeaders.loading')}</p>}
      {groups && groups.length === 0 && <p className="card text-sm text-slate-600">{t('groupLeaders.none')}</p>}
      <ul className="space-y-2">
        {groups?.map((g) => (
          <li key={g.id} className="card space-y-2" data-testid="group-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="block font-semibold text-brand-900">{g.name}</span>
                <span className="block text-xs text-slate-500">
                  {g.assemblyName ? t('groupLeaders.of', { name: g.assemblyName }) : ''}{g.generation !== null ? ` · ${g.generation === 0 ? t('groupLeaders.founding') : t('groupLeaders.generation', { n: g.generation })}` : ''}
                </span>
                <span className="block text-xs text-slate-700">{g.leaders.length === 0 ? t('groupLeaders.no_leader') : t('groupLeaders.led_by', { names: g.leaders.map((l) => l.name).join(', ') })}</span>
              </span>
              <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => { const next = openId === g.id ? null : g.id; setOpenId(next); setSearch(''); if (next) void find(g.id, ''); }}>
                {openId === g.id ? t('groupLeaders.close') : t('groupLeaders.choose')}
              </button>
            </div>
            {openId === g.id && (
              <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm">
                <div className="flex gap-2">
                  <input className="input" value={search} placeholder={t('groupLeaders.search') ?? ''} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void find(g.id, search); } }} />
                  <button type="button" className="btn-secondary px-3" onClick={() => void find(g.id, search)}>{t('groupLeaders.search_button')}</button>
                </div>
                <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100 bg-white">
                  {people.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <span>{p.name}{p.whatsappNumber ? <span className="ml-2 text-xs text-slate-400">{p.whatsappNumber}</span> : null}</span>
                      <button type="button" className="btn-primary px-3 py-1.5" disabled={busy} onClick={() => void appoint(g, p)}>{t('groupLeaders.appoint')}</button>
                    </li>
                  ))}
                  {people.length === 0 && <li className="px-3 py-2 text-slate-500">{t('groupLeaders.nobody')}</li>}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
