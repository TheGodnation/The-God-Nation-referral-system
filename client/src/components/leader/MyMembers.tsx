import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface RoleAssignmentItem {
  id: string;
  community: { id: string; name: string } | null;
}

interface ScopeOption {
  scopeId: string;
  scopeName: string;
}

interface CommunityRosterRow {
  personId: string;
  name: string;
  membershipJoinedAt: string;
}

// Phase 3H — a read-only roster of the People belonging to a Community the
// Leader currently holds an ACTIVE SCOPED_LEADER RoleAssignment for. The
// server enforces authorization independently on every request.
//
// Phase 3J adds one action — "Start Follow-Up" — that posts directly to the
// existing POST /api/leader/follow-ups using this row's personId and the
// currently selected Community as contextType/contextId. No new
// authorization logic lives here: the server independently re-verifies the
// scoped role, the person's membership in the exact scope, and the
// no-duplicate-active constraint on every request, exactly as it already
// does for the create form in MyFollowUp.tsx. Still no reassign/close/bulk
// actions, and no roster-level display of any other Person's follow-up
// state.
//
// Phase 3M.8A adds Community Administrator membership management —
// "Add existing member" (by WhatsApp number, this Community's identity key;
// never a free-text search across all Persons) and "Remove". Both actions
// post to leaderCommunities.ts, which independently re-verifies the
// exact-scope Community Administrator role on every request — this
// component's own scope selector is a display convenience only.
//
// Geography Retirement Step 5B removed the Geography branch this component
// used to also offer entirely — GET /api/leader/roster is Community-scoped
// only now, and RoleAssignment can no longer be Geography-scoped at all.
export function MyMembers() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [rows, setRows] = useState<CommunityRosterRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const [startingPersonId, setStartingPersonId] = useState<string | null>(null);
  const [actionResults, setActionResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  const [addWhatsapp, setAddWhatsapp] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addResult, setAddResult] = useState<{ ok: boolean; text: string } | null>(null);

  const [removingPersonId, setRemovingPersonId] = useState<string | null>(null);
  const [removeResults, setRemoveResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  useEffect(() => {
    api
      .get<{ items: RoleAssignmentItem[] }>('/api/leader/role-assignments')
      .then((res) => {
        const options: ScopeOption[] = res.items
          .filter((r): r is RoleAssignmentItem & { community: { id: string; name: string } } => Boolean(r.community))
          .map((r) => ({ scopeId: r.community.id, scopeName: r.community.name }));
        setScopes(options);
        if (options.length > 0) setSelectedKey(options[0].scopeId);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const selected = scopes.find((s) => s.scopeId === selectedKey) ?? null;

  function loadRoster() {
    if (!selected) return;
    setError(null);
    api
      .get<{ items: CommunityRosterRow[]; pagination: { totalPages: number } }>(
        `/api/leader/roster?scopeType=COMMUNITY&scopeId=${selected.scopeId}&page=${page}&pageSize=20`,
      )
      .then((res) => {
        setRows(res.items);
        setTotalPages(res.pagination.totalPages);
      })
      .catch(() => setError(t('leader.myMembers.load_failed') ?? ''));
  }

  useEffect(loadRoster, [selectedKey, page]);

  if (loading || scopes.length === 0) return null;

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
        contextType: 'COMMUNITY',
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

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !addWhatsapp.trim() || addSubmitting) return;
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
    if (!selected || removingPersonId) return;
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
              <option key={s.scopeId} value={s.scopeId}>
                {s.scopeName}
              </option>
            ))}
          </select>
        )}
      </div>

      {selected && (
        <p className="mb-3 text-sm text-slate-500">
          {t('leader.myMembers.scope_community')}
          {': '}
          {selected.scopeName}
        </p>
      )}

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

      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('leader.myMembers.table_person')}</th>
              <th className="py-2 pr-4">{t('leader.myMembers.table_joined')}</th>
              <th className="py-2 pr-4">{t('leader.myMembers.table_action')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const result = actionResults[r.personId];
              const removeResult = removeResults[r.personId];
              return (
                <tr key={r.personId} className="border-b border-slate-50">
                  <td className="py-2 pr-4">{r.name}</td>
                  <td className="py-2 pr-4">{new Date(r.membershipJoinedAt).toLocaleDateString()}</td>
                  <td className="py-2 pr-4">
                    <div className="space-y-1">
                      {result?.ok ? (
                        <span className="block text-xs font-medium text-green-700">{result.text}</span>
                      ) : (
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
                      )}

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
