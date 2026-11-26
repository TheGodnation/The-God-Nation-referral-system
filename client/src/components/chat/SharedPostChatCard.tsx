import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { RichText, plainPreview } from '../../lib/richText';
import { SocialEmbed, type SocialEmbedInfo } from '../updates/SocialEmbed';

// A link to one of our own shared posts (…/news/post/<id>), sent in an assembly or group chat, shown as a bold card: the picture
// (whole), a gold "The God Nation" label, the title in big bold letters, the first lines and "Read more". "Read more" opens the
// whole post over the chat, large and easy to read; closing it (or the phone's back button) leaves the reader where they were in
// the chat. When the post cannot be loaded (sharing stopped, offline) nothing is shown here and the ordinary link card is used.

interface Bi {
  en: string;
  fr: string;
}
export interface SharedPostData {
  kind: 'post' | 'announcement' | 'update';
  id: string;
  title: Bi;
  body: Bi;
  author: string;
  publishedAt: string | null;
  embed: SocialEmbedInfo | null;
  photos?: { url: string }[];
}

const OWN_HOSTS = ['thegodnationacademy.org', 'www.thegodnationacademy.org'];

/** The shared post a link points to, when it is one of ours: { kind, id }. */
export function sharedPostLink(url: string | null | undefined): { kind: SharedPostData['kind']; id: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const ours = OWN_HOSTS.includes(u.hostname) || (typeof window !== 'undefined' && u.origin === window.location.origin);
    const m = /^\/news\/(post|announcement|update)\/([A-Za-z0-9-]+)\/?$/.exec(u.pathname);
    return ours && m ? { kind: m[1] as SharedPostData['kind'], id: m[2] } : null;
  } catch {
    return null;
  }
}

// One answer per post for the whole visit (a chat may hold the same link many times).
const cache = new Map<string, SharedPostData | null>();
const pending = new Map<string, Promise<SharedPostData | null>>();
function loadShared(kind: string, id: string): Promise<SharedPostData | null> {
  const key = `${kind}/${id}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  let request = pending.get(key);
  if (!request) {
    request = api
      .get<SharedPostData>(`/api/shared/${kind}/${id}`)
      .then((r) => (r && r.title ? r : null))
      .catch(() => null)
      .then((r) => {
        cache.set(key, r);
        pending.delete(key);
        return r;
      });
    pending.set(key, request);
  }
  return request;
}
/** For tests. */
export function clearSharedPostCardCache(): void {
  cache.clear();
  pending.clear();
}

/** The bold card, or `fallback` (the ordinary link card) while it is not known to be one of our posts that can be shown. */
export function SharedPostChatCard({ url, fallback }: { url: string; fallback: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const link = sharedPostLink(url);
  const key = link ? `${link.kind}/${link.id}` : '';
  const [post, setPost] = useState<SharedPostData | null | undefined>(link ? cache.get(key) : null);
  const [reading, setReading] = useState(false);
  useEffect(() => {
    if (!link) return;
    let alive = true;
    void loadShared(link.kind, link.id).then((p) => alive && setPost(p));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!link || post === null) return <>{fallback}</>;
  if (post === undefined) return null; // a moment while it loads
  const fr = i18n.language.startsWith('fr');
  const title = (fr && post.title.fr) || post.title.en;
  const body = (fr && post.body.fr) || post.body.en;
  const photo = post.photos?.[0]?.url ?? null;
  return (
    <>
      <div className="mt-2 overflow-hidden rounded-2xl border-2 border-gold-400 bg-white text-left shadow-md" data-testid="shared-post-card">
        {photo && (
          <button type="button" onClick={() => setReading(true)} className="block w-full bg-brand-950/5" aria-label={title}>
            <img src={photo} alt="" loading="lazy" className="mx-auto max-h-80 w-full object-contain" />
          </button>
        )}
        <div className="px-3 pb-3 pt-2">
          <span className="inline-block rounded-full bg-gold-400 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-900">📣 {t('chatPostCard.label')}</span>
          <p className="mt-1.5 text-lg font-extrabold leading-snug text-brand-900">{title}</p>
          <p className="mt-1 line-clamp-3 text-sm text-slate-700">{plainPreview(body)}</p>
          <button type="button" onClick={() => setReading(true)} className="mt-2 rounded-xl bg-brand-700 px-4 py-2 text-sm font-bold text-white shadow" data-testid="shared-post-read-more">
            {t('chatPostCard.read_more')}
          </button>
        </div>
      </div>
      {reading && <SharedPostReader post={post} title={title} body={body} onClose={() => setReading(false)} />}
    </>
  );
}

/** The whole post over the chat. Closing it, or the phone's back button, returns to the chat exactly where it was. */
function SharedPostReader({ post, title, body, onClose }: { post: SharedPostData; title: string; body: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const pushed = useRef(false);
  useEffect(() => {
    // The phone's back button closes the post instead of leaving the chat.
    try {
      window.history.pushState({ ...(window.history.state ?? {}), sharedPostReader: true }, '');
      pushed.current = true;
    } catch {
      pushed.current = false;
    }
    const onPop = () => {
      pushed.current = false;
      onClose();
    };
    window.addEventListener('popstate', onPop);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('popstate', onPop);
      document.body.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function close() {
    if (pushed.current) {
      pushed.current = false;
      window.history.back(); // closes through the popstate above
    } else onClose();
  }
  const date = post.publishedAt ? new Date(post.publishedAt).toLocaleDateString(i18n.language.startsWith('fr') ? 'fr' : 'en') : '';
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label={title} data-testid="shared-post-reader">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] shadow-sm">
        <button type="button" onClick={close} className="rounded-full px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50" data-testid="shared-post-back">
          ← {t('chatPostCard.back')}
        </button>
      </div>
      <article className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 pb-10 pt-4">
        <span className="inline-block rounded-full bg-gold-400 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-brand-900">📣 {t('chatPostCard.label')}</span>
        <h2 className="mt-2 text-2xl font-extrabold leading-tight text-brand-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {post.author}
          {date ? ` · ${date}` : ''}
        </p>
        {post.photos && post.photos.length > 0 && (
          <div className="mt-4 space-y-3">
            {post.photos.map((ph) => (
              <img key={ph.url} src={ph.url} alt="" loading="lazy" className="w-full rounded-xl bg-slate-100 object-contain" />
            ))}
          </div>
        )}
        <RichText text={body} headings comfort className="mt-5 text-base leading-relaxed text-slate-800" data-testid="shared-post-reader-body" />
        {post.embed && (
          <div className="mt-5">
            <SocialEmbed embed={post.embed} />
          </div>
        )}
        <button type="button" onClick={close} className="mt-8 w-full rounded-xl border-2 border-brand-700 px-4 py-3 font-bold text-brand-800">
          ← {t('chatPostCard.back')}
        </button>
      </article>
    </div>
  );
}
