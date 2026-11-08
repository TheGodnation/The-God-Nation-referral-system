import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

interface Outcome {
  personId: string;
  name: string;
  status: 'APPOINTED' | 'ALREADY_LEADER' | 'NOT_FOUND';
  addedToAssembly: boolean;
  leaderAccount: 'CREATED' | 'ALREADY' | 'NO_MEMBER_ACCOUNT' | 'EMAIL_TAKEN' | null;
}
interface Person { id: string; name: string; whatsappNumber?: string | null; hasMemberAccount?: boolean }

// Make people leaders of this assembly in one step: they are added to it if they are not members yet, appointed, and
// given the Leader account that opens their leadership dashboard. Choose them from the leaders of another group or
// assembly (for example the Leadership Team), or find anyone by name or number.
export function MakeLeadersPanel({ base, communityId, communityName }: { base: string; communityId: string; communityName: string }) {
  const { t } = useTranslation();
  const communitySearch = base.includes('central') ? '/api/member/central-communities?search=' : '/api/admin/communities?search=';
  const [from, setFrom] = useState<{ id: string; name: string } | null>(null);
  const [fromLeaders, setFromLeaders] = useState<Person[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Person[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Outcome[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pickSource(c: { id: string; name: string }) {
    setFrom(c);
    setResults(null);
    try {
      const r = await api.get<{ items: Person[] }>(`${base}/leaders-of?communityId=${encodeURIComponent(c.id)}`);
      setFromLeaders(r.items);
      setTicked(new Set(r.items.map((p) => p.id)));
    } catch {
      setFromLeaders([]);
    }
  }

  async function search() {
    setError(null);
    try {
      const r = await api.get<{ items: Person[] }>(`${base}/people?search=${encodeURIComponent(query)}`);
      setFound(r.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('makeLeaders.failed'));
    }
  }

  async function make(personIds: string[]) {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const r = await api.post<{ results: Outcome[] }>(`${base}/make-leaders`, { communityId, personIds });
      setResults(r.results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('makeLeaders.failed'));
    } finally {
      setBusy(false);
    }
  }

  const line = (o: Outcome) => {
    if (o.status === 'NOT_FOUND') return t('makeLeaders.not_found');
    const head = o.status === 'ALREADY_LEADER' ? t('makeLeaders.already', { name: o.name }) : t('makeLeaders.now_leader', { name: o.name });
    const added = o.addedToAssembly ? ' ' + t('makeLeaders.added') : '';
    const tail =
      o.leaderAccount === 'NO_MEMBER_ACCOUNT' ? ' ' + t('makeLeaders.no_app')
      : o.leaderAccount === 'EMAIL_TAKEN' ? ' ' + t('makeLeaders.email_taken')
      : ' ' + t('makeLeaders.dashboard_ready');
    return head + added + tail;
  };

  return (
    <div className="space-y-4 rounded-lg bg-slate-50 p-3 text-sm" data-testid="make-leaders">
      <p className="text-slate-700">{t('makeLeaders.help', { name: communityName })}</p>

      <div className="space-y-2">
        <p className="font-semibold text-slate-800">{t('makeLeaders.from_title')}</p>
        <SearchPicker
          placeholder={t('makeLeaders.from_search') ?? ''}
          searchPath={communitySearch}
          renderLabel={(c) => c.name}
          actionLabel={t('makeLeaders.choose')}
          searchButtonLabel={t('makeLeaders.search')}
          onPick={(c) => void pickSource({ id: c.id, name: c.name })}
        />
        {from && (
          <div className="space-y-2" data-testid="from-leaders">
            <p className="font-medium text-slate-800">{t('makeLeaders.leaders_of', { name: from.name })}</p>
            {fromLeaders.length === 0 && <p className="text-slate-500">{t('makeLeaders.no_leaders_there')}</p>}
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-white">
              {fromLeaders.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                    <input type="checkbox" checked={ticked.has(p.id)} onChange={() => setTicked((prev) => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })} />
                    {p.name}
                  </label>
                </li>
              ))}
            </ul>
            {fromLeaders.length > 0 && (
              <button type="button" className="btn-primary" disabled={busy || ticked.size === 0} onClick={() => void make([...ticked])}>
                {t('makeLeaders.make_these', { count: ticked.size, name: communityName })}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <p className="font-semibold text-slate-800">{t('makeLeaders.find_title')}</p>
        <div className="flex gap-2">
          <input className="input" value={query} placeholder={t('makeLeaders.find_placeholder') ?? ''} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} />
          <button type="button" className="btn-secondary px-3" onClick={() => void search()}>{t('makeLeaders.search')}</button>
        </div>
        {found && found.length === 0 && <p className="text-slate-600" data-testid="not-found-hint">{t('makeLeaders.nobody_found')}</p>}
        {found && found.length > 0 && (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100 bg-white">
            {found.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                <span>
                  {p.name}
                  {p.whatsappNumber && <span className="ml-2 text-xs text-slate-400">{p.whatsappNumber}</span>}
                  {p.hasMemberAccount === false && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{t('makeLeaders.not_joined')}</span>}
                </span>
                <button type="button" className="btn-primary px-3 py-1.5" disabled={busy} onClick={() => void make([p.id])}>{t('makeLeaders.make_leader')}</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && <p className="text-red-700" role="alert">{error}</p>}
      {results && (
        <ul className="space-y-1 rounded-lg bg-green-50 p-3 text-green-900" role="status" data-testid="make-results">
          {results.map((o) => (
            <li key={o.personId}>✔ {line(o)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
