import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface LeaderRow {
  personId: string;
  name: string;
  away: boolean;
  people: number;
  contactedTwice: number;
  needingAttention: number;
  emergencies: number;
}
interface ChatRow {
  conversationId: string;
  memberName: string;
  messageCount: number;
  lastMessageAt: string | null;
  lastFrom: 'LEADER' | 'MEMBER' | null;
}
interface Thread {
  leaderName: string;
  memberName: string;
  messages: { id: string; from: 'LEADER' | 'MEMBER'; senderName: string; body: string; createdAt: string; removed: boolean; attachments: { kind: 'VOICE' | 'PHOTO' | 'VIDEO' | 'FILE'; fileName: string }[] }[];
}

// The central admin's drill-down for one assembly: each leader with their
// people and how many need attention, and — while he has it switched on — a
// read-only view of the chats between a leader and the people they follow.
// Reading leaves no trace for the leader or the person.
export function LeadersOversight({ base, communityId }: { base: string; communityId: string }) {
  const { t } = useTranslation();
  const [leaders, setLeaders] = useState<LeaderRow[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [chatsOf, setChatsOf] = useState<{ id: string; name: string } | null>(null);
  const [chats, setChats] = useState<ChatRow[] | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLeaders(null);
    setChatsOf(null);
    setThread(null);
    api.get<{ items: LeaderRow[] }>(`${base}/health/${encodeURIComponent(communityId)}/leaders`).then((r) => setLeaders(r.items)).catch(() => setLeaders([]));
    api.get<{ enabled: boolean }>(`${base}/oversight/settings`).then((r) => setEnabled(r.enabled)).catch(() => setEnabled(null));
  }, [base, communityId]);

  async function toggle() {
    if (enabled === null) return;
    setError(null);
    try {
      const r = await api.put<{ enabled: boolean }>(`${base}/oversight/settings`, { enabled: !enabled });
      setEnabled(r.enabled);
      setChatsOf(null);
      setThread(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('oversight.failed'));
    }
  }

  async function openChats(l: LeaderRow) {
    setError(null);
    setThread(null);
    setChatsOf({ id: l.personId, name: l.name });
    setChats(null);
    try {
      const r = await api.get<{ items: ChatRow[] }>(`${base}/oversight/leaders/${encodeURIComponent(l.personId)}/chats`);
      setChats(r.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('oversight.failed'));
    }
  }

  async function openThread(id: string) {
    setError(null);
    try {
      setThread(await api.get<Thread>(`${base}/oversight/chats/${encodeURIComponent(id)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('oversight.failed'));
    }
  }

  if (!leaders) return <p className="text-sm text-slate-400">{t('cells.loading')}</p>;

  return (
    <div className="space-y-3" data-testid="leaders-oversight">
      <h4 className="font-medium text-slate-800">{t('oversight.leaders_title')}</h4>
      {leaders.length === 0 && <p className="text-sm text-slate-500">{t('oversight.no_leaders')}</p>}
      <ul className="divide-y divide-slate-100">
        {leaders.map((l) => (
          <li key={l.personId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>
              <span className="font-medium text-slate-800">{l.name}</span>
              {l.away && <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">{t('oversight.away')}</span>}
              <span className="block text-xs text-slate-500">
                {t('oversight.leader_counts', { people: l.people, twice: l.contactedTwice, attention: l.needingAttention })}
                {l.emergencies > 0 && <span className="ml-2 font-semibold text-red-700">{t('oversight.emergencies', { count: l.emergencies })}</span>}
              </span>
            </span>
            {enabled && (
              <button type="button" className="btn-secondary px-3 py-1 text-sm" onClick={() => openChats(l)}>
                {t('oversight.read_chats')}
              </button>
            )}
          </li>
        ))}
      </ul>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {chatsOf && !thread && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <h5 className="font-medium text-slate-800">{t('oversight.chats_of', { name: chatsOf.name })}</h5>
          {chats === null && <p className="text-sm text-slate-400">{t('cells.loading')}</p>}
          {chats && chats.length === 0 && <p className="text-sm text-slate-500">{t('oversight.no_chats')}</p>}
          <ul className="divide-y divide-slate-100">
            {chats?.map((c) => (
              <li key={c.conversationId}>
                <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left text-sm" onClick={() => openThread(c.conversationId)}>
                  <span className="font-medium text-slate-800">{c.memberName}</span>
                  <span className="text-xs text-slate-500">
                    {t('oversight.messages_count', { count: c.messageCount })}
                    {c.lastMessageAt ? ` · ${new Date(c.lastMessageAt).toLocaleDateString()}` : ''}
                    {c.lastFrom === 'LEADER' ? ` · ${t('oversight.last_leader')}` : c.lastFrom === 'MEMBER' ? ` · ${t('oversight.last_member')}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {thread && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-3">
          <button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => setThread(null)}>{t('oversight.back')}</button>
          <h5 className="font-medium text-slate-800">{t('oversight.thread_title', { leader: thread.leaderName, member: thread.memberName })}</h5>
          <ul className="space-y-1">
            {thread.messages.map((m) => (
              <li key={m.id} className={`rounded-lg px-3 py-2 text-sm ${m.from === 'LEADER' ? 'bg-brand-50' : 'bg-slate-50'}`}>
                <span className="block text-xs font-medium text-slate-500">
                  {m.senderName} · {new Date(m.createdAt).toLocaleString()}
                </span>
                {m.removed ? <em className="text-slate-400">{t('oversight.removed')}</em> : m.body}
                {m.attachments.map((a, i) => (
                  <span key={i} className="mt-1 block text-xs text-slate-600">
                    {t(`oversight.attachment_${a.kind.toLowerCase()}`)}: {a.fileName}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {enabled !== null && (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3 text-sm text-slate-600">
          <span>{enabled ? t('oversight.on') : t('oversight.off')}</span>
          <button type="button" className="btn-secondary px-3 py-1 text-sm" onClick={toggle}>
            {enabled ? t('oversight.switch_off') : t('oversight.switch_on')}
          </button>
        </div>
      )}
    </div>
  );
}
