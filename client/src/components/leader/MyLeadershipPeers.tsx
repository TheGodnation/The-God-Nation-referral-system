import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

interface PeerRow {
  personId: string;
  name: string;
  communityId: string;
  communityName: string;
  generation: number;
}

// Phase 2A — a read-only directory of the Leader's own peers: other Leaders
// holding an ACTIVE Community-scoped RoleAssignment at the same
// Headquarters-relative organizational generation as one of the requesting
// Leader's own Community-scoped roles (see server/src/lib/leaderPeers.ts for
// the exact derivation). Discovery only — deliberately no message/contact
// action and no proposal/appointment action here; this component only ever
// reads GET /api/leader/peers.
//
// Unlike MyLeadershipProposals, this section stays visible (with an
// explicit empty-state row) even when the Leader currently has no peers,
// since an empty result is itself meaningful information here (e.g. "you
// are the only Leader at your generation right now") rather than simply
// "this feature doesn't apply to you yet".
export function MyLeadershipPeers() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<PeerRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api
      .get<{ items: PeerRow[]; pagination: { totalPages: number } }>(
        `/api/leader/peers?page=${page}&pageSize=20`,
      )
      .then((res) => {
        setItems(res.items);
        setTotalPages(res.pagination.totalPages);
        setLoading(false);
      })
      .catch(() => {
        setError(t('leader.leadershipPeers.load_failed'));
        setLoading(false);
      });
  }, [page]);

  if (loading) return null;

  return (
    <div className="card mt-6">
      <h2 className="mb-3 font-semibold text-brand-900">{t('leader.leadershipPeers.title')}</h2>
      <p className="mb-3 text-xs text-slate-400">{t('leader.leadershipPeers.intro')}</p>

      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}

      {!error && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="py-2 pr-4">{t('leader.leadershipPeers.table_name')}</th>
                <th className="py-2 pr-4">{t('leader.leadershipPeers.table_community')}</th>
                <th className="py-2 pr-4">{t('leader.leadershipPeers.table_generation')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={`${p.personId}:${p.communityId}`} className="border-b border-slate-50">
                  <td className="py-2 pr-4">{p.name}</td>
                  <td className="py-2 pr-4">{p.communityName}</td>
                  <td className="py-2 pr-4">{p.generation}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-slate-400">
                    {t('leader.leadershipPeers.no_peers')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3 text-sm">
          <button className="btn-secondary px-3 py-1.5" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {t('leader.prev')}
          </button>
          <span>{t('leader.page_of', { page, total: totalPages })}</span>
          <button
            className="btn-secondary px-3 py-1.5"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            {t('leader.next')}
          </button>
        </div>
      )}
    </div>
  );
}
