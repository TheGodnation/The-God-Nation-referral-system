import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../lib/api';
import { useDataSaver } from '../lib/dataSaver';

interface Preview {
  url: string;
  title: string;
  description: string;
  image: string | null;
  site: string;
}

/**
 * The first web link in a piece of text, without the punctuation that ends a sentence. A link written between < and > was sent
 * with its preview card taken off, so it is not counted.
 */
export function firstUrl(text: string | null | undefined): string | null {
  for (const m of (text ?? '').matchAll(/(<)?(https?:\/\/[^\s<>"']+)(>)?/gi)) {
    if (!m[1]) return m[2].replace(/[).,!?;:]+$/, '');
  }
  return null;
}

/** The message with its first link put between < and >: it is sent without a preview card. */
export function withoutPreview(body: string): string {
  const url = firstUrl(body);
  return url ? body.replace(url, `<${url}>`) : body;
}

// One answer per link for the whole visit, so a chat with the same link many times asks once.
const cache = new Map<string, Preview | null>();
const pending = new Map<string, Promise<Preview | null>>();

function load(url: string): Promise<Preview | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);
  let request = pending.get(url);
  if (!request) {
    request = api
      .get<{ preview: Preview | null }>(`/api/member/link-preview?url=${encodeURIComponent(url)}`)
      .then((r) => r.preview ?? null)
      .catch(() => null)
      .then((p) => {
        cache.set(url, p);
        pending.delete(url);
        return p;
      });
    pending.set(url, request);
  }
  return request;
}

/** For tests: forget what was learned about links. */
export function clearLinkPreviewCache(): void {
  cache.clear();
  pending.clear();
}

// The small card under a link in a chat message or a post (picture, title, first lines), like WhatsApp's. Nothing is shown while it
// loads, for a link that has no preview, or when the answer cannot be had (offline): the message stays as it was.
export function LinkPreviewCard({ text, onDismiss, debounceMs = 0 }: { text: string | null | undefined; /** While typing: the card is shown smaller, with a button that takes it off. */ onDismiss?: (url: string) => void; /** While typing: wait for the link to be finished before asking. */ debounceMs?: number }) {
  const found = firstUrl(text);
  const [url, setUrl] = useState(found);
  // While typing, the link changes with every letter: only the finished one is asked for.
  useEffect(() => {
    if (!debounceMs) return setUrl(found);
    const timer = window.setTimeout(() => setUrl(found), debounceMs);
    return () => window.clearTimeout(timer);
  }, [found, debounceMs]);
  const saver = useDataSaver();
  const { t } = useTranslation();
  const [preview, setPreview] = useState<Preview | null>(url ? (cache.get(url) ?? null) : null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (!url) {
      setPreview(null);
      return;
    }
    let alive = true;
    void load(url).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [url]);

  if (!url || !preview || url !== found) return null;
  // Our own pages open in the same tab; other sites in a new one.
  let own = false;
  try {
    own = new URL(url).origin === window.location.origin;
  } catch {
    own = false;
  }
  const typing = Boolean(onDismiss);
  const image = preview.image && !saver && !imageFailed ? preview.image : null;
  return (
    <div className={`relative ${typing ? 'mb-2' : ''}`} data-testid={typing ? 'link-preview-typing' : undefined}>
      <a
        href={url}
        {...(own ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
        className={`${typing ? 'flex items-stretch' : 'mt-2 block'} overflow-hidden rounded-xl border border-slate-200 bg-white text-left no-underline shadow-sm`}
        data-testid="link-preview"
      >
        {image && (
          <img
            src={image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className={typing ? 'h-20 w-20 shrink-0 bg-slate-100 object-cover' : 'aspect-[1.91/1] w-full bg-slate-100 object-cover'}
          />
        )}
        <span className={`block min-w-0 ${typing ? 'flex-1 py-2 pl-3 pr-9' : 'px-3 py-2'}`}>
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{preview.site}</span>
          <span className="line-clamp-2 block text-sm font-bold text-slate-900">{preview.title}</span>
          {preview.description && <span className="line-clamp-2 block text-xs text-slate-600">{preview.description}</span>}
        </span>
      </a>
      {onDismiss && (
        <button type="button" onClick={() => onDismiss(url)} aria-label={t('linkPreview.remove') ?? ''} className="absolute right-1 top-1 rounded-full bg-white/90 px-2 text-lg leading-none text-slate-600 shadow" data-testid="link-preview-dismiss">
          ×
        </button>
      )}
    </div>
  );
}
