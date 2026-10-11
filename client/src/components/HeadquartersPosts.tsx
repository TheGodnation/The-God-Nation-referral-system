import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';
import { formatBytes } from '../lib/attachmentLimits';
import { HeadquartersFeedCard } from './HeadquartersFeedCard';

interface HeadquartersPostMediaInfo {
  mediaType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'PDF';
  originalFilename: string;
  byteSize: number;
}

interface HeadquartersPostRow {
  id: string;
  titleEn: string;
  titleFr: string | null;
  bodyEn: string;
  bodyFr: string | null;
  publishedAt: string;
  networkWide: boolean;
  commentCount: number;
  reactionCount: number;
  viewerHasReacted: boolean;
  media: HeadquartersPostMediaInfo | null;
}

interface CommentRow {
  id: string;
  authorName: string;
  isOwn: boolean;
  body: string;
  createdAt: string;
}

// Headquarters Network Posts & Shared Engagement — a shared authenticated
// recipient view, used identically by both the Member and Leader
// dashboards (same API, same display rules as Announcements.tsx). A
// structurally separate section, deliberately never merged into
// Announcements or the Community conversation feed — see
// server/src/lib/headquartersPosts.ts. Silent-hide when there is nothing
// to show, matching the established Announcements convention for an
// inapplicable section.
// variant="feed" (member Updates page) shows each post as a full post card
// with the start of the message and its photo; the default "list" keeps the
// compact list used on the dashboards.
export function HeadquartersPosts({ variant = 'list' }: { variant?: 'list' | 'feed' } = {}) {
  const { t, i18n } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<HeadquartersPostRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HeadquartersPostRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [reacting, setReacting] = useState(false);

  // Media Phase 1 — a fresh, short-lived signed URL is fetched once per
  // post-open (never persisted, never reused across posts), exactly like
  // CommunityConversation.tsx's own openAttachment pattern. A failed fetch
  // never blocks the already-loaded post text/comments/reactions above.
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: HeadquartersPostRow[] }>('/api/me/headquarters-posts')
      .then((res) => {
        setItems(res.items);
        setLoading(false);
      })
      .catch(() => {
        setError(t('headquartersPosts.load_failed'));
        setLoading(false);
      });
  }, []);

  function loadComments(id: string, before?: string) {
    setCommentsLoading(true);
    setCommentsError(null);
    const query = before ? `?before=${encodeURIComponent(before)}` : '';
    api
      .get<{ items: CommentRow[]; hasMore: boolean }>(`/api/me/headquarters-posts/${id}/comments${query}`)
      .then((res) => {
        setComments((prev) => (before ? [...res.items, ...prev] : res.items));
        setCommentsHasMore(res.hasMore);
        setCommentsLoading(false);
      })
      .catch(() => {
        setCommentsError(t('headquartersPosts.comments_load_failed'));
        setCommentsLoading(false);
      });
  }

  function openPost(id: string) {
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    setComments([]);
    setCommentDraft('');
    setMediaUrl(null);
    setMediaError(null);
    api
      .get<HeadquartersPostRow>(`/api/me/headquarters-posts/${id}`)
      .then((res) => {
        setDetail(res);
        setDetailLoading(false);
        loadComments(id);
        if (res.media) {
          setMediaLoading(true);
          api
            .get<{ url: string }>(`/api/me/headquarters-posts/${id}/media/download-url`)
            .then((mediaRes) => setMediaUrl(mediaRes.url))
            .catch(() => setMediaError(t('headquartersPosts.media_load_failed')))
            .finally(() => setMediaLoading(false));
        }
      })
      .catch(() => {
        setDetailError(t('headquartersPosts.load_failed'));
        setDetailLoading(false);
      });
  }

  function closePost() {
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setComments([]);
    setMediaUrl(null);
    setMediaError(null);
  }

  async function submitComment() {
    if (!selectedId || !commentDraft.trim()) return;
    setCommentSubmitting(true);
    setCommentsError(null);
    try {
      const created = await api.post<CommentRow>(`/api/me/headquarters-posts/${selectedId}/comments`, { body: commentDraft.trim() });
      setComments((prev) => [...prev, created]);
      setCommentDraft('');
      setDetail((prev) => (prev ? { ...prev, commentCount: prev.commentCount + 1 } : prev));
      setItems((prev) => prev.map((i) => (i.id === selectedId ? { ...i, commentCount: i.commentCount + 1 } : i)));
    } catch (err) {
      setCommentsError(err instanceof ApiError ? err.message : t('headquartersPosts.comment_failed'));
    } finally {
      setCommentSubmitting(false);
    }
  }

  async function toggleReaction() {
    if (!selectedId || !detail) return;
    setReacting(true);
    try {
      const method = detail.viewerHasReacted ? 'delete' : 'post';
      const res = await api[method]<{ viewerHasReacted: boolean; reactionCount: number }>(
        `/api/me/headquarters-posts/${selectedId}/reaction`,
      );
      setDetail((prev) => (prev ? { ...prev, viewerHasReacted: res.viewerHasReacted, reactionCount: res.reactionCount } : prev));
      setItems((prev) =>
        prev.map((i) =>
          i.id === selectedId ? { ...i, viewerHasReacted: res.viewerHasReacted, reactionCount: res.reactionCount } : i,
        ),
      );
    } catch {
      // Best-effort: a failed reaction toggle never affects the already
      // -rendered detail content.
    } finally {
      setReacting(false);
    }
  }

  if (loading) return null;
  if (!error && items.length === 0) return null;

  const isFr = i18n.language.startsWith('fr');

  if (selectedId) {
    return (
      <div className={variant === 'feed' ? 'border-t-4 border-amber-400 bg-white p-4 shadow-sm sm:rounded-xl' : 'card mt-6'}>
        <button className="mb-4 text-sm text-brand-700 hover:underline" onClick={closePost}>
          {t('headquartersPosts.back_to_list')}
        </button>
        {detailLoading && <p className="text-sm text-slate-400">{t('headquartersPosts.loading')}</p>}
        {detailError && <p className="text-sm text-red-700">{detailError}</p>}
        {detail && (
          <>
            <p className="mb-1 text-xs font-medium text-brand-700">
              {t(detail.networkWide ? 'headquartersPosts.source_network_wide' : 'headquartersPosts.source_targeted')}
            </p>
            <h2 className="mb-1 font-semibold text-brand-900">{isFr ? detail.titleFr || detail.titleEn : detail.titleEn}</h2>
            <p className="mb-3 text-xs text-slate-400">{new Date(detail.publishedAt).toLocaleDateString()}</p>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{isFr ? detail.bodyFr || detail.bodyEn : detail.bodyEn}</p>

            {detail.media && (
              <div className="mt-4">
                {mediaLoading && <p className="text-sm text-slate-400">{t('headquartersPosts.media_loading')}</p>}
                {mediaError && <p className="text-sm text-red-700">{mediaError}</p>}
                {mediaUrl && detail.media.mediaType === 'IMAGE' && (
                  <img
                    src={mediaUrl}
                    alt={t('headquartersPosts.media_image_alt') ?? ''}
                    className="max-h-96 w-full rounded-lg object-contain"
                  />
                )}
                {mediaUrl && detail.media.mediaType === 'VIDEO' && (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video src={mediaUrl} controls className="w-full rounded-lg" />
                )}
                {mediaUrl && detail.media.mediaType === 'AUDIO' && (
                  <audio src={mediaUrl} controls className="w-full" />
                )}
                {mediaUrl && detail.media.mediaType === 'PDF' && (
                  <a href={mediaUrl} target="_blank" rel="noreferrer" className="btn-secondary inline-block px-4 py-2 text-sm">
                    {t('headquartersPosts.media_pdf_open', { filename: detail.media.originalFilename })}
                  </a>
                )}
                {!mediaLoading && !mediaUrl && !mediaError && (
                  <p className="text-xs text-slate-400">
                    {detail.media.originalFilename} · {formatBytes(detail.media.byteSize)}
                  </p>
                )}
              </div>
            )}

            <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-3">
              <button
                type="button"
                className={detail.viewerHasReacted ? 'btn-primary px-3 py-1.5 text-sm' : 'btn-secondary px-3 py-1.5 text-sm'}
                disabled={reacting}
                onClick={toggleReaction}
              >
                {t(detail.viewerHasReacted ? 'headquartersPosts.reacted_button' : 'headquartersPosts.react_button')}
              </button>
              <span className="text-xs text-slate-400">{t('headquartersPosts.reaction_count', { count: detail.reactionCount })}</span>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-3">
              <h3 className="mb-2 text-sm font-semibold text-brand-900">{t('headquartersPosts.comments_title')}</h3>
              {commentsHasMore && (
                <button
                  type="button"
                  className="mb-2 text-xs text-brand-700 hover:underline"
                  disabled={commentsLoading}
                  onClick={() => selectedId && comments[0] && loadComments(selectedId, comments[0].id)}
                >
                  {t('headquartersPosts.load_earlier_comments')}
                </button>
              )}
              {commentsError && <p className="mb-2 text-sm text-red-700">{commentsError}</p>}
              {comments.length === 0 && !commentsLoading && (
                <p className="mb-2 text-xs text-slate-400">{t('headquartersPosts.no_comments')}</p>
              )}
              <ul className="mb-3 space-y-2">
                {comments.map((c) => (
                  <li key={c.id} className="border-b border-slate-50 pb-2 text-sm">
                    <p className="text-xs font-medium text-brand-700">{c.authorName}</p>
                    <p className="whitespace-pre-wrap text-slate-700">{c.body}</p>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-2 sm:flex-row">
                <textarea
                  className="input"
                  rows={2}
                  placeholder={t('headquartersPosts.comment_placeholder') ?? ''}
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary sm:w-40"
                  disabled={commentSubmitting || !commentDraft.trim()}
                  onClick={submitComment}
                >
                  {t('headquartersPosts.post_comment')}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  if (variant === 'feed') {
    if (error) return <p className="px-4 text-sm text-red-700 sm:px-0">{error}</p>;
    return (
      <section className="space-y-2 sm:space-y-4" aria-label={t('headquartersPosts.title') ?? ''}>
        {items.map((i) => (
          <HeadquartersFeedCard
            key={i.id}
            item={i}
            onOpen={() => openPost(i.id)}
            onReactionChange={(viewerHasReacted, reactionCount) =>
              setItems((prev) => prev.map((x) => (x.id === i.id ? { ...x, viewerHasReacted, reactionCount } : x)))
            }
          />
        ))}
      </section>
    );
  }

  return (
    <div className="card mt-6">
      <h2 className="mb-3 font-semibold text-brand-900">{t('headquartersPosts.title')}</h2>
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!error && (
        <ul className="space-y-2">
          {items.map((i) => {
            const title = isFr ? i.titleFr || i.titleEn : i.titleEn;
            return (
              <li key={i.id} className="flex items-center justify-between gap-2 border-b border-slate-50 pb-2 text-sm">
                <div>
                  <p className="text-xs font-medium text-brand-700">
                    {t(i.networkWide ? 'headquartersPosts.source_network_wide' : 'headquartersPosts.source_targeted')}
                  </p>
                  <p className="font-semibold text-brand-900">{title}</p>
                  <span className="text-xs text-slate-400">{new Date(i.publishedAt).toLocaleDateString()}</span>
                </div>
                <button className="text-brand-700 hover:underline" onClick={() => openPost(i.id)}>
                  {t('headquartersPosts.read_more')}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
