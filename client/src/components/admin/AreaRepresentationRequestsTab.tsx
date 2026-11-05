import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

type Status = 'PENDING' | 'APPROVED' | 'DECLINED';
type Level = 'NATIONAL' | 'REGION' | 'DIVISION' | 'SUBDIVISION' | 'QUARTER';

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

/** The place a member typed in because theirs was not on the list, the biggest part last. */
const typedPlace = (r: RequestRow) => [r.typedQuarter, r.typedSubdivision, r.typedDivision, r.typedRegion, r.typedCountry].filter(Boolean).join(', ');

/** What the request is for: the level of the place asked for (a region, a division, a subdivision or a quarter). */
function requestedLevel(r: RequestRow): Level | null {
  if (r.area) return r.area.level as Level;
  if (r.typedQuarter) return 'QUARTER';
  if (r.typedSubdivision) return 'SUBDIVISION';
  if (r.typedDivision) return 'DIVISION';
  if (r.typedRegion) return 'REGION';
  return null;
}

const LEVEL_STYLE: Record<Level, string> = {
  NATIONAL: 'bg-slate-800 text-white',
  REGION: 'bg-violet-100 text-violet-800',
  DIVISION: 'bg-sky-100 text-sky-800',
  SUBDIVISION: 'bg-teal-100 text-teal-800',
  QUARTER: 'bg-amber-100 text-amber-800',
};

const STATUS_STYLE: Record<Status, string> = {
  PENDING: 'bg-amber-50 text-amber-800',
  APPROVED: 'bg-green-50 text-green-700',
  DECLINED: 'bg-red-50 text-red-700',
};

const TABS: ('' | Status)[] = ['PENDING', 'APPROVED', 'DECLINED', ''];

