import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

interface HeadquartersPostTargetRow {
  id: string;
  communityId: string;
  communityName: string;
}

interface HeadquartersPostRow {
  id: string;
  titleEn: string;
  titleFr: string | null;
  bodyEn: string;
  bodyFr: string | null;
  networkWide: boolean;
  createdAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  createdBy: { id: string; email: string };
  targets: HeadquartersPostTargetRow[];
  commentCount: number;
  reactionCount: number;
}

const EMPTY_FORM = { titleEn: '', titleFr: '', bodyEn: '', bodyFr: '' };

function postStatus(row: HeadquartersPostRow): 'draft' | 'published' | 'archived' {
  if (row.archivedAt) return 'archived';
  if (row.publishedAt) return 'published';
  return 'draft';
}

function statusBadgeClass(status: 'draft' | 'published' | 'archived') {
  switch (status) {
    case 'published':
      return 'bg-green-50 text-green-700';
    case 'archived':
      return 'bg-slate-100 text-slate-500';
    default:
      return 'bg-amber-50 text-amber-700';
  }
}

// Headquarters Network Posts & Shared Engagement — Admin (Central
// Authority) management surface. Draft -> Published -> Archived, expressed
// purely through publishedAt/archivedAt timestamps, mirroring
// AnnouncementsTab.tsx's own lifecycle exactly. Community-only targeting
// (no Geography/location/Leader/arbitrary-member picker), and a
// mutually-exclusive networkWide toggle: choosing network-wide clears any
// selected Communities, and adding a Community switches the post out of
// network-wide mode — see server/src/routes/adminHeadquartersPosts.ts.
export function HeadquartersPostsTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<HeadquartersPostRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [networkWide, setNetworkWide] = useState(false);
  const [formTargets, setFormTargets] = useState<{ id: string; name: string }[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  function load() {
    api
      .get<{ items: HeadquartersPostRow[]; pagination: { totalPages: number } }>(
        `/api/admin/headquarters-posts?page=${page}&pageSize=20`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      })
      .catch(() => setLoadError(t('admin.headquartersPosts.load_failed')));
  }

  useEffect(load, [page]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setNetworkWide(false);
    setFormTargets([]);
    setFormError(null);
    setEditingId(null);
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
  }

  function startEdit(row: HeadquartersPostRow) {
    setForm({ titleEn: row.titleEn, titleFr: row.titleFr ?? '', bodyEn: row.bodyEn, bodyFr: row.bodyFr ?? '' });
    setNetworkWide(row.networkWide);
    setFormTargets(row.targets.map((tgt) => ({ id: tgt.communityId, name: tgt.communityName })));
    setFormError(null);
    setEditingId(row.id);
    setShowForm(true);
  }

  function addTarget(item: { id: string; name: string }) {
    if (formTargets.some((f) => f.id === item.id)) return;
    setNetworkWide(false);
    setFormTargets((prev) => [...prev, item]);
  }

  function removeTarget(index: number) {
    setFormTargets((prev) => prev.filter((_, i) => i !== index));
  }

  function chooseNetworkWide() {
    setNetworkWide(true);
    setFormTargets([]);
  }

  async function submitForm() {
    setSubmitting(true);
    setFormError(null);
    const basePayload = {
      titleEn: form.titleEn.trim(),
      titleFr: form.titleFr.trim() || null,
      bodyEn: form.bodyEn.trim(),
      bodyFr: form.bodyFr.trim() || null,
    };
    try {
      if (editingId) {
        await api.patch(`/api/admin/headquarters-posts/${editingId}`, {
          ...basePayload,
          ...(networkWide ? { networkWide: true } : { targetCommunityIds: formTargets.map((f) => f.id) }),
        });
      } else {
        const created = await api.post<HeadquartersPostRow>('/api/admin/headquarters-posts', basePayload);
        if (networkWide || formTargets.length > 0) {
          await api.patch(`/api/admin/headquarters-posts/${created.id}`, {
            ...(networkWide ? { networkWide: true } : { targetCommunityIds: formTargets.map((f) => f.id) }),
          });
        }
      }
      resetForm();
      setShowForm(false);
      setPage(1);
      load();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : t(editingId ? 'admin.headquartersPosts.update_failed' : 'admin.headquartersPosts.create_failed'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function publish(id: string) {
    setActingOnId(id);
    setActionError(null);
    try {
      await api.post(`/api/admin/headquarters-posts/${id}/publish`, {});
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('admin.headquartersPosts.publish_failed'));
    } finally {
      setActingOnId(null);
    }
  }

  async function archive(id: string) {
    if (!window.confirm(t('admin.headquartersPosts.archive_confirm') ?? '')) return;
    setActingOnId(id);
    setActionError(null);
    try {
      await api.post(`/api/admin/headquarters-posts/${id}/archive`, {});
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('admin.headquartersPosts.archive_failed'));
    } finally {
      setActingOnId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-900">{t('admin.headquartersPosts.title')}</h2>
        <button className="btn-primary px-4 py-2" onClick={() => (showForm ? setShowForm(false) : startCreate())}>
          {showForm ? t('admin.headquartersPosts.cancel') : t('admin.headquartersPosts.new_post')}
        </button>
      </div>

      <p className="mb-4 text-sm text-slate-500">{t('admin.headquartersPosts.description')}</p>

      {showForm && (
        <div className="card mb-4 space-y-4">
          <h3 className="font-medium text-brand-900">
            {editingId ? t('admin.headquartersPosts.edit_post') : t('admin.headquartersPosts.new_post')}
          </h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="hqpost-title-en">
                {t('admin.headquartersPosts.title_en_label')}
              </label>
              <input
                id="hqpost-title-en"
                className="input"
                value={form.titleEn}
                onChange={(e) => setForm((v) => ({ ...v, titleEn: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="hqpost-title-fr">
                {t('admin.headquartersPosts.title_fr_label')}
              </label>
              <input
                id="hqpost-title-fr"
                className="input"
                value={form.titleFr}
                onChange={(e) => setForm((v) => ({ ...v, titleFr: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="hqpost-body-en">
                {t('admin.headquartersPosts.body_en_label')}
              </label>
              <textarea
                id="hqpost-body-en"
                className="input"
                rows={5}
                value={form.bodyEn}
                onChange={(e) => setForm((v) => ({ ...v, bodyEn: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="hqpost-body-fr">
                {t('admin.headquartersPosts.body_fr_label')}
              </label>
              <textarea
                id="hqpost-body-fr"
                className="input"
                rows={5}
                value={form.bodyFr}
                onChange={(e) => setForm((v) => ({ ...v, bodyFr: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="label">{t('admin.headquartersPosts.audience_label')}</label>
            <div className="mb-2 flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={networkWide} onChange={chooseNetworkWide} />
                {t('admin.headquartersPosts.audience_network_wide')}
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={!networkWide} onChange={() => setNetworkWide(false)} />
                {t('admin.headquartersPosts.audience_selected_communities')}
              </label>
            </div>

            {networkWide && <p className="mb-2 text-xs text-slate-400">{t('admin.headquartersPosts.network_wide_hint')}</p>}

            {!networkWide && (
              <>
                <label className="label">{t('admin.headquartersPosts.targets_label')}</label>
                {formTargets.length > 0 && (
                  <ul className="mb-2 space-y-1">
                    {formTargets.map((tgt, i) => (
                      <li key={tgt.id} className="flex items-center justify-between text-sm">
                        <span>{tgt.name}</span>
                        <button
                          type="button"
                          className="text-xs text-red-700 hover:underline"
                          onClick={() => removeTarget(i)}
                        >
                          {t('admin.headquartersPosts.remove_target')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {formTargets.length === 0 && (
                  <p className="mb-2 text-xs text-slate-400">{t('admin.headquartersPosts.no_targets')}</p>
                )}
                <SearchPicker
                  placeholder={t('admin.people.search_community_placeholder') ?? ''}
                  searchPath="/api/admin/communities?search="
                  renderLabel={(c) => c.name}
                  actionLabel={t('admin.headquartersPosts.add_target')}
                  searchButtonLabel={t('admin.people.search_button')}
                  onPick={(c) => addTarget({ id: c.id, name: c.name })}
                />
              </>
            )}
          </div>

          {formError && <p className="text-sm text-red-700">{formError}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={submitting || !form.titleEn.trim() || !form.bodyEn.trim()}
              onClick={submitForm}
            >
              {editingId ? t('admin.headquartersPosts.save_changes') : t('admin.headquartersPosts.create_draft')}
            </button>
            <button
              type="button"
              className="text-sm text-slate-500 hover:underline"
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
            >
              {t('admin.headquartersPosts.cancel')}
            </button>
          </div>
        </div>
      )}

      {loadError && <p className="mb-4 text-sm text-red-700">{loadError}</p>}
      {actionError && <p className="mb-4 text-sm text-red-700">{actionError}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.headquartersPosts.table_title')}</th>
              <th className="py-2 pr-4">{t('admin.headquartersPosts.table_status')}</th>
              <th className="py-2 pr-4">{t('admin.headquartersPosts.table_created')}</th>
              <th className="py-2 pr-4">{t('admin.headquartersPosts.table_published')}</th>
              <th className="py-2 pr-4">{t('admin.headquartersPosts.table_audience')}</th>
              <th className="py-2 pr-4">{t('admin.headquartersPosts.table_engagement')}</th>
              <th className="py-2 pr-4">{t('admin.headquartersPosts.table_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const status = postStatus(row);
              return (
                <tr key={row.id} className="border-b border-slate-50 align-top">
                  <td className="py-2 pr-4">{row.titleEn}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(status)}`}>
                      {t(`admin.headquartersPosts.status_${status}`)}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{new Date(row.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-4">{row.publishedAt ? new Date(row.publishedAt).toLocaleDateString() : '—'}</td>
                  <td className="max-w-[240px] py-2 pr-4">
                    {row.networkWide
                      ? t('admin.headquartersPosts.audience_network_wide')
                      : row.targets.map((tgt) => tgt.communityName).join(', ') || '—'}
                  </td>
                  <td className="py-2 pr-4">
                    {t('admin.headquartersPosts.engagement_summary', { comments: row.commentCount, reactions: row.reactionCount })}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-col gap-1">
                      {status === 'draft' && (
                        <>
                          <button className="text-brand-700 hover:underline" onClick={() => startEdit(row)}>
                            {t('admin.headquartersPosts.edit')}
                          </button>
                          <button
                            className="text-brand-700 hover:underline disabled:text-slate-300"
                            disabled={actingOnId === row.id}
                            onClick={() => publish(row.id)}
                          >
                            {t('admin.headquartersPosts.publish')}
                          </button>
                        </>
                      )}
                      {status !== 'archived' && (
                        <button
                          className="text-red-700 hover:underline disabled:text-slate-300"
                          disabled={actingOnId === row.id}
                          onClick={() => archive(row.id)}
                        >
                          {t('admin.headquartersPosts.archive')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-slate-400">
                  {t('admin.headquartersPosts.no_posts')}
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
