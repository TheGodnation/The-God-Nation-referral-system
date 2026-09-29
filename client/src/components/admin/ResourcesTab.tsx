import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface ResourceRow {
  id: string;
  titleEn: string;
  titleFr: string | null;
  descriptionEn: string | null;
  descriptionFr: string | null;
  url: string | null;
  active: boolean;
}

const EMPTY_FORM = { titleEn: '', titleFr: '', descriptionEn: '', descriptionFr: '', url: '' };

// Book / Resource Access Grants — Admin management of the Resource
// CATALOG (title/description/url/active only — no ratings, reviews,
// comments, favorites, or purchases). Granting/revoking a specific
// Person's access lives in PeopleTab.tsx's own "Resource Access" section
// instead, mirroring CommunitiesTab.tsx's create/edit/toggle-active
// conventions.
export function ResourcesTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<ResourceRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<{ items: ResourceRow[]; pagination: { totalPages: number } }>(
        `/api/admin/resources?page=${page}&pageSize=20`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }

  useEffect(load, [page]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/admin/resources', {
        titleEn: form.titleEn,
        titleFr: form.titleFr || undefined,
        descriptionEn: form.descriptionEn || undefined,
        descriptionFr: form.descriptionFr || undefined,
        url: form.url || undefined,
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.resources.create_failed'));
    }
  }

  function startEdit(r: ResourceRow) {
    setShowForm(false);
    setEditingId(r.id);
    setEditForm({
      titleEn: r.titleEn,
      titleFr: r.titleFr ?? '',
      descriptionEn: r.descriptionEn ?? '',
      descriptionFr: r.descriptionFr ?? '',
      url: r.url ?? '',
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setError(null);
    try {
      await api.patch(`/api/admin/resources/${editingId}`, {
        titleEn: editForm.titleEn,
        titleFr: editForm.titleFr || null,
        descriptionEn: editForm.descriptionEn || null,
        descriptionFr: editForm.descriptionFr || null,
        url: editForm.url || null,
      });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.resources.save_failed'));
    }
  }

  async function toggleActive(r: ResourceRow) {
    await api.patch(`/api/admin/resources/${r.id}`, { active: !r.active });
    load();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-900">{t('admin.resources.title')}</h2>
        <button className="btn-primary px-4 py-2" onClick={() => { setEditingId(null); setShowForm((v) => !v); }}>
          {t('admin.resources.new_resource')}
        </button>
      </div>

      {error && !showForm && !editingId && <p className="mb-4 text-sm text-red-700">{error}</p>}

      {showForm && (
        <form onSubmit={create} className="card mb-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">{t('admin.resources.title_en_label')}</label>
              <input className="input" value={form.titleEn} onChange={(e) => setForm((f) => ({ ...f, titleEn: e.target.value }))} required />
            </div>
            <div>
              <label className="label">{t('admin.resources.title_fr_label')}</label>
              <input className="input" value={form.titleFr} onChange={(e) => setForm((f) => ({ ...f, titleFr: e.target.value }))} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">{t('admin.resources.description_en_label')}</label>
              <textarea className="input" rows={3} value={form.descriptionEn} onChange={(e) => setForm((f) => ({ ...f, descriptionEn: e.target.value }))} />
            </div>
            <div>
              <label className="label">{t('admin.resources.description_fr_label')}</label>
              <textarea className="input" rows={3} value={form.descriptionFr} onChange={(e) => setForm((f) => ({ ...f, descriptionFr: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">{t('admin.resources.url_label')}</label>
            <input className="input" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://..." />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary" type="submit">
            {t('admin.resources.create')}
          </button>
        </form>
      )}

      {editingId && (
        <form onSubmit={saveEdit} className="card mb-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">{t('admin.resources.title_en_label')}</label>
              <input className="input" value={editForm.titleEn} onChange={(e) => setEditForm((f) => ({ ...f, titleEn: e.target.value }))} required />
            </div>
            <div>
              <label className="label">{t('admin.resources.title_fr_label')}</label>
              <input className="input" value={editForm.titleFr} onChange={(e) => setEditForm((f) => ({ ...f, titleFr: e.target.value }))} />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">{t('admin.resources.description_en_label')}</label>
              <textarea className="input" rows={3} value={editForm.descriptionEn} onChange={(e) => setEditForm((f) => ({ ...f, descriptionEn: e.target.value }))} />
            </div>
            <div>
              <label className="label">{t('admin.resources.description_fr_label')}</label>
              <textarea className="input" rows={3} value={editForm.descriptionFr} onChange={(e) => setEditForm((f) => ({ ...f, descriptionFr: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">{t('admin.resources.url_label')}</label>
            <input className="input" value={editForm.url} onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))} placeholder="https://..." />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-primary" type="submit">
              {t('admin.resources.save_changes')}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditingId(null)}>
              {t('admin.resources.cancel')}
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.resources.table_action')}</th>
              <th className="py-2 pr-4">{t('admin.resources.table_title')}</th>
              <th className="py-2 pr-4">{t('admin.resources.table_active')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-slate-50">
                <td className="space-x-2 whitespace-nowrap py-2 pr-4">
                  <button className="text-brand-700 hover:underline" onClick={() => startEdit(r)}>
                    {t('admin.resources.edit')}
                  </button>
                  <button className="text-brand-700 hover:underline" onClick={() => toggleActive(r)}>
                    {r.active ? t('admin.resources.deactivate') : t('admin.resources.activate')}
                  </button>
                </td>
                <td className="py-2 pr-4">{r.titleEn}</td>
                <td className="py-2 pr-4">{r.active ? t('admin.resources.yes') : t('admin.resources.no')}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-slate-400">
                  {t('admin.resources.no_resources')}
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
