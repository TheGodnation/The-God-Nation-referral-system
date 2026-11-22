import dns from 'dns';
import net from 'net';
import { prisma } from './prisma';
import { APP_URL } from './env';
import { excerpt, cardImageFile, pageSlugOf, newsPathOf } from './ogMeta';
import { sharedPreview } from './sharedPosts';

// The small preview card under a link someone sends in a chat or a post (picture, title, first lines), like WhatsApp's.
// Our own links are answered straight from our database. Any other link is read on the internet by the server, with these
// protections: only http/https on the normal ports, never a private or internal address (checked again after every redirect),
// a few seconds at most, a small page at most, and only a few fields leave this file (never the page itself).

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string | null;
  site: string;
}

const MAX_BYTES = 256 * 1024;
const TIMEOUT_MS = 4000;
const MAX_REDIRECTS = 3;
const TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE = 500;

/** Whether an IP address is on the open internet (not loopback, private, link-local, shared or reserved). */
export function isPublicAddress(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // shared address space
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && c === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    if (x === '::' || x === '::1') return false;
    if (/^f[cd]/.test(x)) return false; // unique local
    if (/^fe[89ab]/.test(x)) return false; // link-local
    if (x.startsWith('ff')) return false;
    return true;
  }
  return false;
}

type Lookup = (host: string) => Promise<string[]>;
const defaultLookup: Lookup = async (host) => (await dns.promises.lookup(host, { all: true })).map((a) => a.address);

/** A link the server may fetch: http/https, the usual port, no login in it, and a name that points only at public addresses. */
async function safeUrl(raw: string, lookup: Lookup): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null;
  if (net.isIP(host)) return isPublicAddress(host) ? url : null;
  try {
    const addresses = await lookup(host);
    return addresses.length > 0 && addresses.every(isPublicAddress) ? url : null;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);

/** The title, sentence and picture a page announces for itself (Open Graph / Twitter tags, then the plain title). */
export function parseOpenGraph(html: string, baseUrl: string): Omit<LinkPreview, 'url'> | null {
  const head = html.slice(0, MAX_BYTES);
  const meta: Record<string, string> = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const value = /content\s*=\s*"([^"]*)"|content\s*=\s*'([^']*)'/i.exec(tag);
    if (key && value && meta[key] === undefined) meta[key] = decode(value[1] ?? value[2] ?? '');
  }
  const pageTitle = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const title = (meta['og:title'] || meta['twitter:title'] || (pageTitle ? decode(pageTitle) : '')).replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const description = (meta['og:description'] || meta['twitter:description'] || meta['description'] || '').replace(/\s+/g, ' ').trim();
  let image: string | null = null;
  const rawImage = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'];
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, baseUrl);
      if (resolved.protocol === 'https:' && resolved.href.length <= 600) image = resolved.href;
    } catch {
      image = null;
    }
  }
  const site = (meta['og:site_name'] || new URL(baseUrl).hostname.replace(/^www\./, '')).trim();
  return { title: excerpt(title, 140), description: excerpt(description, 220), image, site };
}

type Fetcher = typeof fetch;

/** Reads at most MAX_BYTES of an HTML page; null when it is not HTML, too slow or not found. */
async function readPage(start: URL, lookup: Lookup, fetcher: Fetcher): Promise<{ html: string; finalUrl: string } | null> {
  let current: URL | null = start;
  for (let hop = 0; hop <= MAX_REDIRECTS && current; hop++) {
    const res: Response = await fetcher(current.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'TheGodNationLinkPreview/1.0 (+https://thegodnationacademy.org)', Accept: 'text/html,application/xhtml+xml' },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      current = location ? await safeUrl(new URL(location, current).href, lookup) : null; // every hop is checked again
      continue;
    }
    if (!res.ok || !/text\/html|application\/xhtml/i.test(res.headers.get('content-type') ?? '') || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (total < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.length;
    }
    await reader.cancel().catch(() => {});
    return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: current.href };
  }
  return null;
}

const cache = new Map<string, { at: number; value: LinkPreview | null }>();

function remember(key: string, value: LinkPreview | null): void {
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: Date.now(), value });
}

export function clearLinkPreviewCache(): void {
  cache.clear();
}

const sameSite = (url: URL): boolean => {
  const own = new URL(APP_URL).hostname.replace(/^www\./, '');
  return url.hostname.toLowerCase().replace(/^www\./, '') === own;
};

/** A link to one of our own pages, answered from our own database (no trip on the internet). */
async function ownPreview(url: URL): Promise<LinkPreview | null> {
  const base = APP_URL.replace(/\/+$/, '');
  const lang: 'en' | 'fr' = url.searchParams.get('lang') === 'fr' ? 'fr' : 'en';
  const site = 'The God Nation';
  const news = newsPathOf(url.pathname);
  if (news) {
    const p = await sharedPreview(news.kind, news.id, lang);
    if (!p) return null;
    return { url: url.href, title: p.title, description: p.text, image: p.image ? `${base}/${p.image}` : `${base}/${cardImageFile(lang)}`, site };
  }
  const slug = pageSlugOf(url.pathname);
  if (slug) {
    const row = await prisma.contentPage.findFirst({ where: { slug, published: true }, select: { titleEn: true, titleFr: true, bodyEn: true, bodyFr: true } });
    if (!row) return null;
    const fr = lang === 'fr' && row.titleFr;
    return { url: url.href, title: fr ? row.titleFr! : row.titleEn, description: excerpt((fr ? row.bodyFr : row.bodyEn) ?? row.bodyEn), image: `${base}/${cardImageFile(lang)}`, site };
  }
  return null;
}

export async function linkPreview(rawUrl: string, deps: { lookup?: Lookup; fetcher?: Fetcher } = {}): Promise<LinkPreview | null> {
  const lookup = deps.lookup ?? defaultLookup;
  const fetcher = deps.fetcher ?? fetch;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (rawUrl.length > 1000) return null;
  const key = parsed.href;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.value ? TTL_MS : NEGATIVE_TTL_MS)) return hit.value;

  let value: LinkPreview | null = null;
  try {
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (sameSite(parsed)) {
      value = await ownPreview(parsed);
    } else {
      const url = await safeUrl(parsed.href, lookup);
      const page = url ? await readPage(url, lookup, fetcher) : null;
      const og = page ? parseOpenGraph(page.html, page.finalUrl) : null;
      value = og ? { url: parsed.href, ...og } : null;
    }
  } catch {
    value = null;
  }
  remember(key, value);
  return value;
}
