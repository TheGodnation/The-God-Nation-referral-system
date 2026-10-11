import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../lib/api';
import { Avatar } from '../Avatar';
import { YoutubeEmbed } from './YoutubeEmbed';
import { baseMime, shrinkPhoto } from '../../lib/chatMedia';
import { useDataSaver } from '../../lib/dataSaver';

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
  /** Set on replies: the comment this one answers. */
  parentCommentId?: string | null;
  author: Author;
  body: string;
  createdAt: string;
  reactionCounts?: Partial<Record<ReactionType, number>>;
  myReaction?: ReactionType | null;
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

/** "Just now", "5 min", "3 h", "Yesterday at 14:05", or the date. */
function relativeWhen(iso: string, t: ReturnType<typeof useTranslation>['t'], language: string) {
  const then = new Date(iso);
  const mins = Math.floor((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return t('updates.time_now');
  if (mins < 60) return t('updates.time_minutes', { count: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('updates.time_hours', { count: hours });
  const locale = language.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const time = then.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (then.toDateString() === yesterday.toDateString()) return t('updates.time_yesterday', { time });
  return formatWhen(iso, language);
}

// ---------------------------------------------------------------- Composer

interface PickedPhoto {
  key: string;
  blob: Blob;
  name: string;
  preview: string | null;
}

function previewUrl(b: Blob): string | null {
  return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(b) : null;
}

function revokeUrl(u: string | null) {
  if (u && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(u);
}

function Composer({ onPosted, wall }: { onPosted: () => void; wall: boolean }) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<PickedPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError(null);
    const picked = Array.from(list);
    if (fileInput.current) fileInput.current.value = '';
    if (files.length + picked.length > MAX_PHOTOS) {
      setError(t('updates.too_many_photos', { max: MAX_PHOTOS }));
      return;
    }
    setPreparing(true);
    const ready: PickedPhoto[] = [];
    for (const f of picked) {
      // Big phone photos are made smaller first so they post quickly.
      const blob = f.type.startsWith('image/') ? await shrinkPhoto(f) : f;
      const type = baseMime(blob.type);
      if (!PHOTO_TYPES.includes(type)) {
        setError(t('updates.photo_wrong_type'));
        setPreparing(false);
        return;
      }
      if (blob.size > MAX_PHOTO_BYTES) {
        setError(t('updates.photo_too_large'));
        setPreparing(false);
        return;
      }
      ready.push({ key: `${f.name}-${f.size}-${Math.random()}`, blob, name: f.name, preview: previewUrl(blob) });
    }
    setFiles((prev) => [...prev, ...ready]);
    setPreparing(false);
  }

  function removeFile(key: string) {
    setFiles((prev) => {
      const gone = prev.find((p) => p.key === key);
      if (gone) revokeUrl(gone.preview);
      return prev.filter((p) => p.key !== key);
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!body.trim() && files.length === 0) {
      setError(t('updates.empty_post'));
      return;
    }
    setPosting(true);
    try {
      const photos = [];
      for (const file of files) {
        const mimeType = baseMime(file.blob.type);
        const auth = await api.post<{ storageKey: string; uploadUrl: string }>('/api/updates/photos/authorize', {
          mimeType,
          byteSize: file.blob.size,
        });
        const put = await fetch(auth.uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: file.blob });
        if (!put.ok) throw new Error('upload failed');
        photos.push({ storageKey: auth.storageKey, mimeType, byteSize: file.blob.size });
      }
      // Members share words and photos only (no YouTube links).
      await api.post('/api/updates', { body: body.trim(), photos });
      setBody('');
      files.forEach((f) => revokeUrl(f.preview));
      setFiles([]);
      if (textRef.current) textRef.current.style.height = '';
      onPosted();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'STORAGE_UNAVAILABLE') setError(t('updates.photos_unavailable'));
      else if (err instanceof ApiError) setError(err.message);
      else setError(t('updates.post_failed'));
    } finally {
      setPosting(false);
    }
  }

  return (
    <form onSubmit={submit} className={`space-y-3 bg-white p-4 shadow-sm ${wall ? 'sm:rounded-xl' : 'rounded-xl border border-slate-100'}`}>
      <textarea
        ref={textRef}
        className="w-full resize-none rounded-2xl border-0 bg-slate-100 px-4 py-3 text-[16px] outline-none focus:ring-2 focus:ring-brand-200"
        rows={2}
        aria-label={t('updates.compose_label') ?? ''}
        placeholder={t('updates.compose_placeholder') ?? ''}
        value={body}
        maxLength={3000}
        onChange={(e) => {
          setBody(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${Math.min(e.target.scrollHeight, 320)}px`;
        }}
      />
      {files.length > 0 && (
        <ul className="grid grid-cols-4 gap-2">
          {files.map((f) => (
            <li key={f.key} className="relative aspect-square overflow-hidden rounded-lg bg-slate-200">
              {f.preview ? (
                <img src={f.preview} alt={f.name} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full items-center justify-center p-1 text-center text-[10px] text-slate-600">{f.name}</span>
              )}
              <button
                type="button"
                className="absolute right-1 top-1 rounded-full bg-black/60 px-1.5 text-xs text-white"
                aria-label={t('updates.remove_photo', { name: f.name }) ?? ''}
                onClick={() => removeFile(f.key)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <div className="flex gap-1">
          <button
            type="button"
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
            onClick={() => fileInput.current?.click()}
            disabled={posting || preparing}
          >
            <span className="text-green-600">🖼️</span> {preparing ? t('updates.loading') : t('updates.add_photos')}
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            aria-label={t('updates.add_photos') ?? ''}
            onChange={(e) => void addFiles(e.target.files)}
          />
        </div>
        <button type="submit" className="btn-primary px-5 py-1.5" disabled={posting || preparing}>
          {posting ? t('updates.posting') : t('updates.post')}
        </button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- Comments

function CommentReactionPicker({ current, onPick }: { current: ReactionType | null; onPick: (type: ReactionType) => void }) {
  const { t } = useTranslation();
  return (
    <div role="menu" className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-lg">
      {REACTIONS.map((r) => (
        <button
          key={r.type}
          type="button"
          role="menuitem"
          className={`rounded-full px-1 text-xl transition-transform hover:scale-125 ${current === r.type ? 'bg-brand-100' : ''}`}
          aria-label={t(`updates.reaction_${r.type.toLowerCase()}`) ?? ''}
          onClick={() => onPick(r.type)}
        >
          {r.emoji}
        </button>
      ))}
    </div>
  );
}

function CommentBubble({
  c,
  canReact,
  small,
  onReply,
  onDelete,
  onReacted,
}: {
  c: CommentItem;
  canReact: boolean;
  small?: boolean;
  onReply: () => void;
  onDelete: () => void;
  onReacted: (counts: CommentItem['reactionCounts'], mine: ReactionType | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const counts = c.reactionCounts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const emojis = REACTIONS.filter((r) => (counts[r.type] ?? 0) > 0).map((r) => r.emoji).join('');
  const mine = REACTIONS.find((r) => r.type === c.myReaction);

  async function react(type: ReactionType) {
    setPickerOpen(false);
    try {
      const res =
        c.myReaction === type
          ? await api.delete<{ reactionCounts: CommentItem['reactionCounts']; myReaction: ReactionType | null }>(`/api/updates/comments/${c.id}/reaction`)
          : await api.put<{ reactionCounts: CommentItem['reactionCounts']; myReaction: ReactionType | null }>(`/api/updates/comments/${c.id}/reaction`, { type });
      onReacted(res.reactionCounts, res.myReaction);
    } catch {
      /* the comment stays as it was */
    }
  }

  return (
    <div className="flex gap-2" aria-label={t('updates.comment_by', { name: c.author.name }) ?? ''} role="group">
      <Avatar name={c.author.name} photoUrl={c.author.photoUrl} size={small ? 24 : 32} />
      <div className="min-w-0 flex-1">
        <div className="relative inline-block max-w-full rounded-2xl bg-slate-100 px-3 py-2">
          <span className="block text-sm font-semibold text-slate-900">{c.author.name}</span>
          <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{c.body}</p>
          {total > 0 && (
            <span className="absolute -bottom-3 right-1 rounded-full border border-slate-200 bg-white px-1.5 text-xs shadow-sm">
              {`${emojis} ${total}`}
            </span>
          )}
        </div>
        <div className="relative mt-1 flex items-center gap-3 pl-2 text-xs font-semibold text-slate-500">
          <span className="font-normal">{relativeWhen(c.createdAt, t, i18n.language)}</span>
          {canReact && (
            <button
              type="button"
              className={mine ? 'text-brand-700' : 'hover:underline'}
              aria-expanded={pickerOpen}
              onClick={() => setPickerOpen((v) => !v)}
            >
              {mine ? `${mine.emoji} ${t(`updates.reaction_${mine.type.toLowerCase()}`)}` : t('updates.like')}
            </button>
          )}
          {canReact && (
            <button type="button" className="hover:underline" onClick={onReply}>
              {t('updates.reply')}
            </button>
          )}
          {c.canDelete && (
            <button type="button" className="text-red-700 hover:underline" onClick={onDelete}>
              {t('updates.delete')}
            </button>
          )}
          {pickerOpen && <CommentReactionPicker current={c.myReaction ?? null} onPick={(type) => void react(type)} />}
        </div>
      </div>
    </div>
  );
}

function CommentForm({
  postId,
  parent,
  onCancel,
  onSent,
  autoFocus,
}: {
  postId: string;
  parent: { id: string; name: string } | null;
  onCancel?: () => void;
  onSent: () => void;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.post(`/api/updates/${postId}/comments`, { body: draft.trim(), ...(parent ? { parentCommentId: parent.id } : {}) });
      setDraft('');
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('updates.comment_failed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} className="space-y-1">
      {parent && (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          {t('updates.replying_to', { name: parent.name })}
          <button type="button" className="font-semibold hover:underline" onClick={onCancel}>
            {t('updates.cancel')}
          </button>
        </p>
      )}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-full border-0 bg-slate-100 px-4 py-2 text-[15px] outline-none focus:ring-2 focus:ring-brand-200"
          aria-label={(parent ? t('updates.reply_label', { name: parent.name }) : t('updates.comment_label')) ?? ''}
          placeholder={(parent ? t('updates.reply_placeholder') : t('updates.comment_placeholder')) ?? ''}
          value={draft}
          maxLength={1000}
          autoFocus={autoFocus}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn-primary rounded-full px-4" disabled={sending || !draft.trim()}>
          {t('updates.send')}
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </form>
  );
}

// Comments under a post, Facebook-style: each comment has Like (six
// reactions, with counts) and Reply. Replies sit just under the comment
// they answer.
function Comments({ postId, canComment, onCountChange }: { postId: string; canComment: boolean; onCountChange: (n: number) => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);

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

  async function remove(id: string) {
    if (!window.confirm(t('updates.confirm_delete_comment') ?? '')) return;
    try {
      await api.delete(`/api/updates/comments/${id}`);
      load();
    } catch {
      setError(t('updates.delete_failed'));
    }
  }

  function setReaction(id: string, reactionCounts: CommentItem['reactionCounts'], myReaction: ReactionType | null) {
    setItems((prev) => prev?.map((c) => (c.id === id ? { ...c, reactionCounts, myReaction } : c)) ?? prev);
  }

  const all = items ?? [];
  const ids = new Set(all.map((c) => c.id));
  // A reply whose top comment was removed is shown as a normal comment.
  const tops = all.filter((c) => !c.parentCommentId || !ids.has(c.parentCommentId));
  const repliesOf = (id: string) => all.filter((c) => c.parentCommentId === id);

  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      {items === null && !error && <p className="text-sm text-slate-400">{t('updates.loading')}</p>}
      {tops.map((c) => (
        <div key={c.id} className="space-y-3">
          <CommentBubble
            c={c}
            canReact={canComment}
            onReply={() => setReplyTo({ id: c.id, name: c.author.name })}
            onDelete={() => void remove(c.id)}
            onReacted={(counts, mine) => setReaction(c.id, counts, mine)}
          />
          {(repliesOf(c.id).length > 0 || replyTo?.id === c.id) && (
            <div className="ml-10 space-y-3">
              {repliesOf(c.id).map((r) => (
                <CommentBubble
                  key={r.id}
                  c={r}
                  small
                  canReact={canComment}
                  onReply={() => setReplyTo({ id: c.id, name: r.author.name })}
                  onDelete={() => void remove(r.id)}
                  onReacted={(counts, mine) => setReaction(r.id, counts, mine)}
                />
              ))}
              {replyTo?.id === c.id && canComment && (
                <CommentForm
                  postId={postId}
                  parent={replyTo}
                  autoFocus
                  onCancel={() => setReplyTo(null)}
                  onSent={() => {
                    setReplyTo(null);
                    load();
                  }}
                />
              )}
            </div>
          )}
        </div>
      ))}
      {canComment && <CommentForm postId={postId} parent={null} onSent={load} />}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- Photos

function PhotoTile({ url, onOpen, className }: { url: string; onOpen: () => void; className: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const saver = useDataSaver();
  const [wanted, setWanted] = useState(false);
  // "Save data": the photo only downloads after a tap.
  if (saver && !wanted) {
    return (
      <button
        type="button"
        onClick={() => setWanted(true)}
        className={`relative flex flex-col items-center justify-center gap-1 bg-slate-200 text-sm font-semibold text-slate-600 ${className}`}
        aria-label={t('network.tap_to_load_photo') ?? ''}
      >
        <span className="text-2xl">📷</span>⬇ {t('network.tap_to_load')}
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen} className={`relative block overflow-hidden bg-slate-200 ${className}`} aria-label={t('updates.open_photo') ?? ''}>
      {state !== 'failed' && (
        <img
          src={url}
          alt=""
          loading="lazy"
          onLoad={() => setState('ok')}
          onError={() => setState('failed')}
          className={`h-full w-full object-cover transition-opacity ${state === 'ok' ? 'opacity-100' : 'opacity-0'}`}
        />
      )}
      {state === 'loading' && <span className="absolute inset-0 animate-pulse bg-slate-200" aria-hidden />}
      {state === 'failed' && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-2 text-center text-xs text-slate-500">
          <span className="text-2xl">📷</span>
          {t('updates.photo_unavailable')}
        </span>
      )}
    </button>
  );
}

/** Facebook-style photo layout: 1 big, 2 side by side, 3 as one tall + two
 * small, 4 as a square grid. */
function PhotoLayout({ photos, onOpen }: { photos: { id: string; url: string }[]; onOpen: (index: number) => void }) {
  if (photos.length === 1) {
    return <PhotoTile url={photos[0].url} onOpen={() => onOpen(0)} className="aspect-[4/3] max-h-[36rem] w-full" />;
  }
  if (photos.length === 3) {
    return (
      <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-0.5">
        <PhotoTile url={photos[0].url} onOpen={() => onOpen(0)} className="row-span-2 h-full" />
        <PhotoTile url={photos[1].url} onOpen={() => onOpen(1)} className="h-full" />
        <PhotoTile url={photos[2].url} onOpen={() => onOpen(2)} className="h-full" />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-0.5">
      {photos.map((p, i) => (
        <PhotoTile key={p.id} url={p.url} onOpen={() => onOpen(i)} className="aspect-square" />
      ))}
    </div>
  );
}

/** Full-screen photo viewer: swipe or use the arrows to move between a
 * post's photos. */
function PhotoViewer({ photos, start, onClose }: { photos: { id: string; url: string }[]; start: number; onClose: () => void }) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(start);
  const touchX = useRef<number | null>(null);
  const go = (d: number) => setIndex((i) => Math.min(photos.length - 1, Math.max(0, i + d)));

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="dialog"
      aria-label={t('updates.photo_viewer') ?? ''}
      className="fixed inset-0 z-50 flex flex-col bg-black"
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
        touchX.current = null;
      }}
    >
      <div className="flex items-center justify-between p-3 text-white">
        <span className="text-sm">{photos.length > 1 ? `${index + 1} / ${photos.length}` : ''}</span>
        <button type="button" onClick={onClose} aria-label={t('updates.close') ?? ''} className="text-2xl">
          ✕
        </button>
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        <img src={photos[index].url} alt="" className="max-h-full max-w-full object-contain" />
        {index > 0 && (
          <button type="button" onClick={() => go(-1)} aria-label={t('updates.prev_photo') ?? ''} className="absolute left-2 rounded-full bg-white/20 px-3 py-2 text-2xl text-white">
            ‹
          </button>
        )}
        {index < photos.length - 1 && (
          <button type="button" onClick={() => go(1)} aria-label={t('updates.next_photo') ?? ''} className="absolute right-2 rounded-full bg-white/20 px-3 py-2 text-2xl text-white">
            ›
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Post card

const LONG_POST_CHARS = 300;

function PostCard({
  item,
  canReact,
  onDeleted,
  linkAuthors,
  wall,
}: {
  item: UpdateItem;
  canReact: boolean;
  onDeleted: (id: string) => void;
  linkAuthors: boolean;
  wall: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [myReaction, setMyReaction] = useState<ReactionType | null>(item.myReaction);
  const [counts, setCounts] = useState(item.reactionCounts);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(item.commentCount);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [viewerAt, setViewerAt] = useState<number | null>(null);

  const totalReactions = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const topEmojis = REACTIONS.filter((r) => (counts[r.type] ?? 0) > 0).map((r) => r.emoji).join('');
  const isLong = item.body.length > LONG_POST_CHARS || item.body.split('\n').length > 7;

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
    <article
      className={wall ? 'bg-white shadow-sm sm:rounded-xl' : 'card overflow-hidden p-0 sm:p-0'}
      aria-label={t('updates.post_by', { name: item.author.name }) ?? ''}
    >
      <header className="flex items-center gap-3 px-4 pt-3">
        <Avatar name={item.author.name} photoUrl={item.author.photoUrl} size={42} />
        <div className="min-w-0 flex-1">
          {linkAuthors ? (
            <Link to={`/member/people/${item.author.personId}`} className="block truncate font-semibold text-slate-900 hover:underline">
              {item.author.name}
            </Link>
          ) : (
            <p className="truncate font-semibold text-slate-900">{item.author.name}</p>
          )}
          <p className="text-xs text-slate-500" title={formatWhen(item.createdAt, i18n.language)}>
            {relativeWhen(item.createdAt, t, i18n.language)} · 🌍
          </p>
        </div>
        {item.canDelete && (
          <button type="button" className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label={t('updates.delete') ?? ''} title={t('updates.delete') ?? ''} onClick={remove}>
            🗑
          </button>
        )}
      </header>

      {item.body && (
        <div className="px-4 pt-2">
          <p className={`whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-900 ${isLong && !expanded ? 'line-clamp-6' : ''}`}>{item.body}</p>
          {isLong && (
            <button type="button" className="text-sm font-semibold text-slate-500 hover:underline" onClick={() => setExpanded((v) => !v)}>
              {expanded ? t('updates.see_less') : t('updates.see_more')}
            </button>
          )}
        </div>
      )}

      {item.photos.length > 0 && (
        <div className="mt-3">
          <PhotoLayout photos={item.photos} onOpen={setViewerAt} />
        </div>
      )}

      {item.youtubeVideoId && (
        <div className="mt-3 px-4">
          <YoutubeEmbed videoId={item.youtubeVideoId} />
        </div>
      )}

      {(totalReactions > 0 || commentCount > 0) && (
        <div className="flex items-center justify-between px-4 pt-2 text-sm text-slate-500">
          <span>{totalReactions > 0 ? `${topEmojis} ${totalReactions}` : ''}</span>
          {commentCount > 0 ? (
            <button type="button" className="hover:underline" onClick={() => setShowComments(true)}>
              {t('updates.comment_count', { count: commentCount })}
            </button>
          ) : (
            <span />
          )}
        </div>
      )}

      <div className="relative mx-4 mt-2 flex border-t border-slate-200 py-1">
        {canReact && (
          <button
            type="button"
            className={`flex-1 rounded-lg py-2 text-sm font-semibold hover:bg-slate-100 ${myReaction ? 'text-brand-700' : 'text-slate-600'}`}
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
          >
            {mine ? `${mine.emoji} ${t(`updates.reaction_${mine.type.toLowerCase()}`)}` : `👍 ${t('updates.react')}`}
          </button>
        )}
        <button type="button" className="flex-1 rounded-lg py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100" onClick={() => setShowComments((v) => !v)}>
          💬 {t('updates.comments')}
        </button>
        {pickerOpen && (
          <div role="menu" className="absolute bottom-full left-0 z-10 mb-1 flex gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 shadow-lg">
            {REACTIONS.map((r) => (
              <button
                key={r.type}
                type="button"
                role="menuitem"
                className={`rounded-full px-1.5 text-2xl transition-transform hover:scale-125 ${myReaction === r.type ? 'bg-brand-100' : ''}`}
                aria-label={t(`updates.reaction_${r.type.toLowerCase()}`) ?? ''}
                onClick={() => react(r.type)}
              >
                {r.emoji}
              </button>
            ))}
          </div>
        )}
      </div>

      {showComments && (
        <div className="px-4 pb-3">
          <Comments postId={item.id} canComment={canReact} onCountChange={setCommentCount} />
        </div>
      )}
      {error && <p className="px-4 pb-3 text-sm text-red-700">{error}</p>}
      {viewerAt !== null && <PhotoViewer photos={item.photos} start={viewerAt} onClose={() => setViewerAt(null)} />}
    </article>
  );
}

// ---------------------------------------------------------------- Feed

const NEW_POSTS_CHECK_MS = 2 * 60 * 1000;

export function UpdatesFeed({
  authorPersonId,
  showComposer = true,
  friendsOnly = false,
  linkAuthors = false,
  wall = false,
}: {
  authorPersonId?: string;
  showComposer?: boolean;
  /** Only posts from the viewer's friends (and the viewer). */
  friendsOnly?: boolean;
  /** Make author names open their profile (member pages only). */
  linkAuthors?: boolean;
  /** Facebook-style wall look: edge-to-edge white posts on a grey page. */
  wall?: boolean;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<FeedResponse | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newer, setNewer] = useState<FeedResponse | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const dataRef = useRef<FeedResponse | null>(null);
  dataRef.current = data;
  const newerRef = useRef<FeedResponse | null>(null);
  newerRef.current = newer;

  const query = [
    authorPersonId ? `authorPersonId=${encodeURIComponent(authorPersonId)}` : '',
    friendsOnly ? 'friends=true' : '',
  ]
    .filter(Boolean)
    .join('&');

  function load() {
    setError(null);
    setNewer(null);
    api
      .get<FeedResponse>(`/api/updates${query ? `?${query}` : ''}`)
      .then(setData)
      .catch(() => setError(t('updates.load_failed')));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [authorPersonId, friendsOnly]);

  async function loadMore() {
    const current = dataRef.current;
    if (!current?.nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await api.get<FeedResponse>(
        `/api/updates?before=${encodeURIComponent(current.nextBefore)}${query ? `&${query}` : ''}`,
      );
      setData((prev) => (prev ? { ...more, items: [...prev.items, ...more.items.filter((m) => !prev.items.some((p) => p.id === m.id))] } : more));
    } catch {
      setError(t('updates.load_failed'));
    } finally {
      setLoadingMore(false);
    }
  }

  // Keep scrolling: older posts load by themselves near the bottom.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !data?.nextBefore || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    }, { rootMargin: '600px' });
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.nextBefore, loadingMore]);

  // Every couple of minutes, quietly ask for just the newest post (very
  // little data); if it's new, offer a "New posts" button that loads them.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || !dataRef.current || newerRef.current) return;
      api
        .get<FeedResponse>(`/api/updates?limit=1${query ? `&${query}` : ''}`)
        .then((res) => {
          const known = new Set(dataRef.current?.items.map((i) => i.id) ?? []);
          if (res.items.some((i) => !known.has(i.id))) setNewer(res);
        })
        .catch(() => {});
    }, NEW_POSTS_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [query]);

  function showNewer() {
    if (!newer) return;
    setNewer(null);
    load();
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  function removeLocally(id: string) {
    setData((prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== id) } : prev));
  }

  return (
    <div className={wall ? 'space-y-2 sm:space-y-4' : 'space-y-4'}>
      {newer && (
        <div className="sticky top-16 z-20 flex justify-center">
          <button type="button" onClick={showNewer} className="rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-lg">
            ↑ {t('updates.new_posts')}
          </button>
        </div>
      )}
      {showComposer && data?.viewer.canPost && <Composer onPosted={load} wall={wall} />}
      {error && <p className="px-4 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="py-6 text-center text-slate-400">{t('updates.loading')}</p>}
      {data && data.items.length === 0 && <p className="py-6 text-center text-slate-500">{t('updates.empty')}</p>}
      {data?.items.map((item) => (
        <PostCard key={item.id} item={item} canReact={data.viewer.canPost} onDeleted={removeLocally} linkAuthors={linkAuthors} wall={wall} />
      ))}
      <div ref={sentinel} aria-hidden />
      {data?.nextBefore && (
        <button type="button" className="btn-secondary mx-auto block" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? t('updates.loading') : t('updates.load_more')}
        </button>
      )}
      {data && !data.nextBefore && data.items.length > 3 && <p className="py-4 text-center text-xs text-slate-400">{t('updates.all_caught_up')}</p>}
    </div>
  );
}
