import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';
import { CentralAuthorityConversationOversight } from './CentralAuthorityConversationOversight';

interface CommunityNode {
  id: string;
  parentId: string | null;
  name: string;
  active: boolean;
  parent?: { id: string; name: string } | null;
  _count?: { children: number; memberships: number };
  // Purely derived server-side (never stored) — 0 for National Headquarters
  // itself, 1 for a direct child, and so on; null for any Community outside
  // the Headquarters tree, or while Headquarters isn't configured yet.
  generation?: number | null;
}

interface HeadquartersCommunity {
  id: string;
  name: string;
}

// Phase 3A: online God Nation communities — a self-referencing hierarchy
// (Mother -> Child -> Grandchild -> ...), browsed one level at a time via
// a breadcrumb, mirroring the Geography tab's pattern. Deliberately not
// geographically restricted (see the schema-level docs on the Community
// model) — no country/location fields here.
export function CommunitiesTab() {
  const { t } = useTranslation();
  const [breadcrumb, setBreadcrumb] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<CommunityNode[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editParentId, setEditParentId] = useState<string | null>(null);
  const [editParentName, setEditParentName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [oversightId, setOversightId] = useState<string | null>(null);

  const [headquarters, setHeadquarters] = useState<HeadquartersCommunity | null>(null);
  const [headquartersLoaded, setHeadquartersLoaded] = useState(false);
  const [designating, setDesignating] = useState(false);
  const [designateError, setDesignateError] = useState<string | null>(null);

  const parentId = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].id : null;

  function loadHeadquarters() {
    api
      .get<{ community: HeadquartersCommunity | null }>('/api/admin/communities/headquarters')
      .then((res) => setHeadquarters(res.community))
      .catch(() => {})
      .finally(() => setHeadquartersLoaded(true));
  }

  useEffect(loadHeadquarters, []);

  async function designateHeadquarters(community: { id: string; name: string }) {
    setDesignating(true);
    setDesignateError(null);
    try {
      const res = await api.put<{ community: HeadquartersCommunity }>('/api/admin/communities/headquarters', {
        communityId: community.id,
      });
      setHeadquarters(res.community);
      load();
    } catch (err) {
      setDesignateError(err instanceof ApiError ? err.message : t('admin.communities.headquarters_designate_failed'));
    } finally {
      setDesignating(false);
    }
  }

  function load() {
    const query = parentId ? `parentId=${parentId}` : '';
    api
      .get<{ items: CommunityNode[]; pagination: { totalPages: number } }>(
        `/api/admin/communities?${query}&page=${page}&pageSize=20`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }

  useEffect(load, [parentId, page]);

  function openChildren(node: CommunityNode) {
    setBreadcrumb((b) => [...b, { id: node.id, name: node.name }]);
    setPage(1);
    setShowForm(false);
    setEditingId(null);
  }

  function jumpTo(index: number) {
    setBreadcrumb((b) => b.slice(0, index));
    setPage(1);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/admin/communities', { name, parentId: parentId ?? undefined });
      setName('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.communities.create_failed'));
    }
  }

  function startEdit(node: CommunityNode) {
    setShowForm(false);
    setEditingId(node.id);
    setEditName(node.name);
    setEditParentId(node.parentId);
    setEditParentName(node.parent?.name ?? '');
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setError(null);
    try {
      await api.patch(`/api/admin/communities/${editingId}`, { name: editName, parentId: editParentId });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.communities.save_failed'));
    }
  }

  async function toggleActive(node: CommunityNode) {
    await api.patch(`/api/admin/communities/${node.id}`, { active: !node.active });
    load();
  }

  return (
    <div>
      <div className="card mb-4 space-y-2">
        <h3 className="font-semibold text-brand-900">{t('admin.communities.headquarters_heading')}</h3>
        {!headquartersLoaded ? (
          <p className="text-sm text-slate-400">{t('admin.communities.headquarters_loading')}</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              {headquarters
                ? t('admin.communities.headquarters_current', { name: headquarters.name })
                : t('admin.communities.headquarters_none')}
            </p>
            <SearchPicker
              placeholder={t('admin.communities.headquarters_search_placeholder') ?? ''}
              searchPath="/api/admin/communities?search="
              renderLabel={(c) => c.name}
              actionLabel={t('admin.communities.headquarters_designate_action')}
              searchButtonLabel={t('admin.communities.headquarters_search_button')}
              onPick={(c) => designateHeadquarters(c)}
            />
            {designating && <p className="text-sm text-slate-400">{t('admin.communities.headquarters_designating')}</p>}
            {designateError && <p className="text-sm text-red-700">{designateError}</p>}
          </>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button
            className={`hover:underline ${breadcrumb.length === 0 ? 'font-semibold text-brand-900' : 'text-brand-700'}`}
            onClick={() => jumpTo(0)}
          >
            {t('admin.communities.root')}
          </button>
          {breadcrumb.map((b, i) => (
            <span key={b.id} className="flex items-center gap-1">
              <span className="text-slate-300">/</span>
              <button
                className={`hover:underline ${i === breadcrumb.length - 1 ? 'font-semibold text-brand-900' : 'text-brand-700'}`}
                onClick={() => jumpTo(i + 1)}
              >
                {b.name}
              </button>
            </span>
          ))}
        </div>
        <button className="btn-primary px-4 py-2" onClick={() => { setEditingId(null); setShowForm((v) => !v); }}>
          {t('admin.communities.new_community')}
        </button>
      </div>

      {error && !showForm && !editingId && <p className="mb-4 text-sm text-red-700">{error}</p>}

      {showForm && (
        <form onSubmit={create} className="card mb-4 space-y-3">
          <input
            className="input"
            placeholder={t('admin.communities.name_placeholder') ?? ''}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary" type="submit">
            {t('admin.communities.create')}
          </button>
        </form>
      )}

      {editingId && (
        <form onSubmit={saveEdit} className="card mb-4 space-y-3">
          <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} required />
          <div>
            <label className="label">{t('admin.communities.parent_label')}</label>
            <p className="mb-2 text-sm text-slate-600">
              {editParentName || t('admin.communities.no_parent_selected')}
            </p>
            <SearchPicker
              placeholder={t('admin.communities.search_parent_placeholder') ?? ''}
              searchPath="/api/admin/communities?search="
              renderLabel={(c) => c.name}
              actionLabel={t('admin.communities.select')}
              searchButtonLabel={t('admin.people.search_button')}
              onPick={(c) => {
                setEditParentId(c.id);
                setEditParentName(c.name);
              }}
            />
            {editParentId && (
              <button
                type="button"
                className="mt-2 text-sm text-brand-700 hover:underline"
                onClick={() => {
                  setEditParentId(null);
                  setEditParentName('');
                }}
              >
                {t('admin.communities.clear_parent')}
              </button>
            )}
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-primary" type="submit">
              {t('admin.communities.save_changes')}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditingId(null)}>
              {t('admin.communities.cancel')}
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.communities.table_action')}</th>
              <th className="py-2 pr-4">{t('admin.communities.table_name')}</th>
              <th className="py-2 pr-4">{t('admin.communities.table_generation')}</th>
              <th className="py-2 pr-4">{t('admin.communities.table_active')}</th>
              <th className="py-2 pr-4">{t('admin.communities.table_members')}</th>
              <th className="py-2 pr-4">{t('admin.communities.table_children')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((node) => (
              <Fragment key={node.id}>
                <tr className="border-b border-slate-50">
                  <td className="space-x-2 whitespace-nowrap py-2 pr-4">
                    <button className="text-brand-700 hover:underline" onClick={() => openChildren(node)}>
                      {t('admin.communities.open')}
                    </button>
                    <button className="text-brand-700 hover:underline" onClick={() => startEdit(node)}>
                      {t('admin.communities.edit')}
                    </button>
                    <button className="text-brand-700 hover:underline" onClick={() => toggleActive(node)}>
                      {node.active ? t('admin.communities.deactivate') : t('admin.communities.activate')}
                    </button>
                    <button
                      className="text-brand-700 hover:underline"
                      onClick={() => setOversightId((cur) => (cur === node.id ? null : node.id))}
                    >
                      {t('admin.conversationOversight.open_action')}
                    </button>
                  </td>
                  <td className="py-2 pr-4">{node.name}</td>
                  <td className="py-2 pr-4">
                    {node.generation === null || node.generation === undefined
                      ? '—'
                      : node.generation === 0
                        ? t('admin.communities.generation_headquarters')
                        : t('admin.communities.generation_n', { generation: node.generation })}
                  </td>
                  <td className="py-2 pr-4">
                    {node.active ? t('admin.communities.yes') : t('admin.communities.no')}
                  </td>
                  <td className="py-2 pr-4">{node._count?.memberships ?? 0}</td>
                  <td className="py-2 pr-4">{node._count?.children ?? 0}</td>
                </tr>
                {oversightId === node.id && (
                  <tr key={`${node.id}-oversight`} className="border-b border-slate-50">
                    <td colSpan={6} className="p-3">
                      <CentralAuthorityConversationOversight
                        messagesUrl={`/api/admin/communities/${node.id}/conversation/messages`}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-slate-400">
                  {t('admin.communities.no_communities')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-center gap-3 text-sm">
            <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t('admin.prev')}
            </button>
            <span>{t('admin.page_of', { page, total: totalPages })}</span>
            <button
              className="btn-secondary px-3 py-1.5"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('admin.next')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
