import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';

interface MessageRow {
  id: string;
  senderName: string;
  body: string;
  createdAt: string;
}

// Phase 3M.2 — a single, persistent, text-only conversation between a
// FollowUpAssignment's follower and followed Person. Deliberately a
// separate, independent component from Phase 3M.1's CommunityConversation
// — same general shape (load/paginate/send, no realtime, no polling), but
// its own namespace, own routes, own read-only-after-close rule. Never
// touches or displays FollowUpContact (wellbeing/notes) — that stays a
// private Leader/Admin log, entirely unrelated to this conversation.
export function FollowUpConversation({ followUpAssignmentId }: { followUpAssignmentId: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [assignmentStatus, setAssignmentStatus] = useState<'ACTIVE' | 'CLOSED' | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  function loadAll() {
    setError(null);
    Promise.all([
      api.get<{ assignmentStatus: 'ACTIVE' | 'CLOSED' }>(`/api/follow-ups/${followUpAssignmentId}/conversation`),
      api.get<{ items: MessageRow[]; hasMore: boolean }>(`/api/follow-ups/${followUpAssignmentId}/conversation/messages`),
    ])
      .then(([meta, msgs]) => {
        setAssignmentStatus(meta.assignmentStatus);
        setMessages(msgs.items);
        setHasMore(msgs.hasMore);
      })
      .catch(() => setError(t('followUpConversation.load_failed')))
      .finally(() => setLoading(false));
  }

  useEffect(loadAll, [followUpAssignmentId]);

  function loadOlder() {
    if (messages.length === 0 || loadingOlder) return;
    setLoadingOlder(true);
    const oldestId = messages[0].id;
    api
      .get<{ items: MessageRow[]; hasMore: boolean }>(
        `/api/follow-ups/${followUpAssignmentId}/conversation/messages?before=${oldestId}`,
      )
      .then((res) => {
        setMessages((prev) => [...res.items, ...prev]);
        setHasMore(res.hasMore);
      })
      .catch(() => setError(t('followUpConversation.load_failed')))
      .finally(() => setLoadingOlder(false));
  }

  async function send() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await api.post(`/api/follow-ups/${followUpAssignmentId}/conversation/messages`, { body: trimmed });
      setBody('');
      loadAll();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : t('followUpConversation.send_failed'));
    } finally {
      setSending(false);
    }
  }

  const isActive = assignmentStatus === 'ACTIVE';

  return (
    <div className="mt-4 rounded-lg border border-slate-100 p-3">
      <h3 className="mb-2 font-medium text-brand-900">{t('followUpConversation.title')}</h3>

      {loading ? (
        <p className="text-sm text-slate-400">{t('followUpConversation.loading')}</p>
      ) : error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : (
        <>
          {!isActive && <p className="mb-2 text-xs text-slate-400">{t('followUpConversation.read_only_note')}</p>}

          {hasMore && (
            <button
              type="button"
              className="mb-3 text-sm text-brand-700 hover:underline disabled:text-slate-300"
              disabled={loadingOlder}
              onClick={loadOlder}
            >
              {loadingOlder ? t('followUpConversation.loading') : t('followUpConversation.load_older')}
            </button>
          )}

          {messages.length === 0 ? (
            <p className="text-sm text-slate-400">{t('followUpConversation.no_messages')}</p>
          ) : (
            <div className="mb-3 max-h-72 space-y-3 overflow-y-auto rounded border border-slate-100 p-3">
              {messages.map((m) => (
                <div key={m.id} className="text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-brand-900">{m.senderName}</span>
                    <span className="text-xs text-slate-400">{new Date(m.createdAt).toLocaleString()}</span>
                  </div>
                  <p className="whitespace-pre-wrap text-slate-700">{m.body}</p>
                </div>
              ))}
            </div>
          )}

          {isActive && (
            <div className="space-y-2">
              <textarea
                className="input"
                rows={2}
                maxLength={2000}
                placeholder={t('followUpConversation.composer_placeholder') ?? ''}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                disabled={sending}
              />
              {sendError && <p className="text-sm text-red-700">{sendError}</p>}
              <button type="button" className="btn-primary" disabled={sending || !body.trim()} onClick={send}>
                {sending ? t('followUpConversation.sending') : t('followUpConversation.send')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
