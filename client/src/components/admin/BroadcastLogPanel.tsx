import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

export interface BroadcastItem {
  id: string;
  senderName: string;
  body: string;
  recipientCount: number;
  skippedCount: number;
  attachmentCount: number;
  createdAt: string;
}

export function BroadcastLog({ items, showSender }: { items: BroadcastItem[]; showSender: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <ul className="divide-y divide-slate-100 text-sm" data-testid="broadcast-log">
      {items.map((b) => (
        <li key={b.id} className="py-3" data-testid="broadcast-entry">
          <p className="text-xs text-slate-500">
            {showSender ? <strong className="text-slate-800">{b.senderName}</strong> : null}
            {showSender ? ' · ' : ''}
            {new Date(b.createdAt).toLocaleString(i18n.language.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {' · '}
            {t('broadcast.to_people', { count: b.recipientCount })}
            {b.attachmentCount > 0 ? ` · ${t('broadcast.files', { count: b.attachmentCount })}` : ''}
            {b.skippedCount > 0 ? ` · ${t('broadcast.not_delivered', { count: b.skippedCount })}` : ''}
          </p>
          {b.body && <p className="mt-1 whitespace-pre-wrap text-slate-800">{b.body}</p>}
        </li>
      ))}
    </ul>
  );
}

// The record of group messages: every leader's for the central admin, the leaders of their generation for a representative.
export function BroadcastLogPanel({ base }: { base: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<BroadcastItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ items: BroadcastItem[] }>(`${base}/`).then((r) => setItems(r.items)).catch((e) => setError(e instanceof ApiError ? e.message : t('broadcast.load_failed')));
  }, [base, t]);
  return (
    <div className="space-y-3" data-testid="broadcast-log-panel">
      <div>
        <h2 className="text-lg font-bold text-brand-900">{t('broadcast.log_title')}</h2>
        <p className="text-sm text-slate-600">{t('broadcast.log_help')}</p>
      </div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      {!items && !error && <p className="text-sm text-slate-400">{t('broadcast.loading')}</p>}
      {items && items.length === 0 && <p className="card text-sm text-slate-600">{t('broadcast.log_none')}</p>}
      {items && items.length > 0 && (
        <section className="card">
          <BroadcastLog items={items} showSender />
        </section>
      )}
    </div>
  );
}
