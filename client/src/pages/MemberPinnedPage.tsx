import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageShell } from '../components/PageShell';
import { Avatar } from '../components/Avatar';
import { orderedPins, resumePin, type ChatPin } from '../components/chat/PinnedMessages';
import { api } from '../lib/api';
import { RichText } from '../lib/richText';

interface Comment {
  id: string;
  senderName: string;
  senderBadge?: string | null;
  senderPhotoUrl?: string | null;
  isOwn: boolean;
  body: string;
  createdAt: string;
}

interface Info {
  name?: string | null;
  canPin?: boolean;
  pins?: ChatPin[];
}

type Full = { body: string | null; translation?: { sourceLanguage: 'en' | 'fr'; translatedBody: string } | null };

/** Where a teaching's reading and quiz open: they remember they came from the pinned messages. */
export function pinnedTeachingPath(teachingId: string, communityId: string) {
  return `/member/teachings/${teachingId}?pins=${communityId}`;
}

/**
 * The Pinned page: the pinned messages of an assembly, read one after another without going into
 * the chat. A teaching opens its reading and quiz (which bring the person back here, to the next
 * one); a post is read in full with its comments under it. What is done is ticked, and the strip
 * in the chat carries on at the first one not done.
 */
export function MemberPinnedPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { communityId = '', messageId } = useParams();
  const [info, setInfo] = useState<Info | null>(null);
  const [failed, setFailed] = useState(false);
  const [full, setFull] = useState<Record<string, Full>>({});
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      api
        .get<Info>(`/api/communities/${communityId}/conversation`)
        .then((r) => setInfo(r))
        .catch(() => setFailed(true)),
    [communityId],
  );
  useEffect(() => {
    void load();
  }, [load]);

  const pins = useMemo(() => orderedPins(info?.pins ?? []), [info]);
  const at = messageId ? pins.findIndex((p) => p.messageId === messageId) : -1;
  const current = at >= 0 ? pins[at] : null;
  const chatPath = `/member/chats/group/${communityId}`;
  const pinnedPath = (id: string) => `${chatPath}/pinned/${id}`;

  // No pin named (or one that is gone): carry on at the first one not done.
  useEffect(() => {
    if (!info || current) return;
    const next = resumePin(pins);
    if (next) navigate(pinnedPath(next.messageId), { replace: true });
  }, [info, current, pins]); // eslint-disable-line react-hooks/exhaustive-deps

  function markSeen(id: string) {
    setInfo((prev) => (prev ? { ...prev, pins: (prev.pins ?? []).map((p) => (p.messageId === id ? { ...p, unseen: false, ...(p.teachingId ? {} : { done: true }) } : p)) } : prev));
    api.post(`/api/communities/${communityId}/conversation/messages/${id}/pin/seen`).catch(() => {});
  }

  // Opening a pin counts as looking at it; a teaching goes straight to its reading and quiz.
  const currentId = current?.messageId;
  const currentTeaching = current?.teachingId;
  useEffect(() => {
    if (!currentId) return;
    markSeen(currentId);
    if (currentTeaching) navigate(pinnedTeachingPath(currentTeaching, communityId), { replace: true });
  }, [currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // A post: the whole text, and the comments under it.
  const needsFull = Boolean(current && !current.teachingId && current.bodyTruncated && !full[current.messageId]);
  useEffect(() => {
    if (!currentId || currentTeaching || !needsFull) return;
    api
      .get<Full>(`/api/communities/${communityId}/conversation/pins/${currentId}`)
      .then((r) => setFull((f) => ({ ...f, [currentId]: r })))
      .catch(() => {});
  }, [currentId, currentTeaching, needsFull, communityId]);
  useEffect(() => {
    setComments(null);
    setDraft('');
    setCommentError(null);
    if (!currentId || currentTeaching) return;
    let live = true;
    api
      .get<{ items: Comment[] }>(`/api/communities/${communityId}/conversation/pins/${currentId}/comments`)
      .then((r) => live && setComments(r.items))
      .catch(() => live && setComments([]));
    return () => {
      live = false;
    };
  }, [currentId, currentTeaching, communityId]);

  async function sendComment() {
    const body = draft.trim();
    if (!body || !current || sending) return;
    setSending(true);
    setCommentError(null);
    try {
      await api.post(`/api/communities/${communityId}/conversation/messages`, { body, replyToMessageId: current.messageId });
      setDraft('');
      const r = await api.get<{ items: Comment[] }>(`/api/communities/${communityId}/conversation/pins/${current.messageId}/comments`);
      setComments(r.items);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setCommentError(status === 403 ? t('pins.comments_closed') : t('pins.comment_failed'));
    } finally {
      setSending(false);
    }
  }

  async function unpin(id: string) {
    try {
      const res = await api.delete<{ pins: ChatPin[] }>(`/api/communities/${communityId}/conversation/messages/${id}/pin`);
      setInfo((prev) => (prev ? { ...prev, pins: res.pins } : prev));
      const rest = orderedPins(res.pins);
      navigate(rest.length ? pinnedPath((rest[Math.min(at, rest.length - 1)] ?? rest[0]).messageId) : chatPath, { replace: true });
    } catch {
      /* stays as it is */
    }
  }

  if (failed) {
    return (
      <PageShell minimal>
        <div className="mx-auto max-w-sm px-4 py-16 text-center">
          <p className="text-slate-500">{t('pins.load_failed')}</p>
          <Link to={chatPath} className="mt-4 inline-block text-brand-700 hover:underline">{t('pins.back_to_chat')}</Link>
        </div>
      </PageShell>
    );
  }
  if (info && pins.length === 0) {
    return (
      <PageShell minimal>
        <div className="mx-auto max-w-sm px-4 py-16 text-center">
          <p className="text-slate-500">{t('pins.empty')}</p>
          <Link to={chatPath} className="mt-4 inline-block text-brand-700 hover:underline">{t('pins.back_to_chat')}</Link>
        </div>
      </PageShell>
    );
  }
  if (!info || !current) {
    return (
      <PageShell minimal>
        <div className="mx-auto max-w-sm px-4 py-16 text-center text-slate-400">…</div>
      </PageShell>
    );
  }

  const isLast = at === pins.length - 1;
  const fetched = full[current.messageId];
  const text = (fetched ? (fetched.translation?.translatedBody ?? fetched.body) : (current.translation?.translatedBody ?? current.body)) ?? '';
  const loadingWhole = Boolean(current.bodyTruncated && !fetched);

  return (
    <PageShell minimal>
      <section className="mx-auto max-w-lg space-y-4 px-4 py-6" data-testid="pinned-page">
        <Link to={chatPath} className="text-sm text-brand-700 hover:underline">
          ← {info.name ?? t('pins.back_to_chat')}
        </Link>
        <header>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">📌 {t('pins.page_title')}</p>
          <p className="mt-1 text-sm text-slate-500" data-testid="pinned-position">
            {t('pins.position', { current: at + 1, total: pins.length })}
          </p>
          <ol className="mt-2 flex flex-wrap gap-1.5" aria-label={t('pins.page_title') ?? ''}>
            {pins.map((p, i) => (
              <li key={p.messageId}>
                <Link
                  to={pinnedPath(p.messageId)}
                  replace
                  aria-current={i === at ? 'step' : undefined}
                  className={`flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-semibold ${
                    i === at ? 'bg-brand-700 text-white' : p.done ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {p.done && i !== at ? '✓' : i + 1}
                </Link>
              </li>
            ))}
          </ol>
        </header>

        <article className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">{current.senderName}</span>
            {current.senderBadge && <span className="text-[11px] font-bold uppercase text-amber-700">📣</span>}
          </div>
          <div className="mt-2 text-[15px] leading-relaxed" data-testid="pinned-post">
            {text ? <RichText text={text} headings comfort /> : <p className="text-slate-500">{current.attachmentMimeType ? '📎' : ''}</p>}
            {loadingWhole && <p className="mt-2 text-xs text-slate-500">{t('pins.loading_full')}</p>}
          </div>
          {current.attachmentMimeType && (
            <Link to={chatPath} className="mt-3 inline-block text-sm font-semibold text-brand-700 underline">
              {t('pins.attachment_in_chat')}
            </Link>
          )}
        </article>

        <section className="space-y-2" data-testid="pinned-comments">
          <h2 className="text-sm font-semibold text-slate-700">
            {t('pins.comments')} {comments && comments.length > 0 ? `(${comments.length})` : ''}
          </h2>
          {comments && comments.length === 0 && <p className="text-sm text-slate-500">{t('pins.no_comments')}</p>}
          <ul className="space-y-2">
            {(comments ?? []).map((c) => (
              <li key={c.id} className="flex items-start gap-2 rounded-lg bg-white p-2 shadow-sm">
                <Avatar name={c.senderName} photoUrl={c.senderPhotoUrl} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-600">
                    {c.isOwn ? '' : c.senderName}
                    {c.senderBadge ? ' 📣' : ''}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-900">{c.body}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              placeholder={t('pins.write_comment') ?? ''}
              aria-label={t('pins.write_comment') ?? ''}
              className="min-h-[44px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-[15px]"
            />
            <button type="button" className="btn-primary px-4 py-2 text-sm" disabled={!draft.trim() || sending} onClick={() => void sendComment()}>
              {t('pins.send_comment')}
            </button>
          </div>
          {commentError && <p className="text-sm text-red-700" role="alert">{commentError}</p>}
        </section>

        <nav className="flex flex-wrap items-center gap-3 pb-6">
          {at > 0 && (
            <Link to={pinnedPath(pins[at - 1].messageId)} replace className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-brand-700 ring-1 ring-slate-300">
              ← {t('pins.previous')}
            </Link>
          )}
          {isLast ? (
            <Link to={chatPath} className="rounded-full bg-brand-700 px-5 py-2 text-sm font-semibold text-white" data-testid="pinned-finish">
              {t('pins.finish')} ✓
            </Link>
          ) : (
            <Link to={pinnedPath(pins[at + 1].messageId)} replace className="rounded-full bg-brand-700 px-5 py-2 text-sm font-semibold text-white" data-testid="pinned-next">
              {t('pins.next')} →
            </Link>
          )}
          {info.canPin && (
            <button type="button" className="text-sm font-semibold text-red-700 underline" onClick={() => void unpin(current.messageId)}>
              {t('pins.unpin')}
            </button>
          )}
        </nav>
      </section>
    </PageShell>
  );
}
