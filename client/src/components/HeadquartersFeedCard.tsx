import { ReactionsSheet, type ReactorList } from './ReactionsSheet';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Avatar } from './Avatar';
import { api, ApiError } from '../lib/api';
import { useMemberAuth } from '../lib/MemberAuthContext';
import { PostMenu } from './PostMenu';
import { useInView } from '../lib/chatMedia';
import { useDataSaver } from '../lib/dataSaver';
import { formatBytes } from '../lib/attachmentLimits';
import { VoiceInputButton } from './VoiceInputButton';
import { RichText } from '../lib/richText';
import { REACTIONS, CommentThread, HEADQUARTERS_COMMENT_ENDPOINTS } from './updates/UpdatesFeed';
import { SocialEmbed, type SocialEmbedInfo } from './updates/SocialEmbed';

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
  /** Set when headquarters corrected the post after it went out. */
  editedAt?: string | null;
  networkWide: boolean;
  commentCount: number;
  reactionCount: number;
  viewerHasReacted: boolean;
  /** Counts by reaction type (LIKE, LOVE, PRAY…) and the viewer's own. */
  reactionCounts?: Record<string, number>;
  myReaction?: string | null;
  media: HeadquartersFeedMedia[];
  /** Which official name it shows (share-into-app). */
  voice?: 'CENTRAL_AUTHORITY' | 'COMMUNICATION_DEPARTMENT';
  /** Posted "as myself": the person's own name, photo and title are shown instead of the official name. */
  author?: { personId: string; name: string; photoUrl: string | null; title: string | null } | null;
  /** A shared TikTok / Instagram / Facebook / YouTube post to play in the feed. */
  embed?: SocialEmbedInfo | null;
}