// Admin review of Member-submitted AreaRepresentationRequests. Approving one creates the
// AreaLeadershipAssignment directly (see AreaRepresentationRequest's schema comment); a place that is not
// on the list yet is added when the request is approved. A decision can be changed afterwards: a declined
// request can still be approved, and an approved one turned down again.
export function AreaRepresentationRequestsTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<RequestRow[]>([]);
  const [counts, setCounts] = useState<Partial<Record<Status, number>>>({});
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState<'' | Status>('PENDING');
  const [error, setError] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [reopened, setReopened] = useState<Record<string, boolean>>({});
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
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
    // How many are waiting / approved / declined, for the tabs.
    for (const s of ['PENDING', 'APPROVED', 'DECLINED'] as Status[]) {
      api
        .get<{ pagination?: { total?: number } }>(`/api/admin/area-representation-requests?page=1&pageSize=1&status=${s}`)
        .then((res) => setCounts((c) => ({ ...c, [s]: res.pagination?.total })))
        .catch(() => undefined);
    }
  }

  useEffect(load, [page, statusFilter]);

  async function decide(id: string, action: 'approve' | 'decline') {
    setDecidingId(id);
    setError(null);
    try {
      await api.patch(`/api/admin/area-representation-requests/${id}/${action}`, {
        decisionNote: decisionNotes[id]?.trim() || undefined,
        ...(action === 'approve' ? { title: positionTitles[id]?.trim() || undefined } : {}),
      });
      setReopened((r) => ({ ...r, [id]: false }));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('admin.areaRepresentationRequests.decision_failed'));
    } finally {
      setDecidingId(null);
    }
  }

  const tabLabel = (s: '' | Status) => (s === '' ? t('admin.areaRepresentationRequests.tab_all') : t(`admin.areaRepresentationRequests.tab_${s.toLowerCase()}`));

  return (
    <div>
      <h2 className="font-semibold text-brand-900">{t('admin.areaRepresentationRequests.title')}</h2>
      <p className="mb-4 mt-1 text-sm text-slate-500">{t('admin.areaRepresentationRequests.description')}</p>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" role="tablist" aria-label={t('admin.areaRepresentationRequests.title') ?? ''}>
        {TABS.map((s) => {
          const active = statusFilter === s;
          const n = s ? counts[s] : undefined;
          return (
            <button
              key={s || 'all'}
              type="button"
              role="tab"
              aria-selected={active}
              className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-semibold ${active ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600'}`}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
            >
              {tabLabel(s)}
              {typeof n === 'number' && <span className={`rounded-full px-1.5 text-xs ${s === 'PENDING' && n > 0 ? 'bg-amber-500 text-white' : 'bg-slate-200 text-slate-700'}`}>{n}</span>}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      <ul className="space-y-3">
        {items.map((r) => {
          const level = requestedLevel(r);
          const place = r.area ? r.area.name : typedPlace(r);
          const open = r.status === 'PENDING' || reopened[r.id];
          const busy = decidingId === r.id;
          return (
            <li key={r.id} className="card space-y-3" data-testid="area-request">
              <div className="flex items-start gap-3">
                <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-base font-bold text-brand-800">
                  {r.person.name.trim().charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900">{r.person.name}</p>
                  <p className="text-xs text-slate-500">{t('admin.areaRepresentationRequests.sent_on', { date: new Date(r.createdAt).toLocaleDateString() })}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}>{t(`admin.areaRepresentationRequests.status_${r.status.toLowerCase()}`)}</span>
              </div>

              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t('admin.areaRepresentationRequests.wants_to_represent')}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {level && <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${LEVEL_STYLE[level]}`}>{t(`admin.areaRepresentationRequests.level_${level.toLowerCase()}`)}</span>}
                  <span className="font-semibold text-slate-900">{place}</span>
                </div>
                {!r.area && r.status !== 'APPROVED' && <p className="mt-1 text-xs text-amber-700">{t('admin.areaRepresentationRequests.added_on_approval')}</p>}
              </div>

              {r.note && <p className="rounded-lg border-l-4 border-slate-200 bg-white px-3 py-1.5 text-sm italic text-slate-600">“{r.note}”</p>}

              {r.status !== 'PENDING' && (
                <p className="text-xs text-slate-500">
                  {t(r.status === 'APPROVED' ? 'admin.areaRepresentationRequests.decided_approved' : 'admin.areaRepresentationRequests.decided_declined', {
                    date: r.decidedAt ? new Date(r.decidedAt).toLocaleDateString() : '',
                  })}
                  {r.decisionNote ? ` — “${r.decisionNote}”` : ''}
                </p>
              )}

              {open ? (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  {r.status !== 'APPROVED' && (
                    <input
                      className="input text-sm"
                      maxLength={80}
                      aria-label={t('admin.areaRepresentationRequests.position_placeholder') ?? ''}
                      placeholder={t('admin.areaRepresentationRequests.position_placeholder') ?? ''}
                      value={positionTitles[r.id] ?? ''}
                      onChange={(e) => setPositionTitles((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    />
                  )}
                  <textarea
                    className="input text-sm"
                    rows={2}
                    aria-label={t('admin.areaRepresentationRequests.decision_note_placeholder') ?? ''}
                    placeholder={t('admin.areaRepresentationRequests.decision_note_placeholder') ?? ''}
                    value={decisionNotes[r.id] ?? ''}
                    onChange={(e) => setDecisionNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    {r.status !== 'APPROVED' && (
                      <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={busy} onClick={() => void decide(r.id, 'approve')}>
                        {r.status === 'DECLINED' ? t('admin.areaRepresentationRequests.approve_instead') : t('admin.areaRepresentationRequests.approve')}
                      </button>
                    )}
                    {r.status !== 'DECLINED' && (
                      <button type="button" className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50" disabled={busy} onClick={() => void decide(r.id, 'decline')}>
                        {r.status === 'APPROVED' ? t('admin.areaRepresentationRequests.turn_down') : t('admin.areaRepresentationRequests.decline')}
                      </button>
                    )}
                    {r.status !== 'PENDING' && (
                      <button type="button" className="text-sm text-slate-600 underline" onClick={() => setReopened((o) => ({ ...o, [r.id]: false }))}>
                        {t('chatActions.cancel')}
                      </button>
                    )}
                  </div>
                  {r.status === 'APPROVED' && <p className="text-xs text-slate-500">{t('admin.areaRepresentationRequests.turn_down_help')}</p>}
                </div>
              ) : (
                <div className="border-t border-slate-100 pt-3">
                  <button type="button" className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200" onClick={() => setReopened((o) => ({ ...o, [r.id]: true }))}>
                    {t('admin.areaRepresentationRequests.change_decision')}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {items.length === 0 && <p className="card py-6 text-center text-slate-400">{t('admin.areaRepresentationRequests.no_requests')}</p>}

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
  );
}
