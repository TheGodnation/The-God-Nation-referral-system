import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';

interface MessageRow {
  id: string;
  senderName: string;
  body: string;
  createdAt: string;
}

// Phase 3M.6 — a single, persistent, text-only, two-way GROUP conversation
// per Geography node. Shared by both the Member Dashboard and the Leader
// Dashboard, mirroring CommunityConversation's own shape exactly — a
// structural sibling, not a shared/generic component: access is derived
// server-side from either the caller's own current GeographicAssignment
// (that exact node or a descendant) or an ACTIVE exact-match Geography
// RoleAssignment (see server/src/lib/geographyConversation.ts) — this
// component itself makes no authorization decisions, it only renders
// whatever the server returns. Either side may send the first message;
// there is no leader-only posting restriction. No realtime, no polling:
// loading the panel and sending a message are the only two things that
// ever fetch. Text-only — no attachments of any kind.
export function GeographyConversation({ geographyId, geographyName }: { geographyId: string; geographyName: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  function loadLatest() {
    setError(null);
    api
      .get<{ items: MessageRow[]; hasMore: boolean }>(`/api/geographies/${geographyId}/conversation/messages`)
      .then((res) => {
        setMessages(res.items);
        setHasMore(res.hasMore);
      })
      .catch(() => setError(t('geographyConversation.load_failed')))
      .finally(() => setLoading(false));
  }

  useEffect(loadLatest, [geographyId]);

  function loadOlder() {
    if (messages.length === 0 || loadingOlder) return;
    setLoadingOlder(true);
    const oldestId = messages[0].id;
    api
      .get<{ items: MessageRow[]; hasMore: boolean }>(
        `/api/geographies/${geographyId}/conversation/messages?before=${oldestId}`,
      )
      .then((res) => {
        setMessages((prev) => [...res.items, ...prev]);
        setHasMore(res.hasMore);
      })
      .catch(() => setError(t('geographyConversation.load_failed')))
      .finally(() => setLoadingOlder(false));
  }

  async function send() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await api.post(`/api/geographies/${geographyId}/conversation/messages`, { body: trimmed });
      setBody('');
      loadLatest();
    } catch (err) {
      setSendError(err instanceof ApiError ? err.message : t('geographyConversation.send_failed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card mt-6">
      <h2 className="mb-3 font-semibold text-brand-900">
        {t('geographyConversation.title', { geography: geographyName })}
      </h2>

      {loading ? (
        <p className="text-sm text-slate-400">{t('geographyConversation.loading')}</p>
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
              {loadingOlder ? t('geographyConversation.loading') : t('geographyConversation.load_older')}
            </button>
          )}

          {messages.length === 0 ? (
            <p className="text-sm text-slate-400">{t('geographyConversation.no_messages')}</p>
          ) : (
            <div className="mb-3 max-h-96 space-y-3 overflow-y-auto rounded border border-slate-100 p-3">
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

          <div className="space-y-2">
            <textarea
              className="input"
              rows={2}
              maxLength={2000}
              placeholder={t('geographyConversation.composer_placeholder') ?? ''}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={sending}
            />
            {sendError && <p className="text-sm text-red-700">{sendError}</p>}
            <button type="button" className="btn-primary" disabled={sending || !body.trim()} onClick={send}>
              {sending ? t('geographyConversation.sending') : t('geographyConversation.send')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
