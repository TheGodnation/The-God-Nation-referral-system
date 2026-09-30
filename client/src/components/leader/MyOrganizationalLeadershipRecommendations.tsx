import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from '../admin/SearchPicker';

interface RoleAssignmentItem {
  id: string;
  community: { id: string; name: string } | null;
}

type RecommendationStatus = 'PROPOSED' | 'APPROVED' | 'REJECTED' | 'WITHDRAWN';

interface RecommendationRow {
  id: string;
  status: RecommendationStatus;
  note: string | null;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  generation: number | null;
  proposedPerson: { id: string; name: string };
  community: { id: string; name: string };
}

function statusBadgeClass(status: RecommendationStatus) {
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

// Phase 2C — a Leader's own organizational (Community-generation)
// leadership recommendations. Structurally a sibling of
// MyLeadershipProposals.tsx (Geography recommendations), never a shared
// component with it: the anchor here is an exact Community the Leader
// currently leads (never a Geography, never a descendant/sibling/parent
// Community), and candidate search reuses the existing
// GET /api/leader/scoped-people endpoint (already Community-scoped,
// already exact-match authorized server-side) via the existing SearchPicker
// control — never a new, broader Person-search surface. Submitting a
// recommendation is a request only: the server independently re-verifies
// the Leader's exact-match Community role on every request, this
// component's own Community selector is a display convenience never an
// authorization decision.
//
// Unlike MyLeadershipProposals.tsx (which silently hides when the Leader
// has never made a proposal), this section stays visible whenever the
// Leader leads at least one Community, so the creation form is always
// reachable — matching MyLeadershipPeers.tsx's own "stay visible, show an
// explicit empty state" convention.
export function MyOrganizationalLeadershipRecommendations() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [communities, setCommunities] = useState<{ id: string; name: string }[]>([]);
  const [selectedCommunityId, setSelectedCommunityId] = useState('');

  const [items, setItems] = useState<RecommendationRow[]>([]);
  const [listError, setListError] = useState<string | null>(null);

  const [candidate, setCandidate] = useState<{ id: string; name: string } | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  function loadRecommendations() {
    setListError(null);
    api
      .get<{ items: RecommendationRow[] }>('/api/leader/organizational-leadership-recommendations')
      .then((res) => setItems(res.items))
      .catch(() => setListError(t('leader.organizationalLeadershipRecommendations.load_failed')));
  }

  useEffect(() => {
    api
      .get<{ items: RoleAssignmentItem[] }>('/api/leader/role-assignments')
      .then((res) => {
        const led = res.items
          .filter((r): r is RoleAssignmentItem & { community: { id: string; name: string } } => Boolean(r.community))
          .map((r) => r.community);
        setCommunities(led);
        if (led.length > 0) setSelectedCommunityId(led[0].id);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    loadRecommendations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return null;

  async function submit() {
    if (!selectedCommunityId || !candidate || submitting) return;
    setSubmitting(true);
    setSubmitResult(null);
    try {
      await api.post('/api/leader/organizational-leadership-recommendations', {
        proposedPersonId: candidate.id,
        communityId: selectedCommunityId,
        note: note.trim() || undefined,
      });
      setCandidate(null);
      setNote('');
      setSubmitResult({ ok: true, text: t('leader.organizationalLeadershipRecommendations.submit_success') ?? '' });
      loadRecommendations();
    } catch (err) {
      const text = err instanceof ApiError ? err.message : t('leader.organizationalLeadershipRecommendations.submit_failed') ?? '';
      setSubmitResult({ ok: false, text });
    } finally {
      setSubmitting(false);
    }
  }

  async function withdraw(id: string) {
    setWithdrawingId(id);
    setWithdrawError(null);
    try {
      await api.post(`/api/leader/organizational-leadership-recommendations/${id}/withdraw`, {});
      loadRecommendations();
    } catch (err) {
      setWithdrawError(err instanceof ApiError ? err.message : t('leader.organizationalLeadershipRecommendations.withdraw_failed') ?? '');
    } finally {
      setWithdrawingId(null);
    }
  }

  return (
    <div className="card mt-6">
      <h2 className="mb-1 font-semibold text-brand-900">{t('leader.organizationalLeadershipRecommendations.title')}</h2>
      <p className="mb-3 text-xs text-slate-400">{t('leader.organizationalLeadershipRecommendations.intro')}</p>

      {communities.length === 0 ? (
        <p className="mb-3 text-sm text-slate-400">{t('leader.organizationalLeadershipRecommendations.no_eligible_communities')}</p>
      ) : (
        <div className="mb-4 space-y-2 rounded border border-slate-100 p-3">
          {communities.length > 1 && (
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-500">
                {t('leader.organizationalLeadershipRecommendations.community_label')}
              </label>
              <select
                className="input w-auto"
                value={selectedCommunityId}
                onChange={(e) => {
                  setSelectedCommunityId(e.target.value);
                  setCandidate(null);
                }}
              >
                {communities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">
              {t('leader.organizationalLeadershipRecommendations.proposed_person_label')}
            </label>
            {candidate ? (
              <p className="text-sm text-slate-700">
                {candidate.name}{' '}
                <button type="button" className="ml-2 text-xs text-red-700 hover:underline" onClick={() => setCandidate(null)}>
                  {t('leader.followUp.cancel')}
                </button>
              </p>
            ) : (
              <SearchPicker
                placeholder={t('leader.organizationalLeadershipRecommendations.person_search_placeholder') ?? ''}
                searchPath={`/api/leader/scoped-people?contextType=COMMUNITY&contextId=${selectedCommunityId}&search=`}
                renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
                actionLabel={t('leader.organizationalLeadershipRecommendations.select') ?? ''}
                searchButtonLabel={t('leader.organizationalLeadershipRecommendations.search_button') ?? ''}
                onPick={(p) => setCandidate({ id: p.id, name: p.name })}
              />
            )}
          </div>

          <textarea
            className="input text-sm"
            rows={2}
            placeholder={t('leader.organizationalLeadershipRecommendations.note_placeholder') ?? ''}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <button
            type="button"
            className="btn-primary"
            disabled={!candidate || submitting}
            onClick={submit}
          >
            {submitting
              ? t('leader.organizationalLeadershipRecommendations.submitting')
              : t('leader.organizationalLeadershipRecommendations.submit')}
          </button>
          {submitResult && (
            <p className={`text-sm ${submitResult.ok ? 'text-green-700' : 'text-red-700'}`}>{submitResult.text}</p>
          )}
        </div>
      )}

      {listError && <p className="mb-3 text-sm text-red-700">{listError}</p>}
      {withdrawError && <p className="mb-3 text-sm text-red-700">{withdrawError}</p>}

      {!listError && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-slate-400">
                <th className="py-2 pr-4">{t('leader.organizationalLeadershipRecommendations.table_candidate')}</th>
                <th className="py-2 pr-4">{t('leader.organizationalLeadershipRecommendations.table_community')}</th>
                <th className="py-2 pr-4">{t('leader.organizationalLeadershipRecommendations.table_generation')}</th>
                <th className="py-2 pr-4">{t('leader.organizationalLeadershipRecommendations.table_status')}</th>
                <th className="py-2 pr-4">{t('leader.organizationalLeadershipRecommendations.table_date')}</th>
                <th className="py-2 pr-4">{t('leader.organizationalLeadershipRecommendations.table_action')}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-b border-slate-50">
                  <td className="py-2 pr-4">{r.proposedPerson.name}</td>
                  <td className="py-2 pr-4">{r.community.name}</td>
                  <td className="py-2 pr-4">{r.generation ?? '—'}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(r.status)}`}>
                      {t(`leader.organizationalLeadershipRecommendations.status_${r.status.toLowerCase()}`)}
                    </span>
                  </td>
                  <td className="py-2 pr-4">{new Date(r.decidedAt ?? r.createdAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-4">
                    {r.status === 'PROPOSED' ? (
                      <button
                        type="button"
                        className="text-red-700 hover:underline disabled:text-slate-300"
                        disabled={withdrawingId === r.id}
                        onClick={() => withdraw(r.id)}
                      >
                        {t('leader.organizationalLeadershipRecommendations.withdraw')}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-slate-400">
                    {t('leader.organizationalLeadershipRecommendations.no_recommendations')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
