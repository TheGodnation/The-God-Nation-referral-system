import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from './SearchPicker';

type Status = 'PENDING' | 'APPROVED' | 'DECLINED';

interface RequestRow {
  id: string;
  note: string | null;
  status: Status;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  person: { id: string; name: string };
  area: { id: string; name: string; level: string } | null;
  typedCountry: string | null;
  typedRegion: string | null;
  typedDivision: string | null;
  typedSubdivision: string | null;
  typedQuarter: string | null;
}

/** The place a member typed in because theirs was not on the list. */
const typedPlace = (r: RequestRow) => [r.typedQuarter, r.typedSubdivision, r.typedDivision, r.typedRegion, r.typedCountry].filter(Boolean).join(', ');

function statusBadgeClass(status: Status) {
  switch (status) {
    case 'APPROVED':
      return 'bg-green-50 text-green-700';
    case 'DECLINED':
      return 'bg-red-50 text-red-700';
    default:
      return 'bg-amber-50 text-amber-700';
  }
}

// Admin review of Member-submitted AreaRepresentationRequests. Unlike
// RepresentationRequestsTab's own "decide, never appoint" requests,
// approving one of THESE creates the AreaLeadershipAssignment directly
// (see AreaRepresentationRequest's schema comment).
export function AreaRepresentationRequestsTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<RequestRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'' | Status>('PENDING');
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  // For a request whose place is not on the list: the place the admin chose (after adding it
  // under Geographic areas), and an optional position name, per request.
  const [chosenAreas, setChosenAreas] = useState<Record<string, { id: string; name: string }>>({});
  const [positionTitles, setPositionTitles] = useState<Record<string, string>>({});

  function load() {
    const q = statusFilter ? `&status=${statusFilter}` : '';
    api
      .get<{ items: RequestRow[]; pagination: { totalPages: number } }>(`/api/admin/area-representation-requests?page=${page}&pageSize=20${q}`)
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
      })
      .catch(() => setError(t('admin.areaRepresentationRequests.load_failed')));
  }

  useEffect(load, [page, statusFilter]);

  async function decide(id: string, action: 'approve' | 'decline') {
    setDecidingId(id);
    setError(null);
    try {
      await api.patch(`/api/admin/area-representation-requests/${id}/${action}`, {
        decisionNote: decisionNotes[id]?.trim() || undefined,
        ...(action === 'approve' ? { areaId: chosenAreas[id]?.id, title: positionTitles[id]?.trim() || undefined } : {}),
      });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.areaRepresentationRequests.decision_failed'));
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-900">{t('admin.areaRepresentationRequests.title')}</h2>
      </div>
      <p className="mb-4 text-sm text-slate-500">{t('admin.areaRepresentationRequests.description')}</p>

      <div className="mb-4 flex items-center gap-2 text-sm">
        <label className="label mb-0">{t('admin.roleAssignments.filter_status')}</label>
        <select
          className="input w-auto"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as '' | Status);
            setPage(1);
          }}
        >
          <option value="">{t('admin.roleAssignments.filter_all')}</option>
          <option value="PENDING">{t('admin.areaRepresentationRequests.status_pending')}</option>
          <option value="APPROVED">{t('admin.areaRepresentationRequests.status_approved')}</option>
          <option value="DECLINED">{t('admin.areaRepresentationRequests.status_declined')}</option>
        </select>
      </div>

      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('admin.areaRepresentationRequests.table_person')}</th>
              <th className="py-2 pr-4">{t('admin.areaRepresentationRequests.table_area')}</th>
              <th className="py-2 pr-4">{t('admin.areaRepresentationRequests.table_note')}</th>
              <th className="py-2 pr-4">{t('admin.areaRepresentationRequests.table_date')}</th>
              <th className="py-2 pr-4">{t('admin.areaRepresentationRequests.table_status')}</th>
              <th className="py-2 pr-4">{t('admin.areaRepresentationRequests.table_action')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id} className="border-b border-slate-50 align-top">
                <td className="py-2 pr-4">{r.person.name}</td>
                <td className="py-2 pr-4">
                  {r.area ? (
                    r.area.name
                  ) : (
                    <div>
                      <p className="font-medium text-slate-900">{typedPlace(r)}</p>
                      <p className="text-xs text-amber-700">{t('admin.areaRepresentationRequests.not_on_list')}</p>
                      {chosenAreas[r.id] && <p className="mt-1 text-xs text-green-700">✓ {chosenAreas[r.id].name}</p>}
                    </div>
                  )}
                </td>
                <td className="max-w-[200px] py-2 pr-4 text-xs text-slate-500">{r.note}</td>
                <td className="py-2 pr-4">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(r.status)}`}>
                    {t(`admin.areaRepresentationRequests.status_${r.status.toLowerCase()}`)}
                  </span>
                  {r.decisionNote && <p className="mt-1 text-xs italic text-slate-400">{r.decisionNote}</p>}
                </td>
                <td className="py-2 pr-4">
                  {r.status === 'PENDING' ? (
                    <div className="space-y-2">
                      <textarea
                        className="input text-xs"
                        rows={1}
                        placeholder={t('admin.areaRepresentationRequests.decision_note_placeholder') ?? ''}
                        value={decisionNotes[r.id] ?? ''}
                        onChange={(e) => setDecisionNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                      {!r.area && !chosenAreas[r.id] && (
                        <div className="space-y-1">
                          <p className="text-xs text-slate-500">{t('admin.areaRepresentationRequests.choose_area_help')}</p>
                          <SearchPicker
                            placeholder={t('admin.areaRepresentationRequests.search_area_placeholder') ?? ''}
                            searchPath="/api/admin/geographic-areas?search="
                            renderLabel={(a) => `${a.name}${a.parent ? `, ${a.parent.name}` : ''}`}
                            actionLabel={t('admin.roleAssignments.select')}
                            searchButtonLabel={t('admin.people.search_button')}
                            onPick={(a) => setChosenAreas((prev) => ({ ...prev, [r.id]: { id: a.id, name: `${a.name}${a.parent ? `, ${a.parent.name}` : ''}` } }))}
                          />
                        </div>
                      )}
                      <input
                        className="input text-xs"
                        maxLength={80}
                        placeholder={t('admin.areaRepresentationRequests.position_placeholder') ?? ''}
                        value={positionTitles[r.id] ?? ''}
                        onChange={(e) => setPositionTitles((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                      <div className="flex gap-2">
                        <button type="button" className="btn-primary px-2 py-1 text-xs" disabled={decidingId === r.id || (!r.area && !chosenAreas[r.id])} onClick={() => decide(r.id, 'approve')}>
                          {t('admin.areaRepresentationRequests.approve')}
                        </button>
                        <button type="button" className="text-xs text-red-700 hover:underline" disabled={decidingId === r.id} onClick={() => decide(r.id, 'decline')}>
                          {t('admin.areaRepresentationRequests.decline')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-slate-400">
                  {t('admin.areaRepresentationRequests.no_requests')}
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
            <button className="btn-secondary px-3 py-1.5" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              {t('admin.next')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
