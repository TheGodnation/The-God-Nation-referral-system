import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { SearchPicker } from '../admin/SearchPicker';
import { FollowUpConversation } from '../FollowUpConversation';

type ContextType = 'COMMUNITY' | 'GEOGRAPHY';
type WellbeingStatus = 'GOOD' | 'NEEDS_ATTENTION' | 'EMERGENCY' | 'UNABLE_TO_REACH';

interface RoleAssignmentItem {
  id: string;
  community: { id: string; name: string } | null;
  geography: { id: string; name: string; type: string } | null;
}

interface ContactRow {
  id: string;
  contactedAt: string;
  wellbeingStatus: WellbeingStatus;
  note: string | null;
  nextFollowUpDate: string | null;
}

interface FollowUpRow {
  id: string;
  status: 'ACTIVE' | 'CLOSED';
  contextType: ContextType;
  contextId: string;
  followedPerson: { id: string; name: string };
  contacts: ContactRow[];
}

type AttentionReason = 'EMERGENCY' | 'NEEDS_ATTENTION' | 'UNABLE_TO_REACH' | 'OVERDUE' | 'NOT_YET_CONTACTED';

interface AttentionRow {
  followUpAssignmentId: string;
  personId: string;
  name: string;
  reason: AttentionReason;
  lastContactedAt: string | null;
  nextFollowUpDate: string | null;
}

function attentionBadgeClass(reason: AttentionReason) {
  switch (reason) {
    case 'EMERGENCY':
      return 'bg-red-50 text-red-700';
    case 'NEEDS_ATTENTION':
      return 'bg-amber-50 text-amber-700';
    case 'UNABLE_TO_REACH':
      return 'bg-slate-100 text-slate-500';
    case 'OVERDUE':
      return 'bg-orange-50 text-orange-700';
    default:
      return 'bg-slate-100 text-slate-500';
  }
}

const WELLBEING_OPTIONS: WellbeingStatus[] = ['GOOD', 'NEEDS_ATTENTION', 'EMERGENCY', 'UNABLE_TO_REACH'];

function wellbeingBadgeClass(status: WellbeingStatus) {
  switch (status) {
    case 'GOOD':
      return 'bg-green-50 text-green-700';
    case 'NEEDS_ATTENTION':
      return 'bg-amber-50 text-amber-700';
    case 'EMERGENCY':
      return 'bg-red-50 text-red-700';
    default:
      return 'bg-slate-100 text-slate-500';
  }
}

function scopeOf(role: RoleAssignmentItem): { contextType: ContextType; contextId: string; name: string } {
  return role.community
    ? { contextType: 'COMMUNITY', contextId: role.community.id, name: role.community.name }
    : { contextType: 'GEOGRAPHY', contextId: role.geography!.id, name: role.geography!.name };
}

