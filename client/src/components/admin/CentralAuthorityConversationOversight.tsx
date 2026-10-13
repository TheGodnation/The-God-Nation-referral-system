import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';

interface OversightAttachmentRow {
  id: string;
  originalFilename: string;
  mimeType: string;
  byteSize: number;
}

interface OversightMessageRow {
  id: string;
  senderName: string;
  body: string | null;
  createdAt: string;
  // Community only (Phase 3M.8A moderation) — absent for Geography/Follow-Up.
  deleted?: boolean;
  deletedAt?: string | null;
  deletedByName?: string | null;
  // Community only (Phase 3M.8C) — absent for Geography/Follow-Up.
  attachments?: OversightAttachmentRow[];
}

type OversightReason = 'SECURITY' | 'FRAUD_OR_DECEPTION' | 'ABUSE_OR_SAFEGUARDING' | 'ORGANIZATIONAL_REVIEW' | 'OTHER';

const REASONS: OversightReason[] = ['SECURITY', 'FRAUD_OR_DECEPTION', 'ABUSE_OR_SAFEGUARDING', 'ORGANIZATIONAL_REVIEW', 'OTHER'];

// Phase 3M.8B — Central Authority (Admin) read-only conversation oversight.
// One shared viewer reused across Community/Geography/Follow-Up (a single,
// well-scoped Admin-only inspection concern, not a generic communication
// component — it never sends, edits, deletes, or manages participants; it
// has no composer at all). `messagesUrl` is the exact
// GET /api/admin/.../conversation/messages endpoint for one specific
// conversation; this component only ever appends `reason`/`reasonNote`/
// `before` query parameters to it.
//
// Every view requires an explicit reason first — there is no "just open
// it" path. The chosen reason is resent on every subsequent "load older"
// page too (the server audits each call independently), but the human is
// only ever prompted once per session with this panel open.
export function CentralAuthorityConversationOversight({ messagesUrl }: { messagesUrl: string }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<OversightReason | ''>('');
  const [reasonNote, setReasonNote] = useState('');
  const [submittedReason, setSubmittedReason] = useState<{ reason: OversightReason; reasonNote: string } | null>(null);

  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<OversightMessageRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Community-only: .../communities/:id/conversation/messages -> the
  // sibling .../communities/:id/attachments/:attachmentId/download-url
  // route. Unused (never referenced) for Geography/Follow-Up, whose rows
  // never carry an `attachments` field in the first place.
  const attachmentsBaseUrl = messagesUrl.replace(/\/conversation\/messages$/, '/attachments');

  function buildUrl(base: string, activeReason: { reason: OversightReason; reasonNote: string }, before?: string) {
    const params = new URLSearchParams();
    params.set('reason', activeReason.reason);
    if (activeReason.reason === 'OTHER') params.set('reasonNote', activeReason.reasonNote);
    if (before) params.set('before', before);
    return `${base}?${params.toString()}`;
  }

  async function openAttachment(attachmentId: string) {
    if (!submittedReason) return;
    setDownloadError(null);
    try {
      const res = await api.get<{ url: string }>(buildUrl(`${attachmentsBaseUrl}/${attachmentId}/download-url`, submittedReason));
      window.open(res.url, '_blank', 'noopener');
    } catch (err) {
      setDownloadError(err instanceof ApiError ? err.message : t('admin.conversationOversight.load_failed'));
    }
  }

  function startViewing(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) return;
    if (reason === 'OTHER' && !reasonNote.trim()) return;
    const active = { reason, reasonNote: reasonNote.trim() };
    setSubmittedReason(active);
    setError(null);
    setLoading(true);
    api
      .get<{ items: OversightMessageRow[]; hasMore: boolean }>(buildUrl(messagesUrl, active))
      .then((res) => {
        setMessages(res.items);
        setHasMore(res.hasMore);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('admin.conversationOversight.load_failed')))
      .finally(() => setLoading(false));
  }

  function loadOlder() {
    if (!submittedReason || messages.length === 0 || loadingOlder) return;
    setLoadingOlder(true);
    const oldestId = messages[0].id;
    api
      .get<{ items: OversightMessageRow[]; hasMore: boolean }>(buildUrl(messagesUrl, submittedReason, oldestId))
      .then((res) => {
        setMessages((prev) => [...res.items, ...prev]);
        setHasMore(res.hasMore);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : t('admin.conversationOversight.load_failed')))
      .finally(() => setLoadingOlder(false));
  }

  function closeAndReset() {
    setSubmittedReason(null);
    setMessages([]);
    setHasMore(false);
    setError(null);
    setReason('');
    setReasonNote('');
  }

  if (!submittedReason) {
    return (
      <form onSubmit={startViewing} className="space-y-3 rounded border border-slate-100 p-3">
        <p className="text-xs text-slate-500">{t('admin.conversationOversight.intro')}</p>
        <div>
          <label className="label">{t('admin.conversationOversight.reason_label')}</label>
          <select
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value as OversightReason | '')}
            required
          >
            <option value="">{t('admin.conversationOversight.reason_placeholder')}</option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {t(`admin.conversationOversight.reason_${r.toLowerCase()}`)}
              </option>
            ))}
          </select>
        </div>
        {reason === 'OTHER' && (
          <div>
            <label className="label">{t('admin.conversationOversight.reason_note_label')}</label>
            <textarea
              className="input"
              rows={2}
              maxLength={500}
              placeholder={t('admin.conversationOversight.reason_note_placeholder') ?? ''}
              value={reasonNote}
              onChange={(e) => setReasonNote(e.target.value)}
              required
            />
          </div>
        )}
        <button type="submit" className="btn-primary" disabled={!reason || (reason === 'OTHER' && !reasonNote.trim())}>
          {t('admin.conversationOversight.view_button')}
        </button>
      </form>
    );
  }

  return (
    <div className="rounded border border-slate-100 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {t('admin.conversationOversight.viewing_as_reason', {
            reason: t(`admin.conversationOversight.reason_${submittedReason.reason.toLowerCase()}`),
          })}
        </span>
        <button type="button" className="text-xs text-brand-700 hover:underline" onClick={closeAndReset}>
          {t('admin.conversationOversight.close')}
        </button>
      </div>

      {downloadError && <p className="mb-2 text-sm text-red-700">{downloadError}</p>}

      {loading ? (
        <p className="text-sm text-slate-400">{t('admin.conversationOversight.loading')}</p>
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
              {loadingOlder ? t('admin.conversationOversight.loading') : t('admin.conversationOversight.load_older')}
            </button>
          )}

          {messages.length === 0 ? (
            <p className="text-sm text-slate-400">{t('admin.conversationOversight.no_messages')}</p>
          ) : (
            <div className="max-h-96 space-y-3 overflow-y-auto rounded border border-slate-100 p-3">
              {messages.map((m) => (
                <div key={m.id} className="text-sm">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-medium text-brand-900">{m.senderName}</span>
                    <span className="text-xs text-slate-400">{new Date(m.createdAt).toLocaleString()}</span>
                    {m.deleted && (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                        {m.deletedByName
                          ? t('admin.conversationOversight.removed_by', { name: m.deletedByName })
                          : t('admin.conversationOversight.removed')}
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-slate-700">{m.body}</p>
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2">
                      {m.attachments.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="rounded border border-slate-200 px-2 py-1 text-xs text-brand-700 hover:underline"
                          onClick={() => openAttachment(a.id)}
                        >
                          {t('admin.conversationOversight.open_attachment')}: {a.originalFilename}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
