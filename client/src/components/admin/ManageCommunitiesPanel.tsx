import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { DeleteCommunityPanel } from './DeleteCommunityPanel';
import { NewChildPreview } from '../assembly/NewChildPreview';

interface Node {
  id: string;
  name: string;
  nameFr?: string | null;
  kind: 'ASSEMBLY' | 'GROUP';
  parentId: string | null;
  parent?: { id: string; name: string } | null;
  generation: number | null;
  _count?: { children: number; memberships: number };
}

// The central admin's way to look after the tree from their own profile: open an assembly to see what is in it, add
// an assembly or a group, rename it, say whether it is an assembly (a generation) or a group (never a generation),
// and delete it. The same tools as the admin dashboard's Communities tab, with the same rules.
export function ManageCommunitiesPanel({ base }: { base: string }) {
  const { t } = useTranslation();
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<Node[] | null>(null);
  const [search, setSearch] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editNameFr, setEditNameFr] = useState('');
  const [newNameFr, setNewNameFr] = useState('');
  const [editKind, setEditKind] = useState<'ASSEMBLY' | 'GROUP'>('ASSEMBLY');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<'ASSEMBLY' | 'GROUP'>('GROUP');
  const [newFull, setNewFull] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parent = trail.length > 0 ? trail[trail.length - 1] : null;

  const load = (q = search) => {
    const url = q.trim() ? `${base}?search=${encodeURIComponent(q.trim())}` : `${base}?${parent ? `parentId=${parent.id}` : ''}&page=1&pageSize=100`;
    api
      .get<{ items: Node[] }>(url)
      .then((r) => setItems(r.items))
      .catch((e) => setError(e instanceof ApiError ? e.message : t('manageGroups.load_failed')));
  };
  useEffect(() => {
    setSearch('');
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, parent?.id]);

  const label = (n: Node) => (n.generation === null ? '' : n.generation === 0 ? t('manageGroups.founding') : t('manageGroups.generation', { n: n.generation }));

  async function run(action: () => Promise<unknown>, done: string) {
    setError(null);
    setNote(null);
    try {
      await action();
      setNote(done);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('manageGroups.action_failed'));
    }
  }

  return (
    <div className="space-y-4" data-testid="manage-communities">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('manageGroups.title')}</h2>
        <p className="text-sm text-slate-600">{t('manageGroups.help')}</p>
      </div>
      {note && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800" role="status">{note}</p>}
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center gap-1 text-sm">
        <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setTrail([])}>{t('manageGroups.top')}</button>
        {trail.map((b, i) => (
          <span key={b.id}>
            {' › '}
            <button type="button" className="font-semibold text-brand-700 underline" onClick={() => setTrail(trail.slice(0, i + 1))}>{b.name}</button>
          </span>
        ))}
      </div>

      <div className="flex gap-2">
        <input className="input" value={search} placeholder={t('manageGroups.search') ?? ''} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); load(); } }} />
        <button type="button" className="btn-secondary px-3" onClick={() => load()}>{t('manageGroups.search_button')}</button>
      </div>

      {!adding ? (
        <button type="button" className="btn-primary" onClick={() => { setAdding(true); setNewKind(parent ? 'GROUP' : 'ASSEMBLY'); }}>
          + {parent ? t('manageGroups.add_in', { name: parent.name }) : t('manageGroups.add_top')}
        </button>
      ) : (
        <form
          className="card space-y-3"
          data-testid="manage-add"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.post(base, { name: newName, ...(newNameFr.trim() ? { nameFr: newNameFr.trim() } : {}), kind: newKind, ...(parent ? { parentId: parent.id } : {}), autoPlacementEligible: false }).then(() => { setNewName(''); setNewNameFr(''); setAdding(false); }), t('manageGroups.added'));
          }}
        >
          <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('manageGroups.name') ?? ''} aria-label={t('manageGroups.name') ?? ''} maxLength={200} />
          <input className="input" value={newNameFr} onChange={(e) => setNewNameFr(e.target.value)} placeholder={t('manageGroups.name_fr_placeholder') ?? ''} aria-label={t('manageGroups.name_fr') ?? ''} maxLength={200} />
          <fieldset className="space-y-1 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="manage-new-kind" checked={newKind === 'GROUP'} disabled={!parent} onChange={() => setNewKind('GROUP')} /> {t('manageGroups.kind_group')}</label>
            <label className="flex items-center gap-2"><input type="radio" name="manage-new-kind" checked={newKind === 'ASSEMBLY'} onChange={() => setNewKind('ASSEMBLY')} /> {t('manageGroups.kind_assembly')}</label>
            {!parent && <p className="text-xs text-slate-500">{t('manageGroups.group_needs_assembly')}</p>}
          </fieldset>
          {parent && <NewChildPreview base={base} parentId={parent.id} kind={newKind} onFull={setNewFull} />}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={newName.trim().length === 0 || (newKind === 'GROUP' && !parent) || (newKind === 'ASSEMBLY' && Boolean(parent) && newFull)}>{t('manageGroups.create')}</button>
            <button type="button" className="btn-secondary" onClick={() => setAdding(false)}>{t('manageGroups.cancel')}</button>
          </div>
        </form>
      )}

      {!items && !error && <p className="text-sm text-slate-400">{t('manageGroups.loading')}</p>}
      {items && items.length === 0 && <p className="card text-sm text-slate-600">{t('manageGroups.none')}</p>}
      <ul className="space-y-2">
        {items?.map((n) => (
          <li key={n.id} className="card space-y-2" data-testid="manage-row">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block font-semibold text-brand-900">
                  {n.name}
                  {n.nameFr && <span className="block text-xs font-normal text-slate-500" data-testid="manage-name-fr">🇫🇷 {n.nameFr}</span>}
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${n.kind === 'GROUP' ? 'bg-slate-100 text-slate-600' : 'bg-brand-50 text-brand-800'}`}>{n.kind === 'GROUP' ? t('manageGroups.badge_group') : t('manageGroups.badge_assembly')}</span>
                </span>
                <span className="block text-xs text-slate-500">
                  {label(n)}{n.parent ? ` · ${t('manageGroups.inside', { name: n.parent.name })}` : ''} · {t('manageGroups.counts', { members: n._count?.memberships ?? 0, inside: n._count?.children ?? 0 })}
                </span>
              </span>
              <span className="flex flex-wrap gap-3 text-sm font-semibold">
                <button type="button" className="text-brand-700 underline" onClick={() => { setSearch(''); setTrail([...trail, { id: n.id, name: n.name }]); }}>{t('manageGroups.open')}</button>
                <button type="button" className="text-brand-700 underline" onClick={() => { setEditId(editId === n.id ? null : n.id); setEditName(n.name); setEditNameFr(n.nameFr ?? ''); setEditKind(n.kind); setDeleteId(null); }}>{t('manageGroups.edit')}</button>
                <button type="button" className="text-red-600 underline" onClick={() => { setDeleteId(deleteId === n.id ? null : n.id); setEditId(null); }}>{t('manageGroups.delete')}</button>
              </span>
            </div>
            {editId === n.id && (
              <form
                className="space-y-2 rounded-lg bg-slate-50 p-3 text-sm"
                data-testid="manage-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => api.patch(`${base}/${n.id}`, { name: editName, nameFr: editNameFr.trim(), kind: editKind }).then(() => setEditId(null)), t('manageGroups.saved'));
                }}
              >
                <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} aria-label={t('manageGroups.name') ?? ''} maxLength={200} />
                <input className="input" value={editNameFr} onChange={(e) => setEditNameFr(e.target.value)} placeholder={t('manageGroups.name_fr_placeholder') ?? ''} aria-label={t('manageGroups.name_fr') ?? ''} maxLength={200} />
                {n.parentId && (
                  <fieldset className="space-y-1">
                    <label className="flex items-center gap-2"><input type="radio" name={`edit-kind-${n.id}`} checked={editKind === 'GROUP'} onChange={() => setEditKind('GROUP')} /> {t('manageGroups.kind_group')}</label>
                    <label className="flex items-center gap-2"><input type="radio" name={`edit-kind-${n.id}`} checked={editKind === 'ASSEMBLY'} onChange={() => setEditKind('ASSEMBLY')} /> {t('manageGroups.kind_assembly')}</label>
                  </fieldset>
                )}
                <div className="flex gap-2">
                  <button type="submit" className="btn-primary px-3 py-1.5" disabled={editName.trim().length === 0}>{t('manageGroups.save')}</button>
                  <button type="button" className="btn-secondary px-3 py-1.5" onClick={() => setEditId(null)}>{t('manageGroups.cancel')}</button>
                </div>
              </form>
            )}
            {deleteId === n.id && (
              <DeleteCommunityPanel
                base={base}
                node={n}
                onCancel={() => setDeleteId(null)}
                onDone={(message) => {
                  setDeleteId(null);
                  setNote(message);
                  load();
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
