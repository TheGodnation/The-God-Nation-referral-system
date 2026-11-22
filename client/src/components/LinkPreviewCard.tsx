import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useDataSaver } from '../lib/dataSaver';

interface Preview {
  url: string;
  title: string;
  description: string;
  image: string | null;
  site: string;
}

/** The first web link in a piece of text, without the punctuation that ends a sentence. */
export function firstUrl(text: string | null | undefined): string | null {
  const match = text?.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[).,!?;:]+$/, '') : null;
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
export function LinkPreviewCard({ text }: { text: string | null | undefined }) {
  const url = firstUrl(text);
  const saver = useDataSaver();
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

  if (!url || !preview) return null;
  // Our own pages open in the same tab; other sites in a new one.
  let own = false;
  try {
    own = new URL(url).origin === window.location.origin;
  } catch {
    own = false;
  }
  return (
    <a
      href={url}
      {...(own ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
      className="mt-2 block overflow-hidden rounded-xl border border-slate-200 bg-white text-left no-underline shadow-sm"
      data-testid="link-preview"
    >
      {preview.image && !saver && !imageFailed && (
        <img src={preview.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} className="aspect-[1.91/1] w-full bg-slate-100 object-cover" />
      )}
      <span className="block px-3 py-2">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{preview.site}</span>
        <span className="line-clamp-2 block text-sm font-bold text-slate-900">{preview.title}</span>
        {preview.description && <span className="line-clamp-2 block text-xs text-slate-600">{preview.description}</span>}
      </span>
    </a>
  );
}
