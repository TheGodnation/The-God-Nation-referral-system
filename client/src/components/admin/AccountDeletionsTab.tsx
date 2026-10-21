import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

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

const day = (iso: string) => new Date(iso).toLocaleDateString();

export function AccountDeletionsTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Row[] | null>(null);
  const [closed, setClosed] = useState<Closed[]>([]);
  const [error, setError] = useState<string | null>(null);

  function load() {
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
    const question = decision === 'DELETE' ? t('accountDeletion.admin_confirm_delete', { name: row.name ?? '' }) : t('accountDeletion.admin_confirm_keep', { name: row.name ?? '' });
    if (!window.confirm(question)) return;
    setError(null);
    try {
      await api.post(`/api/admin/account-deletions/${row.id}`, { decision });
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
              {r.returnedRoles.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {t('accountDeletion.admin_roles_returned')} {r.returnedRoles.join(' · ')}
                </p>
              )}
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
