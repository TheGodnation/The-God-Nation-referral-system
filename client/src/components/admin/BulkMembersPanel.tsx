import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

// "Add many people": choose where they are now (a generation, one assembly, or no assembly yet), tick
// who should go — only that group is shown — and add them to an assembly (existing or new) in one go.
interface GenerationRow { generation: number; assemblies: number; people: number }
interface Summary { hasHeadquarters: boolean; generations: GenerationRow[]; noAssembly: number }
interface PersonRow { id: string; name: string; whatsappNumber: string | null }
interface AssemblyPick { id: string; name: string }
interface Result { destination: AssemblyPick; created: boolean; added: number; alreadyIn: number; removed: number }

const PAGE = 50;

export function BulkMembersPanel({ base }: { base: string }) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [source, setSource] = useState<{ key: string; label: string } | null>(null);
  const [pickingAssembly, setPickingAssembly] = useState(false);
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<PersonRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [destMode, setDestMode] = useState<'existing' | 'new'>('existing');
  const [dest, setDest] = useState<AssemblyPick | null>(null);
  const [newName, setNewName] = useState('');
  const [newParent, setNewParent] = useState<AssemblyPick | null>(null);
  const [removeFromSource, setRemoveFromSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    api.get<Summary>(`${base}/generations`).then(setSummary).catch(() => setError(t('bulkMembers.load_failed')));
  }, [base, t]);

  function loadPeople(key: string, q: string, p: number, append: boolean) {
    api
      .get<{ items: PersonRow[]; total: number }>(`${base}/people?source=${encodeURIComponent(key)}&search=${encodeURIComponent(q)}&page=${p}&pageSize=${PAGE}`)
      .then((r) => {
        setPeople((prev) => (append ? [...prev, ...r.items] : r.items));
        setTotal(r.total);
      })
      .catch(() => setError(t('bulkMembers.load_failed')));
  }

  function chooseSource(key: string, label: string) {
    setSource({ key, label });
    setPickingAssembly(false);
    setSearch('');
    setPage(1);
    setSelected(new Set());
    setResult(null);
    setError(null);
    loadPeople(key, '', 1, false);
  }

  function runSearch() {
    if (!source) return;
    setPage(1);
    loadPeople(source.key, search, 1, false);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function selectAll() {
    if (!source) return;
    try {
      const r = await api.get<{ ids: string[]; capped: boolean }>(`${base}/ids?source=${encodeURIComponent(source.key)}&search=${encodeURIComponent(search)}`);
      setSelected(new Set(r.ids));
      if (r.capped) setError(t('bulkMembers.capped'));
    } catch {
      setError(t('bulkMembers.load_failed'));
    }
  }

  const destinationReady = destMode === 'existing' ? Boolean(dest) : newName.trim().length > 0;
  const canAdd = selected.size > 0 && destinationReady && !busy;

  async function add() {
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<Result>(`${base}/add`, {
        personIds: [...selected],
        ...(destMode === 'existing' ? { destinationId: dest!.id } : { newAssembly: { name: newName.trim(), ...(newParent ? { parentId: newParent.id } : {}) } }),
        ...(removeFromSource ? { removeFromSource: source.key } : {}),
      });
      setResult(res);
      setSelected(new Set());
      loadPeople(source.key, search, 1, false);
      setPage(1);
      api.get<Summary>(`${base}/generations`).then(setSummary).catch(() => {});
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('bulkMembers.add_failed'));
    } finally {
      setBusy(false);
    }
  }

  const genLabel = (g: number) => (g === 0 ? t('bulkMembers.headquarters') : t('bulkMembers.generation_n', { n: g }));

  return (
    <div className="space-y-5" data-testid="bulk-members">
      <p className="text-sm text-slate-600">{t('bulkMembers.help')}</p>

      <section className="card">
        <h3 className="mb-2 font-semibold text-brand-900">1. {t('bulkMembers.step_from')}</h3>
        {!summary && !error && <p className="text-sm text-slate-400">{t('common.loading')}</p>}
        {summary && !summary.hasHeadquarters && <p className="mb-2 text-sm text-amber-800">{t('bulkMembers.no_headquarters')}</p>}
        <div className="flex flex-wrap gap-2">
          {summary?.generations.map((g) => (
            <button
              key={g.generation}
              type="button"
              onClick={() => chooseSource(`gen:${g.generation}`, genLabel(g.generation))}
              className={`rounded-full border px-3 py-2 text-sm font-semibold ${source?.key === `gen:${g.generation}` ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
            >
              {genLabel(g.generation)} · {t('bulkMembers.people_count', { count: g.people })}
            </button>
          ))}
          {summary && (
            <button
              type="button"
              onClick={() => chooseSource('none', t('bulkMembers.no_assembly'))}
              className={`rounded-full border px-3 py-2 text-sm font-semibold ${source?.key === 'none' ? 'border-brand-700 bg-brand-700 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
            >
              {t('bulkMembers.no_assembly')} · {t('bulkMembers.people_count', { count: summary.noAssembly })}
            </button>
          )}
          <button type="button" onClick={() => setPickingAssembly((v) => !v)} className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
            {t('bulkMembers.one_assembly')}
          </button>
        </div>
        {pickingAssembly && (
          <div className="mt-3">
            <SearchPicker
              placeholder={t('bulkMembers.assembly_placeholder')}
              searchPath={`${base}/assemblies?search=`}
              renderLabel={(a) => a.name}
              actionLabel={t('bulkMembers.choose')}
              searchButtonLabel={t('bulkMembers.search')}
              onPick={(a) => chooseSource(`community:${a.id}`, a.name)}
            />
          </div>
        )}
      </section>

      {source && (
        <section className="card" data-testid="bulk-people">
          <h3 className="mb-2 font-semibold text-brand-900">2. {t('bulkMembers.step_who', { from: source.label })}</h3>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <input
              className="input"
              placeholder={t('bulkMembers.search_people') ?? ''}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  runSearch();
                }
              }}
            />
            <button type="button" className="btn-secondary sm:w-32" onClick={runSearch}>{t('bulkMembers.search')}</button>
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-3 text-sm">
            <button type="button" className="font-semibold text-brand-700 underline" onClick={selectAll}>{t('bulkMembers.select_all', { count: total })}</button>
            <button type="button" className="text-slate-600 underline" onClick={() => setSelected(new Set())}>{t('bulkMembers.clear')}</button>
            <span className="ml-auto font-semibold text-brand-900" data-testid="bulk-selected">{t('bulkMembers.selected', { count: selected.size })}</span>
          </div>
          {people.length === 0 && <p className="py-3 text-sm text-slate-500">{t('bulkMembers.nobody')}</p>}
          <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100">
            {people.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className="text-xs text-slate-400">{p.whatsappNumber}</span>
                </label>
              </li>
            ))}
          </ul>
          {people.length < total && (
            <button
              type="button"
              className="btn-secondary mt-2 px-3 py-1.5 text-sm"
              onClick={() => {
                const next = page + 1;
                setPage(next);
                loadPeople(source.key, search, next, true);
              }}
            >
              {t('bulkMembers.show_more', { shown: people.length, total })}
            </button>
          )}
        </section>
      )}

      {source && (
        <section className="card" data-testid="bulk-destination">
          <h3 className="mb-2 font-semibold text-brand-900">3. {t('bulkMembers.step_to')}</h3>
          <div className="mb-3 flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="bulk-dest" checked={destMode === 'existing'} onChange={() => setDestMode('existing')} />
              {t('bulkMembers.dest_existing')}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="bulk-dest" checked={destMode === 'new'} onChange={() => setDestMode('new')} />
              {t('bulkMembers.dest_new')}
            </label>
          </div>
          {destMode === 'existing' ? (
            <>
              {dest && <p className="mb-2 text-sm font-semibold text-brand-900">✔ {dest.name}</p>}
              <SearchPicker
                placeholder={t('bulkMembers.assembly_placeholder')}
                searchPath={`${base}/assemblies?search=`}
                renderLabel={(a) => a.name}
                actionLabel={t('bulkMembers.choose')}
                searchButtonLabel={t('bulkMembers.search')}
                onPick={(a) => setDest({ id: a.id, name: a.name })}
              />
            </>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="text-slate-700">{t('bulkMembers.new_name')}</span>
                <input className="input mt-1" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} />
              </label>
              <div className="text-sm">
                <p className="mb-1 text-slate-700">{t('bulkMembers.new_parent')} {newParent ? <strong>{newParent.name}</strong> : <em>{t('bulkMembers.new_parent_none')}</em>}</p>
                <SearchPicker
                  placeholder={t('bulkMembers.assembly_placeholder')}
                  searchPath={`${base}/assemblies?search=`}
                  renderLabel={(a) => a.name}
                  actionLabel={t('bulkMembers.choose')}
                  searchButtonLabel={t('bulkMembers.search')}
                  onPick={(a) => setNewParent({ id: a.id, name: a.name })}
                />
              </div>
            </div>
          )}
          <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" checked={removeFromSource} onChange={(e) => setRemoveFromSource(e.target.checked)} />
            <span>{t('bulkMembers.remove_from_source', { from: source.label })}</span>
          </label>
          {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
          <button type="button" className="btn-primary mt-4" disabled={!canAdd} onClick={add}>
            {busy ? t('bulkMembers.adding') : t('bulkMembers.add_button', { count: selected.size })}
          </button>
          {result && (
            <p className="mt-3 rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status" data-testid="bulk-result">
              {t('bulkMembers.result', { added: result.added, assembly: result.destination.name, already: result.alreadyIn })}
              {result.removed > 0 ? ' ' + t('bulkMembers.result_removed', { count: result.removed }) : ''}
            </p>
          )}
        </section>
      )}
      {!source && error && <p className="text-sm text-red-700" role="alert">{error}</p>}
    </div>
  );
}
