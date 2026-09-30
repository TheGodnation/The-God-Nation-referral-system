import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

// Member Reassignment — the server's fixed set of machine-readable move
// error codes (see POST .../community-memberships/move in adminPeople.ts),
// mapped to their own localized copy. Reuses the same ApiError.code
// mechanism already established for exactly this purpose (see api.ts) —
// never a new localization system.
const MOVE_ERROR_KEY_BY_CODE: Record<string, string> = {
  SAME_COMMUNITY: 'admin.people.move_same_community',
  NOT_IN_SOURCE: 'admin.people.move_not_in_source',
  ALREADY_IN_TARGET: 'admin.people.move_already_in_target',
  COMMUNITY_UNAVAILABLE: 'admin.people.move_community_unavailable',
};

interface PersonRow {
  id: string;
  name: string;
  whatsappNumber: string;
  email: string | null;
  preferredLanguage: string;
  _count: { communityMemberships: number; registrations: number };
}

interface PersonDetail extends PersonRow {
  communityMemberships: {
    id: string;
    status: 'ACTIVE' | 'INACTIVE';
    joinedAt: string;
    community: { id: string; name: string };
  }[];
  registrations: { id: string; language: string; pathway: string; createdAt: string }[];
  users: { id: string; name: string; email: string; role: string }[];
}

const EMPTY_PERSON_FORM = { name: '', whatsappNumber: '', email: '', preferredLanguage: 'en' as 'en' | 'fr' };

// Phase 3E — read-only, derived from existing Attempt data.
interface TrainingProgressItem {
  devotionalId: string;
  titleEn: string;
  titleFr: string | null;
  attempted: boolean;
  completed: boolean;
  bestPercentage: number | null;
  lastAttemptAt: string | null;
}

interface TrainingProgressSummary {
  totalEligible: number;
  completedCount: number;
  items: TrainingProgressItem[];
}

// Book / Resource Access Grants — independent of Community membership,
// Geography, leadership, or any other domain (see server/src/lib/
// resourceAccess.ts). Fetched independently of the person detail, same as
// Training Progress above.
interface ResourceAccessGrantRow {
  id: string;
  status: 'ACTIVE' | 'REVOKED';
  grantedAt: string;
  revokedAt: string | null;
  resource: { id: string; titleEn: string; titleFr: string | null; active: boolean };
}

