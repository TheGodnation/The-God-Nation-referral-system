import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

type WellbeingStatus = 'GOOD' | 'NEEDS_ATTENTION' | 'EMERGENCY' | 'UNABLE_TO_REACH';

interface ContactRow {
  id: string;
  contactedAt: string;
  wellbeingStatus: WellbeingStatus;
  note: string | null;
  nextFollowUpDate: string | null;
  loggedBy?: { id: string; name: string };
}

interface FollowUpRow {
  id: string;
  status: 'ACTIVE' | 'CLOSED';
  contextType: 'COMMUNITY' | 'GEOGRAPHY';
  contextId: string;
  assignedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  follower: { id: string; name: string };
  followedPerson: { id: string; name: string };
  assignedBy: { id: string; name: string; email: string };
  closedBy: { id: string; name: string; email: string } | null;
  contacts: ContactRow[];
}

const WELLBEING_OPTIONS: WellbeingStatus[] = ['GOOD', 'NEEDS_ATTENTION', 'EMERGENCY', 'UNABLE_TO_REACH'];

function wellbeingBadgeClass(status: WellbeingStatus) {
  switch (status) {
    case 'GOOD':
      return 'bg-green-50 text-green-700';
    case 'NEEDS_ATTENTION':
      return 'bg-amber-50 text-amber-700';
    case 'EMERGENCY':
      return 'bg-red-50 text-red-700';
    default:
      return 'bg-slate-100 text-slate-500';
  }
}

