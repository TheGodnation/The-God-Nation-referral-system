import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../lib/api';
import { Avatar } from './Avatar';
import { VoiceInputButton } from './VoiceInputButton';

// Phase 2 — Prayer requests. A Member/Leader shares a request either
// PUBLIC (same flat, everyone-sees-it feed shape as Updates) or PRIVATE
// (seen only by themselves, Admin, and their own Community's Leaders — a
// confidential pastoral-care inbox). Encouragement is comments only — no
// separate reaction/counter, by explicit design choice. Used identically
// on the member Prayer page, the Leader dashboard and the Admin dashboard;
// an Admin viewer (no Person identity) can see and moderate but never
// compose or comment.

interface Author {
  personId: string;
  name: string;
  photoUrl: string | null;
}

interface PrayerRequestItem {
  id: string;
  author: Author;
  body: string;
  visibility: 'PUBLIC' | 'PRIVATE';
  community: { id: string; name: string } | null;
  createdAt: string;
  commentCount: number;
  canDelete: boolean;
}

interface FeedResponse {
  viewer: { canPost: boolean; personId: string | null };
  items: PrayerRequestItem[];
  nextBefore: string | null;
}

interface CommentItem {
  id: string;
  author: Author;
  body: string;
  createdAt: string;
  canDelete: boolean;
}