export function PeopleTab({ includeTestData }: { includeTestData: boolean }) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<PersonRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_PERSON_FORM);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PersonDetail | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_PERSON_FORM);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TrainingProgressSummary | null>(null);
  const [resourceAccess, setResourceAccess] = useState<ResourceAccessGrantRow[] | null>(null);
  const [resourceAccessError, setResourceAccessError] = useState<string | null>(null);

  // Member Reassignment — movingMembershipId identifies which membership
  // row's inline "Move" panel is open (never more than one at a time).
  const [movingMembershipId, setMovingMembershipId] = useState<string | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ id: string; name: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moveSuccess, setMoveSuccess] = useState<string | null>(null);

  function load() {
    const q = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : '';
    api
      .get<{ items: PersonRow[]; pagination: { totalPages: number } }>(
        `/api/admin/people?page=${page}&pageSize=20&includeTestData=${includeTestData}${q}`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }

  useEffect(load, [page, includeTestData]);

  function loadDetail(id: string) {
    api.get<PersonDetail>(`/api/admin/people/${id}`).then((p) => {
      setDetail(p);
      setEditForm({
        name: p.name,
        whatsappNumber: p.whatsappNumber,
        email: p.email ?? '',
        preferredLanguage: p.preferredLanguage as 'en' | 'fr',
      });
    });
  }

  function loadResourceAccess(id: string) {
    api
      .get<{ items: ResourceAccessGrantRow[] }>(`/api/admin/people/${id}/resource-access`)
      .then((res) => setResourceAccess(res.items))
      .catch(() => {});
  }

  function openPerson(id: string) {
    setSelectedId(id);
    setDetailError(null);
    setProgress(null);
    setResourceAccess(null);
    setResourceAccessError(null);
    setMovingMembershipId(null);
    setMoveTarget(null);
    setMoveError(null);
    setMoveSuccess(null);
    loadDetail(id);
    // Fetched independently of the person detail — a failure here must
    // never block editing the person's own record.
    api.get<TrainingProgressSummary>(`/api/admin/people/${id}/training-progress`).then(setProgress).catch(() => {});
    loadResourceAccess(id);
  }

  function backToList() {
    setSelectedId(null);
    setDetail(null);
    setProgress(null);
    setResourceAccess(null);
    load();
  }

  async function createPerson(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/api/admin/people', {
        name: form.name,
        whatsappNumber: form.whatsappNumber,
        email: form.email || undefined,
        preferredLanguage: form.preferredLanguage,
      });
      setForm(EMPTY_PERSON_FORM);
      setShowForm(false);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.people.create_failed'));
    }
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setDetailError(null);
    try {
      await api.patch(`/api/admin/people/${selectedId}`, {
        name: editForm.name,
        whatsappNumber: editForm.whatsappNumber,
        email: editForm.email || null,
        preferredLanguage: editForm.preferredLanguage,
      });
      loadDetail(selectedId);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t('admin.people.save_failed'));
    }
  }

  async function addMembership(community: any) {
    if (!selectedId) return;
    setDetailError(null);
    try {
      await api.post(`/api/admin/people/${selectedId}/community-memberships`, { communityId: community.id });
      loadDetail(selectedId);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t('admin.people.membership_failed'));
    }
  }

  async function toggleMembership(membershipId: string, currentStatus: string) {
    await api.patch(`/api/admin/community-memberships/${membershipId}`, {
      status: currentStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
    });
    if (selectedId) loadDetail(selectedId);
  }

  function startMove(membershipId: string) {
    setMovingMembershipId(membershipId);
    setMoveTarget(null);
    setMoveError(null);
    setMoveSuccess(null);
  }

  function cancelMove() {
    setMovingMembershipId(null);
    setMoveTarget(null);
    setMoveError(null);
  }

  function pickMoveTarget(currentCommunityId: string, community: any) {
    if (community.id === currentCommunityId) {
      setMoveTarget(null);
      setMoveError(t('admin.people.move_same_community'));
      return;
    }
    setMoveError(null);
    setMoveTarget({ id: community.id, name: community.name });
  }

  async function confirmMove(fromCommunityId: string) {
    if (!selectedId || !moveTarget || moving) return;
    setMoving(true);
    setMoveError(null);
    try {
      await api.post(`/api/admin/people/${selectedId}/community-memberships/move`, {
        fromCommunityId,
        toCommunityId: moveTarget.id,
      });
      setMovingMembershipId(null);
      setMoveTarget(null);
      setMoveSuccess(t('admin.people.move_success'));
      loadDetail(selectedId);
    } catch (err) {
      if (err instanceof ApiError) {
        const key = err.code && MOVE_ERROR_KEY_BY_CODE[err.code];
        setMoveError(key ? t(key) : err.message);
      } else {
        setMoveError(t('admin.people.move_failed'));
      }
    } finally {
      setMoving(false);
    }
  }

  async function grantResource(resource: any) {
    if (!selectedId) return;
    setResourceAccessError(null);
    try {
      await api.post(`/api/admin/people/${selectedId}/resource-access`, { resourceId: resource.id });
      loadResourceAccess(selectedId);
    } catch (err) {
      setResourceAccessError(err instanceof ApiError ? err.message : t('admin.people.resource_access_grant_failed'));
    }
  }

  async function revokeResourceAccess(grantId: string) {
    if (!selectedId) return;
    setResourceAccessError(null);
    try {
      await api.patch(`/api/admin/resource-access/${grantId}/revoke`);
      loadResourceAccess(selectedId);
    } catch (err) {
      setResourceAccessError(err instanceof ApiError ? err.message : t('admin.people.resource_access_revoke_failed'));
    }
  }

  if (selectedId && detail) {
    return (
      <div>
        <button className="mb-4 text-sm text-brand-700 hover:underline" onClick={backToList}>
          {t('admin.people.back_to_list')}
        </button>

        <form onSubmit={saveEdit} className="card mb-4 space-y-3">
          <h2 className="font-semibold text-brand-900">{t('admin.people.edit_person')}</h2>
          <div>
            <label className="label">{t('admin.people.name_label')}</label>
            <input
              className="input"
              value={editForm.name}
              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">{t('admin.people.whatsapp_label')}</label>
            <input
              className="input"
              value={editForm.whatsappNumber}
              onChange={(e) => setEditForm((f) => ({ ...f, whatsappNumber: e.target.value }))}
              required
            />
          </div>
          <div>
            <label className="label">{t('admin.people.email_label')}</label>
            <input
              className="input"
              type="email"
              value={editForm.email}
              onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">{t('admin.people.language_label')}</label>
            <select
              className="input"
              value={editForm.preferredLanguage}
              onChange={(e) => setEditForm((f) => ({ ...f, preferredLanguage: e.target.value as 'en' | 'fr' }))}
            >
              <option value="en">{t('common.language_en')}</option>
              <option value="fr">{t('common.language_fr')}</option>
            </select>
          </div>
          {detailError && <p className="text-sm text-red-700">{detailError}</p>}
          <button className="btn-primary" type="submit">
            {t('admin.people.save_changes')}
          </button>
        </form>

        <div className="card space-y-3">
          <h2 className="font-semibold text-brand-900">{t('admin.people.community_memberships')}</h2>
          {moveSuccess && <p className="text-sm text-green-700">{moveSuccess}</p>}
          {detail.communityMemberships.length === 0 ? (
            <p className="text-sm text-slate-400">{t('admin.people.no_memberships')}</p>
          ) : (
            <ul className="space-y-2">
              {detail.communityMemberships.map((m) => (
                <Fragment key={m.id}>
                  <li className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-sm">
                    <span>
                      {m.community.name} —{' '}
                      <span className={m.status === 'ACTIVE' ? 'text-green-700' : 'text-slate-400'}>
                        {m.status === 'ACTIVE' ? t('admin.people.status_active') : t('admin.people.status_inactive')}
                      </span>
                    </span>
                    <span className="flex gap-2">
                      <button className="text-brand-700 hover:underline" onClick={() => toggleMembership(m.id, m.status)}>
                        {m.status === 'ACTIVE' ? t('admin.people.deactivate') : t('admin.people.activate')}
                      </button>
                      {m.status === 'ACTIVE' && (
                        <button className="text-brand-700 hover:underline" onClick={() => startMove(m.id)}>
                          {t('admin.people.move')}
                        </button>
                      )}
                    </span>
                  </li>
                  {movingMembershipId === m.id && (
                    <li className="border-b border-slate-50 pb-3 text-sm">
                      <div className="rounded border border-slate-100 bg-slate-50 p-3 space-y-2">
                        <p className="text-xs text-slate-500">
                          {t('admin.people.move_current_community', { name: m.community.name })}
                        </p>
                        <p className="label">{t('admin.people.move_destination_label')}</p>
                        <SearchPicker
                          placeholder={t('admin.people.search_community_placeholder') ?? ''}
                          searchPath="/api/admin/communities?search="
                          renderLabel={(c) => c.name}
                          actionLabel={t('admin.people.move_select_destination')}
                          searchButtonLabel={t('admin.people.search_button')}
                          onPick={(c) => pickMoveTarget(m.community.id, c)}
                        />
                        {moveTarget && (
                          <div className="flex flex-wrap items-center gap-2">
                            <span>{t('admin.people.move_confirm_prompt', { name: moveTarget.name })}</span>
                            <button
                              type="button"
                              className="btn-primary px-3 py-1.5"
                              disabled={moving}
                              onClick={() => confirmMove(m.community.id)}
                            >
                              {moving ? t('admin.people.move_moving') : t('admin.people.move_confirm')}
                            </button>
                          </div>
                        )}
                        {moveError && <p className="text-sm text-red-700">{moveError}</p>}
                        <button type="button" className="text-xs text-slate-500 hover:underline" onClick={cancelMove}>
                          {t('admin.people.cancel')}
                        </button>
                      </div>
                    </li>
                  )}
                </Fragment>
              ))}
            </ul>
          )}
          <SearchPicker
            placeholder={t('admin.people.search_community_placeholder') ?? ''}
            searchPath="/api/admin/communities?search="
            renderLabel={(c) => c.name}
            actionLabel={t('admin.people.add')}
            searchButtonLabel={t('admin.people.search_button')}
            onPick={addMembership}
          />
        </div>

        {progress && (
          <div className="card mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-brand-900">{t('admin.people.trainingProgress.title')}</h2>
              {progress.totalEligible > 0 && (
                <span className="text-sm text-slate-500">
                  {t('admin.people.trainingProgress.summary', { completed: progress.completedCount, total: progress.totalEligible })}
                </span>
              )}
            </div>
            {progress.items.length === 0 ? (
              <p className="text-sm text-slate-400">{t('admin.people.trainingProgress.no_progress')}</p>
            ) : (
              <ul className="space-y-2">
                {progress.items.map((i) => (
                  <li key={i.devotionalId} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-50 pb-2 text-sm">
                    <span>{i.titleEn}</span>
                    <span className="flex items-center gap-2">
                      {i.completed ? (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                          {t('admin.people.trainingProgress.completed')}
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                          {t('admin.people.trainingProgress.not_yet')}
                        </span>
                      )}
                      {i.bestPercentage !== null && (
                        <span className="text-xs text-slate-400">{Math.round(i.bestPercentage)}%</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {resourceAccess && (
          <div className="card mt-4 space-y-3">
            <h2 className="font-semibold text-brand-900">{t('admin.people.resourceAccess.title')}</h2>
            {resourceAccessError && <p className="text-sm text-red-700">{resourceAccessError}</p>}
            {resourceAccess.length === 0 ? (
              <p className="text-sm text-slate-400">{t('admin.people.resourceAccess.no_grants')}</p>
            ) : (
              <ul className="space-y-2">
                {resourceAccess.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-sm">
                    <span>
                      {g.resource.titleEn} —{' '}
                      <span className={g.status === 'ACTIVE' ? 'text-green-700' : 'text-slate-400'}>
                        {g.status === 'ACTIVE' ? t('admin.people.resourceAccess.status_active') : t('admin.people.resourceAccess.status_revoked')}
                      </span>
                    </span>
                    {g.status === 'ACTIVE' && (
                      <button className="text-brand-700 hover:underline" onClick={() => revokeResourceAccess(g.id)}>
                        {t('admin.people.resourceAccess.revoke')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <SearchPicker
              placeholder={t('admin.people.resourceAccess.search_placeholder') ?? ''}
              searchPath="/api/admin/resources?search="
              renderLabel={(r) => r.titleEn}
              actionLabel={t('admin.people.resourceAccess.grant')}
              searchButtonLabel={t('admin.people.search_button')}
              onPick={grantResource}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-900">{t('admin.people.title')}</h2>
        <button className="btn-primary px-4 py-2" onClick={() => setShowForm((v) => !v)}>
          {t('admin.people.new_person')}
        </button>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          load();
        }}
        className="mb-4 flex gap-2"
      >
        <input
          className="input"
          placeholder={t('admin.people.search_placeholder') ?? ''}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="btn-secondary" type="submit">
          {t('admin.people.search_button')}
        </button>
      </form>

      {error && !showForm && <p className="mb-4 text-sm text-red-700">{error}</p>}

      {showForm && (
        <form onSubmit={createPerson} className="card mb-4 space-y-3">
          <input
            className="input"
            placeholder={t('admin.people.name_placeholder') ?? ''}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
          <input
            className="input"
            placeholder={t('admin.people.whatsapp_placeholder') ?? ''}
            value={form.whatsappNumber}
            onChange={(e) => setForm((f) => ({ ...f, whatsappNumber: e.target.value }))}
            required
          />
          <input
            className="input"
            type="email"
            placeholder={t('admin.people.email_placeholder') ?? ''}
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          {error && <p className="text-sm text-red-700">{error}</p>}
          <button className="btn-primary" type="submit">
            {t('admin.people.create')}
          </button>
        </form>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.people.table_action')}</th>
              <th className="py-2 pr-4">{t('admin.people.table_name')}</th>
              <th className="py-2 pr-4">{t('admin.people.table_whatsapp')}</th>
              <th className="py-2 pr-4">{t('admin.people.table_communities')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-b border-slate-50">
                <td className="py-2 pr-4">
                  <button className="text-brand-700 hover:underline" onClick={() => openPerson(p.id)}>
                    {t('admin.people.view')}
                  </button>
                </td>
                <td className="py-2 pr-4">{p.name}</td>
                <td className="py-2 pr-4">{p.whatsappNumber}</td>
                <td className="py-2 pr-4">{p._count.communityMemberships}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-slate-400">
                  {t('admin.people.no_people')}
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