export interface HeadquartersReactionResult {
  viewerHasReacted: boolean;
  reactionCount: number;
  reactionCounts?: Record<string, number>;
  myReaction?: string | null;
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
          <img src={url} alt={t('headquartersPosts.media_image_alt') ?? ''} className="max-h-[32rem] w-full bg-slate-100 object-contain" onError={() => setFailed(true)} />
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
  onCommentCountChange,
  onEdited,
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
  onReactionChange: (result: HeadquartersReactionResult) => void;
  /** The thread loaded or grew: keeps the "N comments" count right. */
  onCommentCountChange?: (count: number) => void;
  /** The central admin corrected the post from its ⋯ menu. */
  onEdited?: (changes: Pick<HeadquartersFeedItem, 'titleEn' | 'titleFr' | 'bodyEn' | 'bodyFr' | 'editedAt'>) => void;
}) {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const title = isFr ? item.titleFr || item.titleEn : item.titleEn;
  const body = expanded && detail ? (isFr ? detail.bodyFr || detail.bodyEn : detail.bodyEn) : isFr ? item.bodyFr || item.bodyEn : item.bodyEn;
  const [busy, setBusy] = useState(false);
  const [showWho, setShowWho] = useState(false);
  const date = new Date(item.publishedAt).toLocaleDateString(isFr ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // The central admin (who publishes these posts) can correct one from its ⋯ menu, like editing a
  // message on WhatsApp: the change shows to everyone, marked "edited", without a new notification.
  const { member } = useMemberAuth();
  const canEdit = Boolean(member?.isCentralAdmin);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ titleEn: '', bodyEn: '', titleFr: '', bodyFr: '' });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  function startEdit() {
    const src = detail ?? item;
    setForm({ titleEn: src.titleEn, bodyEn: src.bodyEn, titleFr: src.titleFr ?? '', bodyFr: src.bodyFr ?? '' });
    setEditError(null);
    setEditing(true);
  }

  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setEditError(null);
    try {
      const res = await api.patch<{ titleEn: string; titleFr: string | null; bodyEn: string; bodyFr: string | null; editedAt: string | null }>(
        `/api/member/central-headquarters-posts/${item.id}`,
        { titleEn: form.titleEn.trim(), bodyEn: form.bodyEn.trim(), titleFr: form.titleFr.trim() || null, bodyFr: form.bodyFr.trim() || null },
      );
      onEdited?.({ titleEn: res.titleEn, titleFr: res.titleFr, bodyEn: res.bodyEn, bodyFr: res.bodyFr, editedAt: res.editedAt });
      setEditing(false);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : t('headquartersPosts.edit_failed'));
    } finally {
      setSaving(false);
    }
  }

  const firstMedia = item.media[0] ?? null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const counts = item.reactionCounts ?? (item.reactionCount > 0 ? { LIKE: item.reactionCount } : {});
  const mine = REACTIONS.find((r) => r.type === (item.myReaction ?? (item.viewerHasReacted ? 'LIKE' : null)));
  const topEmojis = REACTIONS.filter((r) => (counts[r.type] ?? 0) > 0).map((r) => r.emoji).join('') || '👍';

  // Picking the reaction you already have takes it back; another one changes it.
  async function react(type: string) {
    setPickerOpen(false);
    setBusy(true);
    try {
      const res = mine?.type === type
        ? await api.delete<HeadquartersReactionResult>(`/api/me/headquarters-posts/${item.id}/reaction`)
        : await api.post<HeadquartersReactionResult>(`/api/me/headquarters-posts/${item.id}/reaction`, { type });
      onReactionChange(res);
    } catch {
      /* the card stays as it was */
    } finally {
      setBusy(false);
    }
  }

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
      aria-label={t('headquartersPosts.post_label', { title: title || t('headquartersPosts.hq_name') }) ?? ''}
    >
      <header className="flex items-center gap-3 px-4 pt-3">
        {item.author ? (
          <Avatar name={item.author.name} photoUrl={item.author.photoUrl} size={44} />
        ) : (
          <img src="/icons/icon-192.png" alt="" className="h-11 w-11 rounded-full border border-slate-200 bg-white object-contain p-0.5" />
        )}
        <div className="min-w-0 flex-1">
          {item.author ? (
            <p className="truncate font-semibold text-slate-900" data-testid="hq-post-author">
              <Link to={`/member/people/${item.author.personId}`} className="hover:underline">
                {item.author.name}
              </Link>
              {item.author.title && <span className="ml-1 text-xs font-normal text-slate-500">· {item.author.title}</span>}
            </p>
          ) : (
            <p className="flex items-center gap-1 truncate font-semibold text-slate-900">
              {item.voice === 'COMMUNICATION_DEPARTMENT' ? t('headquartersPosts.comm_dept_name') : t('headquartersPosts.hq_name')}
              <span className="rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white" aria-label={t('headquartersPosts.official') ?? ''}>
                ✓
              </span>
            </p>
          )}
          <p className="text-xs text-slate-500">
            📌 {t('headquartersPosts.pinned')} · {date}
            {item.editedAt ? ` · ${t('headquartersPosts.edited')}` : ''}
          </p>
        </div>
        {canEdit && !editing && <PostMenu items={[{ label: `✏️ ${t('headquartersPosts.edit')}`, onSelect: startEdit }]} testId="hq-post-menu" />}
      </header>

      {editing && (
        <form onSubmit={saveEdit} className="space-y-2 px-4 pt-3" data-testid="hq-post-edit-form">
          <label className="label" htmlFor={`hq-edit-title-en-${item.id}`}>{t('admin.headquartersPosts.title_en_label')}</label>
          <input id={`hq-edit-title-en-${item.id}`} className="input" value={form.titleEn} onChange={(e) => setForm((f) => ({ ...f, titleEn: e.target.value }))} />
          <label className="label" htmlFor={`hq-edit-body-en-${item.id}`}>{t('admin.headquartersPosts.body_en_label')}</label>
          <textarea id={`hq-edit-body-en-${item.id}`} className="input min-h-[7rem]" value={form.bodyEn} onChange={(e) => setForm((f) => ({ ...f, bodyEn: e.target.value }))} />
          <label className="label" htmlFor={`hq-edit-title-fr-${item.id}`}>{t('admin.headquartersPosts.title_fr_label')}</label>
          <input id={`hq-edit-title-fr-${item.id}`} className="input" value={form.titleFr} onChange={(e) => setForm((f) => ({ ...f, titleFr: e.target.value }))} />
          <label className="label" htmlFor={`hq-edit-body-fr-${item.id}`}>{t('admin.headquartersPosts.body_fr_label')}</label>
          <textarea id={`hq-edit-body-fr-${item.id}`} className="input min-h-[7rem]" value={form.bodyFr} onChange={(e) => setForm((f) => ({ ...f, bodyFr: e.target.value }))} />
          <p className="text-xs text-slate-500">{t('headquartersPosts.edit_hint')}</p>
          {editError && <p className="text-sm text-red-700">{editError}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={saving || !form.titleEn.trim() || !form.bodyEn.trim()}>
              {saving ? t('updates.saving') : t('updates.save_edit')}
            </button>
            <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
              {t('updates.cancel_edit')}
            </button>
          </div>
        </form>
      )}

      <div className="px-4 pt-3">
        {title && <h3 className="text-lg font-bold leading-snug text-brand-900">{title}</h3>}
        {body && (
          <RichText className={`mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800 ${expanded ? '' : firstMedia?.mediaType === 'IMAGE' ? 'line-clamp-2' : 'line-clamp-3'}`} text={body} headings comfort />
        )}
        <button type="button" onClick={expanded ? onCollapse : onOpen} className="mt-1 text-sm font-semibold text-brand-700 hover:underline">
          {t(expanded ? 'headquartersPosts.read_less' : 'headquartersPosts.read_more')}
        </button>
      </div>

      {item.embed && (
        <div className="mt-3 px-4">
          <SocialEmbed embed={item.embed} />
        </div>
      )}

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
              {`${topEmojis} ${item.reactionCount}`}
            </button>
          ) : (
            <span />
          )}
          {showWho && (
            <ReactionsSheet
              load={() => api.get<ReactorList>(`/api/me/headquarters-posts/${item.id}/reactions`)}
              emojiOf={(r) => REACTIONS.find((x) => x.type === r)?.emoji ?? r}
              onLoaded={(l) => {
                if (l.total === item.reactionCount) return;
                const reactionCounts: Record<string, number> = {};
                for (const r of l.items) reactionCounts[r.reaction] = (reactionCounts[r.reaction] ?? 0) + 1;
                const me = l.items.find((r) => r.isMe);
                onReactionChange({ viewerHasReacted: !!me, reactionCount: l.total, reactionCounts, myReaction: me?.reaction ?? null });
              }}
              onRemoveMine={mine ? () => void react(mine.type) : undefined}
              onClose={() => setShowWho(false)}
            />
          )}
          <span>{item.commentCount > 0 ? t('headquartersPosts.comment_count', { count: item.commentCount }) : ''}</span>
        </div>
      )}

      <div className="relative mx-4 mt-2 flex border-t border-slate-200 py-1">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          disabled={busy}
          aria-expanded={pickerOpen}
          aria-pressed={!!mine}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold hover:bg-slate-100 ${mine ? 'text-brand-700' : 'text-slate-600'}`}
        >
          {mine ? `${mine.emoji} ${t(`updates.reaction_${mine.type.toLowerCase()}`)}` : `👍 ${t('headquartersPosts.like')}`}
        </button>
        <button type="button" onClick={expanded ? undefined : onOpen} className="flex-1 rounded-lg py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
          💬 {t('headquartersPosts.comment')}
        </button>
        {pickerOpen && (
          <div role="menu" className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-lg">
            {REACTIONS.map((r) => (
              <button
                key={r.type}
                type="button"
                role="menuitem"
                className={`rounded-full px-1.5 text-2xl transition-transform hover:scale-125 ${mine?.type === r.type ? 'bg-brand-100' : ''}`}
                aria-label={t(`updates.reaction_${r.type.toLowerCase()}`) ?? ''}
                onClick={() => void react(r.type)}
              >
                {r.emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {expanded && (
        <div className="mx-4 mb-3 mt-1 border-t border-slate-100 pt-3">
          <h4 className="mb-2 text-sm font-semibold text-brand-900">{t('headquartersPosts.comments_title')}</h4>
          {/* The same comments as member posts: Like (six reactions) and Reply under each comment. */}
          <CommentThread postId={item.id} canComment endpoints={HEADQUARTERS_COMMENT_ENDPOINTS} onCountChange={(n) => onCommentCountChange?.(n)} />
        </div>
      )}
    </article>
  );
}
