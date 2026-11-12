import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { DeleteChoice, type DeletionMode } from './DeleteChoice';

// Central admin: members who asked to delete their account. Each account
// is hidden for a month (signing in again brings it back); after the month
// only the admin deletes it for good — or keeps it. Leader roles the
// member held have already come back to the admin.

interface Row {
  id: string;
  name: string | null;
  email: string | null;
  whatsappNumber: string | null;
  source: 'APP' | 'WEB';
  requestedAt: string;
  readyAt: string;
  ready: boolean;
  returnedRoles: string[];
}

interface Closed {
  id: string;
  status: 'CANCELLED' | 'COMPLETED';
  requestedAt: string;
  cancelledBy: 'MEMBER' | 'ADMIN' | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

interface Kept {
  groupId: string;
  mode: 'APPROVAL' | 'NEVER';
  status: 'ACTIVE' | 'APPROVED' | 'LIFTED';
  personName: string | null;
  note: string | null;
  whatsappNumbers: string[];
  emails: string[];
  attempts: number;
  lastAttemptAt: string | null;
  decidedAt: string | null;
}

const day = (iso: string) => new Date(iso).toLocaleDateString();

export function AccountDeletionsTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Row[] | null>(null);
  const [closed, setClosed] = useState<Closed[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Which request the admin is deleting right now, and how (free / with approval / never).
  const [deleting, setDeleting] = useState<string | null>(null);
  const [mode, setMode] = useState<DeletionMode>('FREE');
  const [note, setNote] = useState('');
  const [kept, setKept] = useState<Kept[]>([]);

  function loadKept() {
    api
      .get<{ items: Kept[] }>('/api/admin/account-deletions/kept-out')
      .then((r) => setKept(r.items))
      .catch(() => {});
  }

  async function keptAction(g: Kept, action: 'allow' | 'never') {
    if (!window.confirm(action === 'allow' ? t('deleteChoice.kept_confirm_allow') : t('deleteChoice.kept_confirm_forever'))) return;
    setError(null);
    try {
      await api.post(`/api/admin/account-deletions/kept-out/${g.groupId}/${action}`);
      loadKept();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('deleteChoice.kept_failed'));
    }
  }

  function load() {
    loadKept();
    api
      .get<{ items: Row[]; closed: Closed[] }>('/api/admin/account-deletions')
      .then((r) => {
        setItems(r.items);
        setClosed(r.closed);
      })
      .catch(() => setError(t('accountDeletion.admin_load_failed')));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, []);

