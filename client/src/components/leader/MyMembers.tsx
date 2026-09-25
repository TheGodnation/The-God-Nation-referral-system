import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface RoleAssignmentItem {
  id: string;
  community: { id: string; name: string } | null;
  geography: { id: string; name: string; type: string } | null;
}

type ScopeType = 'COMMUNITY' | 'GEOGRAPHY';

interface ScopeOption {
  scopeType: ScopeType;
  scopeId: string;
  scopeName: string;
}

interface CommunityRosterRow {
  personId: string;
  name: string;
  membershipJoinedAt: string;
}

interface GeographyRosterRow {
  personId: string;
  name: string;
  geographicAssignedAt: string;
  // Phase 3K only: the person's own assigned Geography id, present so this
  // component can tell an exact-scope row apart from a descendant-only row
  // without a second request (see the server-side comment in leader.ts).
  personGeographyId: string;
}

// Phase 3H — a read-only roster of the People belonging to a scope the
// Leader currently holds an ACTIVE SCOPED_LEADER RoleAssignment for. Gated
// on holding at least one active role of EITHER scope type (unlike
// TrainingProgress, which is Community-only, since training has no
// Geography concept) — a component-level convenience only; the server
// enforces authorization independently on every request.
//
// Phase 3J adds one action — "Start Follow-Up" — that posts directly to the
// existing POST /api/leader/follow-ups using this row's personId and the
// currently selected scope as contextType/contextId. No new authorization
// logic lives here: the server independently re-verifies the scoped role,
// the person's membership in the exact scope, and the no-duplicate-active
// constraint on every request, exactly as it already does for the create
// form in MyFollowUp.tsx. Still no reassign/close/bulk actions, and no
// roster-level display of any other Person's follow-up state.
//
// Phase 3K makes the Geography branch descendant-aware server-side (a
// Region Leader's roster now also includes people in that Region's
// Divisions/Sub-Divisions/Villages) while Community stays exact-scope only.
// Follow-Up creation itself is NOT widened to match — it still requires the
// person's own GeographicAssignment to exactly equal the submitted
// contextId — so this component only offers "Start Follow-Up" on rows
// where personGeographyId === the selected scope's own id; a descendant-only
// row shows an explanatory label instead of a button that would just fail.
//
// Phase 3L adds "Propose for Leadership" for Geography rows — a
// recommendation only, never an appointment. Unlike Follow-Up, the
// server's own authorization rule (isGeographyInLeaderScope + the
// candidate's real GeographicAssignment falling within the *selected*
// scope's subtree) is satisfied by every row already visible in a Geography
// roster for that scope, exact or descendant alike, so the action is
// offered unconditionally here — the server independently re-verifies both
// directions on every request regardless of what this component assumes.
//
// Phase 3M.8A adds Community Administrator membership management —
// "Add existing member" (by WhatsApp number, this Community's identity key;
// never a free-text search across all Persons) and "Remove" for Community
// rows only, since Geography membership isn't something a Leader manages
// here at all (GeographicAssignment is set by Admin, see adminPeople.ts).
// Both actions post to leaderCommunities.ts, which independently re-verifies
// the exact-scope Community Administrator role on every request — this
// component's own scope selector is a display convenience only.
export function MyMembers() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [rows, setRows] = useState<(CommunityRosterRow | GeographyRosterRow)[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [startingPersonId, setStartingPersonId] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const [proposingPersonId, setProposingPersonId] = useState<string | null>(null);
  const [proposalNote, setProposalNote] = useState('');
  const [proposalSubmitting, setProposalSubmitting] = useState(false);
  const [proposalResults, setProposalResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const [addWhatsapp, setAddWhatsapp] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addResult, setAddResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [removingPersonId, setRemovingPersonId] = useState<string | null>(null);
  const [removeResults, setRemoveResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  useEffect(() => {
    api
      .get<{ items: RoleAssignmentItem[] }>('/api/leader/role-assignments')
      .then((res) => {
        const options: ScopeOption[] = res.items.map((r) =>
          r.community
            ? { scopeType: 'COMMUNITY' as const, scopeId: r.community.id, scopeName: r.community.name }
            : { scopeType: 'GEOGRAPHY' as const, scopeId: r.geography!.id, scopeName: r.geography!.name },
        );
        setScopes(options);
        if (options.length > 0) setSelectedKey(`${options[0].scopeType}:${options[0].scopeId}`);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const selected = scopes.find((s) => `${s.scopeType}:${s.scopeId}` === selectedKey) ?? null;

  function loadRoster() {
    if (!selected) return;
    setError(null);
    api
      .get<{ items: (CommunityRosterRow | GeographyRosterRow)[]; pagination: { totalPages: number } }>(
        `/api/leader/roster?scopeType=${selected.scopeType}&scopeId=${selected.scopeId}&page=${page}&pageSize=20`,
      )
      .then((res) => {
        setRows(res.items);
        setTotalPages(res.pagination.totalPages);
      })
      .catch(() => setError(t('leader.myMembers.load_failed') ?? ''));
  }

  useEffect(loadRoster, [selectedKey, page]);

  if (loading || scopes.length === 0) return null;

  const dateLabel =
    selected?.scopeType === 'COMMUNITY' ? t('leader.myMembers.table_joined') : t('leader.myMembers.table_assigned');

  function rowDate(row: CommunityRosterRow | GeographyRosterRow): string {
    return 'membershipJoinedAt' in row ? row.membershipJoinedAt : row.geographicAssignedAt;
  }

  // Community rows are always exact-scope (Phase 3H never made Community
  // descendant-aware), so this is only ever meaningful for Geography rows.
  function isExactScopeRow(row: CommunityRosterRow | GeographyRosterRow): boolean {
    if (!selected) return false;
    if (!('personGeographyId' in row)) return true;
    return row.personGeographyId === selected.scopeId;
  }

  async function startFollowUp(personId: string) {
    if (!selected) return;
    setStartingPersonId(personId);
    setActionResults((prev) => {
      const next = { ...prev };
      delete next[personId];
      return next;
    });
    try {
      await api.post('/api/leader/follow-ups', {
        followedPersonId: personId,
        contextType: selected.scopeType,
        contextId: selected.scopeId,
      });
      setActionResults((prev) => ({ ...prev, [personId]: { ok: true, text: t('leader.myMembers.start_followup_success') ?? '' } }));
    } catch (err) {
      const text = err instanceof ApiError ? err.message : t('leader.myMembers.start_followup_failed') ?? '';
      setActionResults((prev) => ({ ...prev, [personId]: { ok: false, text } }));
    } finally {
      setStartingPersonId(null);
    }
  }

  function openProposeForm(personId: string) {
    setProposingPersonId(personId);
    setProposalNote('');
  }

  function cancelProposeForm() {
    setProposingPersonId(null);
    setProposalNote('');
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || selected.scopeType !== 'COMMUNITY' || !addWhatsapp.trim() || addSubmitting) return;
    setAddSubmitting(true);
    setAddResult(null);
    try {
      await api.post(`/api/leader/communities/${selected.scopeId}/members`, { whatsappNumber: addWhatsapp.trim() });
      setAddWhatsapp('');
      setAddResult({ ok: true, text: t('leader.myMembers.add_member_success') ?? '' });
      setPage(1);
      loadRoster();
    } catch (err) {
      const text = err instanceof ApiError ? err.message : t('leader.myMembers.add_member_failed') ?? '';
      setAddResult({ ok: false, text });
    } finally {
      setAddSubmitting(false);
    }
  }

  async function removeMember(personId: string) {
    if (!selected || selected.scopeType !== 'COMMUNITY' || removingPersonId) return;
    if (!window.confirm(t('leader.myMembers.remove_confirm') ?? '')) return;
    setRemovingPersonId(personId);
    try {
      await api.patch(`/api/leader/communities/${selected.scopeId}/members/${personId}`, { status: 'INACTIVE' });
      loadRoster();
    } catch (err) {
      const text = err instanceof ApiError ? err.message : t('leader.myMembers.remove_failed') ?? '';
      setRemoveResults((prev) => ({ ...prev, [personId]: { ok: false, text } }));
    } finally {
      setRemovingPersonId(null);
    }
  }

  async function submitProposal(personId: string) {
    if (!selected) return;
    setProposalSubmitting(true);
    setProposalResults((prev) => {
      const next = { ...prev };
      delete next[personId];
      return next;
    });
    try {
      await api.post('/api/leader/leadership-proposals', {
        proposedPersonId: personId,
        geographyId: selected.scopeId,
        note: proposalNote.trim() || undefined,
      });
      setProposingPersonId(null);
      setProposalNote('');
      setProposalResults((prev) => ({ ...prev, [personId]: { ok: true, text: t('leader.myMembers.propose_success') ?? '' } }));
    } catch (err) {
      const text = err instanceof ApiError ? err.message : t('leader.myMembers.propose_failed') ?? '';
      setProposalResults((prev) => ({ ...prev, [personId]: { ok: false, text } }));
    } finally {
      setProposalSubmitting(false);
    }
  }

  return (
    <div className="card mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-900">{t('leader.myMembers.title')}</h2>
        {scopes.length > 1 && (
          <select
            className="input w-auto"
            value={selectedKey}
            onChange={(e) => {
              setSelectedKey(e.target.value);
              setPage(1);
            }}
          >
            {scopes.map((s) => (
              <option key={`${s.scopeType}:${s.scopeId}`} value={`${s.scopeType}:${s.scopeId}`}>
                {s.scopeName} ({s.scopeType === 'COMMUNITY' ? t('leader.myMembers.scope_community') : t('leader.myMembers.scope_geography')})
              </option>
            ))}
          </select>
        )}
      </div>

      {selected && (
        <p className="mb-1 text-sm text-slate-500">
          {selected.scopeType === 'COMMUNITY' ? t('leader.myMembers.scope_community') : t('leader.myMembers.scope_geography')}
          {': '}
          {selected.scopeName}
        </p>
      )}
      {selected?.scopeType === 'GEOGRAPHY' && (
        <p className="mb-3 text-xs text-slate-400">{t('leader.myMembers.geography_descendant_note')}</p>
      )}

      {selected?.scopeType === 'COMMUNITY' && (
        <form onSubmit={addMember} className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            className="input flex-1"
            placeholder={t('leader.myMembers.add_member_placeholder') ?? ''}
            value={addWhatsapp}
            onChange={(e) => setAddWhatsapp(e.target.value)}
            disabled={addSubmitting}
          />
          <button type="submit" className="btn-secondary sm:w-40" disabled={addSubmitting || !addWhatsapp.trim()}>
            {addSubmitting ? t('leader.myMembers.add_member_submitting') : t('leader.myMembers.add_member_submit')}
          </button>
          {addResult && (
            <span className={`text-xs ${addResult.ok ? 'text-green-700' : 'text-red-700'}`}>{addResult.text}</span>
          )}
        </form>
      )}

      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('leader.myMembers.table_person')}</th>
              <th className="py-2 pr-4">{dateLabel}</th>
              <th className="py-2 pr-4">{t('leader.myMembers.table_action')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const result = actionResults[r.personId];
              const proposalResult = proposalResults[r.personId];
              const removeResult = removeResults[r.personId];
              return (
                <tr key={r.personId} className="border-b border-slate-50">
                  <td className="py-2 pr-4">{r.name}</td>
                  <td className="py-2 pr-4">{new Date(rowDate(r)).toLocaleDateString()}</td>
                  <td className="py-2 pr-4">
                    <div className="space-y-1">
                      {result?.ok ? (
                        <span className="block text-xs font-medium text-green-700">{result.text}</span>
                      ) : isExactScopeRow(r) ? (
                        <div>
                          <button
                            className="text-brand-700 hover:underline disabled:text-slate-300"
                            type="button"
                            disabled={startingPersonId === r.personId}
                            onClick={() => startFollowUp(r.personId)}
                          >
                            {t('leader.myMembers.start_followup')}
                          </button>
                          {result && !result.ok && <p className="text-xs text-red-700">{result.text}</p>}
                        </div>
                      ) : (
                        <span className="block text-xs text-slate-400">{t('leader.myMembers.outside_direct_scope')}</span>
                      )}

                      {selected?.scopeType === 'GEOGRAPHY' &&
                        (proposalResult?.ok ? (
                          <span className="block text-xs font-medium text-green-700">{proposalResult.text}</span>
                        ) : proposingPersonId === r.personId ? (
                          <div className="space-y-1 rounded border border-slate-100 p-2">
                            <textarea
                              className="input text-xs"
                              rows={2}
                              placeholder={t('leader.myMembers.propose_note_placeholder') ?? ''}
                              value={proposalNote}
                              onChange={(e) => setProposalNote(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="btn-primary px-2 py-1 text-xs"
                                disabled={proposalSubmitting}
                                onClick={() => submitProposal(r.personId)}
                              >
                                {t('leader.myMembers.propose_submit')}
                              </button>
                              <button type="button" className="text-xs text-slate-500 hover:underline" onClick={cancelProposeForm}>
                                {t('leader.followUp.cancel')}
                              </button>
                            </div>
                            {proposalResult && !proposalResult.ok && <p className="text-xs text-red-700">{proposalResult.text}</p>}
                          </div>
                        ) : (
                          <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => openProposeForm(r.personId)}>
                            {t('leader.myMembers.propose_action')}
                          </button>
                        ))}

                      {selected?.scopeType === 'COMMUNITY' && (
                        <div>
                          <button
                            type="button"
                            className="text-xs text-red-700 hover:underline disabled:text-slate-300"
                            disabled={removingPersonId === r.personId}
                            onClick={() => removeMember(r.personId)}
                          >
                            {t('leader.myMembers.remove_action')}
                          </button>
                          {removeResult && !removeResult.ok && <p className="text-xs text-red-700">{removeResult.text}</p>}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-slate-400">
                  {t('leader.myMembers.no_members')}
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