// Phase 3D — Admin oversight of every FollowUpAssignment globally (a Leader
// only ever sees their own, in the Leader Dashboard's "My Follow-Up"
// section). Admin creation deliberately does not require the chosen
// follower to already hold a matching RoleAssignment — this is a full
// override path, unlike the Leader's own self-service creation.
export function FollowUpsTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<FollowUpRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'CLOSED'>('ACTIVE');
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [follower, setFollower] = useState<{ id: string; name: string } | null>(null);
  const [followedPerson, setFollowedPerson] = useState<{ id: string; name: string } | null>(null);
  const [contextType, setContextType] = useState<'COMMUNITY' | 'GEOGRAPHY'>('COMMUNITY');
  const [context, setContext] = useState<{ id: string; name: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [wellbeingStatus, setWellbeingStatus] = useState<WellbeingStatus>('GOOD');
  const [note, setNote] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');
  const [reassignTarget, setReassignTarget] = useState<{ id: string; name: string } | null>(null);

  function load() {
    const q = statusFilter ? `&status=${statusFilter}` : '';
    api
      .get<{ items: FollowUpRow[]; pagination: { totalPages: number } }>(
        `/api/admin/follow-ups?page=${page}&pageSize=20${q}`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }

  useEffect(load, [page, statusFilter]);

  function resetCreateForm() {
    setFollower(null);
    setFollowedPerson(null);
    setContextType('COMMUNITY');
    setContext(null);
    setCreateError(null);
  }

  async function createFollowUp() {
    if (!follower || !followedPerson || !context) return;
    setCreateError(null);
    try {
      await api.post('/api/admin/follow-ups', {
        followerId: follower.id,
        followedPersonId: followedPerson.id,
        contextType,
        contextId: context.id,
      });
      resetCreateForm();
      setShowForm(false);
      setPage(1);
      load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : t('admin.followUps.create_failed'));
    }
  }

  function openDetail(id: string) {
    setSelectedId(id);
    setDetailError(null);
    setReassignTarget(null);
    setNote('');
    setNextFollowUpDate('');
    setWellbeingStatus('GOOD');
    api.get<{ items: ContactRow[] }>(`/api/admin/follow-ups/${id}/contacts`).then((res) => setContacts(res.items));
  }

  function backToList() {
    setSelectedId(null);
    setContacts([]);
    load();
  }

  const selected = items.find((i) => i.id === selectedId) ?? null;

  async function logContact(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setDetailError(null);
    try {
      await api.post(`/api/admin/follow-ups/${selectedId}/contacts`, {
        wellbeingStatus,
        note: note.trim() || undefined,
        nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate).toISOString() : undefined,
      });
      setNote('');
      setNextFollowUpDate('');
      openDetail(selectedId);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t('admin.followUps.contact_failed'));
    }
  }

  async function closeFollowUp() {
    if (!selectedId) return;
    if (!window.confirm(t('admin.followUps.close_confirm') ?? '')) return;
    try {
      await api.post(`/api/admin/follow-ups/${selectedId}/close`, {});
      backToList();
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t('admin.followUps.close_failed'));
    }
  }

  async function reassign() {
    if (!selectedId || !reassignTarget) return;
    setDetailError(null);
    try {
      await api.post(`/api/admin/follow-ups/${selectedId}/reassign`, { newFollowerId: reassignTarget.id });
      backToList();
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t('admin.followUps.reassign_failed'));
    }
  }

  if (selectedId && selected) {
    return (
      <div>
        <button className="mb-4 text-sm text-brand-700 hover:underline" onClick={backToList}>
          {t('admin.followUps.back_to_list')}
        </button>

        <div className="card mb-4 space-y-2">
          <h2 className="font-semibold text-brand-900">{t('admin.followUps.detail_title')}</h2>
          <p className="text-sm text-slate-600">
            <strong>{t('admin.followUps.table_follower')}:</strong> {selected.follower.name}
          </p>
          <p className="text-sm text-slate-600">
            <strong>{t('admin.followUps.table_followed')}:</strong> {selected.followedPerson.name}
          </p>
          <p className="text-sm text-slate-600">
            <strong>{t('admin.followUps.table_status')}:</strong>{' '}
            {selected.status === 'ACTIVE' ? t('admin.roleAssignments.filter_active') : t('admin.followUps.status_closed')}
          </p>
        </div>

        {detailError && <p className="mb-4 text-sm text-red-700">{detailError}</p>}

        {selected.status === 'ACTIVE' && (
          <>
            <form onSubmit={logContact} className="card mb-4 space-y-3">
              <h3 className="font-semibold text-brand-900">{t('admin.followUps.log_contact_title')}</h3>
              <div>
                <label className="label">{t('admin.followUps.wellbeing_label')}</label>
                <select
                  className="input"
                  value={wellbeingStatus}
                  onChange={(e) => setWellbeingStatus(e.target.value as WellbeingStatus)}
                >
                  {WELLBEING_OPTIONS.map((w) => (
                    <option key={w} value={w}>
                      {t(`admin.followUps.wellbeing_${w.toLowerCase()}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('admin.followUps.note_label')}</label>
                <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div>
                <label className="label">{t('admin.followUps.next_followup_label')}</label>
                <input
                  className="input"
                  type="date"
                  value={nextFollowUpDate}
                  onChange={(e) => setNextFollowUpDate(e.target.value)}
                />
              </div>
              <button className="btn-primary" type="submit">
                {t('admin.followUps.log_contact_action')}
              </button>
            </form>

            <div className="card mb-4 space-y-3">
              <h3 className="font-semibold text-brand-900">{t('admin.followUps.reassign_title')}</h3>
              {reassignTarget ? (
                <p className="text-sm text-brand-900">
                  {reassignTarget.name}{' '}
                  <button className="ml-2 text-xs text-slate-500 hover:underline" onClick={() => setReassignTarget(null)}>
                    {t('admin.roleAssignments.change')}
                  </button>
                </p>
              ) : (
                <SearchPicker
                  placeholder={t('admin.roleAssignments.search_person_placeholder') ?? ''}
                  searchPath="/api/admin/people?search="
                  renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
                  actionLabel={t('admin.roleAssignments.select')}
                  searchButtonLabel={t('admin.people.search_button')}
                  onPick={(p) => setReassignTarget({ id: p.id, name: p.name })}
                />
              )}
              <button className="btn-primary" type="button" disabled={!reassignTarget} onClick={reassign}>
                {t('admin.followUps.reassign_action')}
              </button>
            </div>

            <div className="card mb-4">
              <button className="text-red-700 hover:underline" onClick={closeFollowUp}>
                {t('admin.followUps.close_action')}
              </button>
            </div>
          </>
        )}

        <div className="card overflow-x-auto">
          <h3 className="mb-3 font-semibold text-brand-900">{t('admin.followUps.history_title')}</h3>
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="py-2 pr-4">{t('admin.followUps.table_contacted_at')}</th>
                <th className="py-2 pr-4">{t('admin.followUps.wellbeing_label')}</th>
                <th className="py-2 pr-4">{t('admin.followUps.note_label')}</th>
                <th className="py-2 pr-4">{t('admin.followUps.table_logged_by')}</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-slate-50">
                  <td className="py-2 pr-4">{new Date(c.contactedAt).toLocaleString()}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${wellbeingBadgeClass(c.wellbeingStatus)}`}>
                      {t(`admin.followUps.wellbeing_${c.wellbeingStatus.toLowerCase()}`)}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{c.note ?? '—'}</td>
                  <td className="py-2 pr-4">{c.loggedBy?.name ?? '—'}</td>
                </tr>
              ))}
              {contacts.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-slate-400">
                    {t('admin.followUps.no_contacts')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-900">{t('admin.followUps.title')}</h2>
        <button className="btn-primary px-4 py-2" onClick={() => setShowForm((v) => !v)}>
          {t('admin.followUps.new_assignment')}
        </button>
      </div>

      <p className="mb-4 text-sm text-slate-500">{t('admin.followUps.description')}</p>

      {showForm && (
        <div className="card mb-4 space-y-4">
          <div>
            <label className="label">{t('admin.followUps.table_follower')}</label>
            {follower ? (
              <p className="text-sm text-brand-900">
                {follower.name}{' '}
                <button className="ml-2 text-xs text-slate-500 hover:underline" onClick={() => setFollower(null)}>
                  {t('admin.roleAssignments.change')}
                </button>
              </p>
            ) : (
              <SearchPicker
                placeholder={t('admin.roleAssignments.search_person_placeholder') ?? ''}
                searchPath="/api/admin/people?search="
                renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
                actionLabel={t('admin.roleAssignments.select')}
                searchButtonLabel={t('admin.people.search_button')}
                onPick={(p) => setFollower({ id: p.id, name: p.name })}
              />
            )}
          </div>

          <div>
            <label className="label">{t('admin.followUps.table_followed')}</label>
            {followedPerson ? (
              <p className="text-sm text-brand-900">
                {followedPerson.name}{' '}
                <button className="ml-2 text-xs text-slate-500 hover:underline" onClick={() => setFollowedPerson(null)}>
                  {t('admin.roleAssignments.change')}
                </button>
              </p>
            ) : (
              <SearchPicker
                placeholder={t('admin.roleAssignments.search_person_placeholder') ?? ''}
                searchPath="/api/admin/people?search="
                renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
                actionLabel={t('admin.roleAssignments.select')}
                searchButtonLabel={t('admin.people.search_button')}
                onPick={(p) => setFollowedPerson({ id: p.id, name: p.name })}
              />
            )}
          </div>

          <div>
            <label className="label">{t('admin.roleAssignments.scope_type_label')}</label>
            <select
              className="input"
              value={contextType}
              onChange={(e) => {
                setContextType(e.target.value as 'COMMUNITY' | 'GEOGRAPHY');
                setContext(null);
              }}
            >
              <option value="COMMUNITY">{t('admin.roleAssignments.scope_community')}</option>
              <option value="GEOGRAPHY">{t('admin.roleAssignments.scope_geography')}</option>
            </select>
          </div>

          <div>
            <label className="label">{t('admin.roleAssignments.scope_label')}</label>
            {context ? (
              <p className="text-sm text-brand-900">
                {context.name}{' '}
                <button className="ml-2 text-xs text-slate-500 hover:underline" onClick={() => setContext(null)}>
                  {t('admin.roleAssignments.change')}
                </button>
              </p>
            ) : contextType === 'COMMUNITY' ? (
              <SearchPicker
                placeholder={t('admin.people.search_community_placeholder') ?? ''}
                searchPath="/api/admin/communities?search="
                renderLabel={(c) => c.name}
                actionLabel={t('admin.roleAssignments.select')}
                searchButtonLabel={t('admin.people.search_button')}
                onPick={(c) => setContext({ id: c.id, name: c.name })}
              />
            ) : (
              <SearchPicker
                placeholder={t('admin.people.search_geography_placeholder') ?? ''}
                searchPath="/api/admin/geography?search="
                renderLabel={(g) => `${g.name} (${g.type})`}
                actionLabel={t('admin.roleAssignments.select')}
                searchButtonLabel={t('admin.people.search_button')}
                onPick={(g) => setContext({ id: g.id, name: g.name })}
              />
            )}
          </div>

          {createError && <p className="text-sm text-red-700">{createError}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={!follower || !followedPerson || !context}
              onClick={createFollowUp}
            >
              {t('admin.followUps.create')}
            </button>
            <button
              type="button"
              className="text-sm text-slate-500 hover:underline"
              onClick={() => {
                resetCreateForm();
                setShowForm(false);
              }}
            >
              {t('admin.leaders.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="mb-4 flex items-center gap-2 text-sm">
        <label className="label mb-0">{t('admin.roleAssignments.filter_status')}</label>
        <select
          className="input w-auto"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as '' | 'ACTIVE' | 'CLOSED');
            setPage(1);
          }}
        >
          <option value="">{t('admin.roleAssignments.filter_all')}</option>
          <option value="ACTIVE">{t('admin.roleAssignments.filter_active')}</option>
          <option value="CLOSED">{t('admin.followUps.status_closed')}</option>
        </select>
      </div>

      {!showForm && error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.followUps.table_action')}</th>
              <th className="py-2 pr-4">{t('admin.followUps.table_follower')}</th>
              <th className="py-2 pr-4">{t('admin.followUps.table_followed')}</th>
              <th className="py-2 pr-4">{t('admin.followUps.table_status')}</th>
              <th className="py-2 pr-4">{t('admin.followUps.table_latest_wellbeing')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((f) => (
              <tr key={f.id} className="border-b border-slate-50">
                <td className="py-2 pr-4">
                  <button className="text-brand-700 hover:underline" onClick={() => openDetail(f.id)}>
                    {t('admin.people.view')}
                  </button>
                </td>
                <td className="py-2 pr-4">{f.follower.name}</td>
                <td className="py-2 pr-4">{f.followedPerson.name}</td>
                <td className="py-2 pr-4">
                  {f.status === 'ACTIVE' ? (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      {t('admin.roleAssignments.filter_active')}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      {t('admin.followUps.status_closed')}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4">
                  {f.contacts[0] ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${wellbeingBadgeClass(f.contacts[0].wellbeingStatus)}`}>
                      {t(`admin.followUps.wellbeing_${f.contacts[0].wellbeingStatus.toLowerCase()}`)}
                    </span>
                  ) : (
                    <span className="text-slate-400">{t('admin.followUps.no_contacts')}</span>
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-center text-slate-400">
                  {t('admin.followUps.no_assignments')}
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
