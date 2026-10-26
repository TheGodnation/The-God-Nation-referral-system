import { ReactionsSheet, type ReactorList } from './ReactionsSheet';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useInView } from '../lib/chatMedia';
import { useDataSaver } from '../lib/dataSaver';
import { formatBytes } from '../lib/attachmentLimits';
import { VoiceInputButton } from './VoiceInputButton';
import { RichText } from '../lib/richText';

export interface HeadquartersFeedMedia {
  id: string;
  mediaType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'PDF';
  originalFilename: string;
  byteSize: number;
}

export interface HeadquartersFeedItem {
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
  media: HeadquartersFeedMedia[];
}

export interface HeadquartersFeedComment {
  id: string;
  authorName: string;
  isOwn: boolean;
  body: string;
  createdAt: string;
}

function HeadquartersImage({ postId, mediaId, extraCount, onOpen }: { postId: string; mediaId: string; extraCount: number; onOpen: () => void }) {
  const { t } = useTranslation();
  const [ref, inView] = useInView<HTMLDivElement>();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const saver = useDataSaver();
  const [wanted, setWanted] = useState(false);

  useEffect(() => {
    // "Save data": wait for a tap before downloading the photo.
    if (!inView || url || (saver && !wanted)) return;
    api
      .get<{ url: string }>(`/api/me/headquarters-posts/${postId}/media/${mediaId}/download-url`)
      .then((r) => setUrl(r.url))
      .catch(() => setFailed(true));
  }, [inView, url, postId, mediaId, saver, wanted]);

  return (
    <div ref={ref} className="relative bg-slate-100">
      {url && !failed ? (
        <button type="button" onClick={onOpen} className="block w-full" aria-label={t('headquartersPosts.media_image_alt') ?? ''}>
          <img src={url} alt={t('headquartersPosts.media_image_alt') ?? ''} className="max-h-[32rem] w-full object-cover" onError={() => setFailed(true)} />
          {extraCount > 0 && (
            <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-semibold text-white">+{extraCount}</span>
          )}
        </button>
      ) : (
        <div className="flex aspect-[16/9] w-full flex-col items-center justify-center gap-1 text-sm text-slate-500">
          <span className="text-3xl">📷</span>
          {failed ? (
            t('headquartersPosts.photo_unavailable')
          ) : saver && !wanted ? (
            <button type="button" onClick={() => setWanted(true)} className="rounded-full bg-black/55 px-3 py-1.5 font-semibold text-white">
              ⬇ {t('network.tap_to_load')}
            </button>
          ) : (
            t('headquartersPosts.loading')
          )}
        </div>
      )}
    </div>
  );
}

