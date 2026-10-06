import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';
import { getAttachmentUrl } from '../lib/chatMedia';

type OtherPartyType = 'CENTRAL_AUTHORITY' | 'LEADER' | 'MEMBER';

interface ConversationRow {
  id: string;
  createdAt: string;
  otherPartyType: OtherPartyType;
  otherPartyName?: string | null;
  unreadCount: number;
}

interface MessageRow {
  id: string;
  isOwn: boolean;
  body: string;
  createdAt: string;
  // Photos / voice notes / videos sent from the member app.
  attachments?: { id: string; originalFilename: string; mimeType: string }[];
}

// Private Communication / Messaging — a shared authenticated participant
// view, reused identically by the Member dashboard, the Leader dashboard,
// and (embedded within) the Admin "Private Messages" tab — because Admin
// is, uniquely for this feature, a genuine two-way participant (see
// server/src/lib/privateMessaging.ts's own comment on why). Structurally
// separate from Announcements/HeadquartersPosts (never merged), and from
// Community/Geography/Follow-Up conversation UI (never repurposed).
//
// A private conversation only ever has 2 sides, so unlike
// CommunityConversation/HeadquartersPosts there is no per-message sender
// name — only `isOwn`, styled against the single "other party" label
// already shown once at the top of the conversation view.
function otherPartyLabel(t: (key: string, opts?: any) => string, row: { otherPartyType: OtherPartyType; otherPartyName?: string | null }) {
  if (row.otherPartyType === 'CENTRAL_AUTHORITY') return t('privateMessages.from_central_authority');
  if (row.otherPartyType === 'LEADER') return t('privateMessages.with_leader', { name: row.otherPartyName ?? '' });
  return row.otherPartyName ?? '';
}

export function PrivateMessages({ alwaysShow = false }: { alwaysShow?: boolean } = {}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ConversationRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ otherPartyType: OtherPartyType; otherPartyName?: string | null } | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  function load() {
    api
      .get<{ items: ConversationRow[] }>('/api/private-messages/conversations')
      .then((res) => {
        setItems(res.items);
        setLoading(false);
      })
      .catch(() => {
        setError(t('privateMessages.load_failed'));
        setLoading(false);
      });
  }

  useEffect(load, []);

  function markReadLocally(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, unreadCount: 0 } : i)));
  }

  function openConversation(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setMessages([]);
    setDetailLoading(true);
    api
      .get<{ items: MessageRow[]; hasMore: boolean; unreadCount: number; otherPartyType: OtherPartyType; otherPartyName?: string | null }>(
        `/api/private-messages/conversations/${id}/messages`,
      )
      .then((res) => {
        setDetail({ otherPartyType: res.otherPartyType, otherPartyName: res.otherPartyName });
        setMessages(res.items);
        setDetailLoading(false);
        if (res.unreadCount > 0 && res.items.length > 0) {
          const latest = res.items[res.items.length - 1];
          api
            .post(`/api/private-messages/conversations/${id}/read`, { messageId: latest.id })
            .then(() => markReadLocally(id))
            .catch(() => {});
        }
      })
      .catch(() => {
        setDetailError(t('privateMessages.load_failed'));
        setDetailLoading(false);
      });
  }

  function closeConversation() {
    setSelectedId(null);
    setDetail(null);
    setMessages([]);
  }

  async function send() {
    const trimmed = body.trim();
    if (!trimmed || !selectedId || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const created = await api.post<MessageRow>(`/api/private-messages/conversations/${selectedId}/messages`, { body: trimmed });
      setMessages((prev) => [...prev, created]);
      setBody('');
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : t('privateMessages.send_failed'));
    } finally {
      setSending(false);
    }
  }

  if (loading) return null;
  if (!alwaysShow && !error && items.length === 0) return null;

  if (selectedId) {
    return (
      <div className="card mt-6">
        <button className="mb-4 text-sm text-brand-700 hover:underline" onClick={closeConversation}>
          {t('privateMessages.back_to_list')}
        </button>
        {detailLoading && <p className="text-sm text-slate-400">{t('privateMessages.loading')}</p>}
        {detailError && <p className="text-sm text-red-700">{detailError}</p>}
        {detail && (
          <>
            <h2 className="mb-3 font-semibold text-brand-900">{otherPartyLabel(t, detail)}</h2>
            {messages.length === 0 ? (
              <p className="mb-3 text-sm text-slate-400">{t('privateMessages.no_messages')}</p>
            ) : (
              <div className="mb-3 max-h-96 space-y-2 overflow-y-auto rounded border border-slate-100 p-3">
                {messages.map((m) => (
                  <div key={m.id} className={`text-sm ${m.isOwn ? 'text-right' : 'text-left'}`}>
                    <p
                      className={`inline-block whitespace-pre-wrap rounded px-2 py-1 ${
                        m.isOwn ? 'bg-brand-50 text-brand-900' : 'bg-slate-50 text-slate-700'
                      }`}
                    >
                      {m.body}
                      {(m.attachments ?? []).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="block text-left text-brand-700 underline"
                          onClick={() =>
                            selectedId &&
                            getAttachmentUrl(`/api/private-messages/conversations/${selectedId}`, m.id, a.id)
                              .then((url) => window.open(url, '_blank', 'noopener'))
                              .catch(() => {})
                          }
                        >
                          📎 {a.originalFilename}
                        </button>
                      ))}
                    </p>
                    <span className="block text-xs text-slate-400">{new Date(m.createdAt).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-2">
              <textarea
                className="input"
                rows={2}
                maxLength={2000}
                placeholder={t('privateMessages.composer_placeholder') ?? ''}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={sending}
              />
              {sendError && <p className="text-sm text-red-700">{sendError}</p>}
              <button className="btn-primary" disabled={sending || !body.trim()} onClick={send}>
                {sending ? t('privateMessages.sending') : t('privateMessages.send')}
              </button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="card mt-6">
      <h2 className="mb-3 font-semibold text-brand-900">{t('privateMessages.title')}</h2>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!error && items.length === 0 && <p className="text-sm text-slate-400">{t('privateMessages.no_conversations')}</p>}
      {!error && items.length > 0 && (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-sm">
              <div>
                <p className={i.unreadCount > 0 ? 'font-semibold text-brand-900' : 'font-medium text-brand-900'}>
                  {otherPartyLabel(t, i)}
                  {i.unreadCount > 0 && (
                    <span className="ml-2 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{i.unreadCount}</span>
                  )}
                </p>
                <span className="text-xs text-slate-400">{new Date(i.createdAt).toLocaleDateString()}</span>
              </div>
              <button className="text-brand-700 hover:underline" onClick={() => openConversation(i.id)}>
                {t('privateMessages.open')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
