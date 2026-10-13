import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';
import { isAllowedAttachmentMime, maxBytesForMime, formatBytes, MAX_ATTACHMENTS_PER_MESSAGE } from '../lib/attachmentLimits';

interface AttachmentRow {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
}

interface PendingAttachment {
  storageKey: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
}

interface MessageRow {
  id: string;
  senderName: string;
  isOwn: boolean;
  body: string | null;
  createdAt: string;
  deleted: boolean;
  attachments: AttachmentRow[];
}

// Phase 3M.1 — a single, persistent, text-only conversation per Community.
// Shared by both the Member Dashboard and the Leader Dashboard: access is
// derived server-side from either an ACTIVE CommunityMembership or an
// ACTIVE SCOPED_LEADER RoleAssignment for this exact Community (never both
// required, never merged into one check) — this component itself makes no
// authorization decisions, it only renders whatever the server returns.
// No realtime, no polling: loading the panel and sending a message are the
// only two things that ever fetch.
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
//
// Phase 3M.8C — two additions, deliberately kept separate:
// (1) "Delete for me" — shown only on a message this component was told is
// the caller's own (`m.isOwn`, server-resolved, never inferred client-side)
// — removes it from THIS caller's own view only, never affects anyone
// else's. (2) Attachments — a selected file is uploaded DIRECTLY to R2 via
// a server-issued presigned URL (this component never proxies file bytes
// through its own app server); only after that upload succeeds does the
// resulting descriptor get attached to the next sent message. Downloading
// an attachment always re-fetches a fresh, short-lived signed URL first —
// never a stored/cached one.
export function CommunityConversation({ communityId, communityName }: { communityId: string; communityName: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isAdministrator, setIsAdministrator] = useState(false);
  // Community Posting Policy — a UX hint only, computed server-side on every
  // load (see GET .../conversation/messages); the server independently
  // re-checks on every send regardless of what this hides/disables here.
  const [canPost, setCanPost] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [hidingId, setHidingId] = useState<string | null>(null);
  const [hideError, setHideError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function markRead(latestMessageId: string) {
    api
      .post<{ unreadCount: number }>(`/api/communities/${communityId}/conversation/read`, { messageId: latestMessageId })
      .then((res) => setUnreadCount(res.unreadCount))
      .catch(() => {});
  }

  function loadLatest() {
    setError(null);
    api
      .get<{ items: MessageRow[]; hasMore: boolean; unreadCount: number; isAdministrator: boolean; canPost: boolean }>(
        `/api/communities/${communityId}/conversation/messages`,
      )
      .then((res) => {
        setMessages(res.items);
        setHasMore(res.hasMore);
        setUnreadCount(res.unreadCount);
        setIsAdministrator(res.isAdministrator);
        // Defensive default: only an explicit `false` hides the composer —
        // an older/mocked response that omits this field is treated as
        // "posting allowed," matching this component's pre-existing
        // behavior before Community Posting Policy existed.
        setCanPost(res.canPost !== false);
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
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, deleted: true, body: null, attachments: [] } : m)));
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : t('communityConversation.delete_failed'));
    } finally {
      setDeletingId(null);
    }
  }

  async function hideMessage(messageId: string) {
    if (hidingId) return;
    if (!window.confirm(t('communityConversation.hide_confirm') ?? '')) return;
    setHidingId(messageId);
    setHideError(null);
    try {
      await api.post(`/api/communities/${communityId}/conversation/messages/${messageId}/hide`);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
    } catch (err) {
      setHideError(err instanceof ApiError ? err.message : t('communityConversation.hide_failed'));
    } finally {
      setHidingId(null);
    }
  }

  async function openAttachment(messageId: string, attachmentId: string) {
    setDownloadError(null);
    try {
      const res = await api.get<{ url: string }>(
        `/api/communities/${communityId}/conversation/messages/${messageId}/attachments/${attachmentId}/download-url`,
      );
      window.open(res.url, '_blank', 'noopener');
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : t('communityConversation.download_failed'));
    }
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);

    if (pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      setUploadError(t('communityConversation.attachment_too_large') ?? '');
      return;
    }
    if (!isAllowedAttachmentMime(file.type)) {
      setUploadError(t('communityConversation.attachment_unsupported_type') ?? '');
      return;
    }
    const maxBytes = maxBytesForMime(file.type)!;
    if (file.size > maxBytes) {
      setUploadError(t('communityConversation.attachment_too_large') ?? '');
      return;
    }

    setUploading(true);
    try {
      const auth = await api.post<{ storageKey: string; uploadUrl: string }>(`/api/communities/${communityId}/attachments/authorize`, {
        originalFilename: file.name,
        mimeType: file.type,
        byteSize: file.size,
      });
      const uploadRes = await fetch(auth.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadRes.ok) throw new Error('upload failed');
      setPendingAttachments((prev) => [
        ...prev,
        { storageKey: auth.storageKey, originalFilename: file.name, mimeType: file.type, byteSize: file.size },
      ]);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : t('communityConversation.upload_failed'));
    } finally {
      setUploading(false);
    }
  }

  function removePendingAttachment(storageKey: string) {
    setPendingAttachments((prev) => prev.filter((a) => a.storageKey !== storageKey));
  }

  async function send() {
    const trimmed = body.trim();
    if ((!trimmed && pendingAttachments.length === 0) || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await api.post(`/api/communities/${communityId}/conversation/messages`, {
        body: trimmed || undefined,
        attachments: pendingAttachments.length ? pendingAttachments : undefined,
      });
      setBody('');
      setPendingAttachments([]);
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
          {hideError && <p className="mb-2 text-sm text-red-700">{hideError}</p>}
          {downloadError && <p className="mb-2 text-sm text-red-700">{downloadError}</p>}

          {messages.length === 0 ? (
            <p className="text-sm text-slate-400">{t('communityConversation.no_messages')}</p>
          ) : (
            <div className="mb-3 max-h-96 space-y-3 overflow-y-auto rounded border border-slate-100 p-3">
              {messages.map((m) => (
                <div key={m.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-brand-900">{m.senderName}</span>
                    <span className="text-xs text-slate-400">{new Date(m.createdAt).toLocaleString()}</span>
                    <div className="ml-auto flex items-center gap-2">
                      {m.isOwn && !m.deleted && (
                        <button
                          type="button"
                          className="text-xs text-slate-500 hover:underline disabled:text-slate-300"
                          disabled={hidingId === m.id}
                          onClick={() => hideMessage(m.id)}
                        >
                          {t('communityConversation.hide_message')}
                        </button>
                      )}
                      {isAdministrator && !m.deleted && (
                        <button
                          type="button"
                          className="text-xs text-red-700 hover:underline disabled:text-slate-300"
                          disabled={deletingId === m.id}
                          onClick={() => deleteMessage(m.id)}
                        >
                          {t('communityConversation.delete_message')}
                        </button>
                      )}
                    </div>
                  </div>
                  {m.deleted ? (
                    <p className="italic text-slate-400">{t('communityConversation.message_deleted')}</p>
                  ) : (
                    <>
                      {m.body && <p className="whitespace-pre-wrap text-slate-700">{m.body}</p>}
                      {(m.attachments ?? []).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-2">
                          {m.attachments.map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              className="rounded border border-slate-200 px-2 py-1 text-xs text-brand-700 hover:underline"
                              onClick={() => openAttachment(m.id, a.id)}
                            >
                              {t('communityConversation.download_attachment')}: {a.originalFilename} ({formatBytes(a.byteSize)})
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {!canPost && (
            <p className="mb-2 text-sm text-slate-500">{t('communityConversation.posting_restricted')}</p>
          )}

          {canPost && (
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

            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pendingAttachments.map((a) => (
                  <span key={a.storageKey} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600">
                    {a.originalFilename} ({formatBytes(a.byteSize)})
                    <button type="button" className="text-red-700 hover:underline" onClick={() => removePendingAttachment(a.storageKey)}>
                      {t('communityConversation.remove_attachment')}
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp,application/pdf,audio/mpeg,audio/ogg,audio/mp4,video/mp4,video/webm"
                onChange={handleFileSelected}
                disabled={uploading || pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
              />
              <button
                type="button"
                className="btn-secondary px-3 py-1.5 text-sm"
                disabled={uploading || pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? t('communityConversation.uploading') : t('communityConversation.attach_file')}
              </button>
              {uploadError && <span className="text-sm text-red-700">{uploadError}</span>}
            </div>

            {sendError && <p className="text-sm text-red-700">{sendError}</p>}
            <button
              type="button"
              className="btn-primary"
              disabled={sending || uploading || (!body.trim() && pendingAttachments.length === 0)}
              onClick={send}
            >
              {sending ? t('communityConversation.sending') : t('communityConversation.send')}
            </button>
          </div>
          )}
        </>
      )}
    </div>
  );
}
