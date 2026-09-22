import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

interface RoleAssignmentItem {
  id: string;
  community: { id: string; name: string } | null;
  geography: { id: string; name: string; type: string } | null;
}

interface ProgressRow {
  personId: string;
  name: string;
  totalEligible: number;
  completedCount: number;
  completed: boolean;
  bestPercentage: number | null;
  lastAttemptAt: string | null;
}

// Phase 3E — read-only training-progress visibility for a Leader's own
// Community. Gated entirely on holding an ACTIVE Community-scoped
// SCOPED_LEADER RoleAssignment (Phase 3D) — a Geography-only Leader sees no
// section at all here, exactly like MyFollowUp's own gating, but on a
// DIFFERENT condition (Community scope specifically, not any active role).
// The server enforces this exact-scope check independently on every
// request; this component's own gating is a convenience, never the source
// of authorization.
export function TrainingProgress() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [communityRoles, setCommunityRoles] = useState<RoleAssignmentItem[]>([]);
  const [selectedCommunityId, setSelectedCommunityId] = useState<string>('');
  const [rows, setRows] = useState<ProgressRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: RoleAssignmentItem[] }>('/api/leader/role-assignments')
      .then((res) => {
        const scoped = res.items.filter((r) => r.community);
        setCommunityRoles(scoped);
        if (scoped.length > 0) setSelectedCommunityId(scoped[0].community!.id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selectedCommunityId) return;
    setError(null);
    api
      .get<{ items: ProgressRow[]; pagination: { totalPages: number } }>(
        `/api/leader/community-progress?communityId=${selectedCommunityId}&page=${page}&pageSize=20`,
      )
      .then((res) => {
        setRows(res.items);
        setTotalPages(res.pagination.totalPages);
      })
      .catch(() => setError(t('leader.trainingProgress.load_failed') ?? ''));
  }, [selectedCommunityId, page]);

  if (loading || communityRoles.length === 0) return null;

  return (
    <div className="card mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-900">{t('leader.trainingProgress.title')}</h2>
        {communityRoles.length > 1 && (
          <select
            className="input w-auto"
            value={selectedCommunityId}
            onChange={(e) => {
              setSelectedCommunityId(e.target.value);
              setPage(1);
            }}
          >
            {communityRoles.map((r) => (
              <option key={r.community!.id} value={r.community!.id}>
                {r.community!.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('leader.trainingProgress.table_person')}</th>
              <th className="py-2 pr-4">{t('leader.trainingProgress.table_status')}</th>
              <th className="py-2 pr-4">{t('leader.trainingProgress.table_best_percentage')}</th>
              <th className="py-2 pr-4">{t('leader.trainingProgress.table_last_attempt')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.personId} className="border-b border-slate-50">
                <td className="py-2 pr-4">{r.name}</td>
                <td className="py-2 pr-4">
                  {r.completed ? (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                      {t('leader.trainingProgress.completed')}
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                      {t('leader.trainingProgress.not_completed', { completed: r.completedCount, total: r.totalEligible })}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-4">{r.bestPercentage !== null ? `${Math.round(r.bestPercentage)}%` : '—'}</td>
                <td className="py-2 pr-4">{r.lastAttemptAt ? new Date(r.lastAttemptAt).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-center text-slate-400">
                  {t('leader.trainingProgress.no_members')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('leader.prev')}
          </button>
          <span>{t('leader.page_of', { page, total: totalPages })}</span>
          <button className="btn-secondary px-3 py-1.5" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            {t('leader.next')}
          </button>
        </div>
      )}
    </div>
  );
}
