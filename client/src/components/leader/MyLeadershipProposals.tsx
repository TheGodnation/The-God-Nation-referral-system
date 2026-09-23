import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

type ProposalStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

interface ProposalRow {
  id: string;
  status: ProposalStatus;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  proposedPerson: { id: string; name: string };
  geography: { id: string; name: string; type: string };
}

function statusBadgeClass(status: ProposalStatus) {
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

// Phase 3L — a Leader's own geographical leadership proposals (never
// another Leader's — the server scopes GET /api/leader/leadership-proposals
// to req.leaderPersonId unconditionally). A proposal is a recommendation
// only; approval here never means the candidate has been formally
// appointed — that remains a fully separate Central Authority action via
// the existing Admin RoleAssignment flow. Silent-hide when the Leader has
// never made a proposal, matching the established MyFollowUp/MyMembers
// convention for an empty/inapplicable section.
export function MyLeadershipProposals() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ProposalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  function load() {
    api
      .get<{ items: ProposalRow[] }>('/api/leader/leadership-proposals')
      .then((res) => {
        setItems(res.items);
        setLoading(false);
      })
      .catch(() => {
        setError(t('leader.leadershipProposals.load_failed'));
        setLoading(false);
      });
  }

  useEffect(load, []);

  async function withdraw(id: string) {
    setWithdrawingId(id);
    setWithdrawError(null);
    try {
      await api.post(`/api/leader/leadership-proposals/${id}/withdraw`, {});
      load();
    } catch (err) {
      setWithdrawError(err instanceof ApiError ? err.message : t('leader.leadershipProposals.withdraw_failed'));
    } finally {
      setWithdrawingId(null);
    }
  }

  if (loading) return null;
  if (!error && items.length === 0) return null;

  return (
    <div className="card mt-6">
      <h2 className="mb-3 font-semibold text-brand-900">{t('leader.leadershipProposals.title')}</h2>
      <p className="mb-3 text-xs text-slate-400">{t('leader.leadershipProposals.recommendation_note')}</p>

      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      {withdrawError && <p className="mb-3 text-sm text-red-700">{withdrawError}</p>}

      {!error && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="py-2 pr-4">{t('leader.leadershipProposals.table_candidate')}</th>
                <th className="py-2 pr-4">{t('leader.leadershipProposals.table_geography')}</th>
                <th className="py-2 pr-4">{t('leader.leadershipProposals.table_status')}</th>
                <th className="py-2 pr-4">{t('leader.leadershipProposals.table_date')}</th>
                <th className="py-2 pr-4">{t('leader.leadershipProposals.table_action')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b border-slate-50">
                  <td className="py-2 pr-4">{p.proposedPerson.name}</td>
                  <td className="py-2 pr-4">{p.geography.name}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(p.status)}`}>
                      {t(`leader.leadershipProposals.status_${p.status.toLowerCase()}`)}
                    </span>
                    {p.decisionNote && <p className="mt-1 text-xs text-slate-400">{p.decisionNote}</p>}
                  </td>
                  <td className="py-2 pr-4">
                    {new Date(p.decidedAt ?? p.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-2 pr-4">
                    {p.status === 'PROPOSED' ? (
                      <button
                        type="button"
                        className="text-red-700 hover:underline disabled:text-slate-300"
                        disabled={withdrawingId === p.id}
                        onClick={() => withdraw(p.id)}
                      >
                        {t('leader.leadershipProposals.withdraw')}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
