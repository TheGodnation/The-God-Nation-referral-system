import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';

interface MessageRow {
  id: string;
  senderName: string;
  body: string | null;
  createdAt: string;
  deleted: boolean;
}

// Phase 3M.1 — a single, persistent, text-only conversation per Community.
// Shared by both the Member Dashboard and the Leader Dashboard: access is
// derived server-side from either an ACTIVE CommunityMembership or an
// ACTIVE SCOPED_LEADER RoleAssignment for this exact Community (never both
// required, never merged into one check) — this component itself makes no
// authorization decisions, it only renders whatever the server returns.
// No realtime, no polling: loading the panel and sending a message are the
// only two things that ever fetch. Text-only — no attachments of any kind.
//
// Phase 3M.7 — read/unread state. Fetching the latest messages is a genuine
// GET (kept side-effect-free server-side); once that succeeds and there is
// at least one unread message, this component fires POST .../read once with
// the newest message actually visible — never from loadOlder(), so paging
// into history never marks the whole conversation read. A failed read-mark
// is a silent best-effort follow-up: it never hides or discards the
// messages that are already rendered, and never shows a false "read" state.
//
// Phase 3M.8A — Community Administrator moderation. `isAdministrator` comes
// straight from the server (isCommunityAdministrator) — this component makes
// no authorization decision of its own, it only shows/hides the Remove
// action based on what the server already told it, and the server
// independently re-checks on every DELETE request regardless of what this
// renders. A moderated message never carries its original body to this
// component at all (server-redacted) — it only ever sees `deleted: true`.
export function CommunityConversation({ communityId, communityName }: { communityId: string; communityName: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  function markRead(latestMessageId: string) {
    api
      .post<{ unreadCount: number }>(`/api/communities/${communityId}/conversation/read`, { messageId: latestMessageId })
      .then((res) => setUnreadCount(res.unreadCount))
      .catch(() => {});
  }

  function loadLatest() {
    setError(null);
    api
      .get<{ items: MessageRow[]; hasMore: boolean; unreadCount: number; isAdministrator: boolean }>(
        `/api/communities/${communityId}/conversation/messages`,
      )
      .then((res) => {
        setMessages(res.items);
        setHasMore(res.hasMore);
        setUnreadCount(res.unreadCount);
        setIsAdministrator(res.isAdministrator);
        if (res.unreadCount > 0 && res.items.length > 0) {
          markRead(res.items[res.items.length - 1].id);
        }
      })
      .catch(() => setError(t('communityConversation.load_failed')))
      .finally(() => setLoading(false));
  }

  useEffect(loadLatest, [communityId]);

  function loadOlder() {
    if (messages.length === 0 || loadingOlder) return;
    setLoadingOlder(true);
    const oldestId = messages[0].id;
    api
      .get<{ items: MessageRow[]; hasMore: boolean }>(
        `/api/communities/${communityId}/conversation/messages?before=${oldestId}`,
      )
      .then((res) => {
        setMessages((prev) => [...res.items, ...prev]);
        setHasMore(res.hasMore);
      })
      .catch(() => setError(t('communityConversation.load_failed')))
      .finally(() => setLoadingOlder(false));
  }

  async function deleteMessage(messageId: string) {
    if (deletingId) return;
    if (!window.confirm(t('communityConversation.delete_confirm') ?? '')) return;
    setDeletingId(messageId);
    setDeleteError(null);
    try {
      await api.delete(`/api/communities/${communityId}/conversation/messages/${messageId}`);
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, deleted: true, body: null } : m)));
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : t('communityConversation.delete_failed'));
    } finally {
      setDeletingId(null);
    }
  }

  async function send() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await api.post(`/api/communities/${communityId}/conversation/messages`, { body: trimmed });
      setBody('');
      loadLatest();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : t('communityConversation.send_failed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card mt-6">
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-brand-900">
        {t('communityConversation.title', { community: communityName })}
        {unreadCount > 0 && (
          <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{unreadCount}</span>
        )}
      </h2>

      {loading ? (
        <p className="text-sm text-slate-400">{t('communityConversation.loading')}</p>
      ) : error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : (
        <>
          {hasMore && (
            <button
              type="button"
              className="mb-3 text-sm text-brand-700 hover:underline disabled:text-slate-300"
              disabled={loadingOlder}
              onClick={loadOlder}
            >
              {loadingOlder ? t('communityConversation.loading') : t('communityConversation.load_older')}
            </button>
          )}

          {deleteError && <p className="mb-2 text-sm text-red-700">{deleteError}</p>}

          {messages.length === 0 ? (
            <p className="text-sm text-slate-400">{t('communityConversation.no_messages')}</p>
          ) : (
            <div className="mb-3 max-h-96 space-y-3 overflow-y-auto rounded border border-slate-100 p-3">
              {messages.map((m) => (
                <div key={m.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-brand-900">{m.senderName}</span>
                    <span className="text-xs text-slate-400">{new Date(m.createdAt).toLocaleString()}</span>
                    {isAdministrator && !m.deleted && (
                      <button
                        type="button"
                        className="ml-auto text-xs text-red-700 hover:underline disabled:text-slate-300"
                        disabled={deletingId === m.id}
                        onClick={() => deleteMessage(m.id)}
                      >
                        {t('communityConversation.delete_message')}
                      </button>
                    )}
                  </div>
                  {m.deleted ? (
                    <p className="italic text-slate-400">{t('communityConversation.message_deleted')}</p>
                  ) : (
                    <p className="whitespace-pre-wrap text-slate-700">{m.body}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <textarea
              className="input"
              rows={2}
              maxLength={2000}
              placeholder={t('communityConversation.composer_placeholder') ?? ''}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={sending}
            />
            {sendError && <p className="text-sm text-red-700">{sendError}</p>}
            <button type="button" className="btn-primary" disabled={sending || !body.trim()} onClick={send}>
              {sending ? t('communityConversation.sending') : t('communityConversation.send')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
