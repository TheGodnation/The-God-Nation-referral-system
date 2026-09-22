import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

interface DevotionalRow {
  id: string;
  titleEn: string;
  titleFr: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  startDate: string;
  endDate: string;
  community: { id: string; name: string } | null;
  _count: { assessments: number };
}

// Phase 3E — read-only, derived from existing Attempt data.
interface CompletionRow {
  personId: string;
  name: string;
  attempted: boolean;
  completed: boolean;
  bestPercentage: number | null;
  lastAttemptAt: string | null;
}

const EMPTY_FORM = {
  titleEn: '',
  titleFr: '',
  descriptionEn: '',
  descriptionFr: '',
  contentEn: '',
  contentFr: '',
  coverImageUrl: '',
  startDate: '',
  endDate: '',
};

function toDateInput(iso: string): string {
  return iso ? iso.slice(0, 10) : '';
}

export function DevotionalsTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<DevotionalRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [communityId, setCommunityId] = useState<string | null>(null);
  const [communityName, setCommunityName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);

  const [completionFor, setCompletionFor] = useState<DevotionalRow | null>(null);
  const [completionRows, setCompletionRows] = useState<CompletionRow[]>([]);
  const [completionPage, setCompletionPage] = useState(1);
  const [completionTotalPages, setCompletionTotalPages] = useState(1);

  function load() {
    api
      .get<{ items: DevotionalRow[]; pagination: { totalPages: number } }>(
        `/api/admin/devotionals?page=${page}&pageSize=20`,
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
      await api.post('/api/admin/devotionals', {
        ...form,
        titleFr: form.titleFr || undefined,
        descriptionEn: form.descriptionEn || undefined,
        descriptionFr: form.descriptionFr || undefined,
        contentFr: form.contentFr || undefined,
        coverImageUrl: form.coverImageUrl || undefined,
        communityId: communityId ?? undefined,
      });
      setForm(EMPTY_FORM);
      setCommunityId(null);
      setCommunityName('');
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.devotionals.create_failed'));
    }
  }

  function startEdit(item: DevotionalRow) {
    setShowForm(false);
    setEditingId(item.id);
    setEditForm({
      titleEn: item.titleEn,
      titleFr: item.titleFr ?? '',
      descriptionEn: '',
      descriptionFr: '',
      contentEn: '',
      contentFr: '',
      coverImageUrl: '',
      startDate: toDateInput(item.startDate),
      endDate: toDateInput(item.endDate),
    });
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingId) return;
    setError(null);
    try {
      await api.patch(`/api/admin/devotionals/${editingId}`, {
        titleEn: editForm.titleEn,
        titleFr: editForm.titleFr || undefined,
        startDate: editForm.startDate || undefined,
        endDate: editForm.endDate || undefined,
      });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.devotionals.save_failed'));
    }
  }

  async function setStatus(item: DevotionalRow, status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') {
    await api.patch(`/api/admin/devotionals/${item.id}`, { status });
    load();
  }

  function viewCompletion(item: DevotionalRow) {
    setCompletionFor(item);
    setCompletionPage(1);
  }

  useEffect(() => {
    if (!completionFor) return;
    api
      .get<{ items: CompletionRow[]; pagination: { totalPages: number } }>(
        `/api/admin/devotionals/${completionFor.id}/completion-summary?page=${completionPage}&pageSize=20`,
      )
      .then((res) => {
        setCompletionRows(res.items);
        setCompletionTotalPages(res.pagination.totalPages);
      });
  }, [completionFor, completionPage]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold text-brand-900">{t('admin.devotionals.title')}</h2>
        <button className="btn-primary px-4 py-2" onClick={() => { setEditingId(null); setShowForm((v) => !v); }}>
          {t('admin.devotionals.new_devotional')}
        </button>
      </div>

      {error && !showForm && !editingId && <p className="mb-4 text-sm text-red-700">{error}</p>}

      {showForm && (
        <form onSubmit={create} className="card mb-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              placeholder={t('admin.devotionals.title_en_placeholder') ?? ''}
              value={form.titleEn}
              onChange={(e) => setForm((f) => ({ ...f, titleEn: e.target.value }))}
              required
            />
            <input
              className="input"
              placeholder={t('admin.devotionals.title_fr_placeholder') ?? ''}
              value={form.titleFr}
              onChange={(e) => setForm((f) => ({ ...f, titleFr: e.target.value }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <textarea
              className="input"
              rows={4}
              placeholder={t('admin.devotionals.content_en_placeholder') ?? ''}
              value={form.contentEn}
              onChange={(e) => setForm((f) => ({ ...f, contentEn: e.target.value }))}
              required
            />
            <textarea
              className="input"
              rows={4}
              placeholder={t('admin.devotionals.content_fr_placeholder') ?? ''}
              value={form.contentFr}
              onChange={(e) => setForm((f) => ({ ...f, contentFr: e.target.value }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">{t('admin.devotionals.start_date_label')}</label>
              <input
                className="input"
                type="date"
                value={form.startDate}
                onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="label">{t('admin.devotionals.end_date_label')}</label>
              <input
                className="input"
                type="date"
                value={form.endDate}
                onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                required
              />
            </div>
          </div>
          <div>
            <label className="label">{t('admin.devotionals.community_label')}</label>
            <p className="mb-2 text-sm text-slate-600">
              {communityId ? communityName : t('admin.devotionals.no_community_selected')}
            </p>
            <SearchPicker
              placeholder={t('admin.devotionals.search_community_placeholder') ?? ''}
              searchPath="/api/admin/communities?search="
              renderLabel={(c) => c.name}
              actionLabel={t('admin.devotionals.select')}
              searchButtonLabel={t('admin.people.search_button')}
              onPick={(c) => {
                setCommunityId(c.id);
                setCommunityName(c.name);
              }}
            />
            {communityId && (
              <button
                type="button"
                className="mt-2 text-sm text-brand-700 hover:underline"
                onClick={() => {
                  setCommunityId(null);
                  setCommunityName('');
                }}
              >
                {t('admin.devotionals.clear_community')}
              </button>
            )}
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary" type="submit">
            {t('admin.devotionals.create')}
          </button>
        </form>
      )}

      {editingId && (
        <form onSubmit={saveEdit} className="card mb-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              value={editForm.titleEn}
              onChange={(e) => setEditForm((f) => ({ ...f, titleEn: e.target.value }))}
              required
            />
            <input
              className="input"
              value={editForm.titleFr}
              onChange={(e) => setEditForm((f) => ({ ...f, titleFr: e.target.value }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              className="input"
              type="date"
              value={editForm.startDate}
              onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))}
            />
            <input
              className="input"
              type="date"
              value={editForm.endDate}
              onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))}
            />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-primary" type="submit">
              {t('admin.devotionals.save_changes')}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditingId(null)}>
              {t('admin.devotionals.cancel')}
            </button>
          </div>
        </form>
      )}

      {completionFor && (
        <div className="card mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-brand-900">
              {t('admin.devotionals.trainingProgress.completion_title', { title: completionFor.titleEn })}
            </h3>
            <button type="button" className="text-sm text-slate-500 hover:underline" onClick={() => setCompletionFor(null)}>
              {t('admin.devotionals.cancel')}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-slate-400">
                  <th className="py-2 pr-4">{t('admin.devotionals.trainingProgress.table_person')}</th>
                  <th className="py-2 pr-4">{t('admin.devotionals.trainingProgress.table_status')}</th>
                  <th className="py-2 pr-4">{t('admin.devotionals.trainingProgress.table_best_percentage')}</th>
                  <th className="py-2 pr-4">{t('admin.devotionals.trainingProgress.table_last_attempt')}</th>
                </tr>
              </thead>
              <tbody>
                {completionRows.map((r) => (
                  <tr key={r.personId} className="border-b border-slate-50">
                    <td className="py-2 pr-4">{r.name}</td>
                    <td className="py-2 pr-4">
                      {r.completed ? (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                          {t('admin.devotionals.trainingProgress.completed')}
                        </span>
                      ) : r.attempted ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                          {t('admin.devotionals.trainingProgress.attempted_not_passed')}
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                          {t('admin.devotionals.trainingProgress.not_attempted')}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">{r.bestPercentage !== null ? `${Math.round(r.bestPercentage)}%` : '—'}</td>
                    <td className="py-2 pr-4">{r.lastAttemptAt ? new Date(r.lastAttemptAt).toLocaleDateString() : '—'}</td>
                  </tr>
                ))}
                {completionRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-slate-400">
                      {t('admin.devotionals.trainingProgress.no_population')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {completionTotalPages > 1 && (
            <div className="flex items-center justify-center gap-3 text-sm">
              <button
                className="btn-secondary px-3 py-1.5"
                disabled={completionPage <= 1}
                onClick={() => setCompletionPage((p) => p - 1)}
              >
                {t('admin.prev')}
              </button>
              <span>{t('admin.page_of', { page: completionPage, total: completionTotalPages })}</span>
              <button
                className="btn-secondary px-3 py-1.5"
                disabled={completionPage >= completionTotalPages}
                onClick={() => setCompletionPage((p) => p + 1)}
              >
                {t('admin.next')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.devotionals.table_action')}</th>
              <th className="py-2 pr-4">{t('admin.devotionals.table_title')}</th>
              <th className="py-2 pr-4">{t('admin.devotionals.table_status')}</th>
              <th className="py-2 pr-4">{t('admin.devotionals.table_community')}</th>
              <th className="py-2 pr-4">{t('admin.devotionals.table_dates')}</th>
              <th className="py-2 pr-4">{t('admin.devotionals.table_assessments')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-slate-50">
                <td className="space-x-2 whitespace-nowrap py-2 pr-4">
                  <button className="text-brand-700 hover:underline" onClick={() => startEdit(item)}>
                    {t('admin.devotionals.edit')}
                  </button>
                  {item.status !== 'PUBLISHED' && (
                    <button className="text-brand-700 hover:underline" onClick={() => setStatus(item, 'PUBLISHED')}>
                      {t('admin.devotionals.publish')}
                    </button>
                  )}
                  {item.status !== 'ARCHIVED' && (
                    <button className="text-brand-700 hover:underline" onClick={() => setStatus(item, 'ARCHIVED')}>
                      {t('admin.devotionals.archive')}
                    </button>
                  )}
                  {item.status !== 'DRAFT' && (
                    <button className="text-brand-700 hover:underline" onClick={() => setStatus(item, 'DRAFT')}>
                      {t('admin.devotionals.revert_to_draft')}
                    </button>
                  )}
                  {item._count.assessments > 0 && (
                    <button className="text-brand-700 hover:underline" onClick={() => viewCompletion(item)}>
                      {t('admin.devotionals.trainingProgress.view_completion')}
                    </button>
                  )}
                </td>
                <td className="py-2 pr-4">{item.titleEn}</td>
                <td className="py-2 pr-4">{item.status}</td>
                <td className="py-2 pr-4">{item.community?.name ?? t('admin.devotionals.global')}</td>
                <td className="py-2 pr-4">
                  {toDateInput(item.startDate)} – {toDateInput(item.endDate)}
                </td>
                <td className="py-2 pr-4">{item._count.assessments}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-slate-400">
                  {t('admin.devotionals.no_devotionals')}
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
