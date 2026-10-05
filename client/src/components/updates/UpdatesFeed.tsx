import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { Avatar } from '../Avatar';
import { YoutubeEmbed } from './YoutubeEmbed';

// The community-wide Updates feed, Facebook-style. Used on the member
// Updates page (with the "write a post" box), on a person's profile
// (authorPersonId), and on the leader and admin dashboards for moderation.
// What each viewer may do (post, delete) comes from the server.

export const REACTIONS = [
  { type: 'LIKE', emoji: '👍' },
  { type: 'LOVE', emoji: '❤️' },
  { type: 'PRAY', emoji: '🙏' },
  { type: 'PRAISE', emoji: '🙌' },
  { type: 'JOY', emoji: '😊' },
  { type: 'SAD', emoji: '😢' },
] as const;
type ReactionType = (typeof REACTIONS)[number]['type'];

interface Author {
  personId: string;
  name: string;
  photoUrl: string | null;
}

export interface UpdateItem {
  id: string;
  author: Author;
  body: string;
  youtubeVideoId: string | null;
  createdAt: string;
  photos: { id: string; url: string }[];
  reactionCounts: Partial<Record<ReactionType, number>>;
  myReaction: ReactionType | null;
  commentCount: number;
  canDelete: boolean;
}

interface FeedResponse {
  viewer: { canPost: boolean; canModerate: boolean; personId: string | null };
  items: UpdateItem[];
  nextBefore: string | null;
}

interface CommentItem {
  id: string;
  author: Author;
  body: string;
  createdAt: string;
  canDelete: boolean;
}

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_PHOTOS = 4;