// One Headquarters post shown in the Updates feed like a proper post: the
// ministry's logo and name, the title, the start of the message, the photo
// shown big, and Like / Comment. "Read more" expands the full post (text,
// every media item, and comments) right here in the same card, Facebook
// style — never a separate page the member has to come "Back" from.
export function HeadquartersFeedCard({
  item,
  expanded,
  detail,
  detailLoading,
  detailError,
  comments,
  commentsLoading,
  commentsError,
  commentsHasMore,
  commentDraft,
  commentSubmitting,
  mediaUrls,
  mediaLoading,
  mediaErrorIds,
  onOpen,
  onCollapse,
  onLoadEarlierComments,
  onCommentDraftChange,
  onSubmitComment,
  onReactionChange,
}: {
  item: HeadquartersFeedItem;
  expanded: boolean;
  detail: HeadquartersFeedItem | null;
  detailLoading: boolean;
  detailError: string | null;
  comments: HeadquartersFeedComment[];
  commentsLoading: boolean;
  commentsError: string | null;
  commentsHasMore: boolean;
  commentDraft: string;
  commentSubmitting: boolean;
  mediaUrls: Record<string, string>;
  mediaLoading: boolean;
  mediaErrorIds: Record<string, boolean>;
  onOpen: () => void;
  onCollapse: () => void;
  onLoadEarlierComments: () => void;
  onCommentDraftChange: (value: string) => void;
  onSubmitComment: () => void;
  onReactionChange: (viewerHasReacted: boolean, reactionCount: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const title = isFr ? item.titleFr || item.titleEn : item.titleEn;
  const body = expanded && detail ? (isFr ? detail.bodyFr || detail.bodyEn : detail.bodyEn) : isFr ? item.bodyFr || item.bodyEn : item.bodyEn;
  const [busy, setBusy] = useState(false);
  const [showWho, setShowWho] = useState(false);
  const date = new Date(item.publishedAt).toLocaleDateString(isFr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  async function toggleLike() {
    setBusy(true);
    try {
      const res = item.viewerHasReacted
        ? await api.delete<{ viewerHasReacted: boolean; reactionCount: number }>(`/api/me/headquarters-posts/${item.id}/reaction`)
        : await api.post<{ viewerHasReacted: boolean; reactionCount: number }>(`/api/me/headquarters-posts/${item.id}/reaction`);
      onReactionChange(res.viewerHasReacted, res.reactionCount);
    } catch {
      /* the card stays as it was */
    } finally {
      setBusy(false);
    }
  }

  const firstMedia = item.media[0] ?? null;
  const mediaLabel =
    firstMedia?.mediaType === 'VIDEO'
      ? `▶ ${t('headquartersPosts.video_tap')}`
      : firstMedia?.mediaType === 'AUDIO'
        ? `🎧 ${t('headquartersPosts.audio_tap')}`
        : firstMedia?.mediaType === 'PDF'
          ? `📄 ${t('headquartersPosts.pdf_tap')}`
          : null;

  return (
    <article
      className="overflow-hidden border-t-4 border-amber-400 bg-white shadow-sm sm:rounded-xl"
      aria-label={t('headquartersPosts.post_label', { title }) ?? ''}
    >
      <header className="flex items-center gap-3 px-4 pt-3">
        <img src="/icons/icon-192.png" alt="" className="h-11 w-11 rounded-full border border-slate-200 bg-white object-contain p-0.5" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 truncate font-semibold text-slate-900">
            {t('headquartersPosts.hq_name')}
            <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white" aria-label={t('headquartersPosts.official') ?? ''}>
              ✓
            </span>
          </p>
          <p className="text-xs text-slate-500">
            📌 {t('headquartersPosts.pinned')} · {date}
          </p>
        </div>
      </header>

      <div className="px-4 pt-3">
        <h3 className="text-lg font-bold leading-snug text-brand-900">{title}</h3>
        {body && (
          <RichText className={`mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800 ${expanded ? '' : 'line-clamp-4'}`} text={body} headings />
        )}
        <button type="button" onClick={expanded ? onCollapse : onOpen} className="mt-1 text-sm font-semibold text-brand-700 hover:underline">
          {t(expanded ? 'headquartersPosts.read_less' : 'headquartersPosts.read_more')}
        </button>
      </div>

      {!expanded && firstMedia?.mediaType === 'IMAGE' && (
        <div className="mt-3">
          <HeadquartersImage postId={item.id} mediaId={firstMedia.id} extraCount={item.media.length - 1} onOpen={onOpen} />
        </div>
      )}
      {!expanded && mediaLabel && (
        <button type="button" onClick={onOpen} className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center gap-2 rounded-lg bg-slate-100 px-3 py-3 text-left text-sm font-medium text-slate-700">
          {mediaLabel}
        </button>
      )}

      {expanded && (
        <div className="px-4">
          {detailLoading && <p className="text-sm text-slate-400">{t('headquartersPosts.loading')}</p>}
          {detailError && <p className="text-sm text-red-700">{detailError}</p>}
          {detail && detail.media.length > 0 && (
            <div className="mt-2 space-y-3">
              {mediaLoading && <p className="text-sm text-slate-400">{t('headquartersPosts.media_loading')}</p>}
              {detail.media.map((m) => {
                const url = mediaUrls[m.id];
                const failed = mediaErrorIds[m.id];
                return (
                  <div key={m.id}>
                    {failed && <p className="text-sm text-red-700">{t('headquartersPosts.media_load_failed')}</p>}
                    {url && m.mediaType === 'IMAGE' && (
                      <img src={url} alt={t('headquartersPosts.media_image_alt') ?? ''} className="max-h-96 w-full rounded-lg object-contain" />
                    )}
                    {url && m.mediaType === 'VIDEO' && (
                      // eslint-disable-next-line jsx-a11y/media-has-caption
                      <video src={url} controls className="w-full rounded-lg" />
                    )}
                    {url && m.mediaType === 'AUDIO' && <audio src={url} controls className="w-full" />}
                    {url && m.mediaType === 'PDF' && (
                      <a href={url} target="_blank" rel="noreferrer" className="btn-secondary inline-block px-4 py-2 text-sm">
                        {t('headquartersPosts.media_pdf_open', { filename: m.originalFilename })}
                      </a>
                    )}
                    {!mediaLoading && !url && !failed && (
                      <p className="text-xs text-slate-400">
                        {m.originalFilename} · {formatBytes(m.byteSize)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {(item.reactionCount > 0 || item.commentCount > 0) && (
        <div className="flex justify-between px-4 pt-2 text-sm text-slate-500">
          {item.reactionCount > 0 ? (
            <button type="button" className="hover:underline" aria-label={t('reactions.who_reacted', { count: item.reactionCount }) ?? ''} onClick={() => setShowWho(true)}>
              👍 {item.reactionCount}
            </button>
          ) : (
            <span />
          )}
          {showWho && (
            <ReactionsSheet
              load={() => api.get<ReactorList>(`/api/me/headquarters-posts/${item.id}/reactions`)}
              emojiOf={() => '👍'}
              onLoaded={(l) => l.total !== item.reactionCount && onReactionChange(l.items.some((r) => r.isMe), l.total)}
              onRemoveMine={item.viewerHasReacted ? () => void toggleLike() : undefined}
              onClose={() => setShowWho(false)}
            />
          )}
          <span>{item.commentCount > 0 ? t('headquartersPosts.comment_count', { count: item.commentCount }) : ''}</span>
        </div>
      )}

      <div className="mx-4 mt-2 flex border-t border-slate-200 py-1">
        <button
          type="button"
          onClick={toggleLike}
          disabled={busy}
          aria-pressed={item.viewerHasReacted}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold hover:bg-slate-100 ${item.viewerHasReacted ? 'text-brand-700' : 'text-slate-600'}`}
        >
          👍 {t('headquartersPosts.like')}
        </button>
        <button type="button" onClick={expanded ? undefined : onOpen} className="flex-1 rounded-lg py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
          💬 {t('headquartersPosts.comment')}
        </button>
      </div>

      {expanded && (
        <div className="mx-4 mb-3 mt-1 border-t border-slate-100 pt-3">
          <h4 className="mb-2 text-sm font-semibold text-brand-900">{t('headquartersPosts.comments_title')}</h4>
          {commentsHasMore && (
            <button type="button" className="mb-2 text-xs text-brand-700 hover:underline" disabled={commentsLoading} onClick={onLoadEarlierComments}>
              {t('headquartersPosts.load_earlier_comments')}
            </button>
          )}
          {commentsError && <p className="mb-2 text-sm text-red-700">{commentsError}</p>}
          {comments.length === 0 && !commentsLoading && <p className="mb-2 text-xs text-slate-400">{t('headquartersPosts.no_comments')}</p>}
          <ul className="mb-3 space-y-2">
            {comments.map((c) => (
              <li key={c.id} className="border-b border-slate-50 pb-2 text-sm">
                <p className="text-xs font-medium text-brand-700">{c.authorName}</p>
                <RichText className="whitespace-pre-wrap text-slate-700" text={c.body} />
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2 sm:flex-row">
            <textarea
              className="input"
              rows={2}
              placeholder={t('headquartersPosts.comment_placeholder') ?? ''}
              value={commentDraft}
              onChange={(e) => onCommentDraftChange(e.target.value)}
            />
            <VoiceInputButton onResult={(transcript) => onCommentDraftChange(commentDraft.trim() ? `${commentDraft.trim()} ${transcript}` : transcript)} />
            <button type="button" className="btn-primary sm:w-40" disabled={commentSubmitting || !commentDraft.trim()} onClick={onSubmitComment}>
              {t('headquartersPosts.post_comment')}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
