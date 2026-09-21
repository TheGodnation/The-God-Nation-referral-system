import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface GeographyNode {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  countryCode: string;
  active: boolean;
  _count?: { children: number };
}

const EMPTY_FORM = { name: '', type: '', countryCode: '', active: true };

// Phase 3A: a configurable geographic hierarchy, browsed one level at a
// time (never the whole tree at once) via a breadcrumb + "Open" action,
// consistent with the "no heavy client-side tree visualization" and
// "avoid huge tree payloads" requirements.
export function GeographyTab() {
  const { t } = useTranslation();
  const [breadcrumb, setBreadcrumb] = useState<{ id: string; name: string }[]>([]);
  const [items, setItems] = useState<GeographyNode[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const parentId = breadcrumb.length > 0 ? breadcrumb[breadcrumb.length - 1].id : null;

  function load() {
    const query = parentId ? `parentId=${parentId}` : '';
    api
      .get<{ items: GeographyNode[]; pagination: { totalPages: number } }>(
        `/api/admin/geography?${query}&page=${page}&pageSize=20`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }

  useEffect(load, [parentId, page]);

  function openChildren(node: GeographyNode) {
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
      await api.post('/api/admin/geography', {
        name: form.name,
        type: form.type,
        countryCode: parentId ? form.countryCode || undefined : form.countryCode,
        parentId: parentId ?? undefined,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.geography.create_failed'));
    }
  }

  function startEdit(node: GeographyNode) {
    setShowForm(false);
    setEditingId(node.id);
    setEditForm({ name: node.name, type: node.type, countryCode: node.countryCode, active: node.active });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setError(null);
    try {
      await api.patch(`/api/admin/geography/${editingId}`, {
        name: editForm.name,
        type: editForm.type,
        countryCode: editForm.countryCode,
      });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.geography.save_failed'));
    }
  }

  async function toggleActive(node: GeographyNode) {
    await api.patch(`/api/admin/geography/${node.id}`, { active: !node.active });
    load();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button
            className={`hover:underline ${breadcrumb.length === 0 ? 'font-semibold text-brand-900' : 'text-brand-700'}`}
            onClick={() => jumpTo(0)}
          >
            {t('admin.geography.root')}
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
          {t('admin.geography.new_node')}
        </button>
      </div>

      {error && !showForm && !editingId && <p className="mb-4 text-sm text-red-700">{error}</p>}

      {showForm && (
        <form onSubmit={create} className="card mb-4 space-y-3">
          <input
            className="input"
            placeholder={t('admin.geography.name_placeholder') ?? ''}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder={t('admin.geography.type_placeholder') ?? ''}
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            required
          />
          {!parentId && (
            <input
              className="input"
              placeholder={t('admin.geography.country_code_placeholder') ?? ''}
              value={form.countryCode}
              onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value }))}
              maxLength={2}
              required
            />
          )}
          {parentId && <p className="text-xs text-slate-400">{t('admin.geography.child_hint')}</p>}
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary" type="submit">
            {t('admin.geography.create')}
          </button>
        </form>
      )}

      {editingId && (
        <form onSubmit={saveEdit} className="card mb-4 space-y-3">
          <input
            className="input"
            value={editForm.name}
            onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <input
            className="input"
            value={editForm.type}
            onChange={(e) => setEditForm((f) => ({ ...f, type: e.target.value }))}
            required
          />
          <input
            className="input"
            value={editForm.countryCode}
            onChange={(e) => setEditForm((f) => ({ ...f, countryCode: e.target.value }))}
            maxLength={2}
            required
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-primary" type="submit">
              {t('admin.geography.save_changes')}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditingId(null)}>
              {t('admin.geography.cancel')}
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[600px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.geography.table_action')}</th>
              <th className="py-2 pr-4">{t('admin.geography.table_name')}</th>
              <th className="py-2 pr-4">{t('admin.geography.table_type')}</th>
              <th className="py-2 pr-4">{t('admin.geography.table_country')}</th>
              <th className="py-2 pr-4">{t('admin.geography.table_active')}</th>
              <th className="py-2 pr-4">{t('admin.geography.table_children')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((node) => (
              <tr key={node.id} className="border-b border-slate-50">
                <td className="space-x-2 whitespace-nowrap py-2 pr-4">
                  <button className="text-brand-700 hover:underline" onClick={() => openChildren(node)}>
                    {t('admin.geography.open')}
                  </button>
                  <button className="text-brand-700 hover:underline" onClick={() => startEdit(node)}>
                    {t('admin.geography.edit')}
                  </button>
                  <button className="text-brand-700 hover:underline" onClick={() => toggleActive(node)}>
                    {node.active ? t('admin.geography.deactivate') : t('admin.geography.activate')}
                  </button>
                </td>
                <td className="py-2 pr-4">{node.name}</td>
                <td className="py-2 pr-4">{node.type}</td>
                <td className="py-2 pr-4">{node.countryCode}</td>
                <td className="py-2 pr-4">
                  {node.active ? t('admin.geography.yes') : t('admin.geography.no')}
                </td>
                <td className="py-2 pr-4">{node._count?.children ?? 0}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-slate-400">
                  {t('admin.geography.no_nodes')}
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
