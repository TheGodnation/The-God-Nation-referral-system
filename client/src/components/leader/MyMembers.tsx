import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';

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
}

// Phase 3H — a read-only roster of the People belonging to an exact scope
// the Leader currently holds an ACTIVE SCOPED_LEADER RoleAssignment for.
// Deliberately separate from MyFollowUp: this shows who is in scope, never
// who to act on — no follow-up buttons, no mutations, no deep links into
// the follow-up system. Gated on holding at least one active role of
// EITHER scope type (unlike TrainingProgress, which is Community-only,
// since training has no Geography concept) — a component-level
// convenience only; the server enforces the exact-scope check
// independently on every request.
export function MyMembers() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [rows, setRows] = useState<(CommunityRosterRow | GeographyRosterRow)[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, page]);

  if (loading || scopes.length === 0) return null;

  const dateLabel =
    selected?.scopeType === 'COMMUNITY' ? t('leader.myMembers.table_joined') : t('leader.myMembers.table_assigned');

  function rowDate(row: CommunityRosterRow | GeographyRosterRow): string {
    return 'membershipJoinedAt' in row ? row.membershipJoinedAt : row.geographicAssignedAt;
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
        <p className="mb-3 text-sm text-slate-500">
          {selected.scopeType === 'COMMUNITY' ? t('leader.myMembers.scope_community') : t('leader.myMembers.scope_geography')}
          {': '}
          {selected.scopeName}
        </p>
      )}

      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-slate-400">
              <th className="py-2 pr-4">{t('leader.myMembers.table_person')}</th>
              <th className="py-2 pr-4">{dateLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.personId} className="border-b border-slate-50">
                <td className="py-2 pr-4">{r.name}</td>
                <td className="py-2 pr-4">{new Date(rowDate(r)).toLocaleDateString()}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={2} className="py-4 text-center text-slate-400">
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