function formatWhen(iso: string, language: string) {
  return new Date(iso).toLocaleString(language.startsWith('fr') ? 'fr-FR' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Composer({ onPosted }: { onPosted: () => void }) {
  const { t } = useTranslation();
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PUBLIC');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setPosting(true);
    setError(null);
    try {
      await api.post('/api/prayer-requests', { body: body.trim(), visibility });
      setBody('');
      setVisibility('PUBLIC');
      onPosted();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'NO_COMMUNITY') setError(t('prayerRequests.no_community'));
      else if (err instanceof ApiError && err.code === 'COMMUNITY_REQUIRED') setError(t('prayerRequests.community_required'));
      else if (err instanceof ApiError) setError(err.message);
      else setError(t('prayerRequests.post_failed'));
    } finally {
      setPosting(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-3">
      <textarea
        className="w-full resize-none rounded-2xl border-0 bg-slate-100 px-4 py-3 text-[16px] outline-none focus:ring-2 focus:ring-brand-200"
        rows={3}
        aria-label={t('prayerRequests.compose_label') ?? ''}
        placeholder={t('prayerRequests.compose_placeholder') ?? ''}
        value={body}
        maxLength={2000}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" name="prayer-visibility" checked={visibility === 'PUBLIC'} onChange={() => setVisibility('PUBLIC')} />
            {t('prayerRequests.visibility_public')}
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" name="prayer-visibility" checked={visibility === 'PRIVATE'} onChange={() => setVisibility('PRIVATE')} />
            {t('prayerRequests.visibility_private')}
          </label>
          <VoiceInputButton onResult={(transcript) => setBody((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript))} />
        </div>
        <button type="submit" className="btn-primary px-5 py-1.5" disabled={posting || !body.trim()}>
          {posting ? t('prayerRequests.posting') : t('prayerRequests.post')}
        </button>
      </div>
      <p className="text-xs text-slate-500">
        {visibility === 'PUBLIC' ? t('prayerRequests.visibility_public_hint') : t('prayerRequests.visibility_private_hint')}
      </p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
  );
}

function CommentForm({ requestId, onSent }: { requestId: string; onSent: () => void }) {
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
      await api.post(`/api/prayer-requests/${requestId}/comments`, { body: draft.trim() });
      setDraft('');
      onSent();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('prayerRequests.comment_failed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} className="space-y-1">
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-full border-0 bg-slate-100 px-4 py-2 text-[15px] outline-none focus:ring-2 focus:ring-brand-200"
          aria-label={t('prayerRequests.comment_label') ?? ''}
          placeholder={t('prayerRequests.comment_placeholder') ?? ''}
          value={draft}
          maxLength={1000}
          onChange={(e) => setDraft(e.target.value)}
        />
        <VoiceInputButton onResult={(transcript) => setDraft((prev) => (prev.trim() ? `${prev.trim()} ${transcript}` : transcript))} />
        <button type="submit" className="btn-primary rounded-full px-4" disabled={sending || !draft.trim()}>
          {t('prayerRequests.send')}
        </button>
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}
    </form>
  );
}

function Comments({ requestId, canComment, onCountChange }: { requestId: string; canComment: boolean; onCountChange: (n: number) => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  function load() {
    api
      .get<{ items: CommentItem[] }>(`/api/prayer-requests/${requestId}/comments`)
      .then((res) => {
        setItems(res.items);
        onCountChange(res.items.length);
      })
      .catch(() => setError(t('prayerRequests.comments_failed')));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [requestId]);

  async function remove(id: string) {
    if (!window.confirm(t('prayerRequests.confirm_delete_comment') ?? '')) return;
    try {
      await api.delete(`/api/prayer-requests/comments/${id}`);
      load();
    } catch {
      setError(t('prayerRequests.delete_failed'));
    }
  }

  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      {items === null && !error && <p className="text-sm text-slate-400">{t('prayerRequests.loading')}</p>}
      {items?.map((c) => (
        <div key={c.id} className="flex gap-2">
          <Avatar name={c.author.name} photoUrl={c.author.photoUrl} size={28} />
          <div className="min-w-0 flex-1">
            <div className="inline-block max-w-full rounded-2xl bg-slate-100 px-3 py-2">
              <span className="block text-sm font-semibold text-slate-900">{c.author.name}</span>
              <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{c.body}</p>
            </div>
            {c.canDelete && (
              <button type="button" className="ml-2 mt-1 text-xs font-semibold text-red-700 hover:underline" onClick={() => void remove(c.id)}>
                {t('prayerRequests.delete')}
              </button>
            )}
          </div>
        </div>
      ))}
      {items?.length === 0 && <p className="text-sm text-slate-400">{t('prayerRequests.no_comments')}</p>}
      {canComment && <CommentForm requestId={requestId} onSent={load} />}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

function RequestCard({ item, canComment, onDeleted }: { item: PrayerRequestItem; canComment: boolean; onDeleted: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(item.commentCount);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(t('prayerRequests.confirm_delete') ?? '')) return;
    try {
      await api.delete(`/api/prayer-requests/${item.id}`);
      onDeleted(item.id);
    } catch {
      setError(t('prayerRequests.delete_failed'));
    }
  }

  return (
    <article className="card space-y-2" aria-label={t('prayerRequests.request_by', { name: item.author.name }) ?? ''}>
      <header className="flex items-center gap-3">
        <Avatar name={item.author.name} photoUrl={item.author.photoUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-slate-900">{item.author.name}</p>
          <p className="text-xs text-slate-500">
            {formatWhen(item.createdAt, i18n.language)}
            {item.visibility === 'PRIVATE' && (
              <> · 🔒 {item.community ? t('prayerRequests.private_to', { community: item.community.name }) : t('prayerRequests.visibility_private')}</>
            )}
          </p>
        </div>
        {item.canDelete && (
          <button type="button" className="rounded-full p-2 text-slate-500 hover:bg-slate-100" aria-label={t('prayerRequests.delete') ?? ''} onClick={remove}>
            🗑
          </button>
        )}
      </header>
      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-900">{item.body}</p>
      <button type="button" className="text-sm font-semibold text-slate-500 hover:underline" onClick={() => setShowComments((v) => !v)}>
        🙏 {t('prayerRequests.comment_count', { count: commentCount })}
      </button>
      {showComments && <Comments requestId={item.id} canComment={canComment} onCountChange={setCommentCount} />}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </article>
  );
}

export function PrayerRequests() {
  const { t } = useTranslation();
  const [scope, setScope] = useState<'public' | 'private'>('public');
  const [data, setData] = useState<FeedResponse | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef<FeedResponse | null>(null);
  dataRef.current = data;

  function load() {
    setData(null);
    setError(null);
    api
      .get<FeedResponse>(`/api/prayer-requests?scope=${scope}`)
      .then(setData)
      .catch(() => setError(t('prayerRequests.load_failed')));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [scope]);

  async function loadMore() {
    const current = dataRef.current;
    if (!current?.nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const more = await api.get<FeedResponse>(`/api/prayer-requests?scope=${scope}&before=${encodeURIComponent(current.nextBefore)}`);
      setData((prev) => (prev ? { ...more, items: [...prev.items, ...more.items.filter((m) => !prev.items.some((p) => p.id === m.id))] } : more));
    } catch {
      setError(t('prayerRequests.load_failed'));
    } finally {
      setLoadingMore(false);
    }
  }

  function removeLocally(id: string) {
    setData((prev) => (prev ? { ...prev, items: prev.items.filter((i) => i.id !== id) } : prev));
  }

  return (
    <section className="space-y-3" aria-label={t('prayerRequests.title') ?? ''}>
      <h2 className="text-lg font-bold text-brand-900">🙏 {t('prayerRequests.title')}</h2>
      <div className="flex gap-2" role="tablist" aria-label={t('prayerRequests.scope_label') ?? ''}>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'public'}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold ${scope === 'public' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 shadow-sm'}`}
          onClick={() => setScope('public')}
        >
          {t('prayerRequests.scope_public')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'private'}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold ${scope === 'private' ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 shadow-sm'}`}
          onClick={() => setScope('private')}
        >
          {t('prayerRequests.scope_private')}
        </button>
      </div>
      {scope === 'private' && <p className="text-xs text-slate-500">{t('prayerRequests.private_tab_hint')}</p>}
      {data?.viewer.canPost && <Composer onPosted={load} />}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="py-6 text-center text-slate-400">{t('prayerRequests.loading')}</p>}
      {data && data.items.length === 0 && <p className="py-6 text-center text-slate-500">{t('prayerRequests.empty')}</p>}
      {data?.items.map((item) => (
        <RequestCard key={item.id} item={item} canComment={data.viewer.canPost} onDeleted={removeLocally} />
      ))}
      {data?.nextBefore && (
        <button type="button" className="btn-secondary mx-auto block" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? t('prayerRequests.loading') : t('prayerRequests.load_more')}
        </button>
      )}
    </section>
  );
}
