import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useInView } from '../lib/chatMedia';
import { useDataSaver } from '../lib/dataSaver';

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
  media: { mediaType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'PDF'; originalFilename: string; byteSize: number } | null;
}

function HeadquartersImage({ postId, onOpen }: { postId: string; onOpen: () => void }) {
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
      .get<{ url: string }>(`/api/me/headquarters-posts/${postId}/media/download-url`)
      .then((r) => setUrl(r.url))
      .catch(() => setFailed(true));
  }, [inView, url, postId, saver, wanted]);

  return (
    <div ref={ref} className="bg-slate-100">
      {url && !failed ? (
        <button type="button" onClick={onOpen} className="block w-full" aria-label={t('headquartersPosts.media_image_alt') ?? ''}>
          <img src={url} alt={t('headquartersPosts.media_image_alt') ?? ''} className="max-h-[32rem] w-full object-cover" onError={() => setFailed(true)} />
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
// shown big, and Like / Comment. "Read more" opens the full post.
export function HeadquartersFeedCard({
  item,
  onOpen,
  onReactionChange,
}: {
  item: HeadquartersFeedItem;
  onOpen: () => void;
  onReactionChange: (viewerHasReacted: boolean, reactionCount: number) => void;
}) {
  const { t, i18n } = useTranslation();
  const isFr = i18n.language.startsWith('fr');
  const title = isFr ? item.titleFr || item.titleEn : item.titleEn;
  const body = isFr ? item.bodyFr || item.bodyEn : item.bodyEn;
  const [busy, setBusy] = useState(false);
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

  const mediaLabel =
    item.media?.mediaType === 'VIDEO'
      ? `▶ ${t('headquartersPosts.video_tap')}`
      : item.media?.mediaType === 'AUDIO'
        ? `🎧 ${t('headquartersPosts.audio_tap')}`
        : item.media?.mediaType === 'PDF'
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
        {body && <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800">{body}</p>}
        <button type="button" onClick={onOpen} className="mt-1 text-sm font-semibold text-brand-700 hover:underline">
          {t('headquartersPosts.read_more')}
        </button>
      </div>

      {item.media?.mediaType === 'IMAGE' && (
        <div className="mt-3">
          <HeadquartersImage postId={item.id} onOpen={onOpen} />
        </div>
      )}
      {mediaLabel && (
        <button type="button" onClick={onOpen} className="mx-4 mt-3 flex w-[calc(100%-2rem)] items-center gap-2 rounded-lg bg-slate-100 px-3 py-3 text-left text-sm font-medium text-slate-700">
          {mediaLabel}
        </button>
      )}

      {(item.reactionCount > 0 || item.commentCount > 0) && (
        <div className="flex justify-between px-4 pt-2 text-sm text-slate-500">
          <span>{item.reactionCount > 0 ? `👍 ${item.reactionCount}` : ''}</span>
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
        <button type="button" onClick={onOpen} className="flex-1 rounded-lg py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
          💬 {t('headquartersPosts.comment')}
        </button>
      </div>
    </article>
  );
}