// Phase 3D — a Leader's own "My Follow-Up" area. Gated entirely on having
// at least one ACTIVE SCOPED_LEADER RoleAssignment: a Leader whose User
// isn't linked to a Person, or who has no active role yet, sees a clear
// explanatory state instead (never a broken/empty list).
export function MyFollowUp() {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState(false);
  const [roles, setRoles] = useState<RoleAssignmentItem[]>([]);
  const [items, setItems] = useState<FollowUpRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createRoleId, setCreateRoleId] = useState<string>('');
  const [createPerson, setCreatePerson] = useState<{ id: string; name: string } | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [wellbeingStatus, setWellbeingStatus] = useState<WellbeingStatus>('GOOD');
  const [note, setNote] = useState('');
  const [nextFollowUpDate, setNextFollowUpDate] = useState('');
  const [reassignTarget, setReassignTarget] = useState<{ id: string; name: string } | null>(null);

  const [attentionItems, setAttentionItems] = useState<AttentionRow[]>([]);
  const [attentionLoading, setAttentionLoading] = useState(false);
  const [attentionError, setAttentionError] = useState<string | null>(null);

  const [attentionLogTargetId, setAttentionLogTargetId] = useState<string | null>(null);
  const [attentionWellbeing, setAttentionWellbeing] = useState<WellbeingStatus>('GOOD');
  const [attentionNote, setAttentionNote] = useState('');
  const [attentionNextFollowUpDate, setAttentionNextFollowUpDate] = useState('');
  const [attentionActionError, setAttentionActionError] = useState<string | null>(null);
  const [attentionActionSuccess, setAttentionActionSuccess] = useState<string | null>(null);

  function loadFollowUps() {
    api.get<{ items: FollowUpRow[] }>('/api/leader/follow-ups').then((res) => setItems(res.items));
  }

  function loadAttention() {
    setAttentionLoading(true);
    setAttentionError(null);
    api
      .get<{ items: AttentionRow[] }>('/api/leader/follow-ups/attention')
      .then((attRes) => {
        setAttentionItems(attRes.items);
        setAttentionLoading(false);
      })
      .catch(() => {
        setAttentionError(t('leader.followUp.attention_load_failed'));
        setAttentionLoading(false);
      });
  }

  useEffect(() => {
    api
      .get<{ items: RoleAssignmentItem[] }>('/api/leader/role-assignments')
      .then((res) => {
        setRoles(res.items);
        setLoading(false);
        if (res.items.length > 0) {
          loadFollowUps();
          loadAttention();
        }
      })
      .catch((err) => {
        setLoading(false);
        if (err instanceof ApiError && err.status === 403) {
          setNotLinked(true);
        } else {
          setError(t('leader.followUp.load_failed'));
        }
      });
  }, []);

  const roleScopeName = (row: FollowUpRow) => {
    const match = roles.find((r) => scopeOf(r).contextId === row.contextId && scopeOf(r).contextType === row.contextType);
    return match ? scopeOf(match).name : '—';
  };

  function resetCreateForm() {
    setCreateRoleId('');
    setCreatePerson(null);
    setCreateError(null);
  }

  async function createFollowUp() {
    const role = roles.find((r) => r.id === createRoleId);
    if (!role || !createPerson) return;
    const scope = scopeOf(role);
    setCreateError(null);
    try {
      await api.post('/api/leader/follow-ups', {
        followedPersonId: createPerson.id,
        contextType: scope.contextType,
        contextId: scope.contextId,
      });
      resetCreateForm();
      setShowCreate(false);
      loadFollowUps();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : t('leader.followUp.create_failed'));
    }
  }

  function openDetail(id: string) {
    setSelectedId(id);
    setDetailError(null);
    setReassignTarget(null);
    setNote('');
    setNextFollowUpDate('');
    setWellbeingStatus('GOOD');
    api.get<{ items: ContactRow[] }>(`/api/leader/follow-ups/${id}/contacts`).then((res) => setContacts(res.items));
  }

  function backToList() {
    setSelectedId(null);
    setContacts([]);
    loadFollowUps();
  }

  const selected = items.find((i) => i.id === selectedId) ?? null;

  async function logContact(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId) return;
    setDetailError(null);
    try {
      await api.post(`/api/leader/follow-ups/${selectedId}/contacts`, {
        wellbeingStatus,
        note: note.trim() || undefined,
        nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate).toISOString() : undefined,
      });
      setNote('');
      setNextFollowUpDate('');
      openDetail(selectedId);
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t('leader.followUp.contact_failed'));
    }
  }

  function openAttentionLog(id: string) {
    setAttentionLogTargetId(id);
    setAttentionWellbeing('GOOD');
    setAttentionNote('');
    setAttentionNextFollowUpDate('');
    setAttentionActionError(null);
    setAttentionActionSuccess(null);
  }

  function cancelAttentionLog() {
    setAttentionLogTargetId(null);
    setAttentionActionError(null);
  }

  async function logContactFromAttention(e: React.FormEvent) {
    e.preventDefault();
    if (!attentionLogTargetId) return;
    setAttentionActionError(null);
    try {
      await api.post(`/api/leader/follow-ups/${attentionLogTargetId}/contacts`, {
        wellbeingStatus: attentionWellbeing,
        note: attentionNote.trim() || undefined,
        nextFollowUpDate: attentionNextFollowUpDate ? new Date(attentionNextFollowUpDate).toISOString() : undefined,
      });
      setAttentionLogTargetId(null);
      setAttentionActionSuccess(t('leader.followUp.attention_log_success'));
      setTimeout(() => setAttentionActionSuccess(null), 3000);
      // The backend remains the source of truth for attention classification —
      // re-fetch rather than guessing locally whether this item still qualifies.
      loadFollowUps();
      loadAttention();
    } catch (err) {
      setAttentionActionError(err instanceof ApiError ? err.message : t('leader.followUp.contact_failed'));
    }
  }

  async function closeFollowUp() {
    if (!selectedId) return;
    if (!window.confirm(t('leader.followUp.close_confirm') ?? '')) return;
    try {
      await api.post(`/api/leader/follow-ups/${selectedId}/close`, {});
      backToList();
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t('leader.followUp.close_failed'));
    }
  }

  async function reassign() {
    if (!selectedId || !reassignTarget) return;
    setDetailError(null);
    try {
      await api.post(`/api/leader/follow-ups/${selectedId}/reassign`, { newFollowerId: reassignTarget.id });
      backToList();
    } catch (err) {
      setDetailError(err instanceof ApiError ? err.message : t('leader.followUp.reassign_failed'));
    }
  }

  if (loading) return null;

  if (notLinked) {
    return (
      <div className="card mt-6">
        <h2 className="mb-2 font-semibold text-brand-900">{t('leader.followUp.title')}</h2>
        <p className="text-sm text-slate-500">{t('leader.followUp.not_linked')}</p>
      </div>
    );
  }

  if (roles.length === 0) {
    return (
      <div className="card mt-6">
        <h2 className="mb-2 font-semibold text-brand-900">{t('leader.followUp.title')}</h2>
        <p className="text-sm text-slate-500">{t('leader.followUp.no_active_role')}</p>
      </div>
    );
  }

  if (selectedId && selected) {
    const scope = selected.contextType;
    void scope;
    return (
      <div className="card mt-6">
        <button className="mb-4 text-sm text-brand-700 hover:underline" onClick={backToList}>
          {t('leader.followUp.back_to_list')}
        </button>

        <h2 className="mb-2 font-semibold text-brand-900">{selected.followedPerson.name}</h2>
        {detailError && <p className="mb-4 text-sm text-red-700">{detailError}</p>}

        <FollowUpConversation followUpAssignmentId={selected.id} />

        {selected.status === 'ACTIVE' && (
          <>
            <form onSubmit={logContact} className="mb-4 space-y-3 rounded-lg border border-slate-100 p-3">
              <h3 className="font-medium text-brand-900">{t('leader.followUp.log_contact_title')}</h3>
              <div>
                <label className="label">{t('leader.followUp.wellbeing_label')}</label>
                <select
                  className="input"
                  value={wellbeingStatus}
                  onChange={(e) => setWellbeingStatus(e.target.value as WellbeingStatus)}
                >
                  {WELLBEING_OPTIONS.map((w) => (
                    <option key={w} value={w}>
                      {t(`leader.followUp.wellbeing_${w.toLowerCase()}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('leader.followUp.note_label')}</label>
                <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div>
                <label className="label">{t('leader.followUp.next_followup_label')}</label>
                <input
                  className="input"
                  type="date"
                  value={nextFollowUpDate}
                  onChange={(e) => setNextFollowUpDate(e.target.value)}
                />
              </div>
              <button className="btn-primary" type="submit">
                {t('leader.followUp.log_contact_action')}
              </button>
            </form>

            <div className="mb-4 space-y-3 rounded-lg border border-slate-100 p-3">
              <h3 className="font-medium text-brand-900">{t('leader.followUp.reassign_title')}</h3>
              {reassignTarget ? (
                <p className="text-sm text-brand-900">
                  {reassignTarget.name}{' '}
                  <button className="ml-2 text-xs text-slate-500 hover:underline" onClick={() => setReassignTarget(null)}>
                    {t('leader.followUp.change')}
                  </button>
                </p>
              ) : (
                <SearchPicker
                  placeholder={t('leader.followUp.search_person_placeholder') ?? ''}
                  searchPath={`/api/leader/scoped-people?contextType=${selected.contextType}&contextId=${selected.contextId}&search=`}
                  renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
                  actionLabel={t('leader.followUp.select')}
                  searchButtonLabel={t('leader.followUp.search_button')}
                  onPick={(p) => setReassignTarget({ id: p.id, name: p.name })}
                />
              )}
              <button className="btn-primary" type="button" disabled={!reassignTarget} onClick={reassign}>
                {t('leader.followUp.reassign_action')}
              </button>
            </div>

            <button className="text-red-700 hover:underline" onClick={closeFollowUp}>
              {t('leader.followUp.close_action')}
            </button>
          </>
        )}

        <h3 className="mb-2 mt-6 font-medium text-brand-900">{t('leader.followUp.history_title')}</h3>
        <ul className="space-y-2">
          {contacts.map((c) => (
            <li key={c.id} className="flex flex-col gap-1 border-b border-slate-50 pb-2 text-sm">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${wellbeingBadgeClass(c.wellbeingStatus)}`}>
                  {t(`leader.followUp.wellbeing_${c.wellbeingStatus.toLowerCase()}`)}
                </span>
                <span className="text-slate-400">{new Date(c.contactedAt).toLocaleString()}</span>
              </div>
              {c.note && <p className="text-slate-600">{c.note}</p>}
            </li>
          ))}
          {contacts.length === 0 && <p className="text-sm text-slate-400">{t('leader.followUp.no_contacts')}</p>}
        </ul>
      </div>
    );
  }

  return (
    <div className="card mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-semibold text-brand-900">{t('leader.followUp.title')}</h2>
        <button className="btn-primary px-4 py-2" onClick={() => setShowCreate((v) => !v)}>
          {t('leader.followUp.new_followup')}
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-700">{error}</p>}

      <div className="mb-4 rounded-lg border border-slate-100 p-3">
        <h3 className="mb-2 font-medium text-brand-900">{t('leader.followUp.attention_title')}</h3>
        {attentionLoading && <p className="text-sm text-slate-400">{t('leader.followUp.attention_loading')}</p>}
        {attentionError && <p className="text-sm text-red-700">{attentionError}</p>}
        {attentionActionSuccess && <p className="mb-2 text-sm text-green-700">{attentionActionSuccess}</p>}
        {!attentionLoading && !attentionError && (
          <ul className="space-y-2">
            {attentionItems.map((a) => (
              <li key={a.followUpAssignmentId} className="border-b border-slate-50 pb-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-brand-900">{a.name}</p>
                    <p className="text-slate-400">
                      {a.lastContactedAt
                        ? t('leader.followUp.attention_last_contact', { date: new Date(a.lastContactedAt).toLocaleDateString() })
                        : t('leader.followUp.attention_no_contact')}
                      {a.nextFollowUpDate &&
                        ` · ${t('leader.followUp.attention_next_followup', { date: new Date(a.nextFollowUpDate).toLocaleDateString() })}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${attentionBadgeClass(a.reason)}`}>
                      {t(`leader.followUp.attention_reason_${a.reason.toLowerCase()}`)}
                    </span>
                    {attentionLogTargetId !== a.followUpAssignmentId && (
                      <button
                        type="button"
                        className="text-xs text-brand-700 hover:underline"
                        onClick={() => openAttentionLog(a.followUpAssignmentId)}
                      >
                        {t('leader.followUp.attention_log_action')}
                      </button>
                    )}
                  </div>
                </div>

                {attentionLogTargetId === a.followUpAssignmentId && (
                  <form onSubmit={logContactFromAttention} className="mt-3 space-y-3 rounded-lg border border-slate-100 p-3">
                    <div>
                      <label className="label">{t('leader.followUp.wellbeing_label')}</label>
                      <select
                        className="input"
                        value={attentionWellbeing}
                        onChange={(e) => setAttentionWellbeing(e.target.value as WellbeingStatus)}
                      >
                        {WELLBEING_OPTIONS.map((w) => (
                          <option key={w} value={w}>
                            {t(`leader.followUp.wellbeing_${w.toLowerCase()}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="label">{t('leader.followUp.note_label')}</label>
                      <textarea
                        className="input"
                        rows={2}
                        value={attentionNote}
                        onChange={(e) => setAttentionNote(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="label">{t('leader.followUp.next_followup_label')}</label>
                      <input
                        className="input"
                        type="date"
                        value={attentionNextFollowUpDate}
                        onChange={(e) => setAttentionNextFollowUpDate(e.target.value)}
                      />
                    </div>
                    {attentionActionError && <p className="text-sm text-red-700">{attentionActionError}</p>}
                    <div className="flex gap-3">
                      <button className="btn-primary" type="submit">
                        {t('leader.followUp.log_contact_action')}
                      </button>
                      <button type="button" className="text-sm text-slate-500 hover:underline" onClick={cancelAttentionLog}>
                        {t('leader.followUp.cancel')}
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
            {attentionItems.length === 0 && (
              <p className="py-2 text-center text-sm text-slate-400">{t('leader.followUp.attention_empty')}</p>
            )}
          </ul>
        )}
      </div>

      {showCreate && (
        <div className="mb-4 space-y-3 rounded-lg border border-slate-100 p-3">
          <div>
            <label className="label">{t('leader.followUp.scope_label')}</label>
            <select
              className="input"
              value={createRoleId}
              onChange={(e) => {
                setCreateRoleId(e.target.value);
                setCreatePerson(null);
              }}
            >
              <option value="">—</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {scopeOf(r).name}
                </option>
              ))}
            </select>
          </div>

          {createRoleId && (
            <div>
              <label className="label">{t('leader.followUp.person_label')}</label>
              {createPerson ? (
                <p className="text-sm text-brand-900">
                  {createPerson.name}{' '}
                  <button className="ml-2 text-xs text-slate-500 hover:underline" onClick={() => setCreatePerson(null)}>
                    {t('leader.followUp.change')}
                  </button>
                </p>
              ) : (
                (() => {
                  const role = roles.find((r) => r.id === createRoleId)!;
                  const scope = scopeOf(role);
                  return (
                    <SearchPicker
                      placeholder={t('leader.followUp.search_person_placeholder') ?? ''}
                      searchPath={`/api/leader/scoped-people?contextType=${scope.contextType}&contextId=${scope.contextId}&search=`}
                      renderLabel={(p) => `${p.name} (${p.whatsappNumber})`}
                      actionLabel={t('leader.followUp.select')}
                      searchButtonLabel={t('leader.followUp.search_button')}
                      onPick={(p) => setCreatePerson({ id: p.id, name: p.name })}
                    />
                  );
                })()
              )}
            </div>
          )}

          {createError && <p className="text-sm text-red-700">{createError}</p>}
          <div className="flex gap-3">
            <button className="btn-primary" type="button" disabled={!createRoleId || !createPerson} onClick={createFollowUp}>
              {t('leader.followUp.create')}
            </button>
            <button
              type="button"
              className="text-sm text-slate-500 hover:underline"
              onClick={() => {
                resetCreateForm();
                setShowCreate(false);
              }}
            >
              {t('leader.followUp.cancel')}
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {items.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-sm">
            <div>
              <p className="font-medium text-brand-900">{f.followedPerson.name}</p>
              <p className="text-slate-400">{roleScopeName(f)}</p>
            </div>
            <div className="flex items-center gap-3">
              {f.contacts[0] ? (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${wellbeingBadgeClass(f.contacts[0].wellbeingStatus)}`}>
                  {t(`leader.followUp.wellbeing_${f.contacts[0].wellbeingStatus.toLowerCase()}`)}
                </span>
              ) : (
                <span className="text-slate-400">{t('leader.followUp.no_contacts')}</span>
              )}
              <button className="text-brand-700 hover:underline" onClick={() => openDetail(f.id)}>
                {t('leader.followUp.view')}
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && <p className="py-4 text-center text-sm text-slate-400">{t('leader.followUp.no_followups')}</p>}
      </ul>
    </div>
  );
}
