import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

interface AnnouncementTargetRow {
  id: string;
  communityId: string | null;
  communityName: string | null;
  geographyId: string | null;
  geographyName: string | null;
}

interface AnnouncementRow {
  id: string;
  titleEn: string;
  titleFr: string | null;
  bodyEn: string;
  bodyFr: string | null;
  createdAt: string;
  publishedAt: string | null;
  archivedAt: string | null;
  createdBy: { id: string; email: string };
  targets: AnnouncementTargetRow[];
}

type FormTarget = { type: 'COMMUNITY' | 'GEOGRAPHY'; id: string; name: string };

const EMPTY_FORM = { titleEn: '', titleFr: '', bodyEn: '', bodyFr: '' };

function announcementStatus(row: AnnouncementRow): 'draft' | 'published' | 'archived' {
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

function targetSummary(targets: AnnouncementTargetRow[]): string {
  if (targets.length === 0) return '—';
  return targets.map((t) => t.communityName ?? t.geographyName ?? '').join(', ');
}

// Phase 3M.3 — Admin management surface for Central Authority targeted
// announcements. Draft -> Published -> Archived, expressed purely through
// publishedAt/archivedAt timestamps (see server/src/lib/announcements.ts).
// Content and targets are only editable while a draft; publishing is
// immediate (no scheduling); archiving works from either draft or published
// state and is also how a draft is discarded (no separate hard-delete path).
export function AnnouncementsTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<AnnouncementRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [targetType, setTargetType] = useState<'COMMUNITY' | 'GEOGRAPHY'>('COMMUNITY');
  const [formTargets, setFormTargets] = useState<FormTarget[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actingOnId, setActingOnId] = useState<string | null>(null);

  function load() {
    api
      .get<{ items: AnnouncementRow[]; pagination: { totalPages: number } }>(
        `/api/admin/announcements?page=${page}&pageSize=20`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      })
      .catch(() => setLoadError(t('admin.announcements.load_failed')));
  }

  useEffect(load, [page]);

  function resetForm() {
    setForm(EMPTY_FORM);
    setTargetType('COMMUNITY');
    setFormTargets([]);
    setFormError(null);
    setEditingId(null);
  }

  function startCreate() {
    resetForm();
    setShowForm(true);
  }

  function startEdit(row: AnnouncementRow) {
    setForm({ titleEn: row.titleEn, titleFr: row.titleFr ?? '', bodyEn: row.bodyEn, bodyFr: row.bodyFr ?? '' });
    setFormTargets(
      row.targets.map((tgt) =>
        tgt.communityId
          ? { type: 'COMMUNITY', id: tgt.communityId, name: tgt.communityName ?? '' }
          : { type: 'GEOGRAPHY', id: tgt.geographyId as string, name: tgt.geographyName ?? '' },
      ),
    );
    setTargetType('COMMUNITY');
    setFormError(null);
    setEditingId(row.id);
    setShowForm(true);
  }

  function addTarget(item: { id: string; name: string }) {
    if (formTargets.some((f) => f.type === targetType && f.id === item.id)) return;
    setFormTargets((prev) => [...prev, { type: targetType, id: item.id, name: item.name }]);
  }

  function removeTarget(index: number) {
    setFormTargets((prev) => prev.filter((_, i) => i !== index));
  }

  async function submitForm() {
    setSubmitting(true);
    setFormError(null);
    const payload = {
      titleEn: form.titleEn.trim(),
      titleFr: form.titleFr.trim() || null,
      bodyEn: form.bodyEn.trim(),
      bodyFr: form.bodyFr.trim() || null,
      targets: formTargets.map((f) => (f.type === 'COMMUNITY' ? { communityId: f.id } : { geographyId: f.id })),
    };
    try {
      if (editingId) {
        await api.patch(`/api/admin/announcements/${editingId}`, payload);
      } else {
        await api.post('/api/admin/announcements', payload);
      }
      resetForm();
      setShowForm(false);
      setPage(1);
      load();
    } catch (err) {
      setFormError(
        err instanceof ApiError
          ? err.message
          : t(editingId ? 'admin.announcements.update_failed' : 'admin.announcements.create_failed'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function publish(id: string) {
    setActingOnId(id);
    setActionError(null);
    try {
      await api.post(`/api/admin/announcements/${id}/publish`, {});
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('admin.announcements.publish_failed'));
    } finally {
      setActingOnId(null);
    }
  }

  async function archive(id: string) {
    if (!window.confirm(t('admin.announcements.archive_confirm') ?? '')) return;
    setActingOnId(id);
    setActionError(null);
    try {
      await api.post(`/api/admin/announcements/${id}/archive`, {});
      load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('admin.announcements.archive_failed'));
    } finally {
      setActingOnId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-900">{t('admin.announcements.title')}</h2>
        <button className="btn-primary px-4 py-2" onClick={() => (showForm ? setShowForm(false) : startCreate())}>
          {showForm ? t('admin.announcements.cancel') : t('admin.announcements.new_announcement')}
        </button>
      </div>

      <p className="mb-4 text-sm text-slate-500">{t('admin.announcements.description')}</p>

      {showForm && (
        <div className="card mb-4 space-y-4">
          <h3 className="font-medium text-brand-900">
            {editingId ? t('admin.announcements.edit_announcement') : t('admin.announcements.new_announcement')}
          </h3>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="announcement-title-en">
                {t('admin.announcements.title_en_label')}
              </label>
              <input
                id="announcement-title-en"
                className="input"
                value={form.titleEn}
                onChange={(e) => setForm((v) => ({ ...v, titleEn: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="announcement-title-fr">
                {t('admin.announcements.title_fr_label')}
              </label>
              <input
                id="announcement-title-fr"
                className="input"
                value={form.titleFr}
                onChange={(e) => setForm((v) => ({ ...v, titleFr: e.target.value }))}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="announcement-body-en">
                {t('admin.announcements.body_en_label')}
              </label>
              <textarea
                id="announcement-body-en"
                className="input"
                rows={5}
                value={form.bodyEn}
                onChange={(e) => setForm((v) => ({ ...v, bodyEn: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="announcement-body-fr">
                {t('admin.announcements.body_fr_label')}
              </label>
              <textarea
                id="announcement-body-fr"
                className="input"
                rows={5}
                value={form.bodyFr}
                onChange={(e) => setForm((v) => ({ ...v, bodyFr: e.target.value }))}
              />
            </div>
          </div>

          <div>
            <label className="label">{t('admin.announcements.targets_label')}</label>
            {formTargets.length > 0 && (
              <ul className="mb-2 space-y-1">
                {formTargets.map((tgt, i) => (
                  <li key={`${tgt.type}-${tgt.id}`} className="flex items-center justify-between text-sm">
                    <span>
                      {tgt.type === 'COMMUNITY'
                        ? t('admin.roleAssignments.scope_community')
                        : t('admin.roleAssignments.scope_geography')}
                      : {tgt.name}
                    </span>
                    <button
                      type="button"
                      className="text-xs text-red-700 hover:underline"
                      onClick={() => removeTarget(i)}
                    >
                      {t('admin.announcements.remove_target')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {formTargets.length === 0 && (
              <p className="mb-2 text-xs text-slate-400">{t('admin.announcements.no_targets')}</p>
            )}

            <div className="mb-2">
              <select
                className="input w-auto"
                value={targetType}
                onChange={(e) => setTargetType(e.target.value as 'COMMUNITY' | 'GEOGRAPHY')}
              >
                <option value="COMMUNITY">{t('admin.roleAssignments.scope_community')}</option>
                <option value="GEOGRAPHY">{t('admin.roleAssignments.scope_geography')}</option>
              </select>
            </div>
            {targetType === 'COMMUNITY' ? (
              <SearchPicker
                placeholder={t('admin.people.search_community_placeholder') ?? ''}
                searchPath="/api/admin/communities?search="
                renderLabel={(c) => c.name}
                actionLabel={t('admin.announcements.add_target')}
                searchButtonLabel={t('admin.people.search_button')}
                onPick={(c) => addTarget({ id: c.id, name: c.name })}
              />
            ) : (
              <SearchPicker
                placeholder={t('admin.people.search_geography_placeholder') ?? ''}
                searchPath="/api/admin/geography?search="
                renderLabel={(g) => `${g.name} (${g.type})`}
                actionLabel={t('admin.announcements.add_target')}
                searchButtonLabel={t('admin.people.search_button')}
                onPick={(g) => addTarget({ id: g.id, name: g.name })}
              />
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
              {editingId ? t('admin.announcements.save_changes') : t('admin.announcements.create_draft')}
            </button>
            <button
              type="button"
              className="text-sm text-slate-500 hover:underline"
              onClick={() => {
                resetForm();
                setShowForm(false);
              }}
            >
              {t('admin.announcements.cancel')}
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
              <th className="py-2 pr-4">{t('admin.announcements.table_title')}</th>
              <th className="py-2 pr-4">{t('admin.announcements.table_status')}</th>
              <th className="py-2 pr-4">{t('admin.announcements.table_created')}</th>
              <th className="py-2 pr-4">{t('admin.announcements.table_published')}</th>
              <th className="py-2 pr-4">{t('admin.announcements.table_targets')}</th>
              <th className="py-2 pr-4">{t('admin.announcements.table_actions')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const status = announcementStatus(row);
              return (
                <tr key={row.id} className="border-b border-slate-50 align-top">
                  <td className="py-2 pr-4">{row.titleEn}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(status)}`}>
                      {t(`admin.announcements.status_${status}`)}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{new Date(row.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-4">{row.publishedAt ? new Date(row.publishedAt).toLocaleDateString() : '—'}</td>
                  <td className="max-w-[240px] py-2 pr-4">{targetSummary(row.targets)}</td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-col gap-1">
                      {status === 'draft' && (
                        <>
                          <button className="text-brand-700 hover:underline" onClick={() => startEdit(row)}>
                            {t('admin.announcements.edit')}
                          </button>
                          <button
                            className="text-brand-700 hover:underline disabled:text-slate-300"
                            disabled={actingOnId === row.id}
                            onClick={() => publish(row.id)}
                          >
                            {t('admin.announcements.publish')}
                          </button>
                        </>
                      )}
                      {status !== 'archived' && (
                        <button
                          className="text-red-700 hover:underline disabled:text-slate-300"
                          disabled={actingOnId === row.id}
                          onClick={() => archive(row.id)}
                        >
                          {t('admin.announcements.archive')}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-slate-400">
                  {t('admin.announcements.no_announcements')}
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