function formatWhen(iso: string, language: string) {
  return new Date(iso).toLocaleString(language.startsWith('fr') ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------- Composer

function Composer({ onPosted }: { onPosted: () => void }) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const [body, setBody] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [showVideo, setShowVideo] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const picked = Array.from(list);
    for (const f of picked) {
      if (!PHOTO_TYPES.includes(f.type)) return setError(t('updates.photo_wrong_type'));
      if (f.size > MAX_PHOTO_BYTES) return setError(t('updates.photo_too_large'));
    }
    const next = [...files, ...picked];
    if (next.length > MAX_PHOTOS) return setError(t('updates.too_many_photos', { max: MAX_PHOTOS }));
    setFiles(next);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!body.trim() && files.length === 0 && !youtubeUrl.trim()) {
      setError(t('updates.empty_post'));
      return;
    }
    setPosting(true);
    try {
      const photos = [];
      for (const file of files) {
        const auth = await api.post<{ storageKey: string; uploadUrl: string }>('/api/updates/photos/authorize', {
          mimeType: file.type,
          byteSize: file.size,
        });
        const put = await fetch(auth.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
        if (!put.ok) throw new Error('upload failed');
        photos.push({ storageKey: auth.storageKey, mimeType: file.type, byteSize: file.size });
      }
      await api.post('/api/updates', {
        body: body.trim(),
        ...(youtubeUrl.trim() ? { youtubeUrl: youtubeUrl.trim() } : {}),
        photos,
      });
      setBody('');
      setYoutubeUrl('');
      setShowVideo(false);
      setFiles([]);
      onPosted();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVALID_YOUTUBE') setError(t('updates.invalid_youtube'));
      else if (err instanceof ApiError && err.code === 'STORAGE_UNAVAILABLE') setError(t('updates.photos_unavailable'));
      else if (err instanceof ApiError) setError(err.message);
      else setError(t('updates.post_failed'));
    } finally {
      setPosting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <textarea
        className="input min-h-[80px]"
        aria-label={t('updates.compose_label') ?? ''}
        placeholder={t('updates.compose_placeholder') ?? ''}
        value={body}
        maxLength={3000}
        onChange={(e) => setBody(e.target.value)}
      />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs text-slate-600">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-1 rounded bg-slate-100 px-2 py-1">
              {f.name}
              <button
                type="button"
                className="text-slate-500"
                aria-label={t('updates.remove_photo', { name: f.name }) ?? ''}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {showVideo && (
        <input
          className="input"
          aria-label={t('updates.youtube_label') ?? ''}
          placeholder="https://youtu.be/…"
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
        />
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => fileInput.current?.click()} disabled={posting}>
            📷 {t('updates.add_photos')}
          </button>
          <button type="button" className="btn-secondary px-3 py-1.5 text-sm" onClick={() => setShowVideo((v) => !v)} disabled={posting}>
            ▶ {t('updates.add_video')}
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={PHOTO_TYPES.join(',')}
            className="hidden"
            aria-label={t('updates.add_photos') ?? ''}
            onChange={(e) => addFiles(e.target.files)}
          />
        </div>
        <button type="submit" className="btn-primary px-4 py-1.5" disabled={posting}>
          {posting ? t('updates.posting') : t('updates.post')}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- Comments

function Comments({ postId, canComment, onCountChange }: { postId: string; canComment: boolean; onCountChange: (n: number) => void }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<{ items: CommentItem[] }>(`/api/updates/${postId}/comments`)
      .then((res) => {
        setItems(res.items);
        onCountChange(res.items.length);
      })
      .catch(() => setError(t('updates.comments_failed')));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [postId]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/api/updates/${postId}/comments`, { body: draft.trim() });
      setDraft('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('updates.comment_failed'));
    } finally {
      setSending(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('updates.confirm_delete_comment') ?? '')) return;
    try {
      await api.delete(`/api/updates/comments/${id}`);
      load();
    } catch {
      setError(t('updates.delete_failed'));
    }
  }

  return (
    <div className="space-y-2 border-t border-slate-100 pt-3">
      {items === null && !error && <p className="text-sm text-slate-400">{t('updates.loading')}</p>}
      {items?.map((c) => (
        <div key={c.id} className="flex gap-2">
          <Avatar name={c.author.name} photoUrl={c.author.photoUrl} size={28} />
          <div className="min-w-0 flex-1 rounded-lg bg-slate-50 px-3 py-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-slate-800">{c.author.name}</span>
              <span className="text-xs text-slate-400">{formatWhen(c.createdAt, i18n.language)}</span>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{c.body}</p>
            {c.canDelete && (
              <button type="button" className="text-xs text-red-700 underline" onClick={() => remove(c.id)}>
                {t('updates.delete')}
              </button>
            )}
          </div>
        </div>
      ))}
      {canComment && (
        <form onSubmit={send} className="flex gap-2">
          <input
            className="input flex-1"
            aria-label={t('updates.comment_label') ?? ''}
            placeholder={t('updates.comment_placeholder') ?? ''}
            value={draft}
            maxLength={1000}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="btn-primary px-3" disabled={sending || !draft.trim()}>
            {t('updates.send')}
          </button>
        </form>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Post card

function PostCard({
  item,
  canReact,
  onDeleted,
  linkAuthors,
}: {
  item: UpdateItem;
  canReact: boolean;
  onDeleted: (id: string) => void;
  linkAuthors: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [myReaction, setMyReaction] = useState<ReactionType | null>(item.myReaction);
  const [counts, setCounts] = useState(item.reactionCounts);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(item.commentCount);
  const [error, setError] = useState<string | null>(null);

  const totalReactions = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const topEmojis = REACTIONS.filter((r) => (counts[r.type] ?? 0) > 0).map((r) => r.emoji).join('');

  async function react(type: ReactionType) {
    setPickerOpen(false);
    setError(null);
    const previous = myReaction;
    const next = previous === type ? null : type;
    // Update the screen straight away; undo if the server says no.
    const adjusted = { ...counts };
    if (previous) adjusted[previous] = Math.max(0, (adjusted[previous] ?? 1) - 1);
    if (next) adjusted[next] = (adjusted[next] ?? 0) + 1;
    for (const k of Object.keys(adjusted) as ReactionType[]) if (!adjusted[k]) delete adjusted[k];
    setCounts(adjusted);
    setMyReaction(next);
    try {
      if (next) await api.put(`/api/updates/${item.id}/reaction`, { type: next });
      else await api.delete(`/api/updates/${item.id}/reaction`);
    } catch {
      setCounts(counts);
      setMyReaction(previous);
      setError(t('updates.react_failed'));
    }
  }

  async function remove() {
    if (!window.confirm(t('updates.confirm_delete_post') ?? '')) return;
    try {
      await api.delete(`/api/updates/${item.id}`);
      onDeleted(item.id);
    } catch {
      setError(t('updates.delete_failed'));
    }
  }

  const mine = REACTIONS.find((r) => r.type === myReaction);

  return (
    <article className="card space-y-3" aria-label={t('updates.post_by', { name: item.author.name }) ?? ''}>
      <header className="flex items-center gap-3">
        <Avatar name={item.author.name} photoUrl={item.author.photoUrl} size={40} />
        <div className="min-w-0 flex-1">
          {linkAuthors ? (
            <Link to={`/member/people/${item.author.personId}`} className="block truncate font-semibold text-slate-800 hover:underline">
              {item.author.name}
            </Link>
          ) : (
            <p className="truncate font-semibold text-slate-800">{item.author.name}</p>
          )}
          <p className="text-xs text-slate-400">{formatWhen(item.createdAt, i18n.language)}</p>
        </div>
        {item.canDelete && (
          <button type="button" className="text-sm text-red-700 underline" onClick={remove}>
            {t('updates.delete')}
          </button>
        )}
      </header>

      {item.body && <p className="whitespace-pre-wrap break-words text-slate-800">{item.body}</p>}

      {item.photos.length > 0 && (
        <div className={`grid gap-1 ${item.photos.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {item.photos.map((p) => (
            <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
              <img src={p.url} alt="" loading="lazy" className="max-h-96 w-full rounded-lg object-cover" />
            </a>
          ))}
        </div>
      )}

      {item.youtubeVideoId && <YoutubeEmbed videoId={item.youtubeVideoId} />}

      {(totalReactions > 0 || commentCount > 0) && (
        <div className="flex justify-between text-xs text-slate-500">
          <span>{totalReactions > 0 ? `${topEmojis} ${totalReactions}` : ''}</span>
          <span>{commentCount > 0 ? t('updates.comment_count', { count: commentCount }) : ''}</span>
        </div>
      )}

      <div className="relative flex gap-2 border-t border-slate-100 pt-2">
        {canReact && (
          <button
            type="button"
            className={`btn-secondary flex-1 py-1.5 text-sm ${myReaction ? 'font-semibold text-brand-700' : ''}`}
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
          >
            {mine ? `${mine.emoji} ${t(`updates.reaction_${mine.type.toLowerCase()}`)}` : `👍 ${t('updates.react')}`}
          </button>
        )}
        <button type="button" className="btn-secondary flex-1 py-1.5 text-sm" onClick={() => setShowComments((v) => !v)}>
          💬 {t('updates.comments')}
        </button>
        {pickerOpen && (
          <div role="menu" className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow">
            {REACTIONS.map((r) => (
              <button
                key={r.type}
                type="button"
                role="menuitem"
                className={`rounded-full px-1.5 text-2xl ${myReaction === r.type ? 'bg-brand-100' : ''}`}
                aria-label={t(`updates.reaction_${r.type.toLowerCase()}`) ?? ''}
                onClick={() => react(r.type)}
              >
                {r.emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {showComments && <Comments postId={item.id} canComment={canReact} onCountChange={setCommentCount} />}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </article>
  );
}

// ---------------------------------------------------------------- Feed

export function UpdatesFeed({
  authorPersonId,
  showComposer = true,
  friendsOnly = false,
  linkAuthors = false,
}: {
  authorPersonId?: string;
  showComposer?: boolean;
  /** Only posts from the viewer's friends (and the viewer). */
  friendsOnly?: boolean;
  /** Make author names open their profile (member pages only). */
  linkAuthors?: boolean;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<FeedResponse | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = [
    authorPersonId ? `authorPersonId=${encodeURIComponent(authorPersonId)}` : '',
    friendsOnly ? 'friends=true' : '',
  ]
    .filter(Boolean)
    .join('&');

  function load() {
    setError(null);
    api
      .get<FeedResponse>(`/api/updates${query ? `?${query}` : ''}`)
      .then(setData)
      .catch(() => setError(t('updates.load_failed')));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [authorPersonId, friendsOnly]);

  async function loadMore() {
    if (!data?.nextBefore) return;
    setLoadingMore(true);
    try {
      const more = await api.get<FeedResponse>(
        `/api/updates?before=${encodeURIComponent(data.nextBefore)}${query ? `&${query}` : ''}`,
      );
      setData({ ...more, items: [...data.items, ...more.items] });
    } catch {
      setError(t('updates.load_failed'));
    } finally {
      setLoadingMore(false);
    }
  }

  function removeLocally(id: string) {
    if (data) setData({ ...data, items: data.items.filter((i) => i.id !== id) });
  }

  return (
    <div className="space-y-4">
      {showComposer && data?.viewer.canPost && <Composer onPosted={load} />}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="text-center text-slate-400">{t('updates.loading')}</p>}
      {data && data.items.length === 0 && <p className="text-center text-slate-500">{t('updates.empty')}</p>}
      {data?.items.map((item) => (
        <PostCard key={item.id} item={item} canReact={data.viewer.canPost} onDeleted={removeLocally} linkAuthors={linkAuthors} />
      ))}
      {data?.nextBefore && (
        <button type="button" className="btn-secondary w-full" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? t('updates.loading') : t('updates.load_more')}
        </button>
      )}
    </div>
  );
}
