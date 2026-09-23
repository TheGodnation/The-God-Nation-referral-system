import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

interface RoleAssignmentRow {
  id: string;
  roleType: 'SCOPED_LEADER';
  status: 'ACTIVE' | 'ENDED';
  assignedAt: string;
  endedAt: string | null;
  person: { id: string; name: string; whatsappNumber: string };
  community: { id: string; name: string } | null;
  geography: { id: string; name: string; type: string } | null;
  assignedBy: { id: string; name: string; email: string };
}

type ProposalStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

interface LeadershipProposalRow {
  id: string;
  status: ProposalStatus;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  proposedPerson: { id: string; name: string };
  proposedByPerson: { id: string; name: string };
  geography: { id: string; name: string; type: string };
  decidedByUser: { id: string; name: string; email: string } | null;
}

function proposalStatusBadgeClass(status: ProposalStatus) {
  switch (status) {
    case 'APPROVED':
      return 'bg-green-50 text-green-700';
    case 'REJECTED':
      return 'bg-red-50 text-red-700';
    case 'WITHDRAWN':
      return 'bg-slate-100 text-slate-500';
    default:
      return 'bg-amber-50 text-amber-700';
  }
}

// Phase 3D — Admin-only screen for granting/ending a Person's scoped
// leadership over an exact Community or Geography. This is a distinct
// concept from a "Leader" User account: RoleAssignment always targets a
// Person, never a User, and never implies any hierarchy over parent/child
// scopes — every grant is exact.
export function RoleAssignmentsTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<RoleAssignmentRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'' | 'ACTIVE' | 'ENDED'>('ACTIVE');

  const [showForm, setShowForm] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<{ id: string; name: string } | null>(null);
  const [scopeType, setScopeType] = useState<'COMMUNITY' | 'GEOGRAPHY'>('COMMUNITY');
  const [selectedScope, setSelectedScope] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [proposals, setProposals] = useState<LeadershipProposalRow[]>([]);
  const [proposalsPage, setProposalsPage] = useState(1);
  const [proposalsTotalPages, setProposalsTotalPages] = useState(1);
  const [proposalsStatusFilter, setProposalsStatusFilter] = useState<'' | ProposalStatus>('PROPOSED');
  const [proposalsError, setProposalsError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});

  function loadProposals() {
    const q = proposalsStatusFilter ? `&status=${proposalsStatusFilter}` : '';
    api
      .get<{ items: LeadershipProposalRow[]; pagination: { totalPages: number } }>(
        `/api/admin/leadership-proposals?page=${proposalsPage}&pageSize=20${q}`,
      )
      .then((res) => {
        setProposals(res.items);
        setProposalsTotalPages(res.pagination.totalPages);
      })
      .catch(() => setProposalsError(t('admin.leadershipProposals.load_failed')));
  }

  useEffect(loadProposals, [proposalsPage, proposalsStatusFilter]);

  // Phase 3L — records a decision only. This never creates, updates, or
  // ends a RoleAssignment; if Central Authority decides to actually appoint
  // this person, that remains the existing, separate "New Assignment" form
  // above, unchanged.
  async function decideProposal(id: string, action: 'approve' | 'reject') {
    setDecidingId(id);
    setProposalsError(null);
    try {
      await api.patch(`/api/admin/leadership-proposals/${id}/${action}`, {
        decisionNote: decisionNotes[id]?.trim() || undefined,
      });
      loadProposals();
    } catch (err) {
      setProposalsError(err instanceof ApiError ? err.message : t('admin.leadershipProposals.decision_failed'));
    } finally {
      setDecidingId(null);
    }
  }

  function load() {
    const q = statusFilter ? `&status=${statusFilter}` : '';
    api
      .get<{ items: RoleAssignmentRow[]; pagination: { totalPages: number } }>(
        `/api/admin/role-assignments?page=${page}&pageSize=20${q}`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      });
  }

  useEffect(load, [page, statusFilter]);

  function resetForm() {
    setSelectedPerson(null);
    setSelectedScope(null);
    setScopeType('COMMUNITY');
    setError(null);
  }

  async function createAssignment() {
    if (!selectedPerson || !selectedScope) return;
    setError(null);
    try {
      await api.post('/api/admin/role-assignments', {
        personId: selectedPerson.id,
        roleType: 'SCOPED_LEADER',
        ...(scopeType === 'COMMUNITY' ? { communityId: selectedScope.id } : { geographyId: selectedScope.id }),
      });
      resetForm();
      setShowForm(false);
      setPage(1);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.roleAssignments.create_failed'));
    }
  }

  async function endAssignment(id: string) {
    if (!window.confirm(t('admin.roleAssignments.end_confirm') ?? '')) return;
    try {
      await api.patch(`/api/admin/role-assignments/${id}/end`, {});
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.roleAssignments.end_failed'));
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-900">{t('admin.roleAssignments.title')}</h2>
        <button className="btn-primary px-4 py-2" onClick={() => setShowForm((v) => !v)}>
          {t('admin.roleAssignments.new_assignment')}
        </button>
      </div>

      <p className="mb-4 text-sm text-slate-500">{t('admin.roleAssignments.description')}</p>

      {showForm && (
        <div className="card mb-4 space-y-4">
          <div>
            <label className="label">{t('admin.roleAssignments.person_label')}</label>
            {selectedPerson ? (
              <p className="text-sm text-brand-900">
                {selectedPerson.name}{' '}
                <button className="ml-2 text-xs text-slate-500 hover:underline" onClick={() => setSelectedPerson(null)}>
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
                onPick={(p) => setSelectedPerson({ id: p.id, name: p.name })}
              />
            )}
          </div>

          <div>
            <label className="label">{t('admin.roleAssignments.scope_type_label')}</label>
            <select
              className="input"
              value={scopeType}
              onChange={(e) => {
                setScopeType(e.target.value as 'COMMUNITY' | 'GEOGRAPHY');
                setSelectedScope(null);
              }}
            >
              <option value="COMMUNITY">{t('admin.roleAssignments.scope_community')}</option>
              <option value="GEOGRAPHY">{t('admin.roleAssignments.scope_geography')}</option>
            </select>
          </div>

          <div>
            <label className="label">{t('admin.roleAssignments.scope_label')}</label>
            {selectedScope ? (
              <p className="text-sm text-brand-900">
                {selectedScope.name}{' '}
                <button className="ml-2 text-xs text-slate-500 hover:underline" onClick={() => setSelectedScope(null)}>
                  {t('admin.roleAssignments.change')}
                </button>
              </p>
            ) : scopeType === 'COMMUNITY' ? (
              <SearchPicker
                placeholder={t('admin.people.search_community_placeholder') ?? ''}
                searchPath="/api/admin/communities?search="
                renderLabel={(c) => c.name}
                actionLabel={t('admin.roleAssignments.select')}
                searchButtonLabel={t('admin.people.search_button')}
                onPick={(c) => setSelectedScope({ id: c.id, name: c.name })}
              />
            ) : (
              <SearchPicker
                placeholder={t('admin.people.search_geography_placeholder') ?? ''}
                searchPath="/api/admin/geography?search="
                renderLabel={(g) => `${g.name} (${g.type})`}
                actionLabel={t('admin.roleAssignments.select')}
                searchButtonLabel={t('admin.people.search_button')}
                onPick={(g) => setSelectedScope({ id: g.id, name: g.name })}
              />
            )}
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}
          <div className="flex gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={!selectedPerson || !selectedScope}
              onClick={createAssignment}
            >
              {t('admin.roleAssignments.create')}
            </button>
            <button
              type="button"
              className="text-sm text-slate-500 hover:underline"
              onClick={() => {
                resetForm();
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
            setStatusFilter(e.target.value as '' | 'ACTIVE' | 'ENDED');
            setPage(1);
          }}
        >
          <option value="">{t('admin.roleAssignments.filter_all')}</option>
          <option value="ACTIVE">{t('admin.roleAssignments.filter_active')}</option>
          <option value="ENDED">{t('admin.roleAssignments.filter_ended')}</option>
        </select>
      </div>

      {!showForm && error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.roleAssignments.table_action')}</th>
              <th className="py-2 pr-4">{t('admin.roleAssignments.table_person')}</th>
              <th className="py-2 pr-4">{t('admin.roleAssignments.table_scope')}</th>
              <th className="py-2 pr-4">{t('admin.roleAssignments.table_status')}</th>
              <th className="py-2 pr-4">{t('admin.roleAssignments.table_assigned_by')}</th>
              <th className="py-2 pr-4">{t('admin.roleAssignments.table_assigned_at')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-slate-50">
                <td className="py-2 pr-4">
                  {r.status === 'ACTIVE' && (
                    <button className="text-red-700 hover:underline" onClick={() => endAssignment(r.id)}>
                      {t('admin.roleAssignments.end')}
                    </button>
                  )}
                </td>
                <td className="py-2 pr-4">{r.person.name}</td>
                <td className="py-2 pr-4">
                  {r.community
                    ? `${t('admin.roleAssignments.scope_community')}: ${r.community.name}`
                    : r.geography
                      ? `${t('admin.roleAssignments.scope_geography')}: ${r.geography.name}`
                      : '—'}
                </td>
                <td className="py-2 pr-4">
                  {r.status === 'ACTIVE' ? (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      {t('admin.roleAssignments.filter_active')}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      {t('admin.roleAssignments.filter_ended')}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4">{r.assignedBy.name}</td>
                <td className="py-2 pr-4">{new Date(r.assignedAt).toLocaleDateString()}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-slate-400">
                  {t('admin.roleAssignments.no_assignments')}
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

      <div className="card mt-6">
        <h2 className="mb-2 font-semibold text-brand-900">{t('admin.leadershipProposals.title')}</h2>
        <p className="mb-4 text-sm text-slate-500">{t('admin.leadershipProposals.description')}</p>

        <div className="mb-4 flex items-center gap-2 text-sm">
          <label className="label mb-0">{t('admin.roleAssignments.filter_status')}</label>
          <select
            className="input w-auto"
            value={proposalsStatusFilter}
            onChange={(e) => {
              setProposalsStatusFilter(e.target.value as '' | ProposalStatus);
              setProposalsPage(1);
            }}
          >
            <option value="">{t('admin.roleAssignments.filter_all')}</option>
            <option value="PROPOSED">{t('admin.leadershipProposals.status_proposed')}</option>
            <option value="APPROVED">{t('admin.leadershipProposals.status_approved')}</option>
            <option value="REJECTED">{t('admin.leadershipProposals.status_rejected')}</option>
            <option value="WITHDRAWN">{t('admin.leadershipProposals.status_withdrawn')}</option>
          </select>
        </div>

        {proposalsError && <p className="mb-4 text-sm text-red-700">{proposalsError}</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="py-2 pr-4">{t('admin.leadershipProposals.table_candidate')}</th>
                <th className="py-2 pr-4">{t('admin.leadershipProposals.table_geography')}</th>
                <th className="py-2 pr-4">{t('admin.leadershipProposals.table_proposer')}</th>
                <th className="py-2 pr-4">{t('admin.leadershipProposals.table_date')}</th>
                <th className="py-2 pr-4">{t('admin.leadershipProposals.table_status')}</th>
                <th className="py-2 pr-4">{t('admin.leadershipProposals.table_note')}</th>
                <th className="py-2 pr-4">{t('admin.leadershipProposals.table_action')}</th>
              </tr>
            </thead>
            <tbody>
              {proposals.map((p) => (
                <tr key={p.id} className="border-b border-slate-50 align-top">
                  <td className="py-2 pr-4">{p.proposedPerson.name}</td>
                  <td className="py-2 pr-4">
                    {p.geography.name} ({p.geography.type})
                  </td>
                  <td className="py-2 pr-4">{p.proposedByPerson.name}</td>
                  <td className="py-2 pr-4">{new Date(p.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${proposalStatusBadgeClass(p.status)}`}>
                      {t(`admin.leadershipProposals.status_${p.status.toLowerCase()}`)}
                    </span>
                    {p.decidedByUser && p.decidedAt && (
                      <p className="mt-1 text-xs text-slate-400">
                        {t('admin.leadershipProposals.decided_by', {
                          name: p.decidedByUser.name,
                          date: new Date(p.decidedAt).toLocaleDateString(),
                        })}
                      </p>
                    )}
                  </td>
                  <td className="max-w-[200px] py-2 pr-4">
                    {p.note && <p className="text-xs text-slate-500">{p.note}</p>}
                    {p.decisionNote && <p className="mt-1 text-xs italic text-slate-400">{p.decisionNote}</p>}
                  </td>
                  <td className="py-2 pr-4">
                    {p.status === 'PROPOSED' ? (
                      <div className="space-y-2">
                        <textarea
                          className="input text-xs"
                          rows={1}
                          placeholder={t('admin.leadershipProposals.decision_note_placeholder') ?? ''}
                          value={decisionNotes[p.id] ?? ''}
                          onChange={(e) => setDecisionNotes((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="btn-primary px-2 py-1 text-xs"
                            disabled={decidingId === p.id}
                            onClick={() => decideProposal(p.id, 'approve')}
                          >
                            {t('admin.leadershipProposals.approve')}
                          </button>
                          <button
                            type="button"
                            className="text-xs text-red-700 hover:underline"
                            disabled={decidingId === p.id}
                            onClick={() => decideProposal(p.id, 'reject')}
                          >
                            {t('admin.leadershipProposals.reject')}
                          </button>
                        </div>
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
              {proposals.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-slate-400">
                    {t('admin.leadershipProposals.no_proposals')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {proposalsTotalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3 text-sm">
              <button
                className="btn-secondary px-3 py-1.5"
                disabled={proposalsPage <= 1}
                onClick={() => setProposalsPage((p) => p - 1)}
              >
                {t('admin.prev')}
              </button>
              <span>{t('admin.page_of', { page: proposalsPage, total: proposalsTotalPages })}</span>
              <button
                className="btn-secondary px-3 py-1.5"
                disabled={proposalsPage >= proposalsTotalPages}
                onClick={() => setProposalsPage((p) => p + 1)}
              >
                {t('admin.next')}
              </button>
            </div>
          )}
        </div>

        <p className="mt-4 text-xs text-slate-400">{t('admin.leadershipProposals.appointment_separate_note')}</p>
      </div>
    </div>
  );
}
