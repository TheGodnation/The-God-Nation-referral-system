import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface SplitChat {
  keepId: string;
  dropId: string;
  personA: { id: string; name: string };
  personB: { id: string; name: string };
  keepMessages: number;
  dropMessages: number;
  keepStarted: string;
  dropStarted: string;
  lastMessageAt: string | null;
}

const day = (iso: string, lang: string) => new Date(iso).toLocaleDateString(lang.startsWith('fr') ? 'fr-FR' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

// Two people who each started a chat with the other end up with TWO chats that carry the same name, and the older
// messages seem to be gone. This lists those pairs and joins each into ONE chat: every message of both, in time order.
export function SplitChatsCard({ base }: { base: string }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<SplitChat[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get<{ items: SplitChat[] }>(`${base}/split-chats`);
      setItems(r.items);
    } catch {
      setError(t('splitChats.load_failed'));
    }
  }, [base, t]);

  async function join(item: SplitChat) {
    if (!window.confirm(t('splitChats.confirm', { a: item.personA.name, b: item.personB.name }) ?? '')) return;
    setBusy(item.keepId);
    setError(null);
    setDone(null);
    try {
      const r = await api.post<{ movedMessages: number }>(`${base}/split-chats/join`, { keepId: item.keepId, dropId: item.dropId });
      setDone(t('splitChats.joined', { a: item.personA.name, b: item.personB.name, count: r.movedMessages }));
      setItems((prev) => (prev ?? []).filter((x) => x.keepId !== item.keepId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('splitChats.failed'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <details className="card space-y-3" data-testid="split-chats" onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && items === null && void load()}>
      <summary className="cursor-pointer font-semibold text-brand-900">{t('splitChats.title')}</summary>
      <p className="text-sm text-slate-600">{t('splitChats.intro')}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {done && <p role="status" className="text-sm text-emerald-700" data-testid="split-done">{done}</p>}
      {items && items.length === 0 && <p className="text-sm text-slate-500" data-testid="split-none">{t('splitChats.none')}</p>}
      <ul className="divide-y divide-slate-100">
        {(items ?? []).map((s) => (
          <li key={s.keepId} className="flex flex-wrap items-center gap-3 py-3" data-testid={`split-${s.keepId}`}>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900">{s.personA.name} ⇄ {s.personB.name}</p>
              <p className="text-xs text-slate-500">
                {t('splitChats.detail', {
                  olderCount: s.keepMessages,
                  olderDate: day(s.keepStarted, i18n.language),
                  newerCount: s.dropMessages,
                  newerDate: day(s.dropStarted, i18n.language),
                })}
              </p>
            </div>
            <button type="button" className="btn-primary px-3 py-1.5 text-sm disabled:opacity-60" disabled={busy === s.keepId} onClick={() => void join(s)} data-testid={`split-join-${s.keepId}`}>
              {busy === s.keepId ? t('splitChats.joining') : t('splitChats.join')}
            </button>
          </li>
        ))}
      </ul>
      {items && <button type="button" className="text-xs font-semibold text-brand-700 underline" onClick={() => void load()}>{t('splitChats.refresh')}</button>}
    </details>
  );
}
