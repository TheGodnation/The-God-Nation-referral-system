import { parseYoutubeVideoId } from './updates';

// ---------------------------------------------------------------------------
// Share-into-app: turning a TikTok / Instagram / Facebook / YouTube link into
// a player that shows right inside the Updates feed, so members watch it
// without leaving the app.
//
// Safety rules:
//  - Only links on the hosts listed here are ever recognised. Anything else
//    is kept as a plain link (provider OTHER) and never put in an iframe.
//  - We never store or trust an embed address sent by the phone. We store
//    the normalised link, and rebuild the embed address from it every time
//    (embedSrcFor), using fixed address patterns.
//  - Short links (vm.tiktok.com, fb.watch, facebook.com/share/…) are opened
//    by the server only for these known short-link hosts, and the address
//    they lead to must itself be one of the known hosts.
// ---------------------------------------------------------------------------

export type SocialProvider = 'YOUTUBE' | 'TIKTOK' | 'INSTAGRAM' | 'FACEBOOK' | 'OTHER';

export interface ParsedSocialLink {
  provider: SocialProvider;
  /** The cleaned-up link we store (https, no tracking bits where we can). */
  url: string;
  /** True when this needs the server to follow it to find the real post. */
  needsResolve: boolean;
}

const MAX_URL_LENGTH = 2000;

function toUrl(raw: string): URL | null {
  const text = raw.trim();
  if (!text || text.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.protocol = 'https:';
    return url;
  } catch {
    return null;
  }
}

function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^(www|m|web|mbasic|touch|mobile)\./, '');
}

const TIKTOK_SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);
const FACEBOOK_HOSTS = new Set(['facebook.com', 'fb.com']);
const FACEBOOK_SHORT_HOSTS = new Set(['fb.watch']);

/** The first web link in a piece of shared text, if any. */
export function findFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  if (!match) return null;
  // Drop punctuation that is usually the end of a sentence, not the link.
  return match[0].replace(/[).,!?;:]+$/, '');
}

/**
 * Recognises a link without going on the internet. Returns null for
 * something that isn't a web link at all.
 */
export function parseSocialLink(raw: string): ParsedSocialLink | null {
  const url = toUrl(raw);
  if (!url) return null;
  const host = bareHost(url);
  const full = url.hostname.toLowerCase();

  // YouTube — reuses the feed's existing, tested parser.
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com' || host === 'youtube-nocookie.com') {
    const id = parseYoutubeVideoId(url.toString());
    if (id) return { provider: 'YOUTUBE', url: `https://www.youtube.com/watch?v=${id}`, needsResolve: false };
    return { provider: 'OTHER', url: url.toString(), needsResolve: false };
  }

  // TikTok
  if (TIKTOK_SHORT_HOSTS.has(full)) {
    return { provider: 'TIKTOK', url: `https://${full}${url.pathname}`, needsResolve: true };
  }
  if (host === 'tiktok.com') {
    const m = url.pathname.match(/^\/(@[\w.-]+)\/(video|photo)\/(\d{6,25})/);
    if (m) return { provider: 'TIKTOK', url: `https://www.tiktok.com/${m[1]}/${m[2]}/${m[3]}`, needsResolve: false };
    if (/^\/t\/[\w-]+/.test(url.pathname)) {
      return { provider: 'TIKTOK', url: `https://www.tiktok.com${url.pathname}`, needsResolve: true };
    }
    return { provider: 'OTHER', url: url.toString(), needsResolve: false };
  }

  // Instagram — posts, reels, IGTV.
  if (host === 'instagram.com' || host === 'instagr.am') {
    const m = url.pathname.match(/^\/(?:[\w.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,40})/);
    if (m) {
      const kind = m[1] === 'reels' ? 'reel' : m[1];
      return { provider: 'INSTAGRAM', url: `https://www.instagram.com/${kind}/${m[2]}/`, needsResolve: false };
    }
    if (url.pathname.startsWith('/share/')) {
      return { provider: 'INSTAGRAM', url: `https://www.instagram.com${url.pathname}`, needsResolve: true };
    }
    return { provider: 'OTHER', url: url.toString(), needsResolve: false };
  }

  // Facebook
  if (FACEBOOK_SHORT_HOSTS.has(host)) {
    return { provider: 'FACEBOOK', url: `https://fb.watch${url.pathname}`, needsResolve: true };
  }
  if (FACEBOOK_HOSTS.has(host)) {
    if (url.pathname.startsWith('/share/')) {
      return { provider: 'FACEBOOK', url: `https://www.facebook.com${url.pathname}`, needsResolve: true };
    }
    // Keep only the parts of the address that identify the post.
    const keep = new URLSearchParams();
    for (const key of ['v', 'story_fbid', 'id', 'fbid']) {
      const value = url.searchParams.get(key);
      if (value) keep.set(key, value);
    }
    const query = keep.toString();
    return { provider: 'FACEBOOK', url: `https://www.facebook.com${url.pathname}${query ? `?${query}` : ''}`, needsResolve: false };
  }

  return { provider: 'OTHER', url: url.toString(), needsResolve: false };
}