  async function decide(row: Row, decision: 'DELETE' | 'KEEP') {
    // Deleting asks how (free to return / only with approval / never) on the row itself; keeping just asks to confirm.
    if (decision === 'DELETE') {
      setDeleting(row.id);
      setMode('FREE');
      setNote('');
      return;
    }
    if (!window.confirm(t('accountDeletion.admin_confirm_keep', { name: row.name ?? '' }))) return;
    setError(null);
    try {
      await api.post(`/api/admin/account-deletions/${row.id}`, { decision });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('accountDeletion.admin_failed'));
    }
  }

  async function confirmDelete(row: Row) {
    setError(null);
    try {
      await api.post(`/api/admin/account-deletions/${row.id}`, { decision: 'DELETE', mode, ...(mode !== 'FREE' && note.trim() ? { note: note.trim() } : {}) });
      setDeleting(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('accountDeletion.admin_failed'));
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">{t('accountDeletion.admin_intro')}</p>
      {error && <p className="text-sm text-red-700">{error}</p>}
      <section className="card space-y-3">
        <h3 className="font-semibold text-brand-900">{t('accountDeletion.admin_waiting')}</h3>
        {items?.length === 0 && <p className="text-sm text-slate-400">{t('accountDeletion.admin_none')}</p>}
        <ul className="divide-y divide-slate-100">
          {items?.map((r) => (
            <li key={r.id} className="space-y-2 py-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-semibold text-slate-800">{r.name}</span> <span className="text-slate-500">{r.whatsappNumber}</span>
                  <span className="block text-xs text-slate-600">{r.email}</span>
                  <span className="block text-xs text-slate-600">
                    {t('accountDeletion.admin_asked', { date: day(r.requestedAt) })} · {r.source === 'WEB' ? t('accountDeletion.admin_from_web') : t('accountDeletion.admin_from_app')}
                  </span>
                  <span className={`block text-xs font-medium ${r.ready ? 'text-red-700' : 'text-amber-800'}`}>
                    {r.ready ? t('accountDeletion.admin_ready') : t('accountDeletion.admin_ready_on', { date: day(r.readyAt) })}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => decide(r, 'KEEP')}>
                    {t('accountDeletion.admin_keep')}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                    disabled={!r.ready}
                    title={r.ready ? undefined : t('accountDeletion.admin_ready_on', { date: day(r.readyAt) }) ?? undefined}
                    onClick={() => decide(r, 'DELETE')}
                  >
                    {t('accountDeletion.admin_delete')}
                  </button>
                </span>
              </div>
              {deleting === r.id && (
                <div className="space-y-2">
                  <DeleteChoice mode={mode} note={note} onMode={setMode} onNote={setNote} name={r.name ?? ''} />
                  <div className="flex items-center gap-3">
                    <button type="button" className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white" onClick={() => confirmDelete(r)}>
                      {t('deleteChoice.delete_confirm')}
                    </button>
                    <button type="button" className="text-xs text-slate-500 hover:underline" onClick={() => setDeleting(null)}>
                      {t('deleteChoice.delete_cancel')}
                    </button>
                  </div>
                </div>
              )}
              {r.returnedRoles.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {t('accountDeletion.admin_roles_returned')} {r.returnedRoles.join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3" data-testid="kept-out">
        <h3 className="font-semibold text-brand-900">{t('deleteChoice.kept_title')}</h3>
        <p className="text-xs text-slate-600">{t('deleteChoice.kept_intro')}</p>
        {kept.length === 0 && <p className="text-sm text-slate-400">{t('deleteChoice.kept_none')}</p>}
        <ul className="divide-y divide-slate-100">
          {kept.map((g) => (
            <li key={g.groupId} className="space-y-1 py-3 text-sm" data-testid={`kept-${g.groupId}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-semibold text-slate-800">{g.personName ?? '—'}</span>{' '}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${g.mode === 'NEVER' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`}>
                    {g.mode === 'NEVER' ? t('deleteChoice.kept_never') : t('deleteChoice.kept_approval')}
                  </span>
                  <span className="block text-xs text-slate-600">{[...(g.whatsappNumbers ?? []), ...(g.emails ?? [])].join(' · ')}</span>
                  {g.note && (
                    <span className="block text-xs text-slate-600">
                      {t('deleteChoice.kept_note_prefix')} {g.note}
                    </span>
                  )}
                  {g.status === 'ACTIVE' ? (
                    <span className={`block text-xs font-medium ${g.attempts > 0 ? 'text-red-700' : 'text-slate-500'}`}>
                      {g.attempts > 0 ? t('deleteChoice.kept_tried', { count: g.attempts, date: day(g.lastAttemptAt ?? '') }) : t('deleteChoice.kept_not_tried')}
                    </span>
                  ) : (
                    <span className="block text-xs text-slate-500">
                      {g.status === 'APPROVED' ? t('deleteChoice.kept_decided_approved', { date: day(g.decidedAt ?? '') }) : t('deleteChoice.kept_decided_lifted', { date: day(g.decidedAt ?? '') })}
                    </span>
                  )}
                </span>
                {g.status === 'ACTIVE' && (
                  <span className="flex flex-wrap items-center gap-2">
                    <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => keptAction(g, 'allow')}>
                      {g.mode === 'APPROVAL' ? t('deleteChoice.kept_allow') : t('deleteChoice.kept_lift')}
                    </button>
                    {g.mode === 'APPROVAL' && (
                      <button type="button" className="rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white" onClick={() => keptAction(g, 'never')}>
                        {t('deleteChoice.kept_forever')}
                      </button>
                    )}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {closed.length > 0 && (
        <section className="card space-y-2">
          <h3 className="font-semibold text-brand-900">{t('accountDeletion.admin_history')}</h3>
          <ul className="space-y-1 text-xs text-slate-600">
            {closed.map((c) => (
              <li key={c.id}>
                {c.status === 'COMPLETED'
                  ? t('accountDeletion.admin_done', { date: day(c.completedAt ?? c.requestedAt) })
                  : c.cancelledBy === 'ADMIN'
                    ? t('accountDeletion.admin_kept', { date: day(c.cancelledAt ?? c.requestedAt) })
                    : t('accountDeletion.admin_came_back', { date: day(c.cancelledAt ?? c.requestedAt) })}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
