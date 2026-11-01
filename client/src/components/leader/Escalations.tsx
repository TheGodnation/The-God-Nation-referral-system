import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

export interface EscalationItem {
  id: string;
  askerName: string;
  aboutName: string;
  communityName: string | null;
  question: string;
  urgent: boolean;
  level: 'PARENT_LEADERS' | 'CENTRAL_ADMIN';
  status: 'OPEN' | 'ANSWERED';
  dueAt: string | null;
  bypassReason: string | null;
  createdAt: string;
  mine: boolean;
  messages: { id: string; senderName: string; mine: boolean; body: string; createdAt: string }[];
}

interface ListSpec {
  key: string;
  title: string;
  url: string;
  empty: string;
}

// Hard questions between leaders: the ones a leader asked, the ones sent to
// them (as a leader of the parent assembly), or — for the central admin —
// every one. Each opens as a small thread with a reply box. `messagesBase` is
// where replies are posted: `${messagesBase}/${id}/messages`.
export function Escalations({ lists, messagesBase, hideWhenEmpty = false }: { lists: ListSpec[]; messagesBase: string; hideWhenEmpty?: boolean }) {
  const { t } = useTranslation();
  const [data, setData] = useState<Record<string, EscalationItem[]>>({});
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    Promise.all(lists.map((l) => api.get<{ items: EscalationItem[] }>(l.url).then((r) => [l.key, r.items] as const).catch(() => [l.key, [] as EscalationItem[]] as const))).then((pairs) => {
      setData(Object.fromEntries(pairs));
      setLoaded(true);
    });
  }
  useEffect(load, []);

  async function send(id: string) {
    const body = reply.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`${messagesBase}/${id}/messages`, { body });
      setReply('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('escalations.send_failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;
  const total = lists.reduce((n, l) => n + (data[l.key]?.length ?? 0), 0);
  if (hideWhenEmpty && total === 0) return null;

  const statusText = (e: EscalationItem) =>
    e.status === 'ANSWERED' ? t('escalations.answered') : e.level === 'CENTRAL_ADMIN' ? t(e.bypassReason ? 'escalations.passed_on' : 'escalations.with_central') : t('escalations.waiting_parent');

  return (
    <section className="card space-y-4" data-testid="escalations">
      {lists.map((l) => {
        const items = data[l.key] ?? [];
        if (hideWhenEmpty && items.length === 0) return null;
        return (
          <div key={l.key} className="space-y-2">
            <h3 className="font-semibold text-brand-900">{l.title}</h3>
            {items.length === 0 && <p className="text-sm text-slate-500">{l.empty}</p>}
            <ul className="space-y-2">
              {items.map((e) => {
                const open = openId === `${l.key}:${e.id}`;
                return (
                  <li key={e.id} className={`rounded-xl border p-3 ${e.urgent && e.status === 'OPEN' ? 'border-red-200 bg-red-50/40' : 'border-slate-200'}`}>
                    <button type="button" className="w-full text-left" aria-expanded={open} onClick={() => { setOpenId(open ? null : `${l.key}:${e.id}`); setReply(''); setError(null); }}>
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{t('escalations.about', { asker: e.askerName, about: e.aboutName })}</span>
                        {e.urgent && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">{t('escalations.urgent')}</span>}
                        <span className={`rounded-full px-2 py-0.5 text-xs ${e.status === 'ANSWERED' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>{statusText(e)}</span>
                      </span>
                      <span className="mt-1 block text-sm text-slate-600">{e.question.length > 140 && !open ? `${e.question.slice(0, 140)}…` : e.question}</span>
                    </button>
                    {open && (
                      <div className="mt-3 space-y-2">
                        {e.communityName && <p className="text-xs text-slate-500">{e.communityName}</p>}
                        <ul className="space-y-1">
                          {e.messages.slice(1).map((m) => (
                            <li key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.mine ? 'bg-brand-50 text-slate-900' : 'bg-slate-50 text-slate-800'}`}>
                              <span className="block text-xs font-medium text-slate-500">{m.senderName}</span>
                              {m.body}
                            </li>
                          ))}
                        </ul>
                        <label className="label" htmlFor={`esc-reply-${e.id}`}>{e.mine ? t('escalations.add_message') : t('escalations.your_answer')}</label>
                        <textarea id={`esc-reply-${e.id}`} className="input" rows={3} value={reply} onChange={(ev) => setReply(ev.target.value)} />
                        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
                        <button type="button" className="btn-primary px-3 py-1.5 text-sm" disabled={busy || !reply.trim()} onClick={() => send(e.id)}>
                          {t('escalations.send')}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