function isFacebookVideo(url: URL): boolean {
  return /\/(videos|reel|watch)\b/.test(url.pathname) || url.pathname.startsWith('/watch') || url.searchParams.has('v');
}

/**
 * The address to load inside the feed's player, rebuilt from a stored link.
 * null means "show it as a plain link card, not a player".
 */
export function embedSrcFor(provider: SocialProvider | null | undefined, link: string | null | undefined): string | null {
  if (!provider || !link || provider === 'OTHER') return null;
  const parsed = parseSocialLink(link);
  if (!parsed || parsed.provider !== provider || parsed.needsResolve) return null;
  const url = new URL(parsed.url);

  switch (provider) {
    case 'YOUTUBE': {
      const id = url.searchParams.get('v');
      return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0` : null;
    }
    case 'TIKTOK': {
      const m = url.pathname.match(/\/(?:video|photo)\/(\d+)/);
      return m ? `https://www.tiktok.com/embed/v2/${m[1]}` : null;
    }
    case 'INSTAGRAM':
      // "captioned" shows the post's own words under the picture/video.
      return `${parsed.url}embed/captioned/`;
    case 'FACEBOOK': {
      const plugin = isFacebookVideo(url) ? 'video' : 'post';
      return `https://www.facebook.com/plugins/${plugin}.php?href=${encodeURIComponent(parsed.url)}&show_text=true&width=500`;
    }
    default:
      return null;
  }
}

/** What the feed card needs to draw the player: never a raw stored value. */
export function embedFor(provider: SocialProvider | null | undefined, link: string | null | undefined) {
  if (!provider || !link) return null;
  return { provider, url: link, src: embedSrcFor(provider, link) };
}

type FetchLike = (
  input: string,
  init?: { method?: string; redirect?: 'follow'; signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{ url: string; status: number }>;

/**
 * Finds the real post behind a short link (vm.tiktok.com/…, fb.watch/…,
 * facebook.com/share/…). Only ever called for links parseSocialLink already
 * marked needsResolve, i.e. only on these known hosts. Gives up quietly
 * after a few seconds; the caller then keeps it as a plain link.
 */
export async function resolveSocialLink(raw: string, fetcher: FetchLike = fetch as unknown as FetchLike): Promise<ParsedSocialLink | null> {
  const first = parseSocialLink(raw);
  if (!first) return null;
  if (!first.needsResolve) return first;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetcher(first.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Some of these sites only redirect a normal phone browser.
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36',
        Accept: 'text/html',
      },
    });
    const final = parseSocialLink(res.url || '');
    if (final && final.provider === first.provider && !final.needsResolve) return final;
  } catch {
    // Network trouble or timeout — fall through.
  } finally {
    clearTimeout(timer);
  }
  // Couldn't find the real post: keep the original as a plain link.
  return { provider: 'OTHER', url: first.url, needsResolve: false };
}
